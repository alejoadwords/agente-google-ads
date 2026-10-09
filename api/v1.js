// api/v1.js — API pública de Acuarius
//
// Para que un sistema externo —el agente de un cliente, su app, su ERP— opere
// una cuenta como lo haría una persona del equipo: leer prospectos, moverlos
// de etapa, asignarlos, dejar notas, crear tareas y citas.
//
// Tres reglas que no se negocian:
//
//   1. Todo pasa por las MISMAS reglas que la interfaz. Mover a Ganado pide
//      motivo, sella la fecha de cierre, anula las tareas pendientes y dispara
//      las automatizaciones y la venta a la pauta. Si la API se saltara algo de
//      eso, un agente dejaría la cuenta en un estado al que ninguna persona
//      puede llegar, y los reportes dejarían de cuadrar.
//   2. Todo queda firmado en el historial con el nombre de la llave («Agente de
//      Karvio»). Tres días después alguien va a preguntar quién movió esto.
//   3. Nunca borra. No hay un solo DELETE de datos del CRM.
//
// La rutas llegan como /api/v1/<ruta> y vercel.json las reescribe a
// /api/v1?ruta=<ruta>: un solo fichero en vez de una función por recurso, así
// la autenticación, los límites y el registro viven en un solo sitio y
// ninguna ruta nueva puede nacer sin ellos.
//
// Sin CORS a propósito: la llave da acceso a la cuenta entera y no debe vivir
// en un navegador. Desde un servidor funciona igual.

export const config = { runtime: 'edge' };

import {
  sbHeaders, pareceLlave, sha256Hex, cuentaConApi, CLAVES_PERMISOS, PERMISOS, EVENTOS,
  limiteCuentaMinuto, creadorVigente, avisarDueno, fechaAviso,
} from './_api-llaves.js';
import { estaSuspendido, esDelEquipo } from './_perfiles.js';
import { intakeLead, ambitoDeTrabajo, enqueueAutomations, ensureCatalog, normTag } from './_lead-intake.js';
import { moverDePipeline, telClave } from './leads.js';
import { comercialesActivos, duenoComoComercial, avisarComercial } from './_assign.js';
import { getGcalToken, gcalEventBody, gcalRequest, gcalEnSuCalendario } from './_gcal.js';
import { enviarPushA } from './_push.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const DOCS = 'https://app.acuarius.app/api-docs.html';

// Mismas etapas cerradas que api/leads.js, agenda.js y cron-tasks.js.
const ETAPAS_CERRADAS = ['ganado', 'perdido', 'won', 'lost', 'cerrado', 'descartado'];
// Las etapas de un lead sin proceso (cuentas de antes de los procesos, y las
// que nunca sembraron etapas): las que siembra pipeline-stages.js.
const ETAPAS_POR_DEFECTO = ['nuevo', 'contactado', 'calificado', 'propuesta', 'negociacion', 'ganado', 'perdido'];
const CAMPOS_LEAD = 'id,name,email,phone,company,stage,pipeline_id,client_id,assigned_to,assigned_name,value,source,tags,custom_fields,notes,created_at,updated_at,closed_at,close_reason,close_currency,expected_close_date';
const PLAN_LEADS = { free: 50, pro: 1000, individual: 1000, trial: 1000, agency: 5000, agencia: 5000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Respuestas ───────────────────────────────────────────────────────────────

class ErrorApi extends Error {
  constructor(estado, codigo, mensaje, extra) {
    super(mensaje);
    this.estado = estado; this.codigo = codigo; this.extra = extra || null;
  }
}
const fallo = (estado, codigo, mensaje, extra) => { throw new ErrorApi(estado, codigo, mensaje, extra); };

function json(cuerpo, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabeceras },
  });
}

