// api/_palomma-proceso.js — paso 2 de la integración con Palomma: convertir
// los eventos guardados (palomma_eventos) en leads de Acuarius.
//
// Lo llama SOLO el cron (api/cron-palomma.js): un único consumidor, para que
// dos eventos del mismo lead nuevo no creen dos leads. Procesa por orden de
// timestamp y es idempotente: cada evento se marca procesado, y el enlace
// Palomma → Acuarius vive en palomma_leads. Las decisiones están arriba de
// _palomma.js. Solo se importa desde funciones edge.

import { embudoIgnorado, tableroDe, etapaDe, notaDeEstado, resumenDePerfil, telefonoDe, estaCalificado } from './_palomma.js';
import { intakeLead } from './_lead-intake.js';
import { registrarError } from './_registro-errores.js';
import { getGcalToken, gcalEventBody, gcalRequest } from './_gcal.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { ...init, headers: sbH(init.prefer ? { Prefer: init.prefer } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}

const MAX_INTENTOS = 5;
const TOPE_CONVERSACION = 30000;
const NOMBRE_TABLERO = { arriendo: /arriendo/i, venta: /venta/i, captacion: /captaci/i };

// ── Contexto de la cuenta (tableros, etapas, equipo), una vez por pasada ─────
async function contextoDe(conexion) {
  const alcance = `user_id=eq.${encodeURIComponent(conexion.user_id)}&` +
    (conexion.client_id ? `client_id=eq.${encodeURIComponent(conexion.client_id)}` : 'client_id=is.null');
  const pipelines = await sb(`/pipelines?${alcance}&select=id,name,is_default`) || [];
  const etapas = pipelines.length
    ? await sb(`/pipeline_stages?pipeline_id=in.(${pipelines.map(p => p.id).join(',')})&select=pipeline_id,key,position`) || []
    : [];
  const equipo = await sb(`/team_members?owner_user_id=eq.${encodeURIComponent(conexion.user_id)}&status=eq.active&select=member_user_id,member_email,member_name`) || [];
  const tablero = (clave) => pipelines.find(p => NOMBRE_TABLERO[clave]?.test(p.name))?.id || null;
  return {
    alcance,
    pipelines,
    principal: pipelines.find(p => p.is_default)?.id || pipelines[0]?.id || null,
    tablero,
    posicion: (pipelineId, key) => etapas.find(e => e.pipeline_id === pipelineId && e.key === key)?.position,
    asesorPorCorreo: (correo) => {
      const c = String(correo || '').toLowerCase().trim();
      return c ? equipo.find(m => String(m.member_email || '').toLowerCase() === c) || null : null;
    },
  };
}

async function nota(conexion, leadId, contenido, evento) {
  const [f] = await sb('/lead_activities', {
    method: 'POST', prefer: 'return=representation',
    body: JSON.stringify({ lead_id: leadId, user_id: conexion.user_id, type: 'nota', content: contenido, metadata: { origen: 'palomma', evento } }),
  }) || [];
  return f?.id || null;
}

// Lee el lead y mezcla campos propios sin pisar los demás.
async function leerLead(id) {
  return (await sb(`/leads?id=eq.${id}&select=id,phone,stage,pipeline_id,assigned_to,closed_at,custom_fields,deleted_at&limit=1`))?.[0] || null;
}
async function mezclarCampos(lead, campos) {
  const cf = { ...(lead.custom_fields || {}) };
  let cambia = false;
  for (const [k, v] of Object.entries(campos)) if (v && cf[k] !== v) { cf[k] = v; cambia = true; }
  if (!cambia) return;
  await sb(`/leads?id=eq.${lead.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ custom_fields: cf, updated_at: new Date().toISOString() }) });
}

// ── La cita en Google Calendar ──────────────────────────────────────────────
// Igual que una reunión creada en la Agenda (api/agenda.js): va al calendario
// de la cuenta, si está conectado. Si no lo está, la cita queda en Acuarius y
// subirCitasPendientes() la sube el día que se conecte. Un fallo de Google no
// tumba el evento: la cita ya está guardada.
const MARCA_CITA = 'agendada por Palomma';
async function citaAGoogle(conexion, act) {
  const conn = await getGcalToken(conexion.user_id).catch(() => null);
  if (!conn?.token) return false;
  try {
    const ev = await gcalRequest(conn.token, 'POST', '', gcalEventBody(act, null, false), false);
    if (ev?.id) await sb(`/activities?id=eq.${act.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ gcal_event_id: ev.id }) });
    return !!ev?.id;
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'palomma.cita a Google Calendar', error: e, usuario: conexion.user_id });
    return false;
  }
}

