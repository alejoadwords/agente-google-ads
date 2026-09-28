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
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const sesion = await verificarSesion(req);
  const quien = sesion.id;
  if (!quien) return jsonResp(await cuerpoSinSesion(sesion, 'social-connections'), 401);

  const cuenta = await cuentaDe(quien);
  const url = new URL(req.url);
  // Un miembro acotado a un cliente NO puede salirse de él cambiando el
  // parámetro en la barra de direcciones. Sin esto veía las cuentas conectadas
  // de cualquier cliente de la agencia —y se llevaba un ticket firmado para
  // operar en su nombre. Mismo criterio que el inbox y Plataformas de pauta.
  const pedido = url.searchParams.get('client_id') || null;
  let alcance;
  try { alcance = await quienPregunta(quien); }
  catch (e) {
    // Una cuenta suspendida no es un fallo de la base: se le dice, y con su
    // propio código, para que la pantalla pueda enseñar algo que se entienda.
    if (e?.suspendida) return jsonResp({ error: e.message, suspendida: true }, 403);
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }
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
