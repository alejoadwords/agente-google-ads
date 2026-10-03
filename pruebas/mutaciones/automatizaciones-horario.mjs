// Mutaciones del horario legal en automatizaciones — node tools/mutar.mjs pruebas/mutaciones/automatizaciones-horario.mjs

export const SUITE = 'pruebas/motor-automatizaciones.mjs';
export const ARCHIVOS = { auto: 'api/cron-automations.js' };
const cambiar = (de, a) => (s) => { if (!s.includes(de)) throw new Error('no está: ' + de); return s.replace(de, a); };

export const MUTACIONES = [
  { nombre: 'sin horario legal', archivo: 'auto', romper: cambiar("if (contactaAlLead && !enHorarioPermitido()) {", "if (false) {") },
  { nombre: 'el correo no cuenta como contacto', archivo: 'auto', romper: cambiar("new Set(['send_email', ", "new Set([") },
  { nombre: 'el NPS no cuenta como contacto', archivo: 'auto', romper: cambiar("'send_nps', ", "") },
  { nombre: 'la reseña no cuenta como contacto', archivo: 'auto', romper: cambiar(", 'pedir_resena']);", "]);") },
  { nombre: 'WhatsApp no cuenta como contacto', archivo: 'auto', romper: cambiar("'send_whatsapp', 'send_sms'", "'send_sms'") },
  { nombre: 'los pasos internos también esperan', archivo: 'auto', romper: cambiar("const contactaAlLead = PASOS_DE_CONTACTO.has(step.type);", "const contactaAlLead = true;") },
  { nombre: 'espera sin reprogramar', archivo: 'auto', romper: cambiar("const runAt = siguienteHorario().toISOString();\n          await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { step_index: i, run_at: runAt }", "const runAt = siguienteHorario().toISOString();\n          await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { step_index: i }") },
  { nombre: 'sin dejarlo en la bitácora', archivo: 'auto', romper: cambiar("'Por la Ley 2300 los mensajes solo salen", "'Fuera de horario") },
  { nombre: 'ignora la ventana propia', archivo: 'auto', romper: cambiar("if (contactaAlLead && !inSendWindow(auto.trigger?.window)) {", "if (false) {") },
];
