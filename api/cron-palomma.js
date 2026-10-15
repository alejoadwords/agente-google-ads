// api/cron-palomma.js — convierte en leads los eventos de Palomma pendientes.
//
// Es el ÚNICO que los procesa (el receptor solo guarda): un solo consumidor
// de la cola, sin carreras. Cada 5 minutos, más los reintentos de lo que haya
// fallado. Ver api/_palomma-proceso.js.
export const config = { runtime: 'edge' };

import { procesarPendientes } from './_palomma-proceso.js';
import { latir } from './_latido.js';

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  await latir('cron-palomma', { empezo: new Date().toISOString() });
  try {
    const r = await procesarPendientes({ limite: 200 });
    await latir('cron-palomma', r, r.fallidos ? r.fallidos + ' eventos de Palomma fallaron: se reintentan' : null);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-palomma', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'no se pudieron procesar los eventos de Palomma' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
