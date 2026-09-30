// api/sms.js — saldo y actividad de SMS de la cuenta.
//
//   GET /api/sms  →  { activo, proveedor, saldo, paquetes, movimientos, mes }
//
// El saldo es de la CUENTA (el dueño), como el cupo del agente: un vendedor y
// su dueña ven lo mismo porque los créditos se gastan entre todos.
// Si algo no se pudo leer se responde error: un «0 créditos» sin haber mirado
// haría que alguien compre un paquete que no necesita.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { cuentaDe } from './_uso-ia.js';
import { saldoSms, smsActivo, paquetesConPago, proveedorSms } from './_sms.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const jsonResp = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

async function leer(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return jsonResp({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'sms'), 401);

  const cuenta = await cuentaDe(sesion.id);
  if (!smsActivo(cuenta)) return jsonResp({ activo: false });

  try {
    const inicioMes = new Date();
    inicioMes.setUTCDate(1); inicioMes.setUTCHours(5, 0, 0, 0); // 00:00 en Bogotá
    if (inicioMes > new Date()) inicioMes.setUTCMonth(inicioMes.getUTCMonth() - 1);
    const c = encodeURIComponent(cuenta);
    const [saldo, movimientos, envios] = await Promise.all([
      saldoSms(cuenta),
      leer(`/sms_movimientos?user_id=eq.${c}&motivo=neq.envio&select=cantidad,motivo,referencia,created_at&order=created_at.desc&limit=30`),
      // Resumen del mes: una fila por envío, solo el estado y los créditos.
      // Se agrega aquí; con el tope de mil filas se pagina.
      (async () => {
        const filas = [];
        for (let off = 0; off < 200000; off += 1000) {
          const p = await leer(`/sms_envios?user_id=eq.${c}&created_at=gte.${inicioMes.toISOString()}&select=estado,creditos&order=id.asc&limit=1000&offset=${off}`);
          filas.push(...p);
          if (p.length < 1000) break;
        }
        return filas;
      })(),
    ]);
    const mes = { enviados: 0, entregados: 0, fallidos: 0, simulados: 0, creditos: 0 };
    for (const e of envios) {
      if (e.estado === 'fallido') { mes.fallidos++; continue; }
      if (e.estado === 'reservado') continue;
      mes.creditos += e.creditos;
      if (e.estado === 'simulado') mes.simulados++;
      else { mes.enviados++; if (e.estado === 'entregado') mes.entregados++; }
    }
    return jsonResp({ activo: true, proveedor: proveedorSms(), saldo, paquetes: paquetesConPago(), movimientos, mes, desde: inicioMes.toISOString() });
  } catch (e) {
    console.error('[sms]', e.message);
    return jsonResp({ error: 'No se pudo leer el saldo de SMS. Intenta de nuevo en un momento.' }, 503);
  }
}
