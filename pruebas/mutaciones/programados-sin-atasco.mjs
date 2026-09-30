// Mutaciones de pruebas/programados-sin-atasco.mjs — node tools/mutar.mjs pruebas/mutaciones/programados-sin-atasco.mjs

export const SUITE = 'pruebas/programados-sin-atasco.mjs';
export const ARCHIVOS = { cron: 'api/cron-programados.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'no se apunta cuándo se reservó', archivo: 'cron', romper: cambiar("JSON.stringify({ estado: 'enviando', reservado_at: new Date().toISOString() })", "JSON.stringify({ estado: 'enviando' })") },
  { nombre: 'no se recuperan los atascados', archivo: 'cron', romper: cambiar("      { method: 'PATCH', headers: sb(), body: JSON.stringify({ estado: 'fallido', error: MOTIVO_ATASCADO }) }", "      { method: 'GET', headers: sb() }") },
  { nombre: 'se recupera también el que está en curso', archivo: 'cron', romper: cambiar("reservado_at.lt.${encodeURIComponent(limite)}", "reservado_at.lt.${encodeURIComponent(new Date(t0 + 60000).toISOString())}") },
  { nombre: 'sin reloj', archivo: 'cron', romper: cambiar("    if (Date.now() >= hasta) { sinTiempo++; continue; }", "") },
];
