// api/lead-lists.js
// Listas/segmentos de leads para campañas: dinámicas (guardan filtros de
// etiquetas/etapa/fuente y se resuelven al momento del envío) o estáticas
// (guardan lead_ids elegidos a mano). Las consumen el paso Destinatarios del
// wizard de campañas y api/campaigns.js (resolveAudience con list_id).
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: los miembros operan sobre las listas del dueño del workspace
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sbHeaders() });
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) userId = _tw.owner_user_id;
  } catch {}

  // Modo soporte: si viene un vale válido de un administrador, se opera sobre
  // la cuenta del cliente. El vale va firmado y caduca, así que el navegador no
  // puede fabricarlo. Ver api/_soporte.js.
  let _sop = null;
  try {
    const { resolverSoporte } = await import('./_soporte.js');
    const r = await resolverSoporte(req, userId, { escribe: req.method !== 'GET' });
    if (r.bloqueado) return jsonResp({ error: r.bloqueado }, 403);
    if (r.soporte) { userId = r.userId; _sop = r.soporte; }
  } catch {}

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;
  const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';

  if (req.method === 'GET') {
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/lead_lists?user_id=eq.${encodeURIComponent(userId)}${scope}&select=*&order=created_at.desc&limit=100`, { headers: sbHeaders() }).then(r => r.json());
    return jsonResp({ lists: rows || [] });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const name = String(body.name || '').trim().slice(0, 80);
    if (name.length < 2) return jsonResp({ error: 'La lista necesita un nombre' }, 400);
    const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.filter(x => /^[0-9a-f-]{36}$/.test(String(x))).slice(0, 2000) : [];
    const kind = leadIds.length ? 'static' : 'dynamic';
    const filters = kind === 'dynamic' ? {
      tags: Array.isArray(body.filters?.tags) ? body.filters.tags.slice(0, 20) : [],
      stage: body.filters?.stage || null,
      source: body.filters?.source || null,
    } : {};
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_lists`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({ user_id: userId, client_id: clientId, name, kind, filters, lead_ids: leadIds }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ list: rows[0] }, 201);
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_lists?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: sbHeaders() });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
