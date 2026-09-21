// api/social-connections.js — las cuentas conectadas para publicar
//
//   GET    ?client_id=            qué cuentas hay (SIN los tokens)
//   GET    ?ticket=1&client_id=   ticket firmado para arrancar el OAuth
//   DELETE ?network=&client_id=   desconectar
//
// El token de la página no se devuelve NUNCA por aquí. Antes vivía en el
// navegador y por eso había que mandarlo de vuelta en cada publicación; ver
// `api/_social-cuentas.js`.

import { firmarTicket, cuentaDe, listarCuentas, borrarCuentas } from './_social-cuentas.js';
import { quienPregunta, alcanceDeCliente, clienteAjeno } from './_perfiles.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const quien = await getUserId(req);
  if (!quien) return jsonResp({ error: 'No autorizado' }, 401);

  const cuenta = await cuentaDe(quien);
  const url = new URL(req.url);
  // Un miembro acotado a un cliente NO puede salirse de él cambiando el
  // parámetro en la barra de direcciones. Sin esto veía las cuentas conectadas
  // de cualquier cliente de la agencia —y se llevaba un ticket firmado para
  // operar en su nombre. Mismo criterio que el inbox y Plataformas de pauta.
  const pedido = url.searchParams.get('client_id') || null;
  let alcance;
  try { alcance = await quienPregunta(quien); }
  catch { return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }
  if (clienteAjeno(alcance, pedido)) return jsonResp({ error: 'No tienes acceso a ese cliente.' }, 403);
  const cliente = alcanceDeCliente(alcance, pedido) || '';

  try {
    if (req.method === 'GET') {
      if (url.searchParams.get('ticket')) {
        return jsonResp({ ticket: await firmarTicket(cuenta, cliente) });
      }
      return jsonResp({ conexiones: await listarCuentas(cuenta, cliente) });
    }

    if (req.method === 'DELETE') {
      const network = url.searchParams.get('network');
      if (!network) return jsonResp({ error: 'Falta la red' }, 400);
      const ok = await borrarCuentas(cuenta, cliente, network);
      if (!ok) return jsonResp({ error: 'No se pudo desconectar la cuenta.' }, 500);
      return jsonResp({ ok: true });
    }

    return jsonResp({ error: 'Método no permitido' }, 405);
  } catch (e) {
    console.error('[social-connections]', e);
    return jsonResp({ error: 'No pudimos acceder a tus cuentas conectadas ahora mismo.' }, 500);
  }
}
