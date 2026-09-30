// Mutaciones de pruebas/ventana-24h.mjs — node tools/mutar.mjs pruebas/mutaciones/ventana-24h.mjs

export const SUITE = 'pruebas/ventana-24h.mjs';
export const ARCHIVOS = { cron: 'api/cron-ventana.js', seg: 'api/_followup.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'vuelve a pedir status', archivo: 'cron', romper: cambiar("select=id,name,phone,client_id,stage,closed_at", "select=id,name,phone,client_id,status") },
  { nombre: 'el cierre por fecha no cuenta', archivo: 'cron', romper: cambiar("return !!lead?.closed_at || CERRADAS", "return CERRADAS") },
  { nombre: 'un lead que no se pudo leer se marca', archivo: 'cron', romper: cambiar("        if (!rl.ok) throw new Error('no se pudo leer el lead (Supabase ' + rl.status + ')');", "        if (!rl.ok) { await marcar(c.id).catch(() => {}); continue; }") },
  { nombre: 'crear la tarea vuelve a tragarse el error', archivo: 'seg', romper: cambiar("  if (!r.ok) throw new Error('no se pudo crear la tarea (Supabase ' + r.status + ')');", "  if (!r.ok) return null;") },
  { nombre: 'una sola página', archivo: 'cron', romper: cambiar("    if (sinTiempo || convs.length < PAGINA) break;", "    break;") },
  { nombre: 'sin reloj', archivo: 'cron', romper: cambiar("      if (Date.now() >= tope) { sinTiempo = true; break; }\n      revisadas++;", "      revisadas++;") },
];
