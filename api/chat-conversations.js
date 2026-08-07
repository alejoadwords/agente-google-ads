export const config = { runtime: 'edge' };

import { upsertLeadFromConversation } from './_inbox-engine.js';
import { getPolicy } from './_channel-policy.js';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
function sbHeaders() {
  return { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' };
}
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g,'+').replace(/_/g,'/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: si soy miembro activo de un workspace, opero sobre los datos del dueño
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sbHeaders() });
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) userId = _tw.owner_user_id;
  } catch {}


  const url = new URL(req.url);

  // GET ?report=1&from= — datos agregados para el informe de Conversaciones
  if (req.method === 'GET' && url.searchParams.get('report')) {
    const from = url.searchParams.get('from');
    let cq = `${SUPABASE_URL}/rest/v1/chat_conversations?user_id=eq.${userId}&select=id,channel,status,unread_count,created_at,last_message_at,lead_id&order=created_at.desc&limit=1000`;
    if (from) cq += `&created_at=gte.${encodeURIComponent(from)}`;
    const convs = await fetch(cq, { headers: sbHeaders() }).then(r => r.ok ? r.json() : []).catch(() => []);

    // Mensajes de esas conversaciones, para medir el tiempo de primera respuesta
    let msgs = [];
    const ids = (convs || []).map(c => c.id).slice(0, 300);
    if (ids.length) {
      const mq = `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=in.(${ids.join(',')})` +
        `&select=conversation_id,role,created_at&order=created_at.asc&limit=5000`;
      msgs = await fetch(mq, { headers: sbHeaders() }).then(r => r.ok ? r.json() : []).catch(() => []);
    }
    const chans = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${userId}&select=channel,channel_name,is_active`,
      { headers: sbHeaders() }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    return jsonResp({ conversations: convs || [], messages: msgs || [], channels: chans || [] });
  }

  // GET — list conversations
  if (req.method === 'GET' && !url.searchParams.get('messages')) {
    const status = url.searchParams.get('status');
    const channel = url.searchParams.get('channel');
    const agentId = url.searchParams.get('agent_id');
    const leadId = url.searchParams.get('lead_id');
    let query = `${SUPABASE_URL}/rest/v1/chat_conversations?user_id=eq.${userId}&select=*&order=last_message_at.desc&limit=50`;
    if (status) query += `&status=eq.${encodeURIComponent(status)}`;
    if (channel) query += `&channel=eq.${encodeURIComponent(channel)}`;
    if (agentId) query += `&agent_id=eq.${encodeURIComponent(agentId)}`;
    if (leadId) query += `&lead_id=eq.${encodeURIComponent(leadId)}`;
    const res = await fetch(query, { headers: sbHeaders() });
    const rows = await res.json();
    return jsonResp({ conversations: rows || [] });
  }

  // GET — messages for a conversation
  if (req.method === 'GET' && url.searchParams.get('messages')) {
    const convId = url.searchParams.get('messages');
    // Verify ownership
    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${convId}&user_id=eq.${userId}&select=id`,
      { headers: sbHeaders() }
    );
    const ck = await check.json();
    if (!ck?.[0]) return jsonResp({ error: 'No autorizado' }, 403);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${convId}&select=*&order=created_at.asc`,
      { headers: sbHeaders() }
    );
    const rows = await res.json();
    return jsonResp({ messages: rows || [] });
  }

  // PUT — update conversation status / mark read
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id, status, unread_count } = body;
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const update = {};
    if (status) update.status = status;
    if (unread_count !== undefined) update.unread_count = unread_count;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ conversation: rows[0] });
  }

  // POST ?action=to_pipeline — la conversación entra al CRM como lead
  // Es la decisión manual: se elige la etapa y el lead queda vinculado a la
  // conversación (con su etiqueta de canal y las automatizaciones disparadas).
  if (req.method === 'POST' && url.searchParams.get('action') === 'to_pipeline') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { conversation_id, stage, name, phone, email } = body || {};
    if (!conversation_id) return jsonResp({ error: 'Falta conversation_id' }, 400);

    const conv = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conversation_id}&user_id=eq.${userId}&select=*`,
      { headers: sbHeaders() }
    ).then(r => r.json()).then(r => r?.[0]).catch(() => null);
    if (!conv) return jsonResp({ error: 'No autorizado' }, 403);
    if (conv.lead_id) return jsonResp({ lead_id: conv.lead_id, ya_estaba: true });

    const agent = conv.agent_id ? await fetch(
      `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${conv.agent_id}&select=client_id`,
      { headers: sbHeaders() }
    ).then(r => r.json()).then(r => r?.[0]).catch(() => null) : null;

    const policy = await getPolicy(userId, conv.channel);
    const leadId = await upsertLeadFromConversation(
      userId, agent?.client_id || null, conv,
      { nombre: name || conv.contact_name, celular: phone || conv.contact_phone, email: email || conv.contact_email },
      // 'always' porque la decisión ya la tomó una persona
      { ...policy, mode: 'always', stage: stage || policy.stage }
    );
    if (!leadId) return jsonResp({ error: 'No se pudo crear el lead' }, 500);
    return jsonResp({ lead_id: leadId }, 201);
  }

  // POST — send manual message (when human took over)
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { conversation_id, content } = body;
    if (!conversation_id || !content) return jsonResp({ error: 'Faltan campos' }, 400);

    // Verify ownership and get connection info
    const convRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conversation_id}&user_id=eq.${userId}&select=*`,
      { headers: sbHeaders() }
    );
    const convRows = await convRes.json();
    const conv = convRows?.[0];
    if (!conv) return jsonResp({ error: 'No autorizado' }, 403);

    // Get channel connection
    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${conv.connection_id}&select=*`,
      { headers: sbHeaders() }
    );
    const connRows = await connRes.json();
    const conn = connRows?.[0];

    // Save message
    const msgRes = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({ conversation_id, role: 'assistant', content }),
    });
    if (!msgRes.ok) return jsonResp({ error: 'Error guardando mensaje' }, 500);

    // Update last_message
    await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conversation_id}`, {
      method: 'PATCH',
      headers: sbHeaders(),
      body: JSON.stringify({ last_message: content.slice(0, 200), last_message_at: new Date().toISOString() }),
    });

    // Enviar por el canal que corresponda
    if (conn) {
      if (conv.channel === 'tiktok') await sendTikTokMessage(conn, conv.contact_id, content);
      else await sendMetaMessage(conn, conv.contact_id, conv.channel, content);
    }

    return jsonResp({ ok: true }, 201);
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}

async function sendMetaMessage(conn, contactId, channel, text) {
  try {
    if (channel === 'whatsapp') {
      await fetch(`https://graph.facebook.com/v19.0/${conn.external_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.access_token}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: contactId, type: 'text', text: { body: text } }),
      });
    } else {
      await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${conn.access_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: contactId }, message: { text } }),
      });
    }
  } catch(e) { console.error('sendMetaMessage', e); }
}

// TikTok Business Messaging: el envío manual desde el inbox usa el mismo
// endpoint que el webhook cuando el agente contesta solo.
async function sendTikTokMessage(conn, contactId, text) {
  try {
    await fetch(process.env.TIKTOK_SEND_URL || 'https://business-api.tiktok.com/open_api/v1.3/business/message/send/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': conn.access_token },
      body: JSON.stringify({ business_id: conn.external_id, to_user_id: contactId, message: { type: 'text', text } }),
    });
  } catch (e) { console.error('sendTikTokMessage', e); }
}
