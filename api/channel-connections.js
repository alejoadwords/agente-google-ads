export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
function sb() {
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
  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const url = new URL(req.url);

  // GET — list pages from Meta user token (to show which pages to connect)
  if (req.method === 'GET' && url.searchParams.get('action') === 'list_pages') {
    const metaToken = url.searchParams.get('token');
    if (!metaToken) return jsonResp({ error: 'Falta token' }, 400);
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,picture,instagram_business_account{id,name,profile_picture_url}&access_token=${metaToken}`
    );
    const data = await res.json();
    return jsonResp({ pages: data.data || [] });
  }

  // GET ?all=1 — todas las conexiones del usuario (hub Fuentes de leads)
  if (req.method === 'GET' && url.searchParams.get('all')) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${userId}&select=id,channel,channel_name,is_active&order=created_at.desc&limit=50`,
      { headers: sb() }
    );
    return jsonResp({ connections: (await res.json()) || [] });
  }

  // GET — list connections for an agent
  if (req.method === 'GET') {
    const agentId = url.searchParams.get('agent_id');
    if (!agentId) return jsonResp({ error: 'Falta agent_id' }, 400);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?agent_id=eq.${agentId}&user_id=eq.${userId}&select=id,channel,external_id,channel_name,avatar_url,is_active,created_at`,
      { headers: sb() }
    );
    const rows = await res.json();
    return jsonResp({ connections: rows || [] });
  }

  // POST — create/connect a channel
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { agent_id, channel, external_id, access_token, channel_name, avatar_url } = body;
    if (!agent_id || !channel || !external_id) return jsonResp({ error: 'Faltan campos' }, 400);

    // Verify agent belongs to user
    const agentCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${agent_id}&user_id=eq.${userId}&select=id`,
      { headers: sb() }
    );
    const agentRows = await agentCheck.json();
    if (!agentRows?.[0]) return jsonResp({ error: 'Agente no encontrado' }, 404);

    // For Messenger/Instagram: subscribe page to webhook
    if ((channel === 'messenger' || channel === 'instagram') && access_token) {
      try {
        await fetch(`https://graph.facebook.com/v19.0/${external_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${access_token}`, {
          method: 'POST',
        });
      } catch(e) { console.error('webhook subscribe error', e); }
    }

    const payload = {
      agent_id, user_id: userId, channel,
      external_id: String(external_id),
      access_token: access_token || null,
      channel_name: channel_name || null,
      avatar_url: avatar_url || null,
      is_active: true,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections`, {
      method: 'POST',
      headers: { ...sb(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ connection: rows[0] }, 201);
  }

  // DELETE — disconnect a channel
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: sb() }
    );
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
