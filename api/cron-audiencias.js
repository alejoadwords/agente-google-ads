// api/cron-audiencias.js — mantiene al día las audiencias del CRM en Google y Meta
//
// Una vez al día (6:00 de Colombia): a cada audiencia activa le sube los leads
// que entraron al grupo desde ayer y le quita los que salieron (un lead que
// pasó de «en proceso» a «ganado» sale de una y entra en la otra). Ver
// api/_audiencias.js. En streaming, para pasar de los 25 s del edge.
export const config = { runtime: 'edge' };

import { sincronizar } from './_audiencias.js';
import { latir } from './_latido.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TOPE_MS = 220000;

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  await latir('cron-audiencias', { empezo: new Date().toISOString() });
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(ctrl) {
      const latido = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch {} }, 4000);
      const res = { revisadas: 0, ok: 0, fallidas: 0, sin_tiempo: 0 };
      let fin;
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/audiencias_crm?activa=eq.true&select=*&order=ultimo_sync.asc.nullsfirst&limit=500`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
        if (!r.ok) throw new Error('Supabase ' + r.status + ' al listar las audiencias');
        const lista = await r.json();
        const finEn = Date.now() + TOPE_MS;
        for (const aud of lista) {
          if (Date.now() > finEn) { res.sin_tiempo++; continue; }
          res.revisadas++;
          const s = await sincronizar(aud);
          if (s.ok) res.ok++; else res.fallidas++;
        }
        await latir('cron-audiencias', res, res.fallidas ? res.fallidas + ' audiencias no se pudieron sincronizar' : null);
        fin = { ok: true, ...res };
      } catch (e) {
        await latir('cron-audiencias', { error: true }, e?.message || String(e));
        fin = { error: e?.message || 'falló' };
      }
      clearInterval(latido);
      ctrl.enqueue(enc.encode(JSON.stringify(fin)));
      ctrl.close();
    },
  }), { headers: { 'Content-Type': 'application/json' } });
}
