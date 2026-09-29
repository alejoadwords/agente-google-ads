// Mutaciones de pruebas/plan-por-peticion.mjs — node tools/mutar.mjs pruebas/mutaciones/plan-por-peticion.mjs

export const SUITE = 'pruebas/plan-por-peticion.mjs';
export const ARCHIVOS = {
  camp: 'api/campaigns.js', auto: 'api/automations.js', team: 'api/team.js', prop: 'api/proposals.js',
  motor: 'api/cron-automations.js',
};
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // El plan vuelve a vivir en el módulo
  { nombre: 'campañas recuerda el plan entre usuarios', archivo: 'camp', romper: cambiar(
    "  const metaPlan = await clerkMeta(userId);\n  const planCuenta = metaPlan.plan || 'free';\n  const emailsExtra = parseInt(metaPlan.emails_extra) || 0;",
    "  globalThis.__m = globalThis.__m || await clerkMeta(userId);\n  const metaPlan = globalThis.__m;\n  const planCuenta = metaPlan.plan || 'free';\n  const emailsExtra = parseInt(metaPlan.emails_extra) || 0;") },
  { nombre: 'automatizaciones deja pasar por un plan recordado', archivo: 'auto', romper: cambiar(
    "  const meta = await clerkMeta(userId);\n  if (PAID_PLANS.includes(meta.plan)) return true;",
    "  if (globalThis.__pagado) return true;\n  const meta = await clerkMeta(userId);\n  if (PAID_PLANS.includes(meta.plan)) { globalThis.__pagado = true; return true; }") },
  { nombre: 'propuestas deja pasar por un plan recordado', archivo: 'prop', romper: cambiar(
    "  const meta = await clerkMeta(userId);\n  if (PAID_PLANS.includes(meta.plan)) return true;",
    "  if (globalThis.__pagadoP) return true;\n  const meta = await clerkMeta(userId);\n  if (PAID_PLANS.includes(meta.plan)) { globalThis.__pagadoP = true; return true; }") },
  { nombre: 'equipo recuerda los asientos entre usuarios', archivo: 'team', romper: cambiar(
    "  const metaDueno = await clerkMeta(cuenta);",
    "  const metaDueno = globalThis.__md = globalThis.__md || await clerkMeta(cuenta);") },
  // La baja
  { nombre: '«Enviar correo» ignora la baja', archivo: 'motor', romper: cambiar(
    "  if (!lead.email) return { result: 'skipped', detail: 'El lead no tiene email' };\n  if (dadoDeBajaCorreo(lead)) return { result: 'skipped', detail: 'Se dio de baja del correo' };\n  if (!RESEND_API_KEY) return { result: 'failed', detail: 'RESEND_API_KEY no configurada' };\n  const subject",
    "  if (!lead.email) return { result: 'skipped', detail: 'El lead no tiene email' };\n  if (!RESEND_API_KEY) return { result: 'failed', detail: 'RESEND_API_KEY no configurada' };\n  const subject") },
  { nombre: 'la encuesta NPS ignora la baja', archivo: 'motor', romper: cambiar(
    "async function actionSendNps(step, lead, auto) {\n  if (!lead.email) return { result: 'skipped', detail: 'El lead no tiene email' };\n  if (dadoDeBajaCorreo(lead)) return { result: 'skipped', detail: 'Se dio de baja del correo' };",
    "async function actionSendNps(step, lead, auto) {\n  if (!lead.email) return { result: 'skipped', detail: 'El lead no tiene email' };") },
  { nombre: 'la reseña por correo ignora la baja', archivo: 'motor', romper: cambiar(
    "    if (dadoDeBajaCorreo(lead)) return { result: 'skipped', detail: 'Se dio de baja del correo' };\n    if (!RESEND_API_KEY)",
    "    if (!RESEND_API_KEY)") },
  { nombre: 'la etiqueta de baja mal escrita', archivo: 'motor', romper: cambiar("return (lead?.tags || []).includes('no-email');", "return (lead?.tags || []).includes('no_email');") },
  { nombre: 'sin enlace de baja en el correo', archivo: 'motor', romper: cambiar("'<a href=\"' + baja + '\" style=\"color:#9ca3af\">Darte de baja</a></p>' +", "'</p>' +") },
  { nombre: 'sin cabecera List-Unsubscribe', archivo: 'motor', romper: cambiar("      headers: { 'List-Unsubscribe': '<' + baja + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },\n", '') },
  { nombre: 'el enlace se firma distinto que la baja', archivo: 'motor', romper: cambiar(".update('unsub:' + leadId)", ".update('baja:' + leadId)") },
];
