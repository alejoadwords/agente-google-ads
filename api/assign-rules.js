// api/assign-rules.js — reglas de reparto de leads entre comerciales
// GET → { reglas, equipo, fuentes }
// PUT → { reglas: { whatsapp: {modo:'turnos'}, default: {modo:'fijo', fijo:'user_x'} } }
//
// Edge porque importa api/_assign.js.

export const config = { runtime: 'edge' };

import { getReglas, saveReglas, comercialesActivos, MODOS } from './_assign.js';
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Las fuentes que el reparto sabe distinguir hoy
// OJO: estos valores tienen que ser EXACTAMENTE los que se guardan en
// leads.source, o la regla que configure el usuario nunca se aplicará. Los
// formularios guardan 'formulario' (no 'landing_page') y los webhooks —el
// genérico y el de una automatización— guardan 'webhook' salvo que quien lo
// llame mande otro. Antes aquí ponía 'externa' y la regla nunca se aplicaba;
// las cuentas que la guardaron así se traducen en claveFuente (api/_assign.js).
export const FUENTES = ['default', 'whatsapp', 'messenger', 'instagram', 'tiktok', 'formulario', 'webhook', 'meta_lead_ads', 'hotmart', 'importacion', 'manual'];

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
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'assign-rules'), 401);

  // Las reglas son del dueño del workspace, no del miembro
  let esMiembro = false;
  try {
    const tw = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`,
      { headers: sbHeaders() }
    ).then(r => r.json());
    if (tw?.[0]?.owner_user_id) { userId = tw[0].owner_user_id; esMiembro = true; }
  } catch {}


  if (req.method === 'GET') {
    const [reglas, equipo] = await Promise.all([getReglas(userId), comercialesActivos(userId)]);
    return jsonResp({ reglas, equipo, fuentes: FUENTES, modos: MODOS });
  }

  if (req.method === 'PUT') {
    // Un comercial no puede cambiar cómo se reparten los leads
    if (esMiembro) return jsonResp({ error: 'Solo el dueño de la cuenta puede cambiar el reparto' }, 403);
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body?.reglas || typeof body.reglas !== 'object') return jsonResp({ error: 'Faltan las reglas' }, 400);
    const ok = await saveReglas(userId, body.reglas);
    if (!ok) return jsonResp({ error: 'No se pudo guardar' }, 500);
    return jsonResp({ reglas: await getReglas(userId) });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