// Las citas de Palomma que aún no están en Google (se crearon antes de conectar
// el calendario, o Google falló): las futuras, de a pocas por vuelta.
export async function subirCitasPendientes(conexion, tope = 10) {
  const conn = await getGcalToken(conexion.user_id).catch(() => null);
  if (!conn?.token) return 0;
  const citas = await sb(`/activities?user_id=eq.${encodeURIComponent(conexion.user_id)}&type=eq.meeting&gcal_event_id=is.null&cancelled_at=is.null` +
    `&due_at=gt.${new Date().toISOString()}&title=ilike.*${encodeURIComponent(MARCA_CITA)}*&select=*&order=due_at.asc&limit=${tope}`) || [];
  let subidas = 0;
  for (const c of citas) if (await citaAGoogle(conexion, c)) subidas++;
  return subidas;
}

// ── Encontrar o crear el lead de Acuarius ───────────────────────────────────
// «Verifica que no estén creados ya» (Alejandro, 15-10): las asesoras venían
// creándolos a mano. Se busca por teléfono (los últimos 10 dígitos) y luego por
// correo en TODA la cuenta del cliente; si existe, se enlaza a ese y no se crea
// otro. Solo si no hay ninguno se crea, con intakeLead.
async function asegurarLead(conexion, ctx, L) {
  const tel = String(telefonoDe(L) || '').replace(/\D/g, '').slice(-10);
  let existente = null;
  if (tel.length >= 7) {
    const cola = tel.slice(-2);
    const filas = await sb(`/leads?${ctx.alcance}&deleted_at=is.null&phone=like.*${cola}&select=id,phone,closed_at,updated_at&order=updated_at.desc&limit=1000`) || [];
    const mismos = filas.filter(f => String(f.phone || '').replace(/\D/g, '').endsWith(tel));
    existente = mismos.find(f => !f.closed_at) || mismos[0] || null;
  }
  if (!existente && L.email) {
    existente = (await sb(`/leads?${ctx.alcance}&deleted_at=is.null&email=eq.${encodeURIComponent(String(L.email).toLowerCase())}&select=id&order=updated_at.desc&limit=1`))?.[0] || null;
  }
  if (existente) return { leadId: existente.id, creado: false };

  const clave = tableroDe(L);
  const asesor = null;   // se asigna con el estado (redirected / appointmentPending), no al nacer
  const { lead } = await intakeLead(conexion.user_id, conexion.client_id || null, {
    name: L.name || L.whatsappUsername || 'Contacto de WhatsApp',
    email: L.email || null,
    phone: telefonoDe(L),
    source: 'palomma',
    sourceLabel: 'Palomma',
    note: 'Prospecto que llegó por Palomma' + (L.source ? ' (origen: ' + L.source + ')' : '') + '.',
    pipelineId: (clave && ctx.tablero(clave)) || ctx.principal,
    stage: 'nuevo',
    custom_fields: {
      'Conversación en Palomma': L.dashboardUrl || null,
      'Origen en Palomma': L.source || null,
      'Busca (Palomma)': resumenDePerfil(L.profile) || null,
    },
    sinAsignar: !asesor,
    sinPrimerContacto: true,
  });
  return { leadId: lead.id, creado: true };
}

