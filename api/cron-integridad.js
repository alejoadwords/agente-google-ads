export const config = { runtime: 'edge' };

// api/cron-integridad.js
// Vigilante diario de coherencia de datos.
//
// Nació de un fallo que descubrió un CLIENTE, no nosotros: durante once días se
// crearon tareas que no aparecían en ninguna parte, y nadie se enteró porque
// nada daba error. Este cron busca justo esa clase de cosas —las que no
// revientan, solo dejan de existir— y avisa por correo si encuentra alguna.
//
// Si todo está bien no manda nada: un aviso diario que siempre dice «ok» se
// deja de leer a la semana.

import { emailHtml, bloque, RESPONDER_A } from './_email-layout.js';
import { enviarResend } from './_correo.js';
import { latir } from './_latido.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const cab = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const AVISAR_A = 'ceo@acuarius.app';

const sb = (ruta) => fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: cab })
  .then(r => (r.ok ? r.json() : []))
  .catch(() => []);

// TODAS las filas, de mil en mil. PostgREST devuelve como mucho mil aunque se
// pida `limit=5000`: con 1.041 tareas, la revisión de fantasmas veía mil, y
// las 41 que quedaban fuera salían en el correo como «tareas que no aparecen
// en ninguna parte» (30-09-2026, 24 falsas). Y un fallo NO se convierte en
// lista vacía: con las tareas vacías, todo el historial parecería fantasma.
// Se lanza, y quien llama dice que no pudo revisar.
export async function sbTodas(ruta, { pagina = 1000, techo = 50000 } = {}) {
  const orden = /[?&]order=/.test(ruta) ? '' : '&order=id.asc';
  const filas = [];
  for (let desde = 0; desde < techo; desde += pagina) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}${orden}&limit=${pagina}&offset=${desde}`, { headers: cab });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' leyendo ' + ruta.split('?')[0]);
    const lote = (await r.json()) || [];
    filas.push(...lote);
    if (lote.length < pagina) return filas;
  }
  throw new Error('más de ' + techo + ' filas en ' + ruta.split('?')[0] + ': la revisión no se fía de un recorte');
}

// Una revisión que no pudo leer sus datos lo dice, en vez de callar o de
// inventarse hallazgos.
function noSePudo(nombre, e) {
  return { titulo: 'No se pudo hacer la revisión: ' + nombre, detalle: [String(e?.message || e)] };
}

// ── Revisión 1: tareas que el usuario cree tener y no existen ────────────────
// Una fila de lead_activities type 'tarea' con fecha, sin su gemela en
// activities, es una tarea invisible: no sale en Tareas, ni en la tarjeta, ni
// en el resumen. Solo cuentan las futuras: una vencida ya no se puede rescatar.
export async function tareasFantasma() {
  let historial, reales;
  try {
    [historial, reales] = await Promise.all([
      sbTodas('lead_activities?type=eq.tarea&select=id,lead_id,content,metadata'),
      sbTodas('activities?type=eq.task&select=id,lead_id,due_at'),
    ]);
  } catch (e) { return noSePudo('tareas fantasma', e); }
  const hay = new Set((reales || []).map(t => t.lead_id + '|' + new Date(t.due_at).toISOString()));
  const ahora = Date.now();
  const malas = [];
  for (const a of historial || []) {
    const f = a.metadata?.due_date;
    if (!f || a.metadata?.activity_id) continue;
    const t = /Z|[+-]\d{2}:?\d{2}$/.test(f) ? new Date(f) : new Date(f + ':00-05:00');
    if (isNaN(t) || t.getTime() <= ahora) continue;
    if (hay.has(a.lead_id + '|' + t.toISOString())) continue;
    malas.push(`«${(a.content || '').slice(0, 60)}» para el ${f} (lead ${a.lead_id})`);
  }
  return malas.length
    ? { titulo: 'Tareas que el usuario creó y no aparecen en ninguna parte', detalle: malas }
    : null;
}

// ── Revisión 2: tareas que nunca podrán verse en una tarjeta ────────────────
export async function tareasSinLead() {
  const filas = await sb('activities?type=eq.task&done=is.false&cancelled_at=is.null&lead_id=is.null&select=id,title&limit=200');
  return filas?.length
    ? { titulo: 'Tareas pendientes sin lead (no salen en ninguna ficha)', detalle: filas.map(f => `«${f.title}»`) }
    : null;
}

// ── Revisión 3: la tarea y su lead en clientes distintos ────────────────────
// Con un cliente activo, el filtro las esconde: existen pero no se ven.
export async function clienteDesajustado() {
  let tareas, leads;
  try {
    [tareas, leads] = await Promise.all([
      sbTodas('activities?type=eq.task&done=is.false&cancelled_at=is.null&select=id,title,lead_id,client_id'),
      sbTodas('leads?select=id,client_id'),
    ]);
  } catch (e) { return noSePudo('cliente de tareas y leads', e); }
  const deLead = new Map((leads || []).map(l => [l.id, l.client_id || null]));
  const malas = (tareas || [])
    .filter(t => t.lead_id && deLead.has(t.lead_id) && (t.client_id || null) !== deLead.get(t.lead_id))
    .map(t => `«${t.title}» (lead ${t.lead_id})`);
  return malas.length
    ? { titulo: 'Tareas cuyo cliente no coincide con el de su lead', detalle: malas }
    : null;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const secreto = req.headers.get('authorization') || url.searchParams.get('secret') || '';
  if (process.env.CRON_SECRET && !secreto.includes(process.env.CRON_SECRET)) {
    return new Response('No autorizado', { status: 401 });
  }

  // La entrada se marca aparte de la salida: un latido que solo se escribe al
  // terminar no distingue «Vercel no lo llamó» de «lo llamó y se murió a
  // mitad». Ver api/_latido.js.
  await latir('cron-integridad', { empezo: new Date().toISOString() });
  const responder = async (cuerpo, fallo) => {
    await latir('cron-integridad', cuerpo, fallo);
    return new Response(JSON.stringify(cuerpo), { headers: { 'Content-Type': 'application/json' } });
  };

  const hallazgos = (await Promise.all([tareasFantasma(), tareasSinLead(), clienteDesajustado()]))
    .filter(Boolean);

  if (!hallazgos.length) return responder({ ok: true, hallazgos: 0 });

  const cuerpo = hallazgos.map(h =>
    `<p style="margin:0 0 6px"><b>${h.titulo}</b> — ${h.detalle.length}</p>` +
    bloque(h.detalle.slice(0, 12).map(d => `• ${d}`).join('<br>') +
      (h.detalle.length > 12 ? `<br><i>…y ${h.detalle.length - 12} más</i>` : ''), '#AE3B2A')
  ).join('');

  await enviarResend('cron-integridad', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Acuarius <alertas@app.acuarius.app>',
      reply_to: RESPONDER_A,
      to: [AVISAR_A],
      subject: `⚠️ Revisión de integridad: ${hallazgos.length} cosa(s) que revisar`,
      html: emailHtml({
        titulo: 'Hay datos que no cuadran',
        intro: 'La revisión diaria encontró cosas que no dan error pero dejan de funcionar sin avisar.',
        cuerpo,
        pie: '<b>Equipo de Soporte — Acuarius</b>',
      }),
    }),
  }).catch(e => console.error('[integridad] no se pudo avisar:', e?.message));

  return responder({ ok: false, hallazgos: hallazgos.map(h => h.titulo) });
}