// Supabase con el error a la vista: un fallo de la base NUNCA se convierte en
// una lista vacía. Un agente que lee «no hay prospectos» cuando la consulta
// falló toma decisiones sobre algo que no es verdad.
async function sb(ruta, { method = 'GET', body, prefer, cabeceras } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, {
    method,
    headers: sbHeaders({ ...(prefer ? { Prefer: prefer } : {}), ...(cabeceras || {}) }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    const e = new Error(`Supabase ${method} ${ruta.split('?')[0]} → ${r.status}: ${txt.slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
  if (r.status === 204 || prefer === 'return=minimal') return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ── Lectura y validación de lo que llega ────────────────────────────────────

function texto(v, max, campo, { requerido = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (requerido) fallo(422, 'falta_campo', `Falta «${campo}».`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') fallo(422, 'campo_invalido', `«${campo}» tiene que ser texto.`);
  const s = String(v).trim();
  if (requerido && !s) fallo(422, 'falta_campo', `Falta «${campo}».`);
  return s.slice(0, max) || null;
}

function uuid(v, campo) {
  if (!UUID.test(String(v || ''))) fallo(422, 'id_invalido', `«${campo}» no es un id válido.`);
  return String(v).toLowerCase();
}

// Fecha y hora con zona, obligatoria. Sin zona, «10:00» puede ser Bogotá o
// Madrid y la cita cae seis horas corrida. Se valida la FORMA antes de
// parsear: V8 rescata una fecha de casi cualquier texto (new Date('basura') +
// zona devuelve el año 2000), y así nacían tareas vencidas hace 26 años.
function fechaHora(v, campo, { requerido = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (requerido) fallo(422, 'falta_campo', `Falta «${campo}».`);
    return null;
  }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    fallo(422, 'fecha_invalida', `«${campo}» tiene que ser fecha y hora con zona horaria, por ejemplo 2026-10-09T15:00:00-05:00.`);
  }
  const d = new Date(s);
  const MIN = Date.UTC(2020, 0, 1), MAX = Date.now() + 5 * 365 * 86400000;
  if (isNaN(d) || d.getTime() < MIN || d.getTime() > MAX) fallo(422, 'fecha_invalida', `«${campo}» está fuera de rango.`);
  return d.toISOString();
}

function fechaDia(v, campo) {
  if (v === undefined || v === null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) fallo(422, 'fecha_invalida', `«${campo}» tiene que ser AAAA-MM-DD.`);
  const d = new Date(String(v) + 'T12:00:00-05:00');
  if (isNaN(d)) fallo(422, 'fecha_invalida', `«${campo}» no es una fecha.`);
  return String(v);
}

function numero(v, campo) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e12) fallo(422, 'campo_invalido', `«${campo}» tiene que ser un número positivo.`);
  return n;
}

function entero(v, def, min, max) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

// Para buscar dentro de un filtro `or=(...)` de PostgREST: se quitan los
// caracteres que abren otra condición. Sin esto, un texto de búsqueda podría
// añadir filtros propios a la consulta.
function paraBuscar(s) {
  return String(s || '').replace(/[,()*:\\"'%]/g, ' ').trim().slice(0, 60);
}

function sinTildes(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Contexto de la cuenta ────────────────────────────────────────────────────

// Filtro de alcance: una llave atada a un cliente solo ve ese cliente.
function alcance(ctx) {
  return ctx.cliente ? `&client_id=eq.${encodeURIComponent(ctx.cliente)}` : '';
}

async function etapasDeCuenta(ctx) {
  if (!ctx._etapas) {
    ctx._etapas = await sb(`/pipeline_stages?user_id=eq.${encodeURIComponent(ctx.cuenta)}` +
      `&select=key,label,position,pipeline_id,client_id,al_entrar&order=position.asc`) || [];
  }
  return ctx._etapas;
}

async function procesosDeCuenta(ctx) {
  if (!ctx._procesos) {
    ctx._procesos = await sb(`/pipelines?user_id=eq.${encodeURIComponent(ctx.cuenta)}${alcance(ctx)}` +
      `&select=id,name,client_id,is_default,position&order=position.asc`) || [];
  }
  return ctx._procesos;
}

async function etapasDelLead(ctx, lead) {
  const todas = await etapasDeCuenta(ctx);
  let propias = lead.pipeline_id
    ? todas.filter(s => s.pipeline_id === lead.pipeline_id)
    : todas.filter(s => !s.pipeline_id && (s.client_id || null) === (lead.client_id || null));
  if (!propias.length && !lead.pipeline_id) propias = todas.filter(s => !s.pipeline_id);
  if (!propias.length) {
    propias = ETAPAS_POR_DEFECTO.map((k, i) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), position: i + 1 }));
  }
  return propias;
}

function tipoDeCierre(key) {
  if (key === 'ganado') return 'ganado';
  if (key === 'perdido') return 'perdido';
  return null;
}

async function leadFormateado(ctx, l) {
  if (!l) return null;
  const etapas = await etapasDelLead(ctx, l);
  const procesos = await procesosDeCuenta(ctx);
  const et = etapas.find(s => s.key === l.stage);
  const pr = procesos.find(p => p.id === l.pipeline_id);
  return {
    id: l.id,
    name: l.name,
    email: l.email,
    phone: l.phone,
    company: l.company,
    stage: l.stage,
    stage_label: et?.label || l.stage,
    pipeline_id: l.pipeline_id,
    pipeline_name: pr?.name || null,
    client_id: l.client_id,
    assigned_to: l.assigned_to,
    assigned_name: l.assigned_name,
    value: l.value === null || l.value === undefined ? null : Number(l.value),
    source: l.source,
    tags: l.tags || [],
    custom_fields: l.custom_fields || {},
    notes: l.notes || null,
    expected_close_date: l.expected_close_date,
    closed_at: l.closed_at,
    close_reason: l.close_reason,
    close_currency: l.close_currency,
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

async function leerLead(ctx, id) {
  const filas = await sb(`/leads?id=eq.${uuid(id, 'id')}&user_id=eq.${encodeURIComponent(ctx.cuenta)}` +
    `&deleted_at=is.null${alcance(ctx)}&select=${CAMPOS_LEAD}&limit=1`);
  const l = filas?.[0];
  if (!l) fallo(404, 'no_encontrado', 'No hay ningún prospecto con ese id en esta cuenta.');
  return l;
}

// Línea del historial firmada por la llave. `actor` es el NOMBRE (así lo pinta
// la ficha) y `actor_id` el identificador; ver [[project_voz]] sobre por qué no
// se pueden confundir.
async function historial(ctx, leadId, tipo, contenido, metadata = {}) {
  await sb('/lead_activities', {
    method: 'POST', prefer: 'return=minimal',
    body: {
      lead_id: leadId, user_id: ctx.cuenta, type: tipo,
      content: String(contenido || '').slice(0, 4000),
      metadata: { ...metadata, actor: ctx.actorNombre, actor_id: ctx.actorId, via: 'api' },
    },
  });
}

// Quien atiende un lead lo toca: la inactividad cuelga de updated_at, y un
// lead atendido por el agente no puede salir como olvidado en el Pulso.
async function tocarLead(ctx, leadId) {
  await sb(`/leads?id=eq.${leadId}&user_id=eq.${encodeURIComponent(ctx.cuenta)}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { updated_at: new Date().toISOString() },
  });
}

async function personaDelEquipo(ctx, id) {
  if (!id) return null;
  if (id === ctx.cuenta) return await duenoComoComercial(ctx.cuenta) || { id, nombre: 'Dueño de la cuenta', esDueno: true };
  if (!(await esDelEquipo(ctx.cuenta, id))) return null;
  return (await comercialesActivos(ctx.cuenta)).find(c => c.id === id) || null;
}

// ── Operaciones ──────────────────────────────────────────────────────────────

async function indice(ctx) {
  return {
    api: 'Acuarius', version: 'v1', documentacion: DOCS,
    llave: {
      nombre: ctx.llave.nombre, prefijo: ctx.llave.prefijo, permisos: ctx.llave.permisos,
      cliente: ctx.cliente,
      limites: {
        por_minuto: ctx.llave.limite_minuto, cambios_por_minuto: ctx.llave.limite_escrituras_minuto,
        por_dia: ctx.llave.limite_dia, cuenta_por_minuto: limiteCuentaMinuto(),
      },
    },
    uso: ctx.uso,
    permisos_disponibles: PERMISOS.map(p => ({ clave: p.clave, nombre: p.nombre })),
    eventos_disponibles: EVENTOS.map(e => e.clave),
  };
}

async function listarProcesos(ctx) {
  const procesos = await procesosDeCuenta(ctx);
  const etapas = await etapasDeCuenta(ctx);
  const forma = s => ({
    key: s.key, label: s.label, position: s.position,
    cierre: tipoDeCierre(s.key),
    pide_cita: s.al_entrar?.tipo === 'cita',
  });
  const out = procesos.map(p => ({
    id: p.id, name: p.name, client_id: p.client_id, is_default: p.is_default,
    etapas: etapas.filter(s => s.pipeline_id === p.id).map(forma),
  }));
  // Cuentas de antes de los procesos: sus etapas no cuelgan de ninguno.
  const sueltas = etapas.filter(s => !s.pipeline_id && (!ctx.cliente || s.client_id === ctx.cliente));
  if (sueltas.length && !out.length) {
    out.push({ id: null, name: 'Pipeline', client_id: ctx.cliente, is_default: true, etapas: sueltas.map(forma) });
  }
  return { procesos: out };
}

async function listarEquipo(ctx) {
  const dueno = await duenoComoComercial(ctx.cuenta);
  const miembros = await sb(`/team_members?owner_user_id=eq.${encodeURIComponent(ctx.cuenta)}&status=eq.active` +
    `&select=member_user_id,member_name,member_email,role,client_id&order=created_at.asc`) || [];
  return {
    equipo: [
      { id: ctx.cuenta, nombre: dueno?.nombre || 'Dueño de la cuenta', email: dueno?.email || null, rol: 'dueno' },
      ...miembros.filter(m => m.member_user_id && (!ctx.cliente || !m.client_id || m.client_id === ctx.cliente)).map(m => ({
        id: m.member_user_id, nombre: m.member_name || m.member_email, email: m.member_email,
        rol: m.role === 'vendedor' ? 'ventas' : m.role,
      })),
    ],
  };
}

async function listarMotivos(ctx) {
  const filas = await sb(`/close_reasons?user_id=eq.${encodeURIComponent(ctx.cuenta)}&select=kind,label,position&order=position.asc`) || [];
  return {
    ganado: filas.filter(f => f.kind === 'won').map(f => f.label),
    perdido: filas.filter(f => f.kind === 'lost').map(f => f.label),
  };
}

async function listarEtiquetas(ctx) {
  const filas = await sb(`/lead_tags?user_id=eq.${encodeURIComponent(ctx.cuenta)}${alcance(ctx)}` +
    `&select=name,color,kind,client_id&order=name.asc`) || [];
  return { etiquetas: filas };
}

async function listarLeads(ctx, q) {
  let f = `/leads?user_id=eq.${encodeURIComponent(ctx.cuenta)}&deleted_at=is.null${alcance(ctx)}`;
  const etapa = q.get('etapa');
  if (etapa) {
    const keys = etapa.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
    f += `&stage=in.(${keys.map(k => '"' + k.replace(/["\\]/g, '') + '"').join(',')})`;
  }
  if (q.get('proceso')) f += `&pipeline_id=eq.${uuid(q.get('proceso'), 'proceso')}`;
  const asignado = q.get('asignado');
  if (asignado === 'nadie') f += '&assigned_to=is.null';
  else if (asignado) f += `&assigned_to=eq.${encodeURIComponent(asignado)}`;
  if (q.get('fuente')) f += `&source=eq.${encodeURIComponent(q.get('fuente'))}`;
  if (q.get('etiqueta')) f += `&tags=cs.${encodeURIComponent('{"' + normTag(q.get('etiqueta')).replace(/["\\]/g, '') + '"}')}`;
  const estado = q.get('estado') || 'todos';
  if (estado === 'abiertos') f += `&stage=not.in.(${ETAPAS_CERRADAS.join(',')})&closed_at=is.null`;
  else if (estado === 'cerrados') f += `&or=(stage.in.(${ETAPAS_CERRADAS.join(',')}),closed_at.not.is.null)`;
  else if (estado !== 'todos') fallo(422, 'campo_invalido', '«estado» puede ser abiertos, cerrados o todos.');
  const dias = q.get('sin_actividad_dias');
  if (dias) {
    const n = entero(dias, 0, 1, 3650);
    f += `&updated_at=lt.${encodeURIComponent(new Date(Date.now() - n * 86400000).toISOString())}`;
  }
  if (q.get('actualizado_desde')) f += `&updated_at=gte.${encodeURIComponent(fechaHora(q.get('actualizado_desde'), 'actualizado_desde'))}`;
  if (q.get('creado_desde')) f += `&created_at=gte.${encodeURIComponent(fechaHora(q.get('creado_desde'), 'creado_desde'))}`;
  const buscar = paraBuscar(q.get('buscar'));
  if (buscar) {
    const b = encodeURIComponent(`*${buscar}*`);
    f += `&or=(name.ilike.${b},email.ilike.${b},phone.ilike.${b},company.ilike.${b})`;
  }
  const orden = q.get('orden') === 'creado' ? 'created_at.desc' : 'updated_at.desc';
  const limite = entero(q.get('limite'), 50, 1, 100);
  const desde = entero(q.get('desde'), 0, 0, 10000);
  const filas = await sb(`${f}&select=${CAMPOS_LEAD}&order=${orden},id.asc&limit=${limite + 1}&offset=${desde}`) || [];
  const hay = filas.length > limite;
  const leads = [];
  for (const l of filas.slice(0, limite)) leads.push(await leadFormateado(ctx, l));
  return { leads, siguiente: hay ? desde + limite : null };
}

async function fichaLead(ctx, id) {
  const l = await leerLead(ctx, id);
  const out = { lead: await leadFormateado(ctx, l) };
  out.historial = (await sb(`/lead_activities?lead_id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}` +
    `&select=id,type,content,metadata,created_at&order=created_at.desc&limit=50`) || []).map(a => ({
    id: a.id, tipo: a.type, contenido: a.content, created_at: a.created_at,
    autor: a.metadata?.actor || (a.metadata?.sistema ? 'Sistema' : null),
  }));
  if (ctx.puede('tareas:leer')) {
    out.tareas = (await sb(`/activities?lead_id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}` +
      `&select=*&order=due_at.desc&limit=30`) || []).map(tareaFormateada);
  }
  if (ctx.puede('conversaciones:leer')) {
    out.conversaciones = (await sb(`/chat_conversations?lead_id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}` +
      `&select=id,channel,status,contact_name,last_message,last_message_at,last_inbound_at&order=last_message_at.desc.nullslast&limit=10`) || [])
      .map(conversacionFormateada);
  }
  return out;
}

// Contacto repetido por correo o por los últimos 10 dígitos del teléfono,
// igual que el alta manual (api/leads.js) y el importador.
async function buscarDuplicado(ctx, email, phone) {
  const base = `/leads?user_id=eq.${encodeURIComponent(ctx.cuenta)}&deleted_at=is.null${alcance(ctx)}`;
  if (email) {
    const f = await sb(`${base}&email=ilike.${encodeURIComponent(email.replace(/[*%,()]/g, ''))}&select=id,name,stage,assigned_name&limit=1`);
    if (f?.[0]) return f[0];
  }
  const clave = telClave(phone);
  if (clave) {
    const f = await sb(`${base}&phone=not.is.null&select=id,name,stage,assigned_name,phone&order=created_at.desc&limit=1000`) || [];
    const hit = f.find(x => telClave(x.phone) === clave);
    if (hit) return hit;
  }
  return null;
}

async function crearLead(ctx, b) {
  const name = texto(b.name, 200, 'name', { requerido: true });
  const email = texto(b.email, 200, 'email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fallo(422, 'campo_invalido', '«email» no es un correo válido.');
  const phone = texto(b.phone, 40, 'phone');
  const siExiste = b.si_existe || 'error';
  if (!['error', 'actualizar'].includes(siExiste)) fallo(422, 'campo_invalido', '«si_existe» puede ser error o actualizar.');

  // El tope de prospectos del plan. intakeLead no lo mira (los webhooks de
  // entrada no pueden rechazar), así que se mira aquí.
  const cuenta = ctx.plan;
  const tope = cuenta.esAdmin ? Infinity : (PLAN_LEADS[cuenta.plan] || 10) + cuenta.leadsExtra * 1000;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(ctx.cuenta)}&deleted_at=is.null&select=id&limit=0`,
    { headers: sbHeaders({ Prefer: 'count=exact' }) });
  if (!r.ok) throw new Error('No se pudo contar los leads: HTTP ' + r.status);
  const actuales = parseInt((r.headers.get('content-range') || '*/0').split('/')[1] || '0') || 0;

  const ya = await buscarDuplicado(ctx, email, phone);
  if (ya && siExiste === 'error') {
    fallo(409, 'duplicado', `Ya existe un prospecto con ese correo o teléfono: ${ya.name}.`,
      { lead: { id: ya.id, name: ya.name, stage: ya.stage, assigned_name: ya.assigned_name } });
  }
  if (!ya && actuales >= tope) {
    fallo(403, 'limite_del_plan', `La cuenta llegó al tope de ${tope} prospectos de su plan.`);
  }

  // Ámbito: el cliente de la llave; si no tiene, el de trabajo de la cuenta
  // (pro_main en una cuenta Pro con perfil) o la cuenta a secas.
  const cliente = ctx.cliente || await ambitoDeTrabajo(ctx.cuenta);
  let pipelineId = null;
  if (b.proceso) {
    pipelineId = uuid(b.proceso, 'proceso');
    const p = (await procesosDeCuenta(ctx)).find(x => x.id === pipelineId);
    if (!p) fallo(404, 'no_encontrado', 'Ese proceso no existe en esta cuenta.');
    if ((p.client_id || null) !== (cliente || null)) fallo(422, 'campo_invalido', 'Ese proceso es de otro cliente.');
  }
  let stage = null;
  if (b.etapa) {
    const etapas = await etapasDelLead(ctx, { pipeline_id: pipelineId, client_id: cliente });
    const e = resolverEtapa(etapas, b.etapa);
    if (tipoDeCierre(e.key) || ETAPAS_CERRADAS.includes(e.key)) {
      fallo(422, 'etapa_de_cierre', 'Un prospecto no se crea cerrado: créalo y luego muévelo con POST /leads/{id}/etapa, que pide el motivo.');
    }
    if (e.al_entrar?.tipo === 'cita') {
      fallo(422, 'etapa_pide_cita', `La etapa «${e.label}» pide agendar una cita: créalo en otra etapa y muévelo con POST /leads/{id}/etapa enviando la cita.`);
    }
    stage = e.key;
  }
  let asignado = null;
  if (b.asignado_a) {
    if (!ctx.puede('leads:asignar')) fallo(403, 'sin_permiso', 'Para elegir el responsable la llave necesita el permiso «leads:asignar».');
    asignado = await personaDelEquipo(ctx, String(b.asignado_a));
    if (!asignado) fallo(422, 'campo_invalido', '«asignado_a» no es una persona activa del equipo. Consulta GET /equipo.');
  }
  const etiquetas = Array.isArray(b.etiquetas) ? b.etiquetas.map(normTag).filter(t => t.length >= 2).slice(0, 15) : [];
  const campos = camposPropios(b.campos);
  const fuente = texto(b.fuente, 40, 'fuente') || 'api';

  const { lead, created } = await intakeLead(ctx.cuenta, cliente || null, {
    name, email, phone,
    company: texto(b.company, 200, 'company'),
    value: numero(b.value, 'value'),
    note: texto(b.nota, 600, 'nota'),
    source: fuente.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
    sourceLabel: ctx.actorNombre,
    tags: etiquetas,
    stage: stage || undefined,
    custom_fields: campos,
    pipelineId,
    assignedTo: asignado?.id || null,
  });
  if (!lead?.id) throw new Error('intakeLead no devolvió el lead');
  await historial(ctx, lead.id, created ? 'creacion' : 'nota',
    created ? `Creado por ${ctx.actorNombre}` : `${ctx.actorNombre} completó los datos de este prospecto`);
  const fresco = await leerLead(ctx, lead.id);
  return { estado: created ? 201 : 200, cuerpo: { lead: await leadFormateado(ctx, fresco), creado: created } };
}

function camposPropios(v) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) fallo(422, 'campo_invalido', '«campos» tiene que ser un objeto {nombre: valor}.');
  const out = {};
  for (const [k, val] of Object.entries(v).slice(0, 50)) {
    out[String(k).slice(0, 80)] = val === null ? null : String(val).slice(0, 300);
  }
  return out;
}

async function editarLead(ctx, id, b) {
  const l = await leerLead(ctx, id);
  const cambio = {};
  const cambiados = [];
  const poner = (campo, valor) => { cambio[campo] = valor; cambiados.push(campo); };
  if (b.name !== undefined) poner('name', texto(b.name, 200, 'name', { requerido: true }));
  if (b.email !== undefined) {
    const e = texto(b.email, 200, 'email');
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fallo(422, 'campo_invalido', '«email» no es un correo válido.');
    poner('email', e);
  }
  if (b.phone !== undefined) poner('phone', texto(b.phone, 40, 'phone'));
  if (b.company !== undefined) poner('company', texto(b.company, 200, 'company'));
  if (b.value !== undefined) poner('value', numero(b.value, 'value'));
  if (b.expected_close_date !== undefined) poner('expected_close_date', fechaDia(b.expected_close_date, 'expected_close_date'));
  if (b.campos !== undefined) {
    // Se FUSIONAN con los que hay, como en la ficha: mandar uno solo no puede
    // borrar el clic del anuncio ni la campaña que el lead traía.
    const nuevos = { ...(l.custom_fields || {}) };
    for (const [k, v] of Object.entries(camposPropios(b.campos))) {
      if (v === null) delete nuevos[k]; else nuevos[k] = v;
    }
    poner('custom_fields', nuevos);
  }
  for (const k of ['stage', 'etapa', 'assigned_to', 'asignado_a', 'tags', 'etiquetas']) {
    if (b[k] !== undefined) {
      fallo(422, 'usa_otra_ruta', `«${k}» no se cambia aquí: usa POST /leads/{id}/${k.startsWith('stage') || k === 'etapa' ? 'etapa' : k.startsWith('tag') || k === 'etiquetas' ? 'etiquetas' : 'asignar'}.`);
    }
  }
  if (!cambiados.length) fallo(422, 'sin_cambios', 'No llegó ningún campo para cambiar.');
  cambio.updated_at = new Date().toISOString();
  const filas = await sb(`/leads?id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}`, {
    method: 'PATCH', prefer: 'return=representation', body: cambio,
  });
  await historial(ctx, l.id, 'nota', `${ctx.actorNombre} actualizó: ${cambiados.join(', ')}`, { sistema: true, campos: cambiados });
  return { lead: await leadFormateado(ctx, filas?.[0] || l) };
}

function resolverEtapa(etapas, pedida) {
  const p = sinTildes(pedida);
  const e = etapas.find(s => s.key === String(pedida)) || etapas.find(s => sinTildes(s.label) === p) || etapas.find(s => sinTildes(s.key) === p);
  if (!e) {
    fallo(422, 'etapa_desconocida', `La etapa «${pedida}» no existe en el proceso de este prospecto.`,
      { etapas: etapas.map(s => ({ key: s.key, label: s.label })) });
  }
  return e;
}

// Mover de etapa con TODAS las reglas de una persona. Ver la cabecera.
async function moverEtapa(ctx, id, b) {
  let l = await leerLead(ctx, id);
  const avisos = [];

  // 1. Cambio de proceso, si lo piden. Es lo mismo que «Mover a otro proceso»
  //    de la ficha (moverDePipeline): conserva la etapa si existe allí.
  if (b.proceso && b.proceso !== l.pipeline_id) {
    const destino = uuid(b.proceso, 'proceso');
    if (!(await procesosDeCuenta(ctx)).some(p => p.id === destino)) fallo(404, 'no_encontrado', 'Ese proceso no existe en esta cuenta.');
    const r = await moverDePipeline(ctx.cuenta, l.id, destino);
    if (r.estado >= 400 && !r.cuerpo?.sin_cambios) fallo(r.estado === 404 ? 404 : 422, 'proceso_no_cambiado', r.cuerpo?.error || 'No se pudo cambiar de proceso.');
    await historial(ctx, l.id, 'nota', `${ctx.actorNombre} lo pasó al proceso «${r.cuerpo?.destino || ''}»`, { sistema: true });
    ctx._etapas = null;
    l = await leerLead(ctx, l.id);
    if (!b.etapa) return { lead: await leadFormateado(ctx, l), avisos };
  }

  if (!b.etapa) fallo(422, 'falta_campo', 'Falta «etapa».');
  const etapas = await etapasDelLead(ctx, l);
  const destino = resolverEtapa(etapas, b.etapa);
  const origen = etapas.find(s => s.key === l.stage);
  if (destino.key === l.stage) return { lead: await leadFormateado(ctx, l), sin_cambios: true, avisos };

  const cierre = tipoDeCierre(destino.key);
  const estabaCerrado = ETAPAS_CERRADAS.includes(String(l.stage || '').toLowerCase()) || !!l.closed_at;
  const quedaCerrado = ETAPAS_CERRADAS.includes(destino.key);
  const cambio = { stage: destino.key, updated_at: new Date().toISOString() };

  // 2. Cierre: el mismo modal que una persona, en datos. El motivo es
  //    obligatorio; el importe no (la interfaz tampoco lo exige), pero se avisa.
  let motivo = null;
  if (cierre) {
    motivo = texto(b.motivo, 200, 'motivo');
    if (!motivo) {
      const m = await listarMotivos(ctx);
      fallo(422, 'falta_motivo', `Para pasar a «${destino.label}» hace falta «motivo».`, { motivos: m[cierre] });
    }
    const catalogo = (await listarMotivos(ctx))[cierre];
    if (catalogo.length) {
      const hit = catalogo.find(c => sinTildes(c) === sinTildes(motivo));
      if (!hit) fallo(422, 'motivo_desconocido', `«${motivo}» no está entre los motivos de la cuenta.`, { motivos: catalogo });
      motivo = hit;
    }
    cambio.close_reason = motivo;
    const dia = fechaDia(b.fecha_cierre, 'fecha_cierre');
    // Igual que la ventana de cierre: el día elegido a las 12:00 de Colombia.
    cambio.closed_at = dia ? new Date(dia + 'T12:00:00-05:00').toISOString() : new Date().toISOString();
    if (cierre === 'ganado') {
      const valor = numero(b.valor, 'valor');
      if (valor !== null) cambio.value = valor;
      else if (!Number(l.value)) avisos.push('Se ganó sin valor: la venta llega a la pauta y a los reportes sin importe.');
      const moneda = texto(b.moneda, 3, 'moneda');
      if (moneda && !/^[A-Za-z]{3}$/.test(moneda)) fallo(422, 'campo_invalido', '«moneda» tiene que ser un código de 3 letras, como COP o USD.');
      cambio.close_currency = (moneda || l.close_currency || 'COP').toUpperCase();
    }
  } else if (quedaCerrado && !estabaCerrado) {
    cambio.closed_at = cambio.updated_at;
  } else if (!quedaCerrado && estabaCerrado) {
    // Reabierto: sin esto leadCerrado() lo seguiría contando como cerrado.
    cambio.closed_at = null;
  }

  // 3. Etapa que pide cita: primero la cita; si no se puede agendar, el lead
  //    no se mueve. Igual que el modal «Agenda la cita».
  let cita = null;
  if (destino.al_entrar?.tipo === 'cita') {
    const c = b.cita || {};
    if (!c.inicio) {
      fallo(422, 'etapa_pide_cita', `La etapa «${destino.label}» pide agendar una cita: envía «cita»: {"inicio": "2026-10-09T15:00:00-05:00"}.`);
    }
    const inicio = fechaHora(c.inicio, 'cita.inicio', { requerido: true });
    const fin = c.fin ? fechaHora(c.fin, 'cita.fin')
      : new Date(new Date(inicio).getTime() + (Number(destino.al_entrar.duracion) || 60) * 60000).toISOString();
    cita = await crearActividad(ctx, {
      tipo: 'cita', lead: l,
      titulo: texto(c.titulo, 80, 'cita.titulo') || destino.al_entrar.titulo || 'Cita',
      descripcion: texto(c.descripcion, 2000, 'cita.descripcion'),
      inicio, fin, invitarLead: c.invitar_lead === true,
    });
  }

  // 4. La nota del cierre va ANTES de mover, como en la ventana de cierre.
  const nota = texto(b.nota, 4000, 'nota');
  if (nota) await historial(ctx, l.id, 'nota', nota, cierre ? { al_cerrar: cierre === 'ganado' ? 'won' : 'lost', close_reason: motivo } : {});

  const filas = await sb(`/leads?id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}`, {
    method: 'PATCH', prefer: 'return=representation', body: cambio,
  });
  const nuevo = filas?.[0] || { ...l, ...cambio };

  // 5. Lo que hace el servidor tras cualquier cambio de etapa (api/leads.js PUT).
  if (!estabaCerrado && quedaCerrado) {
    await sb(`/activities?lead_id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}&done=is.false&cancelled_at=is.null`, {
      method: 'PATCH', prefer: 'return=minimal', body: { cancelled_at: new Date().toISOString() },
    });
  }
  const contenido = cierre === 'ganado' ? `Ganada · ${motivo}`
    : cierre === 'perdido' ? `Perdida · ${motivo}`
    : `Movido de «${origen?.label || l.stage}» a «${destino.label}»`;
  await historial(ctx, l.id, 'stage_change', contenido, { from: l.stage, to: destino.key, ...(motivo ? { close_reason: motivo } : {}) });
  await enqueueAutomations(ctx.cuenta, nuevo, 'stage_changed', destino.key);

  return { lead: await leadFormateado(ctx, nuevo), ...(cita ? { cita } : {}), avisos };
}

async function asignar(ctx, id, b) {
  const l = await leerLead(ctx, id);
  if (!('asignado_a' in (b || {}))) fallo(422, 'falta_campo', 'Falta «asignado_a» (el id de la persona, o null para dejarlo sin responsable).');
  if (b.asignado_a === null) {
    if (!l.assigned_to) return { lead: await leadFormateado(ctx, l), sin_cambios: true };
    const filas = await sb(`/leads?id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { assigned_to: null, assigned_name: null, updated_at: new Date().toISOString() },
    });
    await historial(ctx, l.id, 'nota', `${ctx.actorNombre} lo dejó sin responsable (antes: ${l.assigned_name || 'sin nombre'})`, { sistema: true, asignacion: 'api' });
    return { lead: await leadFormateado(ctx, filas?.[0]) };
  }
  const com = await personaDelEquipo(ctx, String(b.asignado_a));
  if (!com) fallo(422, 'campo_invalido', '«asignado_a» no es una persona activa del equipo. Consulta GET /equipo.');
  if (l.assigned_to === com.id) return { lead: await leadFormateado(ctx, l), sin_cambios: true };
  const filas = await sb(`/leads?id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { assigned_to: com.id, assigned_name: com.nombre, updated_at: new Date().toISOString() },
  });
  await historial(ctx, l.id, 'nota', `${ctx.actorNombre} se lo asignó a ${com.nombre}`, { sistema: true, asignacion: 'api' });
  // A la persona le llega lo mismo que con el reparto automático: el correo
  // (salvo al dueño, que es la cuenta entera) y el aviso al teléfono.
  if (!com.esDueno) await avisarComercial(com, l, ctx.actorNombre).catch(() => {});
  await enviarPushA(com.id, {
    titulo: 'Te asignaron un lead', texto: (l.name || 'Sin nombre') + ' · por ' + ctx.actorNombre,
    url: '/crm?lead=' + l.id, etiqueta: 'asignado-' + l.id,
  }).catch(() => {});
  return { lead: await leadFormateado(ctx, filas?.[0]) };
}

async function etiquetar(ctx, id, b) {
  const l = await leerLead(ctx, id);
  const agregar = (Array.isArray(b.agregar) ? b.agregar : []).map(normTag).filter(t => t.length >= 2);
  const quitar = new Set((Array.isArray(b.quitar) ? b.quitar : []).map(normTag));
  if (!agregar.length && !quitar.size) fallo(422, 'sin_cambios', 'Envía «agregar» o «quitar» con una lista de etiquetas.');
  const antes = l.tags || [];
  const lista = [...new Set([...antes.filter(t => !quitar.has(t)), ...agregar])].slice(0, 15);
  const nuevas = lista.filter(t => !antes.includes(t));
  await ensureCatalog(ctx.cuenta, l.client_id || null, nuevas, null);
  const filas = await sb(`/leads?id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { tags: lista, updated_at: new Date().toISOString() },
  });
  const quitadas = antes.filter(t => !lista.includes(t));
  if (nuevas.length || quitadas.length) {
    await historial(ctx, l.id, 'nota',
      `${ctx.actorNombre} ` + [nuevas.length ? 'etiquetó: ' + nuevas.join(', ') : '', quitadas.length ? 'quitó: ' + quitadas.join(', ') : ''].filter(Boolean).join(' · '),
      { sistema: true });
  }
  if (nuevas.length) await enqueueAutomations(ctx.cuenta, filas?.[0] || l, 'tag_added', nuevas);
  return { lead: await leadFormateado(ctx, filas?.[0] || l) };
}

