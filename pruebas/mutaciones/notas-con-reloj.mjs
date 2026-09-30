// Mutaciones de pruebas/notas-con-reloj.mjs — node tools/mutar.mjs pruebas/mutaciones/notas-con-reloj.mjs

export const SUITE = 'pruebas/notas-con-reloj.mjs';
export const ARCHIVOS = { cron: 'api/cron-notas.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'sin reloj', archivo: 'cron', romper: cambiar("    if (Date.now() >= hasta) { resumen.sin_tiempo++; continue; }\n", '') },
  { nombre: 'el reloj después de apartar el día', archivo: 'cron', romper: (s) => s.replace("    if (Date.now() >= hasta) { resumen.sin_tiempo++; continue; }\n", '').replace("    if (await yaSeHizo(SUPABASE_URL, SUPABASE_KEY, 'notas-sin-leer:' + para, periodoDe('dia'))) continue;\n", "    if (await yaSeHizo(SUPABASE_URL, SUPABASE_KEY, 'notas-sin-leer:' + para, periodoDe('dia'))) continue;\n    if (Date.now() >= hasta) { resumen.sin_tiempo++; continue; }\n") },
  { nombre: 'los nombres de todos los leads', archivo: 'cron', romper: cambiar("suyas.slice(0, 8).map(n => n.lead_id)", "suyas.map(n => n.lead_id)") },
];
