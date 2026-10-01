// api/cron-conversiones.js — manda a Meta y a Google las ventas en cola
//
// La cola la llena la base al ganar un lead (sql/conversiones_pauta.sql). Esto
// corre cada 10 minutos: Meta solo acepta ventas de los últimos 7 días, así
// que no puede esperar al día siguiente, y diez minutos es lo mismo que tardan
// las automatizaciones y las campañas. Ver api/_conversiones.js.
export const config = { runtime: 'edge' };

import { procesarCola } from './_conversiones.js';
import { latir } from './_latido.js';

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  await latir('cron-conversiones', { empezo: new Date().toISOString() });
  try {
    const r = await procesarCola({ tope: 18000 });
    await latir('cron-conversiones', r, r.rechazadas ? r.rechazadas + ' ventas rechazadas por la red' : null);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-conversiones', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'no se pudo leer la cola' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
