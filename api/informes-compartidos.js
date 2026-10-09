// api/informes-compartidos.js — los informes de Análisis por un enlace vivo.
//
// Un cliente le enseña sus informes a su jefe o a su junta, que no tienen
// usuario en Acuarius. El enlace (/i/<código>) es VIVO: cada vez que se abre
// se leen los datos de ese momento y se dibujan con el mismo módulo que usa la
// app (public/informes.js), así que el enlace y la pantalla dicen lo mismo.
//
// Con sesión (dueño, administrador o mercadeo):
//   GET               los enlaces de la cuenta (y del cliente, si se pide)
//   POST              crear: { client_id, pipeline_id|null, informes[], titulo, negocio, moneda }
//   DELETE ?id=       revocar (el enlace deja de abrir; no se borra la fila)
//
// Sin sesión:
//   GET ?t=<código>[&desde=<ms>]   los datos para dibujar los informes
//
// Lo que sale por el enlace público NO lleva nombres, teléfonos, correos ni
// notas de los leads, ni el texto de las actividades: solo lo que hace falta
// para contar. Los nombres de los comerciales sí, porque son del equipo y el
// informe por comercial no se entiende sin ellos.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, alcanceDeCliente, soloLoSuyo, puedeVer } from './_perfiles.js';
import { traerTodo } from './_paginado.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Copia de FUENTES_BASE de api/lead-sources.js (un endpoint no se importa
// desde otro); pruebas/informes-compartidos.mjs vigila que sean iguales.
export const FUENTES_BASE = [
  { key: 'manual',      label: 'Manual' },
  { key: 'meta_ads',    label: 'Meta Ads' },
  { key: 'google_ads',  label: 'Google Ads' },
  { key: 'organico',    label: 'Orgánico' },
  { key: 'referido',    label: 'Referido' },
  { key: 'web',         label: 'Web' },
];

// Los que se pueden compartir: los mismos ids que usa la app (crmView).
export const INFORMES_VALIDOS = ['analytics', 'sales', 'prod', 'equipo', 'mk'];
const MAX_ENLACES = 30;
const DIEZ_ANOS = 3650 * 86400000;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}
function jsonResp(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });
}
async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(), ...opts });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const enc = encodeURIComponent;

function token() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── Lo que se ve de un lead por un enlace público ───────────────────────────
// Lista cerrada a propósito: lo que no esté aquí no sale, aunque mañana se le
// añada una columna a `leads`.
const CAMPOS_LEAD = 'id,stage,value,source,tags,assigned_to,assigned_name,created_at,updated_at,closed_at,close_reason,close_currency,pipeline_id';

/**
 * Los datos de los informes de un enlace. Las consultas son las MISMAS que hace
 * la app para el dueño de la cuenta (ver los comentarios de cada endpoint), con
 * dos diferencias deliberadas: solo las columnas que cuentan, y las
 * actividades recortadas a los leads del informe.
 */
