// api/qualify-rules.js — criterios de calificación de un agente del inbox.
// GET  ?agent_id=…  → { regla }
// PUT  ?agent_id=…  → { regla }
//
// Edge porque importa api/_qualify.js.

export const config = { runtime: 'edge' };

import { getRegla, saveRegla, DEFAULT_REGLA } from './_qualify.js';
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

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

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const sesion = await verificarSesion(req);
  let userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'qualify-rules'), 401);

  // Un miembro del equipo opera sobre la cuenta del dueño
  try {
    const tw = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`,
      { headers: sbHeaders() }
    ).then(r => r.json());
    if (tw?.[0]?.owner_user_id) userId = tw[0].owner_user_id;
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
