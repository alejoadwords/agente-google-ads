// Mutaciones de pruebas/catalogo-rotacion.mjs — node tools/mutar.mjs pruebas/mutaciones/catalogo-rotacion.mjs

export const SUITE = 'pruebas/catalogo-rotacion.mjs';
export const ARCHIVOS = { cron: 'api/cron-catalogo.js', cat: 'api/_catalogo.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'orden fijo', archivo: 'cat', romper: cambiar("&select=*&order=ultimo_sync.asc.nullsfirst,id.asc", "&select=*") },
  { nombre: 'sin reloj', archivo: 'cron', romper: cambiar("    if (Date.now() >= hasta) { sinTiempo++; continue; }\n", '') },
  { nombre: 'un fallo vuelve a ser lista vacía', archivo: 'cat', romper: cambiar("  if (!r.ok) throw new Error('no se pudieron leer las fuentes del catálogo (Supabase ' + r.status + ')');", "  if (!r.ok) return [];") },
];
