// api/webhooks/inbox/[token].js
// Entrada genérica de mensajes al inbox, para los canales que no tienen (o no
// nos dan) API propia. El caso claro es LinkedIn: no existe API pública de
// mensajes directos, así que el mensaje entra desde Zapier / Make / n8n o desde
// una integración propia, y la respuesta del agente vuelve en el JSON para que
// sea ese mismo automatismo el que la publique.
//
// POST https://app.acuarius.app/api/webhooks/inbox/<token>
//   { "contact_id": "...", "contact_name": "...", "text": "...", "message_id": "..." }
// →  { "ok": true, "reply": "...", "escalated": false, "calificacion": {...} }
//
// El token es el external_id de la conexión: único, secreto y revocable
// borrando la conexión.

import { processIncoming } from '../../_inbox-engine.js';

// Edge obligatorio: importa api/_*.js (ver api/hook/[token].js)
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  const url = new URL(req.url);
  const token = url.pathname.split('/').filter(Boolean).pop();
  if (!token || token.length < 12) return jsonResp({ error: 'Token inválido' }, 401);

  // Solo para saber de qué canal es: processIncoming vuelve a resolver la
  // conexión, pero necesita el canal para buscarla.
  const conn = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?external_id=eq.${encodeURIComponent(token)}&is_active=eq.true&select=channel&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
  if (!conn) return jsonResp({ error: 'Conexión no encontrada o desactivada' }, 404);

  let body;
  try {
    body = req.headers.get('content-type')?.includes('json')
      ? await req.json()
      : Object.fromEntries(new URLSearchParams(await req.text()));
  } catch { return jsonResp({ error: 'Body inválido' }, 400); }

  // Nombres tolerantes: cada herramienta llama a las cosas a su manera
  const contactId = String(body.contact_id || body.contactId || body.from || body.sender_id || '').trim();
  const text = String(body.text || body.message || body.body || '').trim();
  if (!contactId || !text) {
    return jsonResp({ error: 'Faltan contact_id y text' }, 400);
  }

  try {
    const r = await processIncoming({
      channel: conn.channel,
      externalId: token,
      contactId,
      contactName: String(body.contact_name || body.contactName || body.name || '').trim() || null,
      text: text.slice(0, 4000),
      providerMessageId: String(body.message_id || body.messageId || `${contactId}-${Date.now()}`),
      // La respuesta la publica quien llama: aquí no hay API a la que escribir
      send: null,
    });
    return jsonResp(r);
  } catch (e) {
    console.error('[inbox webhook]', e);
    return jsonResp({ error: String(e?.message || e) }, 500);
  }
}
