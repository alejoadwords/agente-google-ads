// Mutaciones de pruebas/seguimiento-sin-atasco.mjs — node tools/mutar.mjs pruebas/mutaciones/seguimiento-sin-atasco.mjs

export const SUITE = 'pruebas/seguimiento-sin-atasco.mjs';
export const ARCHIVOS = { cron: 'api/cron-seguimiento.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'vuelve el orden de las más antiguas', archivo: 'cron', romper: cambiar("&order=last_message_at.desc,id.asc", "&order=last_message_at.asc,id.asc") },
  { nombre: 'una sola página de 60', archivo: 'cron', romper: cambiar("      if (resumen.sinTiempo || (convs || []).length < PAGINA) break;", "      break;") },
  { nombre: 'sin reloj', archivo: 'cron', romper: cambiar("      if (Date.now() >= hasta) { resumen.sinTiempo = true; break; }\n      // Uno por cada mensaje", "      // Uno por cada mensaje") },
  { nombre: 'el canal se lee en cada conversación', archivo: 'cron', romper: cambiar("      if (!conexiones.has(conv.connection_id)) {", "      if (true) {") },
  { nombre: 'un fallo de lectura vuelve a ser lista vacía', archivo: 'cron', romper: cambiar("      if (!r0.ok) throw new Error('no se pudieron leer las conversaciones (Supabase ' + r0.status + ')');", "      if (!r0.ok) break;") },
  { nombre: 'se insiste dos veces', archivo: 'cron', romper: cambiar("      if (conv.seguimiento_at && conv.seguimiento_at >= conv.last_inbound_at) continue;", "") },
];
