// La revisión de integridad no se inventa hallazgos: node pruebas/integridad-sin-recorte.mjs
//
// El 30-09-2026 llegó «Tareas que el usuario creó y no aparecen en ninguna
// parte — 24». Eran falsas: había 1.041 tareas y PostgREST devuelve como mucho
// mil aunque se pida limit=5000; las que quedaban fuera parecían fantasmas.
// Un Supabase de mentira que corta en mil, como el de verdad.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s });

let TAREAS = [], HISTORIAL = [], LEADS = [], cae = null;
const futuro = (i) => new Date(Date.now() + (i + 1) * 3600e3).toISOString();
function sembrar(n) {
  TAREAS = []; HISTORIAL = []; LEADS = [];
  for (let i = 0; i < n; i++) {
    const lead = 'l' + i, f = futuro(i);
    LEADS.push({ id: lead, client_id: null });
    TAREAS.push({ id: 't' + String(i).padStart(5, '0'), lead_id: lead, due_at: f, title: 'T' + i, client_id: null, type: 'task', done: false });
    HISTORIAL.push({ id: 'h' + String(i).padStart(5, '0'), lead_id: lead, content: 'Seguimiento ' + i, metadata: { due_date: f }, type: 'tarea' });
  }
}
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  const tabla = u.split('/rest/v1/')[1].split('?')[0];
  if (cae && u.includes(cae)) return resp({ message: 'caída' }, 500);
  const limit = Math.min(Number((u.match(/[?&]limit=(\d+)/) || [])[1] || 1000), 1000);
  const offset = Number((u.match(/[?&]offset=(\d+)/) || [])[1] || 0);
  let filas = tabla === 'activities' ? TAREAS : tabla === 'lead_activities' ? HISTORIAL : tabla === 'leads' ? LEADS : [];
  if (u.includes('lead_id=is.null')) filas = filas.filter(f => !f.lead_id);
  return resp(filas.slice(offset, offset + limit));
};
const m = await import('../api/cron-integridad.js');

sembrar(1041);
ok((await m.sbTodas('activities?type=eq.task&select=id')).length === 1041, 'lee las 1.041 tareas, no mil');
const r = await m.tareasFantasma();
ok(r === null, 'con 1.041 tareas y todas con su gemela: ni un fantasma (antes salían 41)', r && r.detalle.length);

sembrar(1041);
TAREAS.splice(1040, 1);   // una de verdad sin gemela
const r2 = await m.tareasFantasma();
ok(r2 && r2.detalle.length === 1 && /Seguimiento 1040/.test(r2.detalle[0]), 'y una fantasma de verdad se sigue encontrando', r2 && r2.detalle.join(' | ').slice(0, 120));

sembrar(50);
cae = '/rest/v1/activities';
const r3 = await m.tareasFantasma();
ok(r3 && /No se pudo hacer la revisión/.test(r3.titulo) && r3.detalle.length === 1, 'si no se pueden leer las tareas, se dice — no 50 fantasmas', r3 && r3.titulo + ' ' + r3.detalle.length);
const r4 = await m.clienteDesajustado();
ok(r4 && /No se pudo hacer la revisión/.test(r4.titulo), 'lo mismo en la revisión de clientes');
cae = null;

sembrar(1500);
TAREAS[1400].client_id = 'otro';
const r5 = await m.clienteDesajustado();
ok(r5 && r5.detalle.length === 1, 'la tarea de otro cliente pasado el registro mil también aparece', r5 && r5.detalle.length);

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
