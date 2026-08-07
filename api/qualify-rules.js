// api/qualify-rules.js — criterios de calificación de un agente del inbox.
// GET  ?agent_id=…  → { regla }
// PUT  ?agent_id=…  → { regla }
//
// Edge porque importa api/_qualify.js.

export const config = { runtime: 'edge' };

import { getRegla, saveRegla, DEFAULT_REGLA } from './_qualify.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
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
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data))) return null;
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

  // Un miembro del equipo opera sobre la cuenta del dueño
  try {
    const tw = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`,
      { headers: sbHeaders() }
    ).then(r => r.json());
    if (tw?.[0]?.owner_user_id) userId = tw[0].owner_user_id;
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
  const agentId = url.searchParams.get('agent_id');
  if (!agentId) return jsonResp({ error: 'Falta agent_id' }, 400);

  // El agente tiene que ser suyo, o cualquiera podría leer criterios ajenos
  const propio = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${encodeURIComponent(agentId)}&user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  if (!propio?.length) return jsonResp({ error: 'Agente no encontrado' }, 404);

  if (req.method === 'GET') {
    return jsonResp({ regla: await getRegla(userId, agentId), plantilla: DEFAULT_REGLA });
  }

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const ok = await saveRegla(userId, agentId, body?.regla || {});
    if (!ok) return jsonResp({ error: 'No se pudo guardar' }, 500);
    return jsonResp({ regla: await getRegla(userId, agentId) });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
