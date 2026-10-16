// api/cron-revisor-agente.js — «Mejorar el agente», fase 3.
//
// Cada 10 minutos: avisa de quien escribió y nadie le respondió
// (_sin-respuesta.js) y lee las conversaciones del agente ya terminadas para
// dejar sugerencias de mejora (_revisor-agente.js).
export const config = { runtime: 'edge' };

import { revisarPendientes } from './_revisor-agente.js';
import { detectarSinRespuesta } from './_sin-respuesta.js';
import { latir } from './_latido.js';

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  await latir('cron-revisor-agente', { empezo: new Date().toISOString() });
  try {
    // Primero lo urgente: alguien esperando respuesta. Después, el revisor.
    const sinRespuesta = await detectarSinRespuesta({ presupuestoMs: 6000 }).catch(async (e) => ({ error: e?.message || String(e) }));
    const r = { ...(await revisarPendientes({ presupuestoMs: 15000 })), sinRespuesta };
    const fallo = [r.fallidas ? r.fallidas + ' conversaciones no se pudieron revisar' : null,
      sinRespuesta.error ? 'el detector de «sin respuesta» falló: ' + sinRespuesta.error : null].filter(Boolean).join(' · ') || null;
    await latir('cron-revisor-agente', r, fallo);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-revisor-agente', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'no se pudo revisar' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