const TIPOS_NOTA = ['nota', 'llamada', 'email', 'reunion', 'visita'];

async function anotar(ctx, id, b) {
  const l = await leerLead(ctx, id);
  const contenido = texto(b.texto, 4000, 'texto', { requerido: true });
  const tipo = b.tipo || 'nota';
  if (!TIPOS_NOTA.includes(tipo)) fallo(422, 'campo_invalido', `«tipo» puede ser: ${TIPOS_NOTA.join(', ')}.`);
  let para = null;
  if (b.avisar_responsable === true) {
    if (!l.assigned_to) fallo(422, 'sin_responsable', 'El prospecto no tiene responsable a quien avisar.');
    para = l.assigned_to;
  }
  const meta = para ? { para, avisado_at: new Date().toISOString() } : {};
  const fila = await sb('/lead_activities', {
    method: 'POST', prefer: 'return=representation',
    body: {
      lead_id: l.id, user_id: ctx.cuenta, type: tipo, content: contenido,
      metadata: { ...meta, actor: ctx.actorNombre, actor_id: ctx.actorId, via: 'api' },
    },
  });
  await tocarLead(ctx, l.id);
  let aviso = null;
  if (para) {
    // La misma «nota al responsable» que escribe la dirección desde la ficha.
    const { avisarNotaLead } = await import('./_aviso-lead-nota.js');
    aviso = await avisarNotaLead({
      ownerId: ctx.cuenta, autorNombre: ctx.actorNombre,
      lead: { id: l.id, name: l.name, company: l.company }, texto: contenido, paraId: para,
    }).catch(e => ({ enviado: false, motivo: e.message }));
    await enviarPushA(para, {
      titulo: 'Nota sobre ' + (l.name || 'un lead'), texto: contenido.slice(0, 120),
      url: '/crm?lead=' + l.id, etiqueta: 'nota-' + l.id,
    }).catch(() => {});
  }
  const a = fila?.[0];
  return { estado: 201, cuerpo: { nota: { id: a?.id, tipo, contenido, created_at: a?.created_at }, ...(aviso ? { aviso } : {}) } };
}

