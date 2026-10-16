// api/cron-revisor-agente.js — «Mejorar el agente», fase 3.
//
// Cada 10 minutos lee las conversaciones del agente ya terminadas y deja
// sugerencias de mejora para que el dueño las apruebe. Ver _revisor-agente.js.
export const config = { runtime: 'edge' };

import { revisarPendientes } from './_revisor-agente.js';
import { latir } from './_latido.js';

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  await latir('cron-revisor-agente', { empezo: new Date().toISOString() });
  try {
    const r = await revisarPendientes({ presupuestoMs: 20000 });
    await latir('cron-revisor-agente', r, r.fallidas ? r.fallidas + ' conversaciones no se pudieron revisar' : null);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-revisor-agente', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'no se pudo revisar' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
