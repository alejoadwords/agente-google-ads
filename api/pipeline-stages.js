export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
    const header = JSON.parse(atob(hB64.replace(/-/g,'+').replace(/_/g,'/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
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
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const DEFAULT_STAGES = [
  { key: 'nuevo',       label: 'Nuevo',        color: '#6B7280', position: 1 },
  { key: 'contactado',  label: 'Contactado',   color: '#3B82F6', position: 2 },
  { key: 'calificado',  label: 'Calificado',   color: '#8B5CF6', position: 3 },
  { key: 'propuesta',   label: 'Propuesta',    color: '#F59E0B', position: 4 },
  { key: 'negociacion', label: 'Negociación',  color: '#EF4444', position: 5 },
  { key: 'ganado',      label: 'Ganado',       color: '#10B981', position: 6 },
  { key: 'perdido',     label: 'Perdido',      color: '#9CA3AF', position: 7 },
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // GET — list stages (global per user, not per client)
  if (req.method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_stages?user_id=eq.${userId}&select=*&order=position.asc`,
      { headers: sbHeaders() }
    );
    let rows = await res.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      // Seed defaults
      const seeds = DEFAULT_STAGES.map(s => ({
        user_id: userId,
        key: s.key,
        label: s.label,
        color: s.color,
        position: s.position,
      }));
      const seedRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_stages`, {
        method: 'POST',
        headers: sbHeaders(),
        body: JSON.stringify(seeds),
      });
      if (seedRes.ok) rows = await seedRes.json();
    }

    return jsonResp({ stages: Array.isArray(rows) ? rows : [] });
  }

  const url = new URL(req.url);

  // PUT — update a single stage (label, color)
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id, label, color } = body;
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const update = {};
    if (label) update.label = label.trim();
    if (color) update.color = color;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_stages?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ stage: rows[0] });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
