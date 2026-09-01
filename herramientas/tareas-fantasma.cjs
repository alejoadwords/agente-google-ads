#!/usr/bin/env node
// Tareas fantasma: filas de lead_activities con type 'tarea' y fecha que NO
// tienen su tarea real en `activities`. Son tareas que el usuario cree haber
// creado y no aparecen en Tareas, ni en la tarjeta, ni en el resumen diario.
//
// Así fue como se descubrió el fallo: contando. Se ejecuta con
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node herramientas/tareas-fantasma.cjs
// y devuelve código 1 si encuentra alguna futura, para poder engancharlo a un
// aviso. Las vencidas se listan aparte: esas ya no se pueden rescatar.
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) { console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY'); process.exit(2); }
const cab = { apikey: KEY, Authorization: 'Bearer ' + KEY };

(async () => {
  const act = await fetch(`${URL_}/rest/v1/lead_activities?type=eq.tarea&select=lead_id,content,metadata&limit=5000`, { headers: cab }).then(r => r.json());
  const tareas = await fetch(`${URL_}/rest/v1/activities?type=eq.task&select=lead_id,title,due_at&limit=5000`, { headers: cab }).then(r => r.json());
  const reales = new Set((tareas || []).map(t => t.lead_id + '|' + new Date(t.due_at).toISOString()));
  const ahora = Date.now();
  const fantasmas = { futuras: [], vencidas: [] };
  for (const a of act || []) {
    const f = a.metadata && a.metadata.due_date;
    if (!f) continue;
    if (a.metadata.activity_id) continue;
    const t = /Z|[+-]\d{2}:?\d{2}$/.test(f) ? new Date(f) : new Date(f + ':00-05:00');
    if (isNaN(t)) continue;
    if (reales.has(a.lead_id + '|' + t.toISOString())) continue;
    (t.getTime() > ahora ? fantasmas.futuras : fantasmas.vencidas).push({ lead: a.lead_id, txt: a.content, cuando: f });
  }
  console.log(`tareas fantasma — futuras: ${fantasmas.futuras.length}  ·  vencidas: ${fantasmas.vencidas.length}`);
  for (const f of fantasmas.futuras) console.log('  FUTURA (invisible para el usuario)', f.cuando, '·', f.txt, '·', f.lead);
  process.exit(fantasmas.futuras.length ? 1 : 0);
})().catch(e => { console.error('error:', e.message); process.exit(2); });
