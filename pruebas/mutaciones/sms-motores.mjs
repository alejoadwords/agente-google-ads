// Mutaciones de pruebas/sms-motores.mjs — node tools/mutar.mjs pruebas/mutaciones/sms-motores.mjs

export const SUITE = 'pruebas/sms-motores.mjs';
export const ARCHIVOS = {
  sms: 'api/_sms.js', cron: 'api/cron-campaigns.js', camp: 'api/campaigns.js', auto: 'api/cron-automations.js',
  hot: 'api/hotmart-webhook.js', ack: 'api/sms-ack.js', ent: 'api/sms-entrante.js',
};
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'sin horario en el motor', archivo: 'cron', romper: cambiar("if (c.channel === 'sms' && !enHorarioPermitido()) continue;", '') },
  { nombre: 'sin horario en enviarSms', archivo: 'sms', romper: cambiar("if (!enHorarioPermitido(ahora)) return", "if (false) return") },
  { nombre: 'baja ignorada', archivo: 'sms', romper: cambiar("if ((lead.tags || []).includes(ETIQUETA_BAJA)) return", "if (false) return") },
  { nombre: 'sin quitar tildes', archivo: 'sms', romper: cambiar("const mensaje = prepararTexto(texto);", "const mensaje = String(texto || '').trim();") },
  { nombre: 'sin beta', archivo: 'sms', romper: cambiar("if (!smsActivo(userId)) return { estado: 'omitido'", "if (false) return { estado: 'omitido'") },
  { nombre: 'sin saldo no pausa', archivo: 'cron', romper: cambiar("if (r.status === 'sin_saldo') { sinSaldo = true; return; }", "if (r.status === 'sin_saldo') return;") },
  { nombre: 'sin saldo se marca fallido', archivo: 'cron', romper: cambiar("if (r.estado === 'sin_saldo') return { status: 'sin_saldo' };", "if (r.estado === 'sin_saldo') return { status: 'failed' };") },
  { nombre: 'motivo de pausa perdido', archivo: 'cron', romper: cambiar('p_extra: motivoPausa ? { motivo_pausa: motivoPausa } : null,', 'p_extra: null,') },
  { nombre: 'audiencia con fijos', archivo: 'camp', romper: cambiar("&& !(channel === 'sms' && !normalizarTelefono(l.phone)));", ');') },
  { nombre: 'audiencia con bajas', archivo: 'camp', romper: cambiar("if (channel === 'sms') q += `&phone=not.is.null&tags=not.cs.{\"${BAJA_SMS}\"}`;", "if (channel === 'sms') q += `&phone=not.is.null`;") },
  { nombre: 'encolar sin saldo', archivo: 'camp', romper: cambiar('if (necesarios > saldo) {', 'if (false) {') },
  { nombre: 'reanudar sin saldo', archivo: 'camp', romper: cambiar('if (saldo < seg) return', 'if (false) return') },
  { nombre: 'auto sin saldo como enviado', archivo: 'auto', romper: cambiar("if (r.estado === 'sin_saldo') return { result: 'failed'", "if (r.estado === 'sin_saldo') return { result: 'sent'") },
  { nombre: 'hotmart acredita a ojo', archivo: 'hot', romper: cambiar("if (rs.fuente === 'indeterminada') {", "if (false) {") },
  { nombre: 'hotmart reembolso suma', archivo: 'hot', romper: cambiar("acreditarSms(clerkUser.id, -rs.cantidad,", "acreditarSms(clerkUser.id, rs.cantidad,") },
  { nombre: 'nombre acepta cualquier cantidad', archivo: 'hot', romper: cambiar('return PAQUETES_SMS.some(p => p.creditos === cantidad) ? cantidad : 0;', 'return cantidad;') },
  { nombre: 'ack no corrige la campaña', archivo: 'ack', romper: cambiar("if (envio.campaign_id && (estado === 'fallido' || deFallo)) {", 'if (false) {') },
  { nombre: 'ack corrige aunque sea repetido', archivo: 'ack', romper: cambiar("if (!envio || envio.estado === estado ||", 'if (!envio ||') },
  { nombre: 'ack no deshace un fallo', archivo: 'ack', romper: cambiar("p_sent: deFallo ? 1 : -1, p_failed: deFallo ? -1 : 1", 'p_sent: -1, p_failed: 1') },
  { nombre: 'ack sin cambio condicional', archivo: 'ack', romper: cambiar("if (!(await r2.json()).length) return new Response('ok');", '') },
  { nombre: 'ack marca a todos los destinatarios', archivo: 'ack', romper: cambiar("campaign_recipients?campaign_id=eq.${envio.campaign_id}&lead_id=eq.${envio.lead_id}&", 'campaign_recipients?campaign_id=eq.${envio.campaign_id}&') },
  { nombre: 'ack sin firma', archivo: 'ack', romper: cambiar("|| q('k') !== await firmaAck(subid)", '') },
  { nombre: 'baja a todas las cuentas', archivo: 'ent', romper: cambiar('/leads?user_id=eq.${encodeURIComponent(ultimo.user_id)}&phone', '/leads?phone') },
  { nombre: 'baja con cualquier texto', archivo: 'ent', romper: cambiar('!PIDE_BAJA.test(texto)', 'false') },
  { nombre: 'sin tope de segmentos', archivo: 'sms', romper: cambiar('if (segmentos > MAX_SEGMENTOS) return', 'if (false) return') },
  { nombre: 'rechazo sin devolver', archivo: 'sms', romper: cambiar("await rpc('sms_devolver', { p_envio: envioId, p_detalle: resultado.detalle });", '') },
  { nombre: 'rechazo como enviado', archivo: 'sms', romper: cambiar("if (r.ok && String(d.code) === '0') return { ok: true };", 'return { ok: true };') },
];