export async function datosDelEnlace(e, { desde = null, ahora = Date.now(), leer = sb } = {}) {
  const U = enc(e.user_id);
  const cli = e.client_id;
  const scopeLeads = cli ? `&client_id=eq.${enc(cli)}` : '';            // como /api/leads
  const scopeEq = cli ? `&client_id=eq.${enc(cli)}` : '&client_id=is.null'; // como campañas, fuentes…
  const quiere = new Set(e.informes || []);
  const h = sbHeaders();

  const [leads, pipelines, etiquetas, fuentesPropias] = await Promise.all([
    traerTodo(`${SUPABASE_URL}/rest/v1/leads?user_id=eq.${U}${scopeLeads}&deleted_at=is.null&select=${CAMPOS_LEAD}&order=created_at.desc`, h, { techo: 20000 }),
    leer(`pipelines?user_id=eq.${U}${scopeEq}&select=id,name,is_default,position&order=position.asc`),
    leer(`lead_tags?user_id=eq.${U}${scopeEq}&select=name,color,kind&order=name.asc`),
    leer(`lead_sources?user_id=eq.${U}${scopeEq}&select=key,label&order=position.asc`).catch(() => []),
  ]);

  let etapas = [];
  if (e.pipeline_id) {
    etapas = await leer(`pipeline_stages?user_id=eq.${U}&pipeline_id=eq.${enc(e.pipeline_id)}&select=key,label,color,position,probability&order=position.asc`);
    // Mismo criterio que /api/pipeline-stages: una clave repetida cuenta una vez.
    const vistas = new Set();
    etapas = (etapas || []).filter(s => !vistas.has(s.key) && vistas.add(s.key));
  }

  // Tareas pendientes, para «requieren atención» (como ?tareas=1 de la agenda).
  const tareas = quiere.has('analytics')
    ? await traerTodo(`${SUPABASE_URL}/rest/v1/activities?user_id=eq.${U}&done=is.false&cancelled_at=is.null` +
        (cli ? `&or=(client_id.eq.${enc(cli)},client_id.is.null)` : '') +
        `&due_at=lte.${enc(new Date(ahora + 90 * 86400000).toISOString())}&lead_id=not.is.null&select=lead_id,due_at&order=due_at.asc`, h, { techo: 20000 })
    : { filas: [] };

  const out = {
    leads: leads.filas, truncado: !!leads.truncado,
    pipelines: pipelines || [], etapas,
    etiquetas: etiquetas || [],
    fuentes: FUENTES_BASE.concat((fuentesPropias || []).map(f => ({ key: f.key, label: f.label }))),
    tareas: tareas.filas,
  };

  const idsLeads = new Set(out.leads.map(l => l.id));
  const desdeMs = Math.max(ahora - DIEZ_ANOS, Number(desde) || (ahora - 365 * 86400000));
  const desdeIso = enc(new Date(desdeMs).toISOString());

  // Productividad: la agenda del periodo (como el calendario de /api/agenda).
  if (quiere.has('prod')) {
    const acts = await traerTodo(`${SUPABASE_URL}/rest/v1/activities?user_id=eq.${U}${scopeEq}&cancelled_at=is.null` +
      `&due_at=gte.${desdeIso}&due_at=lte.${enc(new Date(ahora + 60 * 86400000).toISOString())}` +
      `&select=id,lead_id,type,due_at,done,created_at,updated_at&order=due_at.asc`, h, { techo: 10000 });
    out.acts = acts.filas;
  }
  // Productividad y Por comercial: lo registrado en las fichas, sin su texto.
  if (quiere.has('prod') || quiere.has('equipo')) {
    try {
      const inter = await traerTodo(`${SUPABASE_URL}/rest/v1/lead_activities?user_id=eq.${U}&created_at=gte.${desdeIso}` +
        `&select=id,lead_id,type,created_at,metadata&order=created_at.desc`, h, { techo: 50000 });
      out.inter = inter.filas
        .filter(a => a.lead_id && idsLeads.has(a.lead_id))
        .map(a => ({ id: a.id, lead_id: a.lead_id, type: a.type, created_at: a.created_at, metadata: (a.metadata && a.metadata.sistema) ? { sistema: true } : null }));
    } catch { out.inter = []; out.falla = true; }
  }
  // Por comercial: el equipo (como /api/assign-rules).
  if (quiere.has('equipo')) {
    const m = await leer(`team_members?owner_user_id=eq.${U}&status=eq.active&select=member_user_id,member_name,member_email&order=created_at.asc`);
    out.equipo = (m || []).filter(x => x.member_user_id).map(x => ({ id: x.member_user_id, nombre: x.member_name || x.member_email || 'Comercial' }));
  }
  // Marketing: campañas con sus aperturas reales, automatizaciones y registro.
  if (quiere.has('mk')) {
    const [camps, autos, logs] = await Promise.all([
      leer(`campaigns?user_id=eq.${U}${scopeEq}&select=id,name,subject,channel,status,stats,sent_at,created_at&order=created_at.desc&limit=50`),
      leer(`automations?user_id=eq.${U}${scopeEq}&select=id,name,active&order=created_at.desc`),
      leer(`automation_logs?user_id=eq.${U}&select=automation_id,lead_id,created_at,result&order=created_at.desc&limit=100`),
    ]);
    out.camps = await conAperturas(camps || []);
    out.autos = autos || [];
    out.logs = (logs || []).map(l => ({ automation_id: l.automation_id, lead_id: l.lead_id, created_at: l.created_at, result: l.result }));
  }
  return out;
}