// ── Tareas y citas ───────────────────────────────────────────────────────────

function tareaFormateada(a) {
  return {
    id: a.id,
    tipo: a.type === 'meeting' ? 'cita' : 'tarea',
    titulo: a.title, descripcion: a.description,
    vence: a.due_at, termina: a.end_at,
    hecha: !!a.done, anulada_at: a.cancelled_at,
    lead_id: a.lead_id, client_id: a.client_id,
    en_google_calendar: !!a.gcal_event_id,
    created_at: a.created_at, updated_at: a.updated_at,
  };
}

async function crearActividad(ctx, { tipo, lead, titulo, descripcion, inicio, fin, invitarLead }) {
  if (fin && new Date(fin) <= new Date(inicio)) fallo(422, 'fecha_invalida', 'El fin tiene que ser posterior al inicio.');
  const fila = {
    user_id: ctx.cuenta,
    client_id: lead ? (lead.client_id || null) : (ctx.cliente || null),
    lead_id: lead?.id || null,
    type: tipo === 'cita' ? 'meeting' : 'task',
    title: titulo, description: descripcion || null,
    due_at: inicio, end_at: fin || null, done: false,
  };
  let avisoCalendario = null;
  if (fila.type === 'meeting') {
    // Igual que api/agenda.js: si Google falla, la cita se guarda igual y se dice.
    const conn = await getGcalToken(ctx.cuenta);
    if (conn) {
      try {
        const correo = invitarLead && lead?.email ? lead.email : null;
        const ev = await gcalRequest(conn.token, 'POST', '', gcalEventBody(fila, correo, !!correo), !!correo);
        fila.gcal_event_id = ev.id;
      } catch (e) { avisoCalendario = 'No se pudo crear el evento en Google Calendar: ' + e.message; }
    } else {
      avisoCalendario = 'Google Calendar no está conectado: la cita quedó solo en Acuarius.';
    }
  }
  const filas = await sb('/activities', { method: 'POST', prefer: 'return=representation', body: fila });
  const act = filas?.[0];
  if (lead) {
    // Como la ficha: la tarea real más su línea en el historial, enlazadas.
    await historial(ctx, lead.id, fila.type === 'meeting' ? 'reunion' : 'tarea', titulo,
      { activity_id: act?.id, due_date: inicio });
    await tocarLead(ctx, lead.id);
  }
  return { ...tareaFormateada(act || fila), ...(avisoCalendario ? { aviso_calendario: avisoCalendario } : {}) };
}

