// api/push.js
// Suscripciones de avisos push del navegador.
//   GET  ?clave=1   → la clave pública VAPID (la necesita el navegador para suscribirse)
//   POST            → guardar la suscripción de este dispositivo
//   DELETE          → quitarla (el usuario apaga los avisos)
//   POST ?prueba=1  → mandarse un aviso a uno mismo, para comprobar que llega
export const config = { runtime: 'edge' };

import { enviarPushA } from './_push.js';
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
  const url = new URL(req.url);

  // La clave pública no es secreta — va incrustada en el navegador de cada
  // usuario— así que se sirve sin sesión.
  if (req.method === 'GET' && url.searchParams.get('clave')) {
    return jsonResp({ clave: process.env.VAPID_PUBLIC || null });
  }

  const sesion = await verificarSesion(req);
  const userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'push'), 401);

  // Las suscripciones son POR PERSONA, no por cuenta: un comercial quiere los
  // avisos de sus leads en SU teléfono. Aquí no se resuelve el dueño del equipo.
  if (req.method === 'POST' && url.searchParams.get('prueba')) {
    const r = await enviarPushA(userId, {
      titulo: 'Acuarius',
      texto: 'Los avisos están funcionando. Así se verán.',
      url: '/',
      etiqueta: 'prueba',
    });
    return jsonResp(r);
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const endpoint = String(body?.endpoint || '');
    const p256dh = String(body?.keys?.p256dh || '');
    const auth = String(body?.keys?.auth || '');
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
      return jsonResp({ error: 'Suscripción incompleta' }, 400);
    }
    // on_conflict por endpoint: el navegador puede renovar su suscripción y
    // reenviarla; sin esto, el segundo guardado da 409 y el usuario se queda
    // sin avisos creyendo que los tiene.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subs?on_conflict=endpoint`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: userId, endpoint, p256dh, auth,
        navegador: (req.headers.get('user-agent') || '').slice(0, 200),
      }),
    });
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    return jsonResp({ ok: true });
  }

  if (req.method === 'DELETE') {
    const endpoint = url.searchParams.get('endpoint');
    const filtro = endpoint
      ? `endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${encodeURIComponent(userId)}`
      : `user_id=eq.${encodeURIComponent(userId)}`;
    await fetch(`${SUPABASE_URL}/rest/v1/push_subs?${filtro}`, { method: 'DELETE', headers: sbHeaders() });
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
