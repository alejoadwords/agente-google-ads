export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

  // Modo soporte: opera sobre la cuenta del cliente si viene un vale válido de
  // un administrador. Ver api/_soporte.js.
  try {
    const { resolverSoporte } = await import('./_soporte.js');
    const _r = await resolverSoporte(req, userId, { escribe: req.method !== 'GET' });
    if (_r.bloqueado) return jsonResp({ error: _r.bloqueado }, 403);
    if (_r.invalido) return jsonResp({ error: 'La sesión de soporte caducó o no es válida. Vuelve a entrar a la cuenta.' }, 401);
    if (_r.soporte) userId = _r.userId;
  } catch {}

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;
  const scopeFilter = clientId ? `user_id=eq.${userId}&client_id=eq.${clientId}` : `user_id=eq.${userId}&client_id=is.null`;

  // GET — list agents with their channel_connections
  if (req.method === 'GET' && !url.searchParams.get('id')) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_agents?${scopeFilter}&select=*,channel_connections(*)&order=created_at.asc`,
      { headers: sbHeaders() }
    );
    const rows = await res.json();
    return jsonResp({ agents: rows || [] });
  }

  // GET single agent
  if (req.method === 'GET' && url.searchParams.get('id')) {
    const id = url.searchParams.get('id');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${id}&user_id=eq.${userId}&select=*,channel_connections(*)`,
      { headers: sbHeaders() }
    );
    const rows = await res.json();
    if (!rows?.[0]) return jsonResp({ error: 'No encontrado' }, 404);
    return jsonResp({ agent: rows[0] });
  }

  // POST — create agent
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { name, persona, business_ctx, faqs, capture_fields, tone, escalate_phrase } = body;
    if (!name) return jsonResp({ error: 'El nombre es requerido' }, 400);
    const payload = {
      user_id: userId,
      client_id: clientId,
      name: name.trim(),
      persona: persona?.trim() || '',
      business_ctx: business_ctx?.trim() || '',
      faqs: faqs || [],
      capture_fields: capture_fields || ['nombre', 'celular'],
      tone: tone || 'informal',
      escalate_phrase: escalate_phrase?.trim() || 'Claro, en un momento te comunico con un asesor. ¿Me das un segundo?',
      is_active: true,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_agents`, {
      method: 'POST', headers: sbHeaders(), body: JSON.stringify(payload),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ agent: rows[0] }, 201);
  }

  // PUT — update agent
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id, ...fields } = body;
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const allowed = ['name','persona','business_ctx','faqs','capture_fields','tone','escalate_phrase','is_active'];
    const update = { updated_at: new Date().toISOString() };
    for (const k of allowed) { if (fields[k] !== undefined) update[k] = fields[k]; }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ agent: rows[0] });
  }

  // DELETE
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${id}&user_id=eq.${userId}`, {
      method: 'DELETE', headers: sbHeaders(),
    });
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
