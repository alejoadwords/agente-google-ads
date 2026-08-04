// Webhook de mensajes directos de TikTok (Business Messaging API).
// GET  → verificación del endpoint (TikTok manda un challenge al darlo de alta)
// POST → mensajes entrantes
//
// La conversación la lleva _inbox-engine.js, igual que Meta: aquí solo se
// traduce el evento de TikTok al formato común y se responde por su API.
//
// Nota sobre el payload: la Business Messaging API todavía mueve nombres de
// campo entre versiones, así que el parseo acepta las variantes conocidas en
// vez de asumir una sola forma. Si TikTok cambia algo, se ve en el log de
// eventos ignorados en vez de perderse en silencio.

export const config = { runtime: 'edge' };

import { processIncoming } from '../_inbox-engine.js';

const SEND_URL = process.env.TIKTOK_SEND_URL || 'https://business-api.tiktok.com/open_api/v1.3/business/message/send/';

// ── Envío de la respuesta por TikTok ──────────────────────────────────────────
async function sendTikTok(connection, contactId, text) {
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': connection.access_token },
    body: JSON.stringify({
      business_id: connection.external_id,
      to_user_id: contactId,
      message: { type: 'text', text },
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || (out && out.code && out.code !== 0)) {
    console.error('[tiktok] envío falló:', res.status, JSON.stringify(out).slice(0, 300));
  }
}

// ── Normalización del evento ──────────────────────────────────────────────────
// Devuelve una lista de mensajes { externalId, contactId, contactName, text, id }
export function parseTikTokEvents(body) {
  const out = [];
  const push = (m, ctx = {}) => {
    if (!m) return;
    const text =
      (typeof m.text === 'string' && m.text) ||
      m.content?.text || m.message?.text ||
      (typeof m.content === 'string' ? m.content : null) || '';
    if (!text) return;
    const contactId = String(
      m.from_user_id || m.sender_id || m.from?.id || m.sender?.id || ctx.from_user_id || ''
    );
    const externalId = String(
      m.business_id || m.to_user_id || m.receiver_id || ctx.business_id || ctx.to_user_id || body.business_id || ''
    );
    if (!contactId || !externalId) return;
    out.push({
      externalId,
      contactId,
      contactName: m.from_user_name || m.sender_name || m.from?.nickname || m.sender?.display_name || null,
      text: String(text).slice(0, 4000),
      id: String(m.message_id || m.msg_id || m.id || `${contactId}-${m.create_time || m.timestamp || Date.now()}`),
    });
  };

  // Forma 1: { event: 'message.receive', data: { ... } }
  if (body?.data && !Array.isArray(body.data)) push(body.data, body.data);
  // Forma 2: { data: [ {...}, {...} ] }
  if (Array.isArray(body?.data)) body.data.forEach(d => push(d, d));
  // Forma 3: { messages: [...] } dentro de una conversación
  if (Array.isArray(body?.messages)) body.messages.forEach(m => push(m, body));
  // Forma 4: lote de eventos { events: [ { data: {...} } ] }
  if (Array.isArray(body?.events)) {
    body.events.forEach(ev => {
      if (Array.isArray(ev?.data)) ev.data.forEach(d => push(d, d));
      else push(ev?.data || ev, ev?.data || ev);
    });
  }

  // Sin duplicados por id de mensaje
  const seen = new Set();
  return out.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

export default async function handler(req) {
  const url = new URL(req.url);

  // Alta del webhook: TikTok pide devolver el challenge tal cual
  if (req.method === 'GET') {
    const challenge = url.searchParams.get('challenge') || url.searchParams.get('hub.challenge');
    const token = url.searchParams.get('verify_token') || url.searchParams.get('hub.verify_token');
    const expected = process.env.TIKTOK_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (challenge && (!expected || token === expected)) return new Response(challenge, { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response('Bad request', { status: 400 }); }

  // Modo simulador: permite probar el circuito completo (inbox, agente, entrada
  // al pipeline) sin la app de TikTok aprobada. Exige el secreto de los crons.
  const simulate = url.searchParams.get('simulate') === '1';
  if (simulate) {
    const secret = req.headers.get('x-acuarius-secret');
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const eventos = parseTikTokEvents(body);
  if (!eventos.length) {
    console.warn('[tiktok] evento sin mensajes reconocibles:', JSON.stringify(body).slice(0, 400));
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  const resultados = [];
  for (const m of eventos) {
    try {
      const r = await processIncoming({
        channel: 'tiktok',
        externalId: m.externalId,
        contactId: m.contactId,
        contactName: m.contactName,
        text: m.text,
        providerMessageId: m.id,
        // En simulación no se llama a la API de TikTok: no hay cuenta real
        send: simulate ? null : sendTikTok,
      });
      resultados.push(r);
    } catch (e) {
      console.error('[tiktok] error procesando mensaje', e);
      resultados.push({ ok: false, reason: String(e && e.message || e) });
    }
  }

  if (simulate) {
    return new Response(JSON.stringify({ procesados: resultados.length, resultados }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('EVENT_RECEIVED', { status: 200 });
}