async function listarTareas(ctx, q) {
  let f = `/activities?user_id=eq.${encodeURIComponent(ctx.cuenta)}`;
  if (ctx.cliente) f += `&client_id=eq.${encodeURIComponent(ctx.cliente)}`;
  if (q.get('lead_id')) f += `&lead_id=eq.${uuid(q.get('lead_id'), 'lead_id')}`;
  const estado = q.get('estado') || 'pendientes';
  // «Pendiente» es done=false Y sin anular, en TODA consulta de activities.
  if (estado === 'pendientes') f += '&done=is.false&cancelled_at=is.null';
  else if (estado === 'hechas') f += '&done=is.true';
  else if (estado !== 'todas') fallo(422, 'campo_invalido', '«estado» puede ser pendientes, hechas o todas.');
  const tipo = q.get('tipo');
  if (tipo === 'tarea') f += '&type=eq.task';
  else if (tipo === 'cita') f += '&type=eq.meeting';
  else if (tipo) fallo(422, 'campo_invalido', '«tipo» puede ser tarea o cita.');
  if (q.get('desde')) f += `&due_at=gte.${encodeURIComponent(fechaHora(q.get('desde'), 'desde'))}`;
  if (q.get('hasta')) f += `&due_at=lt.${encodeURIComponent(fechaHora(q.get('hasta'), 'hasta'))}`;
  const limite = entero(q.get('limite'), 50, 1, 100);
  const desde = entero(q.get('pagina_desde'), 0, 0, 10000);
  const filas = await sb(`${f}&select=*&order=due_at.asc,id.asc&limit=${limite + 1}&offset=${desde}`) || [];
  return { tareas: filas.slice(0, limite).map(tareaFormateada), siguiente: filas.length > limite ? desde + limite : null };
}

