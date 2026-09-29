// api/uso-agente.js — el consumo de mensajes del agente en lo que va de mes.
//
//   GET /api/uso-agente  →  { plan, cupo, usados, restante, porcentaje, agotado }
//
// Lo pinta la pantalla de Agentes IA. El número es de la CUENTA, no de quien
// pregunta: un vendedor y su dueña ven el mismo consumo, porque el cupo es uno
// solo y se gasta entre todos.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { cuentaDe } from './_uso-ia.js';
import { estadoDeCupo } from './_cupo-agente.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return jsonResp({ error: 'Método no permitido' }, 405);

  const sesion = await verificarSesion(req);
  // El rechazo lleva el nombre del endpoint: así el registro dice qué pantalla
  // se quedó sin sesión, y no solo que alguna lo hizo. Y sale por jsonResp,
  // que es donde viven las cabeceras CORS de esta función.
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'uso-agente'), 401);

  // El gasto se imputa a la cuenta del dueño, así que el consumo se pregunta
  // por él aunque quien mire sea un miembro del equipo.
  const cuenta = await cuentaDe(sesion.id);
  const estado = await estadoDeCupo(cuenta);

  // Si no se pudo contar, se dice. Devolver un cero cómodo dejaría una pantalla
  // que asegura «0 de 500» sin haber mirado nada.
  if (estado.error) return jsonResp({ error: estado.motivo }, 503);

  return jsonResp(estado);
}