// Las aperturas, como `GET /api/campaigns?stats=1&id=`: contactos distintos
// que abrieron o hicieron clic. La que no se pudo contar se queda sin el dato.
async function conAperturas(camps) {
  const h = sbHeaders();
  const contables = camps.filter(c => c.channel === 'email' && ['sent', 'sending'].includes(c.status) && (c.stats || {}).sent > 0).slice(0, 30);
  await Promise.all(contables.map(async c => {
    try {
      const sent = (await traerTodo(`${SUPABASE_URL}/rest/v1/email_events?campaign_id=eq.${enc(c.id)}&event=eq.sent&select=resend_id`, h, { techo: 50000 })).filas;
      const ids = sent.map(s => s.resend_id).filter(Boolean);
      let opened = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const trozo = ids.slice(i, i + 100);
        const r = (await traerTodo(`${SUPABASE_URL}/rest/v1/email_events?resend_id=in.(${trozo.map(x => '"' + x + '"').join(',')})&event=in.(opened,clicked)&select=resend_id`, h, { techo: 20000 })).filas;
        opened += new Set(r.map(e => e.resend_id)).size;
      }
      c.stats = Object.assign({}, c.stats, { opened });
    } catch {}
  }));
  return camps;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);

  // ── Público: los datos de un enlace ──────────────────────────────────────
  const t = url.searchParams.get('t');
  if (req.method === 'GET' && t !== null) {
    if (!/^[a-f0-9]{32}$/.test(t)) return jsonResp({ error: 'Enlace no válido.' }, 404);
    try {
      const e = (await sb(`informes_compartidos?token=eq.${t}&select=*&limit=1`))?.[0];
      if (!e) return jsonResp({ error: 'Este enlace no existe.' }, 404);
      if (e.revocado_at) return jsonResp({ error: 'Este enlace fue desactivado por quien lo compartió.', revocado: true }, 410);
      const datos = await datosDelEnlace(e, { desde: url.searchParams.get('desde') });
      // La visita se cuenta sin esperar: que falle no puede dejar sin informe.
      fetch(`${SUPABASE_URL}/rest/v1/informes_compartidos?id=eq.${e.id}`, {
        method: 'PATCH', headers: sbHeaders(),
        body: JSON.stringify({ vistas: (e.vistas || 0) + 1, ultima_vista: new Date().toISOString() }),
      }).catch(() => {});
      return jsonResp({
        enlace: {
          titulo: e.titulo, negocio: e.negocio, moneda: e.moneda || '', informes: e.informes,
          pipeline_id: e.pipeline_id, todos: !e.pipeline_id, creado: e.created_at,
        },
        generado: new Date().toISOString(),
        ...datos,
      }, 200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    } catch (err) {
      return jsonResp({ error: 'No se pudieron leer los datos del informe. Intenta de nuevo en un momento.' }, 502);
    }
  }

  // ── Con sesión ───────────────────────────────────────────────────────────
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'informes-compartidos'), 401);
  let quien;
  try { quien = await quienPregunta(sesion.id); }
  catch (e) { return jsonResp({ error: e.message }, e.suspendida ? 403 : 503); }
  // Compartir saca los números de la cuenta: solo quien los ve enteros.
  if (!puedeVer(quien.perfil, 'analisis') || soloLoSuyo(quien.perfil)) {
    return jsonResp({ error: 'Tu perfil solo ve su propia gestión: compartir los informes de la cuenta lo hace un administrador.' }, 403);
  }
  const U = enc(quien.userId);

  if (req.method === 'GET') {
    const cliente = alcanceDeCliente(quien, url.searchParams.get('client_id'));
    const filtro = url.searchParams.has('client_id') || quien.cliente
      ? (cliente ? `&client_id=eq.${enc(cliente)}` : '&client_id=is.null') : '';
    const enlaces = await sb(`informes_compartidos?user_id=eq.${U}${filtro}&revocado_at=is.null&select=id,token,client_id,pipeline_id,informes,titulo,negocio,creado_por_nombre,created_at,vistas,ultima_vista&order=created_at.desc`);
    return jsonResp({ enlaces: enlaces || [] });
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch {}
    const informes = [...new Set((body.informes || []).filter(i => INFORMES_VALIDOS.includes(i)))];
    if (!informes.length) return jsonResp({ error: 'Elige al menos un informe para compartir.' }, 400);
    const cliente = alcanceDeCliente(quien, body.client_id || null);
    // El proceso tiene que ser de esta cuenta y de este cliente.
    let pipelineId = body.pipeline_id || null;
    if (pipelineId) {
      const p = await sb(`pipelines?id=eq.${enc(pipelineId)}&user_id=eq.${U}&select=id,client_id&limit=1`);
      if (!p?.[0] || (p[0].client_id || null) !== (cliente || null)) return jsonResp({ error: 'Ese proceso no es de esta cuenta.' }, 400);
    }
    const vivos = await sb(`informes_compartidos?user_id=eq.${U}&revocado_at=is.null&select=id`);
    if ((vivos || []).length >= MAX_ENLACES) return jsonResp({ error: `Ya tienes ${MAX_ENLACES} enlaces activos. Desactiva alguno para crear otro.` }, 400);
    const fila = {
      token: token(), user_id: quien.userId, client_id: cliente, pipeline_id: pipelineId, informes,
      titulo: String(body.titulo || '').slice(0, 120) || null,
      negocio: String(body.negocio || '').slice(0, 120) || null,
      moneda: String(body.moneda || '').slice(0, 8) || null,
      creado_por: quien.actorId, creado_por_nombre: quien.nombre || null,
    };
    const r = await sb('informes_compartidos', { method: 'POST', body: JSON.stringify(fila) });
    const e = r?.[0];
    if (!e) return jsonResp({ error: 'No se pudo crear el enlace.' }, 500);
    return jsonResp({ enlace: e, url: 'https://app.acuarius.app/i/' + e.token });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/.test(id)) return jsonResp({ error: 'Falta el enlace.' }, 400);
    const r = await sb(`informes_compartidos?id=eq.${enc(id)}&user_id=eq.${U}&revocado_at=is.null`, {
      method: 'PATCH', body: JSON.stringify({ revocado_at: new Date().toISOString() }),
    });
    if (!r?.length) return jsonResp({ error: 'Ese enlace no existe o ya estaba desactivado.' }, 404);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
