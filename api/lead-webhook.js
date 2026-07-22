// api/lead-webhook.js
// Webhook de entrada genérico por usuario (independiente de automatizaciones):
// GET devuelve (o crea) la URL única; POST {regenerate:true} rota el token.
// El token vive en platform_connections (platform 'lead_webhook') y lo consume
// api/hook/[token].js como fallback cuando el token no es de una automatización.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function newToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: el webhook es del dueño del workspace
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sbHeaders() });
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) userId = _tw.owner_user_id;
  } catch {}

  const existing = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.lead_webhook&select=access_token&limit=1`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);

  let regenerate = false;
  if (req.method === 'POST') {
    try { regenerate = !!(await req.json()).regenerate; } catch {}
    if (!regenerate) return jsonResp({ error: 'Método no permitido' }, 405);
  }

  let token = existing?.[0]?.access_token;
  if (!token || regenerate) {
    token = newToken();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: userId, platform: 'lead_webhook', access_token: token,
        account_name: 'Webhook de entrada de leads', updated_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) return jsonResp({ error: 'No se pudo crear el webhook: ' + (await r.text()).slice(0, 120) }, 500);
  }
  return jsonResp({ url: 'https://app.acuarius.app/api/hook/' + token, token });
}