async function crearTarea(ctx, b) {
  const tipo = b.tipo || 'tarea';
  if (!['tarea', 'cita'].includes(tipo)) fallo(422, 'campo_invalido', '«tipo» puede ser tarea o cita.');
  const lead = b.lead_id ? await leerLead(ctx, b.lead_id) : null;
  const t = await crearActividad(ctx, {
    tipo, lead,
    titulo: texto(b.titulo, 200, 'titulo', { requerido: true }),
    descripcion: texto(b.descripcion, 2000, 'descripcion'),
    inicio: fechaHora(b.vence, 'vence', { requerido: true }),
    fin: tipo === 'cita' ? fechaHora(b.termina, 'termina') : null,
    invitarLead: b.invitar_lead === true,
  });
  return { estado: 201, cuerpo: { tarea: t } };
}

async function editarTarea(ctx, id, b) {
  const filas = await sb(`/activities?id=eq.${uuid(id, 'id')}&user_id=eq.${encodeURIComponent(ctx.cuenta)}` +
    `${ctx.cliente ? `&client_id=eq.${encodeURIComponent(ctx.cliente)}` : ''}&select=*&limit=1`);
  const a = filas?.[0];
  if (!a) fallo(404, 'no_encontrado', 'No hay ninguna tarea con ese id en esta cuenta.');
  if (a.cancelled_at) fallo(409, 'anulada', 'Esa tarea se anuló al cerrar su prospecto; no se puede cambiar.');
  const cambio = {};
  if (b.hecha !== undefined) {
    if (typeof b.hecha !== 'boolean') fallo(422, 'campo_invalido', '«hecha» tiene que ser true o false.');
    cambio.done = b.hecha;
  }
  if (b.titulo !== undefined) cambio.title = texto(b.titulo, 200, 'titulo', { requerido: true });
  if (b.descripcion !== undefined) cambio.description = texto(b.descripcion, 2000, 'descripcion');
  if (b.vence !== undefined) cambio.due_at = fechaHora(b.vence, 'vence', { requerido: true });
  if (b.termina !== undefined) cambio.end_at = fechaHora(b.termina, 'termina');
  if (!Object.keys(cambio).length) fallo(422, 'sin_cambios', 'No llegó ningún campo para cambiar.');
  const ini = cambio.due_at || a.due_at, fin = cambio.end_at === undefined ? a.end_at : cambio.end_at;
  if (fin && new Date(fin) <= new Date(ini)) fallo(422, 'fecha_invalida', 'El fin tiene que ser posterior al inicio.');
  cambio.updated_at = new Date().toISOString();
  const nuevas = await sb(`/activities?id=eq.${a.id}&user_id=eq.${encodeURIComponent(ctx.cuenta)}`, {
    method: 'PATCH', prefer: 'return=representation', body: cambio,
  });
  const act = nuevas?.[0] || { ...a, ...cambio };
  let avisoCalendario = null;
  if (a.gcal_event_id && (cambio.title || cambio.description !== undefined || cambio.due_at || cambio.end_at !== undefined)) {
    try { await gcalEnSuCalendario(ctx.cuenta, a.resource_id, 'PATCH', '/' + a.gcal_event_id, gcalEventBody(act, null, false)); }
    catch (e) { avisoCalendario = 'El evento de Google Calendar no se pudo actualizar: ' + e.message; }
  }
  if (a.lead_id) {
    if (b.hecha === true && !a.done) await historial(ctx, a.lead_id, 'nota', `${ctx.actorNombre} marcó como hecha: ${a.title}`, { sistema: true, activity_id: a.id });
    await tocarLead(ctx, a.lead_id);
  }
  return { tarea: { ...tareaFormateada(act), ...(avisoCalendario ? { aviso_calendario: avisoCalendario } : {}) } };
}

// ── Conversaciones ───────────────────────────────────────────────────────────

function conversacionFormateada(c) {
  return {
    id: c.id, canal: c.channel, estado: c.status,
    contacto_id: c.contact_id, contacto_nombre: c.contact_name,
    lead_id: c.lead_id, ultimo_mensaje: c.last_message,
    ultimo_mensaje_at: c.last_message_at, ultimo_entrante_at: c.last_inbound_at,
    archivada_at: c.archivada_at,
  };
}

// Una conversación no guarda cliente. Para una llave atada a un cliente se
// acota por los canales de ese cliente.
async function filtroConversaciones(ctx) {
  if (!ctx.cliente) return '';
  const canales = await sb(`/channel_connections?user_id=eq.${encodeURIComponent(ctx.cuenta)}` +
    `&client_id=eq.${encodeURIComponent(ctx.cliente)}&select=id`) || [];
  if (!canales.length) return '&id=is.null';
  return `&connection_id=in.(${canales.map(c => c.id).join(',')})`;
}

async function listarConversaciones(ctx, q) {
  let f = `/chat_conversations?user_id=eq.${encodeURIComponent(ctx.cuenta)}${await filtroConversaciones(ctx)}`;
  if (q.get('lead_id')) f += `&lead_id=eq.${uuid(q.get('lead_id'), 'lead_id')}`;
  const estado = q.get('estado');
  if (estado) {
    if (!['bot', 'human', 'resolved'].includes(estado)) fallo(422, 'campo_invalido', '«estado» puede ser bot, human o resolved.');
    f += `&status=eq.${estado}`;
  }
  if (q.get('canal')) f += `&channel=eq.${encodeURIComponent(q.get('canal'))}`;
  if (q.get('actualizado_desde')) f += `&last_message_at=gte.${encodeURIComponent(fechaHora(q.get('actualizado_desde'), 'actualizado_desde'))}`;
  const limite = entero(q.get('limite'), 30, 1, 100);
  const desde = entero(q.get('desde'), 0, 0, 10000);
  const filas = await sb(`${f}&select=id,channel,status,contact_id,contact_name,lead_id,last_message,last_message_at,last_inbound_at,archivada_at` +
    `&order=last_message_at.desc.nullslast,id.asc&limit=${limite + 1}&offset=${desde}`) || [];
  return { conversaciones: filas.slice(0, limite).map(conversacionFormateada), siguiente: filas.length > limite ? desde + limite : null };
}

