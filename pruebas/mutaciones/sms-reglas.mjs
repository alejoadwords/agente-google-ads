// Mutaciones de pruebas/sms-reglas.mjs — node tools/mutar.mjs pruebas/mutaciones/sms-reglas.mjs

export const SUITE = 'pruebas/sms-reglas.mjs';
export const ARCHIVOS = { sms: 'api/_sms.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'fijos como móviles', archivo: 'sms', romper: cambiar("return /^573\\d{9}$/.test(d) ? d : null;", "return d.length >= 10 ? d : null;") },
  { nombre: 'ñ se cambia', archivo: 'sms', romper: cambiar("'á': 'a',", "'ñ': 'n', 'á': 'a',") },
  { nombre: 'segmento GSM de 160 al partir', archivo: 'sms', romper: cambiar('Math.ceil(largo / 153)', 'Math.ceil(largo / 160)') },
  { nombre: 'extendidos cuentan 1', archivo: 'sms', romper: cambiar('else if (GSM_EXTENDIDO.includes(c)) largo += 2;', 'else if (GSM_EXTENDIDO.includes(c)) largo += 1;') },
  { nombre: 'unicode de 70 al partir', archivo: 'sms', romper: cambiar('Math.ceil(u / 67)', 'Math.ceil(u / 70)') },
  { nombre: 'sin Emiliani', archivo: 'sms', romper: cambiar('alLunes(fijo(1, 6))', 'fijo(1, 6)') },
  { nombre: 'sin semana santa', archivo: 'sms', romper: cambiar('p - 3 * DIA, p - 2 * DIA,', '') },
  { nombre: 'domingo permitido', archivo: 'sms', romper: cambiar('const FRANJAS = { 1:', 'const FRANJAS = { 0: [7, 19], 1:') },
  { nombre: 'sábado hasta las 19', archivo: 'sms', romper: cambiar('6: [8, 15] }', '6: [8, 19] }') },
  { nombre: 'festivos ignorados', archivo: 'sms', romper: cambiar("if (festivosColombia(local.getUTCFullYear()).has(iso(local.getTime()))) return false;", '') },
];
