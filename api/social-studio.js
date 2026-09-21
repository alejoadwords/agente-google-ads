// api/social-studio.js — la parrilla de contenido, guardada en la cuenta
//
// El Studio guardaba la parrilla en `localStorage`. Eso significaba que el
// trabajo vivía en UN navegador: se perdía al limpiar la caché o al cambiar de
// equipo, el resto del equipo no lo veía, y el servidor no podía hacer nada
// con él —ni programar publicaciones, ni avisar de nada—, porque un cron no
// puede leer el navegador de nadie.
//
//   GET  /api/social-studio?client_id=   la parrilla de ese ámbito
//   PUT  /api/social-studio              la guarda entera
//
// Se guarda el bloque completo y no post por post a propósito: el navegador ya
// trabaja con esa forma —`{version, activeId, parrillas:[{posts:[…]}]}`— y
// partirla en tablas obligaría a reescribir los quince sitios que la
// manipulan. Lo que NO puede entrar aquí son las imágenes: el navegador las
// sube al almacenamiento antes de guardar y aquí solo llega su URL.

export const config = { runtime: 'edge' };

import { quienPregunta, alcanceDeCliente, clienteAjeno } from './_perfiles.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Una parrilla con imágenes pegadas dentro pesaría megas. Se corta aquí y se
// dice por qué: mejor un error claro que una fila que no se puede guardar.
const TOPE = 1_500_000;

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Verificación del JWT de Clerk (mismo patrón que api/leads.js)
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  try {
    const [hB64, pB64, sB64] = auth.replace('Bearer ', '').split('.');
    if (!sB64) return null;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const p = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p.sub || null;
  } catch { return null; }
}

// Un miembro del equipo trabaja sobre la parrilla de SU cuenta, no sobre una
// suya propia: si cada uno tuviera la suya, planificar en equipo sería
// imposible. Misma resolución que el resto de los endpoints del CRM.
async function cuentaDe(userId) {
  try {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}` +
      `&status=eq.active&select=owner_user_id&limit=1`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : []));
    return filas?.[0]?.owner_user_id || userId;
  } catch { return userId; }
}

const VACIA = { version: 2, activeId: null, parrillas: [] };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const cuenta = await cuentaDe(userId);
  const url = new URL(req.url);
  // `client_id` va como texto y '' es el ámbito «de la cuenta», no NULL: el
  // índice único no distingue dos NULL y dejaría crear filas duplicadas.
  //
  // Y el que pide el navegador NO se usa tal cual: un miembro acotado a un
  // cliente leía y escribía la parrilla de cualquier otro con solo cambiar el
  // parámetro. Mismo criterio que el inbox y Plataformas de pauta.
  const pedido = (req.method === 'GET' ? url.searchParams.get('client_id') : null) || null;
  let alcance;
  try { alcance = await quienPregunta(userId); }
  catch { return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }
  if (clienteAjeno(alcance, pedido)) return jsonResp({ error: 'No tienes acceso a ese cliente.' }, 403);
  const cliente = alcanceDeCliente(alcance, pedido) ?? '';

  try {
    if (req.method === 'GET') {
      const filas = await fetch(
        `${SUPABASE_URL}/rest/v1/social_parrillas?user_id=eq.${encodeURIComponent(cuenta)}` +
        `&client_id=eq.${encodeURIComponent(cliente)}&select=data,updated_at&limit=1`,
        { headers: sbHeaders() }
      ).then(r => (r.ok ? r.json() : []));
      const fila = filas?.[0];
      return jsonResp({ data: fila?.data || VACIA, actualizada: fila?.updated_at || null, hay: !!fila });
    }

    if (req.method === 'PUT') {
      const body = await req.json().catch(() => ({}));
      const data = body.data;
      // El cliente de la escritura viene en el CUERPO, así que también hay que
      // acotarlo: dejarlo pasar permitía sobrescribir la parrilla de cualquier
      // otro cliente de la agencia con solo cambiar un campo del JSON.
      const pedidoCli = String(body.client_id ?? '') || null;
      if (clienteAjeno(alcance, pedidoCli)) {
        return jsonResp({ error: 'No tienes acceso a ese cliente.' }, 403);
      }
      const cli = alcanceDeCliente(alcance, pedidoCli) ?? '';
      if (!data || typeof data !== 'object' || !Array.isArray(data.parrillas)) {
        return jsonResp({ error: 'La parrilla no tiene la forma esperada.' }, 400);
      }
      const texto = JSON.stringify(data);
      if (texto.length > TOPE) {
        return jsonResp({
          error: 'La parrilla pesa demasiado para guardarse. Suele ser una imagen que no se subió: ' +
                 'vuelve a abrir el post y a cargarla.',
          pesa: texto.length,
        }, 413);
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/social_parrillas?on_conflict=user_id,client_id`, {
        method: 'POST',
        headers: sbHeaders('resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify({
          user_id: cuenta, client_id: cli, data, updated_at: new Date().toISOString(),
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error('[studio] no se pudo guardar:', t.slice(0, 200));
        return jsonResp({ error: 'No se pudo guardar la parrilla.' }, 500);
      }
      return jsonResp({ ok: true });
    }

    return jsonResp({ error: 'Método no permitido' }, 405);
  } catch (e) {
    console.error('[studio]', e);
    return jsonResp({ error: 'No pudimos acceder a tu parrilla ahora mismo.' }, 500);
  }
}
