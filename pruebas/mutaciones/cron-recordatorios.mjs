// Mutaciones de pruebas/cron-recordatorios.mjs — node tools/mutar.mjs pruebas/mutaciones/cron-recordatorios.mjs
//
// OJO: la suite habla con la base de verdad. Cada mutante siembra y borra su
// propia cuenta de prueba.

export const SUITE = 'pruebas/cron-recordatorios.mjs';
export const ARCHIVOS = { cron: 'api/cron-recordatorios.js' };

const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'la pasada acotada recorre todas las cuentas', archivo: 'cron',
    romper: cambiar("      (soloCuenta ? `&user_id=eq.${encodeURIComponent(soloCuenta)}` : '') +\n", '') },
  { nombre: 'un contacto sin correo vuelve a contar como fallo', archivo: 'cron',
    romper: cambiar("      } else if (correo.motivo === 'sin correo' && whats.estado === 'saltado') {", "      } else if (false) {") },
  { nombre: 'sin canal se marca como enviado', archivo: 'cron',
    romper: cambiar("      if (correo.estado === 'enviado' || whats.estado === 'enviado') {", "      if (correo.estado === 'enviado' || whats.estado === 'enviado' || correo.motivo === 'sin correo') {") },
];
