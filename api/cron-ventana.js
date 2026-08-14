// api/cron-ventana.js
// Avisa antes de que se cierre la ventana de 24 horas de WhatsApp.
//
// Es el punto donde de verdad se pierde dinero: pasadas 24 horas desde el
// último mensaje del cliente ya no se le puede escribir libremente. Una
// conversación que caduca de madrugada se pierde sin que nadie la mire, y en el
// inbox solo se nota si alguien entra a mirarla.
//
// Corre cada hora (vercel.json).
export const config = { runtime: 'edge' };

import { getRegla, crearTareaVentana } from './_followup.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
const LOTE = 120;

function sb() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

export default async function handler(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  const ahora = Date.now();
  // La franja: lo que ya entró en las últimas horas de vida de la ventana pero
  // todavía no ha caducado. El aviso se marca en la fila, así que aunque una
  // pasada se salte no se avisa dos veces ni se pierde.
  const desde = new Date(ahora - 24 * 3600000).toISOString();   // aún viva
  const hasta = new Date(ahora - 12 * 3600000).toISOString();   // franja más ancha que el máximo configurable

  const convs = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?channel=eq.whatsapp&status=neq.resolved` +
    `&aviso_ventana_at=is.null&lead_id=not.is.null` +
    `&last_inbound_at=gt.${encodeURIComponent(desde)}&last_inbound_at=lt.${encodeURIComponent(hasta)}` +
    `&select=id,user_id,lead_id,contact_name,last_inbound_at&order=last_inbound_at.asc&limit=${LOTE}`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);

  if (!convs.length) return new Response(JSON.stringify({ ok: true, avisadas: 0 }));

  // La regla es por cuenta: se pide una vez por cuenta, no una por conversación.
  const reglas = new Map();
  let avisadas = 0, saltadas = 0;

  for (const c of convs) {
    try {
      if (!reglas.has(c.user_id)) reglas.set(c.user_id, await getRegla(c.user_id));
      const regla = reglas.get(c.user_id);
      if (!regla.ventana_24h) { saltadas++; continue; }

      const quedanMs = new Date(c.last_inbound_at).getTime() + 24 * 3600000 - ahora;
      const quedanH = quedanMs / 3600000;
      // Todavía no toca: se deja para una pasada posterior, sin marcar nada.
      if (quedanH > regla.ventana_horas_antes) continue;
      // Ya caducó entre la consulta y aquí: avisar ahora no sirve de nada.
      if (quedanH <= 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${c.id}`, {
          method: 'PATCH', headers: sb(),
          body: JSON.stringify({ aviso_ventana_at: new Date().toISOString() }),
        }).catch(() => {});
        saltadas++; continue;
      }

      const lead = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?id=eq.${c.lead_id}&select=id,name,phone,client_id,status`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);

      // Ganado o perdido ya no necesita rescate.
      if (!lead || ['ganado', 'perdido'].includes(String(lead.status || '').toLowerCase())) {
        await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${c.id}`, {
          method: 'PATCH', headers: sb(),
          body: JSON.stringify({ aviso_ventana_at: new Date().toISOString() }),
        }).catch(() => {});
        saltadas++; continue;
      }

      await crearTareaVentana(c.user_id, lead, c, Math.max(1, Math.round(quedanH)));

      // Se marca DESPUÉS de crear la tarea. Al revés, un fallo al crearla
      // dejaría la conversación marcada como avisada sin que nadie lo sepa.
      await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${c.id}`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({ aviso_ventana_at: new Date().toISOString() }),
      }).catch(() => {});
      avisadas++;
    } catch (e) {
      console.error('cron-ventana', c.id, e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, avisadas, saltadas, revisadas: convs.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
