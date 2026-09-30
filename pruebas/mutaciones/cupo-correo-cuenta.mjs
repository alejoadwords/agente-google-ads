// Mutaciones de pruebas/cupo-correo-cuenta.mjs — node tools/mutar.mjs pruebas/mutaciones/cupo-correo-cuenta.mjs

export const SUITE = 'pruebas/cupo-correo-cuenta.mjs';
export const ARCHIVOS = { motor: 'api/cron-automations.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'el correo no dice su cuenta', archivo: 'motor', romper: cambiar("    return enviarResend('cron-automations', opciones, usuario);", "    return enviarResend('cron-automations', opciones);") },
  { nombre: 'no se mira el cupo', archivo: 'motor', romper: cambiar("        if (vaCorreo && !(await tomarCupoCorreo(auto.user_id))) {", "        if (false) {") },
  { nombre: 'el cupo no se descuenta en memoria', archivo: 'motor', romper: cambiar("  c.hueco--;\n  return true;", "  return true;") },
  { nombre: 'se consulta en cada correo', archivo: 'motor', romper: cambiar("  if (!_cupoCorreo.has(userId)) {", "  if (true) {") },
  { nombre: 'el paso agotado se pierde', archivo: 'motor', romper: cambiar("          await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { step_index: i, run_at: runAt }, 'return=minimal');\n          await log(auto.id, job.user_id, lead.id, i, 'cupo'", "          await log(auto.id, job.user_id, lead.id, i, 'cupo'") },
  { nombre: 'espera una hora, no a mañana', archivo: 'motor', romper: cambiar("  d.setUTCDate(d.getUTCDate() + 1);\n  d.setUTCHours(0, 5, 0, 0);", "  d.setTime(Date.now() + 3600e3);") },
  { nombre: 'un lead sin correo gasta cupo', archivo: 'motor', romper: cambiar("(step.type === 'pedir_resena' && step.canal !== 'whatsapp')) && lead.email && !dadoDeBajaCorreo(lead);", "(step.type === 'pedir_resena' && step.canal !== 'whatsapp'));") },
];
