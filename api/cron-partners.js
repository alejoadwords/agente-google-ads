// api/cron-partners.js — convierte en comisiones los cobros de cuentas referidas
//
// Cada hora: los cobros de licencia (y reembolsos) que anotó el webhook de
// Hotmart en `cobros` y que son de cuentas traídas por un Partner aprobado se
// vuelven filas de partner_comisiones. Idempotente; ver api/_partners.js.
// Un cobro en otra moneda sin tasa de cambio disponible se deja para la
// siguiente vuelta y se avisa en el latido, para que no se pierda en silencio.
export const config = { runtime: 'edge' };

import { acumular } from './_partners.js';
import { latir } from './_latido.js';

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  try {
    const r = await acumular();
    await latir('cron-partners', r, r.sinTasa ? r.sinTasa + ' cobros sin tasa de cambio: se reintentan' : null);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-partners', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'no se pudieron acumular las comisiones' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