async function mensajes(ctx, id, q) {
  const conv = (await sb(`/chat_conversations?id=eq.${uuid(id, 'id')}&user_id=eq.${encodeURIComponent(ctx.cuenta)}` +
    `${await filtroConversaciones(ctx)}&select=id,channel,status,contact_id,contact_name,lead_id,last_message,last_message_at,last_inbound_at,archivada_at&limit=1`))?.[0];
  if (!conv) fallo(404, 'no_encontrado', 'No hay ninguna conversación con ese id en esta cuenta.');
  const limite = entero(q.get('limite'), 50, 1, 200);
  let f = `/chat_messages?conversation_id=eq.${conv.id}`;
  if (q.get('antes')) f += `&created_at=lt.${encodeURIComponent(fechaHora(q.get('antes'), 'antes'))}`;
  const filas = await sb(`${f}&select=id,role,content,adjunto_url,adjunto_tipo,created_at&order=created_at.desc&limit=${limite}`) || [];
  return {
    conversacion: conversacionFormateada(conv),
    // El rol traducido: «user» es el contacto, no un usuario de Acuarius.
    mensajes: filas.reverse().map(m => ({
      id: m.id, de: m.role === 'user' ? 'contacto' : 'negocio', contenido: m.content,
      adjunto_url: m.adjunto_url, adjunto_tipo: m.adjunto_tipo, created_at: m.created_at,
    })),
  };
}

async function listarWebhooks(ctx) {
  const filas = await sb(`/api_webhooks?user_id=eq.${encodeURIComponent(ctx.cuenta)}${alcance(ctx)}` +
    `&select=id,url,eventos,activo,client_id,created_at,ultimo_ok_at,ultimo_error,fallos_seguidos,desactivado_motivo&order=created_at.asc`) || [];
  return { webhooks: filas };
}

// ── Enrutador ────────────────────────────────────────────────────────────────
// [método, patrón, permiso, manejador]. El permiso se comprueba ANTES de llamar:
// ninguna ruta puede olvidarse de pedirlo.
const RUTAS = [
  ['GET',   /^$/,                                   null,                  (c) => indice(c)],
  ['GET',   /^procesos$/,                           'leads:leer',          (c) => listarProcesos(c)],
  ['GET',   /^equipo$/,                             'leads:leer',          (c) => listarEquipo(c)],
  ['GET',   /^motivos-cierre$/,                     'leads:leer',          (c) => listarMotivos(c)],
  ['GET',   /^etiquetas$/,                          'leads:leer',          (c) => listarEtiquetas(c)],
  ['GET',   /^leads$/,                              'leads:leer',          (c, m, q) => listarLeads(c, q)],
  ['POST',  /^leads$/,                              'leads:escribir',      (c, m, q, b) => crearLead(c, b)],
  ['GET',   /^leads\/([^/]+)$/,                     'leads:leer',          (c, m) => fichaLead(c, m[1])],
  ['PATCH', /^leads\/([^/]+)$/,                     'leads:escribir',      (c, m, q, b) => editarLead(c, m[1], b)],
  ['POST',  /^leads\/([^/]+)\/etapa$/,              'leads:etapa',         (c, m, q, b) => moverEtapa(c, m[1], b)],
  ['POST',  /^leads\/([^/]+)\/asignar$/,            'leads:asignar',       (c, m, q, b) => asignar(c, m[1], b)],
  ['POST',  /^leads\/([^/]+)\/etiquetas$/,          'leads:escribir',      (c, m, q, b) => etiquetar(c, m[1], b)],
  ['POST',  /^leads\/([^/]+)\/notas$/,              'leads:escribir',      (c, m, q, b) => anotar(c, m[1], b)],
  ['GET',   /^tareas$/,                             'tareas:leer',         (c, m, q) => listarTareas(c, q)],
  ['POST',  /^tareas$/,                             'tareas:escribir',     (c, m, q, b) => crearTarea(c, b)],
  ['PATCH', /^tareas\/([^/]+)$/,                    'tareas:escribir',     (c, m, q, b) => editarTarea(c, m[1], b)],
  ['GET',   /^conversaciones$/,                     'conversaciones:leer', (c, m, q) => listarConversaciones(c, q)],
  ['GET',   /^conversaciones\/([^/]+)\/mensajes$/,  'conversaciones:leer', (c, m, q) => mensajes(c, m[1], q)],
  ['GET',   /^webhooks$/,                           null,                  (c) => listarWebhooks(c)],
];

// La llave: quién es, de qué cuenta, y si puede pasar. Devuelve el contexto o
// una Response de rechazo.
async function autenticar(req) {
  const cab = req.headers.get('authorization') || '';
  const llave = cab.replace(/^Bearer\s+/i, '').trim();
  if (!llave) return json({ error: 'Falta la llave: envía «Authorization: Bearer acu_live_…».', codigo: 'sin_llave', documentacion: DOCS }, 401);
  if (!pareceLlave(llave)) return json({ error: 'Esa llave no tiene el formato de una llave de Acuarius.', codigo: 'llave_invalida' }, 401);
  const filas = await sb(`/api_llaves?hash=eq.${await sha256Hex(llave)}&select=*&limit=1`);
  const fila = filas?.[0];
  if (!fila) return json({ error: 'Esa llave no existe.', codigo: 'llave_invalida' }, 401);
  if (fila.revocada_at) return json({ error: 'Esa llave fue revocada. Crea otra en Configuración → API y agentes.', codigo: 'llave_revocada' }, 401);
  if (await estaSuspendido(fila.user_id)) return json({ error: 'La cuenta está suspendida.', codigo: 'cuenta_suspendida' }, 403);
  const plan = await cuentaConApi(fila.user_id);
  if (!plan.ok) return json({ error: 'No se pudo comprobar el plan de la cuenta. Reintenta en unos segundos.', codigo: 'plan_no_disponible' }, 503, { 'Retry-After': '10' });
  if (!plan.permitido) return json({ error: 'El plan de esta cuenta no incluye la API. Está en Pro y Agency.', codigo: 'plan_sin_api' }, 403);

  // Quien creó la llave tiene que seguir pudiendo crearla. Si era un
  // administrador del equipo y lo sacaron (o le bajaron el perfil), la llave
  // se revoca aquí mismo y el dueño se entera. Si no se puede comprobar, no
  // se deja pasar.
  let creador;
  try { creador = await creadorVigente(fila.user_id, fila.creada_por); }
  catch {
    return json({ error: 'No se pudo comprobar la llave. Reintenta en unos segundos.', codigo: 'llave_no_disponible' }, 503, { 'Retry-After': '10' });
  }
  if (!creador.vigente) {
    const revocada = await sb(`/api_llaves?id=eq.${fila.id}&revocada_at=is.null`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { revocada_at: new Date().toISOString(), revocada_por: 'sistema' },
    }).catch(() => null);
    // Solo avisa la petición que la revocó: si llegan diez a la vez, un correo.
    if (revocada?.length) {
      await avisarDueno(fila.user_id, {
        asunto: 'Acuarius revocó una llave de la API de tu cuenta',
        titulo: 'Revocamos una llave de la API',
        intro: `La llave «${fila.nombre}» dejó de funcionar porque ${creador.motivo}. Quien sale del equipo no se lleva acceso a tu cuenta.`,
        filas: [['Llave', `${fila.nombre} (${fila.prefijo}…)`], ['Cuándo', fechaAviso()]],
        pie: 'Si esa llave la usaba un sistema que debe seguir funcionando, crea una nueva desde Configuración → API y agentes.',
      });
    }
    return json({ error: `Esta llave fue revocada porque ${creador.motivo}. Pide una nueva al dueño de la cuenta.`, codigo: 'llave_revocada' }, 401);
  }

  // Los límites se cuentan en la base, atómicos. Si no se puede contar, NO se
  // deja pasar: un agente desbocado sin freno es justo lo que el límite existe
  // para parar, y no hay forma de saber que no lo es.
  //   · llamadas de la llave por minuto y por día
  //   · CAMBIOS de la llave por minuto, más bajo: leer mucho no hace daño
  //   · llamadas de toda la cuenta por minuto, sumando sus llaves
  const ahora = new Date();
  const minuto = 'm:' + ahora.toISOString().slice(0, 16);
  const dia = 'd:' + ahora.toISOString().slice(0, 10);
  const escritura = req.method === 'POST' || req.method === 'PATCH';
  let uso;
  try {
    uso = (await sb('/rpc/api_contar_v2', { method: 'POST', body: {
      p_llave: fila.id, p_cuenta: fila.user_id, p_minuto: minuto, p_dia: dia, p_escritura: escritura,
    } }))?.[0];
  } catch {
    return json({ error: 'No se pudo comprobar el límite de uso. Reintenta en unos segundos.', codigo: 'limite_no_disponible' }, 503, { 'Retry-After': '10' });
  }
  const resto = String(60 - ahora.getUTCSeconds());
  if (uso.minuto > fila.limite_minuto) {
    return json({ error: `Pasaste el límite de ${fila.limite_minuto} llamadas por minuto.`, codigo: 'limite_minuto' }, 429, { 'Retry-After': resto });
  }
  if (escritura && uso.escrituras_minuto > fila.limite_escrituras_minuto) {
    return json({ error: `Pasaste el límite de ${fila.limite_escrituras_minuto} cambios por minuto. Las consultas siguen disponibles.`, codigo: 'limite_escrituras' }, 429, { 'Retry-After': resto });
  }
  const topeCuenta = limiteCuentaMinuto();
  if (uso.cuenta_minuto > topeCuenta) {
    return json({ error: `La cuenta pasó el límite de ${topeCuenta} llamadas por minuto entre todas sus llaves.`, codigo: 'limite_cuenta' }, 429, { 'Retry-After': resto });
  }
  if (uso.dia > fila.limite_dia) {
    return json({ error: `Pasaste el límite de ${fila.limite_dia} llamadas por día (se reinicia a medianoche UTC).`, codigo: 'limite_dia' }, 429);
  }
  const permisos = new Set((fila.permisos || []).filter(p => CLAVES_PERMISOS.includes(p)));
  return {
    llave: fila, cuenta: fila.user_id, cliente: fila.client_id || null, plan,
    actorNombre: fila.nombre, actorId: 'api:' + fila.id,
    uso: { minuto: uso.minuto, dia: uso.dia },
    puede: (p) => permisos.has(p),
  };
}

