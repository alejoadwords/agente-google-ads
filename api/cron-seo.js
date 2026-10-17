// api/cron-seo.js — Proyecto SEO: medir solo.
//
// Cada 30 minutos avanza la cola de todos los proyectos vivos: posiciones una
// vez por semana y GEO del mes (cada pregunta 3 veces en cada IA). Lo que no
// cabe en una vuelta —por tiempo o por cupo de la cuenta— sigue en la
// siguiente. Antes solo se medía cuando alguien abría la pantalla, y el
// enlace del cliente se quedaba con datos viejos. Ver _seo-medir.js.
export const config = { runtime: 'edge' };

import { latir } from './_latido.js';
import { registrarError } from './_registro-errores.js';
import { medirPosiciones, medirGeo } from './_seo-medir.js';
import { tocaMedirPosiciones, periodoCO } from './_seo.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const sb = async (ruta) => { const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH }); if (!r.ok) throw new Error('Supabase ' + r.status); return r.json(); };
const PRESUPUESTO_MS = 20000;

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  const empezo = Date.now();
  await latir('cron-seo', { empezo: new Date().toISOString() });
  const r = { proyectos: 0, posiciones: 0, geo: 0, fallidos: 0 };
  try {
    const proyectos = await sb('/seo_proyectos?archivado_at=is.null&select=*&order=actualizado_at.asc&limit=500');
    r.proyectos = proyectos.length;
    // Primero las posiciones (rápidas y semanales), después el GEO.
    for (const p of proyectos) {
      if (Date.now() - empezo > PRESUPUESTO_MS * 0.5) break;
      try {
        const [u] = await sb(`/seo_posiciones?proyecto_id=eq.${p.id}&select=fecha&order=fecha.desc&limit=1`);
        if (!tocaMedirPosiciones(u?.fecha)) continue;
        const m = await medirPosiciones(p, { presupuestoMs: Math.max(2000, PRESUPUESTO_MS * 0.5 - (Date.now() - empezo)) });
        r.posiciones += m.medidas || 0;
      } catch (e) { r.fallidos++; await registrarError({ origen: 'servidor', donde: 'cron-seo.posiciones', error: e, usuario: p.user_id, detalle: p.id }); }
    }
    const periodo = periodoCO();
    for (const p of proyectos) {
      if (Date.now() - empezo > PRESUPUESTO_MS) break;
      try {
        const g = await medirGeo(p, { periodo, presupuestoMs: Math.max(2000, PRESUPUESTO_MS - (Date.now() - empezo)) });
        r.geo += g.hechas || 0;
      } catch (e) { r.fallidos++; await registrarError({ origen: 'servidor', donde: 'cron-seo.geo', error: e, usuario: p.user_id, detalle: p.id }); }
    }
    await latir('cron-seo', r, r.fallidos ? r.fallidos + ' proyectos SEO fallaron al medir' : null);
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-seo', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'no se pudo medir' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
