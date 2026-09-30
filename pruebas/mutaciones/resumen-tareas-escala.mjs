// Mutaciones de pruebas/resumen-tareas-escala.mjs — node tools/mutar.mjs pruebas/mutaciones/resumen-tareas-escala.mjs

export const SUITE = 'pruebas/resumen-tareas-escala.mjs';
export const ARCHIVOS = { cron: 'api/cron-tasks.js', vercel: 'vercel.json' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'vuelve el tope de mil', archivo: 'cron', romper: cambiar("    if (lote.length < 1000) return filas;\n  }\n  throw", "    return filas;\n  }\n  throw") },
  { nombre: 'leads en una sola URL', archivo: 'cron', romper: cambiar("for (let i = 0; i < ids.length; i += 150) {   // la URL con cientos de ids falla\n    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.slice(i, i + 150).join(',')})", "for (let i = 0; i < ids.length; i += 100000) {   // la URL con cientos de ids falla\n    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.slice(i, i + 100000).join(',')})") },
  { nombre: 'un fallo de leads vuelve a ser lista vacía', archivo: 'cron', romper: cambiar("    if (!r.ok) throw new Error(`no se pudieron leer los leads (Supabase ${r.status})`);", "    if (!r.ok) continue;") },
  { nombre: 'no se miran los ya enviados', archivo: 'cron', romper: cambiar("    if (hechos.has(clave(x.quien))) { resumen.ya_enviados++; continue; }", "") },
  { nombre: 'se marca aunque Resend falle', archivo: 'cron', romper: cambiar("      await anotar('el resumen diario de tareas no salió: Resend ' + r.status, `${lote.length} personas · ${det.slice(0, 400)}`, null);\n      continue;", "      await anotar('el resumen diario de tareas no salió: Resend ' + r.status, `${lote.length} personas · ${det.slice(0, 400)}`, null);") },
  { nombre: 'sin reloj', archivo: 'cron', romper: cambiar("    if (Date.now() >= hasta) { resumen.sin_tiempo++; return; }", "") },
  { nombre: 'lotes de 101', archivo: 'cron', romper: cambiar("  for (let i = 0; i < porEnviar.length; i += 100) {\n    const lote = porEnviar.slice(i, i + 100);", "  for (let i = 0; i < porEnviar.length; i += 101) {\n    const lote = porEnviar.slice(i, i + 101);") },
  { nombre: 'una sola corrida al día', archivo: 'vercel', romper: cambiar('"schedule": "0,10,20 12 * * 1-5"', '"schedule": "0 12 * * 1-5"') },
];
