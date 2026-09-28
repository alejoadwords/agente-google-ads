// api/channel-policy.js — regla de entrada al pipeline por canal
// GET  → { policies: { whatsapp: {mode,stage,tag}, ... } }
// PUT  → { policies: {...} }
//
// Debe ser edge porque importa api/_channel-policy.js.

export const config = { runtime: 'edge' };

import { getPolicies, savePolicies, CHANNELS, MODES } from './_channel-policy.js';
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
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'channel-policy'), 401);

  // Equipo: un miembro opera sobre la configuración del dueño
  try {
    const tw = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`,
      { headers: sbHeaders() }
    ).then(r => r.json());
    if (tw?.[0]?.owner_user_id) userId = tw[0].owner_user_id;
  } catch {}


  if (req.method === 'GET') {
    return jsonResp({ policies: await getPolicies(userId), channels: CHANNELS, modes: MODES });
  }

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body?.policies || typeof body.policies !== 'object') return jsonResp({ error: 'Faltan las políticas' }, 400);
    const ok = await savePolicies(userId, body.policies);
    if (!ok) return jsonResp({ error: 'No se pudo guardar' }, 500);
    return jsonResp({ policies: await getPolicies(userId) });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