// ── Un evento ───────────────────────────────────────────────────────────────
async function aplicar(conexion, ctx, ev) {
  const data = ev.payload?.data || {};
  const L = data.lead || {};
  if (embudoIgnorado(L.pipelineName)) return 'ignorado: embudo ' + L.pipelineName;

  let enlace = (await sb(`/palomma_leads?conexion_id=eq.${conexion.id}&palomma_lead_id=eq.${encodeURIComponent(ev.palomma_lead_id)}&select=*&limit=1`))?.[0];
  // Mientras Palomma no lo califique, no existe para Acuarius. El evento que lo
  // califica trae el lead entero con la conversación, así que no se pierde nada.
  if (!enlace && !estaCalificado(L, data)) return 'esperando calificación';
  if (!enlace) {
    const { leadId, creado } = await asegurarLead(conexion, ctx, L);
    [enlace] = await sb('/palomma_leads?on_conflict=conexion_id,palomma_lead_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
      body: JSON.stringify({ conexion_id: conexion.id, palomma_lead_id: ev.palomma_lead_id, lead_id: leadId, creado_por_palomma: creado, etapa_palomma: L.pipelinePositionId || null, ultimo_ts: ev.ts }),
    });
    if (!creado) await nota(conexion, leadId, 'Este contacto también está escribiendo por Palomma.' + (L.dashboardUrl ? ' Conversación: ' + L.dashboardUrl : ''), ev.tipo);
  }
  const lead = await leerLead(enlace.lead_id);
  if (!lead || lead.deleted_at) return 'sin lead (borrado en Acuarius)';

  // Un evento más viejo que el último aplicado no mueve nada (llegan desordenados).
  const viejo = enlace.ultimo_ts && ev.ts && ev.ts < enlace.ultimo_ts;
  const hechos = [];

  // Si el lead no tiene teléfono y ahora se sabe (la persona lo dio en el chat),
  // se completa. Nunca se cambia uno que ya tenga.
  const telNuevo = telefonoDe(L);
  if (telNuevo && !lead.phone) {
    await sb(`/leads?id=eq.${lead.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ phone: telNuevo, updated_at: new Date().toISOString() }) });
    lead.phone = telNuevo;
    hechos.push('teléfono');
  }

  // Perfil y enlace a la conversación: siempre se pueden refrescar.
  await mezclarCampos(lead, {
    'Conversación en Palomma': L.dashboardUrl || null,
    'Busca (Palomma)': resumenDePerfil(L.profile) || null,
  });

  // El tablero se decide cuando el perfil lo dice. Si Palomma lo creó en el
  // principal sin saber aún si arrienda o compra, y sigue en «nuevo» sin que
  // nadie lo haya tocado, se mueve al que corresponde.
  const clave = tableroDe(L);
  const destino = clave && ctx.tablero(clave);
  if (!viejo && enlace.creado_por_palomma && destino && lead.pipeline_id !== destino && lead.stage === 'nuevo' && !lead.closed_at) {
    await sb(`/leads?id=eq.${lead.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ pipeline_id: destino, updated_at: new Date().toISOString() }) });
    lead.pipeline_id = destino;
    hechos.push('tablero ' + clave);
  }

  const estado = L.pipelinePositionId;
  const cambioEstado = estado && estado !== enlace.etapa_palomma;
  // lead.status-updated trae los hitos; lead.updated, los que Palomma no
  // anuncia (cita confirmada/cancelada, info recolectada). Así no sale doble.
  const esHito = ev.tipo === 'lead.status-updated' ||
    (ev.tipo === 'lead.updated' && cambioEstado && ['appointmentConfirmed', 'appointmentCancelled', 'propertyInfoCollected'].includes(estado));

  if (!viejo && esHito) {
    const texto = notaDeEstado(estado, data);
    if (texto) { await nota(conexion, lead.id, texto, ev.tipo); hechos.push('nota ' + estado); }

    // Asesor: solo si el lead no tiene dueño. Uno que no está en Acuarius
    // (Patricia Campo) va al reparto normal.
    const emp = data.employeeAssigned;
    if (emp && !lead.assigned_to) {
      const m = ctx.asesorPorCorreo(emp.email);
      const { asignarLead } = await import('./_assign.js');
      await asignarLead(conexion.user_id, { ...lead, source: 'palomma' }, 'palomma', m ? m.member_user_id : null);
      hechos.push(m ? 'asignado a ' + (m.member_name || emp.name) : 'reparto (asesor no está en Acuarius)');
    }

    // Etapa: solo hacia delante y solo si el lead sigue abierto.
    const meta = etapaDe(estado);
    if (meta && !lead.closed_at && !['ganado', 'perdido'].includes(lead.stage)) {
      const pa = ctx.posicion(lead.pipeline_id, lead.stage), pb = ctx.posicion(lead.pipeline_id, meta);
      if (pb != null && (pa == null || pb > pa)) {
        await sb(`/leads?id=eq.${lead.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ stage: meta, stage_position: Date.now(), updated_at: new Date().toISOString() }) });
        await sb('/lead_activities', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ lead_id: lead.id, user_id: conexion.user_id, type: 'stage_change', content: 'Movido por Palomma', metadata: { from: lead.stage, to: meta, actor: 'Palomma', origen: 'palomma' } }) });
        hechos.push('etapa ' + lead.stage + ' → ' + meta);
      }
    }

    // La cita, en la agenda (una sola vez por appointment.id).
    const cita = data.appointment;
    if (estado === 'appointmentPending' && cita?.id && cita.startAt && !(enlace.citas || []).includes(cita.id)) {
      const [act] = await sb('/activities', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({
        user_id: conexion.user_id, client_id: conexion.client_id || null, lead_id: lead.id, type: 'meeting',
        title: 'Visita' + (cita.listingCode ? ' al inmueble ' + cita.listingCode : '') + ' (' + MARCA_CITA + ')',
        description: [cita.branchName, cita.neighborhood, cita.city].filter(Boolean).join(' · ') || null,
        due_at: new Date(cita.startAt).toISOString(), end_at: cita.endAt ? new Date(cita.endAt).toISOString() : null, done: false,
      }) });
      enlace.citas = [...(enlace.citas || []), cita.id];
      hechos.push('cita agendada');
      if (act && await citaAGoogle(conexion, act)) hechos.push('en Google Calendar');
    }
  }

  // La conversación, en UNA nota que se actualiza (decisión de Alejandro).
  const conv = L.conversation?.content;
  if (conv) {
    const contenido = 'Conversación de WhatsApp en Palomma' + (L.conversation.lastCustomerMessageAt ? ' (último mensaje del contacto: ' + new Date(L.conversation.lastCustomerMessageAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) + ')' : '') +
      '\n\n' + String(conv).slice(-TOPE_CONVERSACION);
    if (enlace.nota_conversacion_id) {
      await sb(`/lead_activities?id=eq.${enlace.nota_conversacion_id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ content: contenido }) });
    } else {
      enlace.nota_conversacion_id = await nota(conexion, lead.id, contenido, 'conversacion');
    }
    hechos.push('conversación');
  }

  // Llamada del agente de voz y mensaje no entregado: notas.
  if (ev.tipo === 'call.ended' && data.call) {
    const c = data.call;
    await nota(conexion, lead.id, 'Palomma: llamada ' + (c.type === 'inbound' ? 'entrante' : 'saliente') + (c.answered ? ' de ' + (c.durationMinutes || Math.round((c.durationSeconds || 0) / 60)) + ' min' : ' sin contestar') +
      (c.analysis?.summary ? '. Resumen: ' + c.analysis.summary : '') + (c.recordingUrl ? '\nGrabación: ' + c.recordingUrl : ''), ev.tipo);
    hechos.push('llamada');
  }
  if (ev.tipo === 'whatsapp-message.delivery-failed') {
    await nota(conexion, lead.id, 'Palomma: WhatsApp no pudo entregar un mensaje a este contacto' + ((data.errors || [])[0]?.code ? ' (código ' + data.errors[0].code + ')' : '') + '.', ev.tipo);
    hechos.push('entrega fallida');
  }

  await sb(`/palomma_leads?conexion_id=eq.${conexion.id}&palomma_lead_id=eq.${encodeURIComponent(ev.palomma_lead_id)}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: JSON.stringify({
      ...(viejo ? {} : { etapa_palomma: estado || enlace.etapa_palomma, ultimo_ts: ev.ts || enlace.ultimo_ts }),
      nota_conversacion_id: enlace.nota_conversacion_id || null, citas: enlace.citas || [], actualizado_at: new Date().toISOString(),
    }),
  });
  return hechos.join(', ') || (viejo ? 'evento viejo, sin cambios' : 'sin cambios');
}

// Citas que quedaron sin Google Calendar (se conectó después, o Google falló),
// de todas las conexiones encendidas.
async function citasDeTodas() {
  let n = 0;
  const activas = await sb('/palomma_conexiones?activo=eq.true&procesar=eq.true&select=id,user_id,client_id').catch(() => []) || [];
  for (const c of activas) n += await subirCitasPendientes(c).catch(() => 0);
  return n;
}

/**
 * Procesa los eventos pendientes, en orden de timestamp. `conexionId` acota a
 * una conexión (el receptor); sin él, todas (el cron). Devuelve un resumen.
 */
export async function procesarPendientes({ conexionId = null, limite = 100 } = {}) {
  const filtro = conexionId ? `&conexion_id=eq.${conexionId}` : '';
  const pendientes = await sb(`/palomma_eventos?procesado_at=is.null&intentos=lt.${MAX_INTENTOS}${filtro}&select=id,conexion_id,tipo,palomma_lead_id,ts,payload,intentos&order=ts.asc.nullslast,id.asc&limit=${limite}`) || [];
  if (!pendientes.length) {
    return { procesados: 0, fallidos: 0, citasSubidas: await citasDeTodas() };
  }
  const conexiones = new Map();
  let procesados = 0, fallidos = 0;
  for (const ev of pendientes) {
    try {
      if (!conexiones.has(ev.conexion_id)) {
        const c = (await sb(`/palomma_conexiones?id=eq.${ev.conexion_id}&select=id,user_id,client_id,activo,procesar&limit=1`))?.[0];
        conexiones.set(ev.conexion_id, c && c.activo ? { conexion: c, ctx: c.procesar ? await contextoDe(c) : null } : null);
      }
      const cx = conexiones.get(ev.conexion_id);
      // Con el paso 2 apagado (palomma_conexiones.procesar) el evento se queda
      // pendiente: se procesará entero el día que se encienda.
      if (cx && !cx.conexion.procesar) continue;
      const resultado = cx ? await aplicar(cx.conexion, cx.ctx, ev) : 'conexión inactiva';
      await sb(`/palomma_eventos?id=eq.${ev.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ procesado_at: new Date().toISOString(), resultado: String(resultado).slice(0, 300), error: null }) });
      procesados++;
    } catch (e) {
      fallidos++;
      const intentos = (ev.intentos || 0) + 1;
      await sb(`/palomma_eventos?id=eq.${ev.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ intentos, error: String(e?.message || e).slice(0, 500) }) }).catch(() => {});
      if (intentos >= MAX_INTENTOS) {
        await registrarError({ origen: 'servidor', donde: 'palomma.procesar', error: e, detalle: ev.tipo + ' ' + ev.palomma_lead_id });
      }
    }
  }
  return { procesados, fallidos, citasSubidas: await citasDeTodas() };
}