// Idempotency-Key: la segunda llamada con la misma clave devuelve la primera
// respuesta en vez de repetir la escritura.
async function reservarIdempotencia(ctx, clave) {
  const filas = await sb('/api_idempotencia?on_conflict=llave_id,clave', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { llave_id: ctx.llave.id, clave },
  });
  if (filas?.length) return null;   // es la primera: adelante
  const previa = (await sb(`/api_idempotencia?llave_id=eq.${ctx.llave.id}&clave=eq.${encodeURIComponent(clave)}&select=estado,cuerpo&limit=1`))?.[0];
  if (!previa || previa.estado === null) {
    return json({ error: 'Otra llamada con la misma Idempotency-Key sigue en curso.', codigo: 'idempotencia_en_curso' }, 409);
  }
  return json(previa.cuerpo, previa.estado, { 'Idempotent-Replayed': 'true' });
}

async function registrar(ctx, req, ruta, estado, ms, error) {
  if (req.method === 'GET' && estado < 400) return;
  try {
    await sb('/api_registro', {
      method: 'POST', prefer: 'return=minimal',
      body: {
        llave_id: ctx.llave.id, user_id: ctx.cuenta, metodo: req.method,
        ruta: '/' + ruta, estado, ms, error: error ? String(error).slice(0, 500) : null,
      },
    });
  } catch (e) { console.error('[api] no se pudo registrar la llamada:', e.message); }
}

export default async function handler(req) {
  const inicio = Date.now();
  const url = new URL(req.url);
  const ruta = (url.searchParams.get('ruta') ?? url.pathname.replace(/^\/api\/v1\/?/, '')).replace(/^\/+|\/+$/g, '');
  url.searchParams.delete('ruta');

  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  let ctx;
  try {
    ctx = await autenticar(req);
  } catch (e) {
    const { registrarError } = await import('./_registro-errores.js');
    await registrarError({ origen: 'api', donde: 'v1/autenticar', error: e }).catch(() => {});
    return json({ error: 'Error interno al comprobar la llave. Reintenta en unos segundos.', codigo: 'error_interno' }, 500);
  }
  if (ctx instanceof Response) return ctx;

  const rutasDeAqui = RUTAS.filter(r => r[1].test(ruta));
  const r = rutasDeAqui.find(x => x[0] === req.method);
  if (!r) {
    if (rutasDeAqui.length) {
      return json({ error: `Esa ruta no admite ${req.method}. Admite: ${rutasDeAqui.map(x => x[0]).join(', ')}.`, codigo: 'metodo_no_permitido' }, 405,
        { Allow: rutasDeAqui.map(x => x[0]).join(', ') });
    }
    return json({ error: `No existe la ruta /api/v1/${ruta}.`, codigo: 'ruta_desconocida', documentacion: DOCS }, 404);
  }
  if (r[2] && !ctx.puede(r[2])) {
    const p = PERMISOS.find(x => x.clave === r[2]);
    const resp = json({ error: `Esta llave no tiene el permiso «${r[2]}» (${p?.nombre}). Se da en Configuración → API y agentes.`, codigo: 'sin_permiso' }, 403);
    await registrar(ctx, req, ruta, 403, Date.now() - inicio, 'sin permiso ' + r[2]);
    return resp;
  }

  let cuerpo = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      const t = await req.text();
      if (t.length > 100000) return json({ error: 'El cuerpo pasa de 100 KB.', codigo: 'cuerpo_grande' }, 413);
      cuerpo = t ? JSON.parse(t) : {};
      if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new Error('no es objeto');
    } catch {
      return json({ error: 'El cuerpo tiene que ser un objeto JSON.', codigo: 'json_invalido' }, 400);
    }
  }

  const clave = req.method !== 'GET' ? (req.headers.get('idempotency-key') || '').trim() : '';
  if (clave) {
    if (clave.length > 100) return json({ error: 'Idempotency-Key admite hasta 100 caracteres.', codigo: 'campo_invalido' }, 422);
    const previa = await reservarIdempotencia(ctx, clave).catch(() => null);
    if (previa) return previa;
  }

  let estado = 200, salida, errorTexto = null;
  try {
    const res = await r[3](ctx, ruta.match(r[1]), url.searchParams, cuerpo);
    if (res && res.estado && res.cuerpo) { estado = res.estado; salida = res.cuerpo; }
    else salida = res;
  } catch (e) {
    if (e instanceof ErrorApi) {
      estado = e.estado; errorTexto = e.message;
      salida = { error: e.message, codigo: e.codigo, ...(e.extra || {}) };
    } else {
      estado = 500; errorTexto = e?.message || String(e);
      salida = { error: 'No se pudo completar la operación. Reintenta; si sigue fallando, escríbenos a soporte@acuarius.app.', codigo: 'error_interno' };
      try {
        const { registrarError } = await import('./_registro-errores.js');
        await registrarError({ origen: 'api', donde: 'v1/' + req.method + ' ' + ruta.replace(/[0-9a-f-]{36}/gi, ':id'), error: e, usuario: ctx.cuenta });
      } catch {}
    }
  }

  if (clave) {
    try {
      if (estado >= 500) {
        // Un error nuestro no se guarda: el reintento tiene que poder pasar.
        await sb(`/api_idempotencia?llave_id=eq.${ctx.llave.id}&clave=eq.${encodeURIComponent(clave)}`, { method: 'DELETE', prefer: 'return=minimal' });
      } else {
        await sb(`/api_idempotencia?llave_id=eq.${ctx.llave.id}&clave=eq.${encodeURIComponent(clave)}`, {
          method: 'PATCH', prefer: 'return=minimal', body: { estado, cuerpo: salida },
        });
      }
    } catch (e) { console.error('[api] idempotencia:', e.message); }
  }
  await registrar(ctx, req, ruta, estado, Date.now() - inicio, errorTexto);
  return json(salida, estado, {
    'X-Limite-Minuto': String(ctx.llave.limite_minuto), 'X-Uso-Minuto': String(ctx.uso.minuto),
    'X-Limite-Dia': String(ctx.llave.limite_dia), 'X-Uso-Dia': String(ctx.uso.dia),
  });
}
