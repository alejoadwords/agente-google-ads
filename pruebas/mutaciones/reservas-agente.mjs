// Mutaciones de pruebas/reservas-agente.mjs — node tools/mutar.mjs pruebas/mutaciones/reservas-agente.mjs
//
// Cada una rompe algo que la prueba DEBE notar. Si alguna sobrevive, la
// prueba está en verde por casualidad.

export const SUITE = 'pruebas/reservas-agente.mjs';
export const ARCHIVOS = {
  agente: 'api/_reservas-agente.js',
  reservas: 'api/_reservas.js',
  motor: 'api/_inbox-engine.js',
  app: 'public/app.js',
};

const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // Solo lo marcado
  { nombre: 'el prompt ofrece servicios sin marcar', archivo: 'agente',
    romper: cambiar("const suyos = servicios.filter(s => s.agente_reserva === true).slice(0, MAX_SERVICIOS);", "const suyos = servicios.slice(0, MAX_SERVICIOS);") },
  { nombre: 'al ejecutar no se mira el interruptor', archivo: 'agente',
    romper: cambiar("if (!servicio || servicio.agente_reserva !== true) {", "if (!servicio) {") },
  { nombre: 'el servicio solo se reconoce por la clave', archivo: 'agente',
    romper: cambiar("  if (exactos.length === 1) return exactos[0];", "  return null;") },
  { nombre: 'un nombre parecido a dos servicios se adivina', archivo: 'agente',
    romper: cambiar("  return parecidos.length === 1 ? parecidos[0] : null;", "  return parecidos[0] || null;") },
  { nombre: 'el ejemplo del prompt no lleva la clave de verdad', archivo: 'agente',
    romper: cambiar('[RESERVA: {"servicio": "${ej.clave}"', '[RESERVA: {"servicio": "clave"') },
  { nombre: 'un servicio no marcado no escala', archivo: 'agente',
    romper: cambiar("return { ok: false, escalar: true, motivo: 'servicio',", "return { ok: false, motivo: 'servicio',") },

  // La hora
  { nombre: 'la hora se toma en UTC', archivo: 'agente',
    romper: cambiar("const inicio = instanteDe(zona, pedido.dia, hora);", "const inicio = new Date(pedido.dia + 'T' + hora + ':00Z');") },
  { nombre: 'se guarda sin volver a mirar el hueco', archivo: 'reservas',
    romper: cambiar("  const libre = puede.find(r => sigueLibre(inicio.toISOString(), reglasDe(neg, r, servicio, ocupado[r.id], new Date())));",
                    "  const libre = puede[0];") },
  { nombre: 'no hay techo de antelación', archivo: 'reservas',
    romper: cambiar("  if (inicio.getTime() > Date.now() + maxDias * 86400000) {", "  if (false) {") },
  { nombre: 'el ensayo escribe de verdad', archivo: 'reservas',
    romper: cambiar("  if (simular) return { simulada: true, recurso: libre };\n", '') },
  { nombre: 'las alternativas repiten la que falló', archivo: 'agente',
    romper: cambiar("      if (iso !== fallida) out.push(iso);", "      out.push(iso);") },
  { nombre: 'pedir a Ana ocupada se le cuela a Luis', archivo: 'agente',
    romper: cambiar("    pedido: pedidoRecurso ? pedidoRecurso.id : null,", "    pedido: null,") },
  { nombre: 'el nombre pedido tiene que ser exacto', archivo: 'agente',
    romper: cambiar("const normal = (t) => String(t || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();",
                    "const normal = (t) => String(t || '');") },

  // Duplicados
  { nombre: 'el bloque repetido crea otra cita', archivo: 'agente',
    romper: cambiar("  if (previa) {\n", "  if (false) {\n") },

  // El prompt
  { nombre: 'el prompt no lleva el bloque de citas', archivo: 'motor',
    romper: cambiar("${bloqueReservas(reservas, canal)}", '') },
  { nombre: 'las horas no se reparten por el día', archivo: 'agente',
    romper: cambiar("  if (horas.length <= n) return horas;", "  return horas.slice(0, n);") },
  { nombre: 'en WhatsApp también se pide el teléfono', archivo: 'agente',
    romper: cambiar("const contacto = canal === 'whatsapp'", "const contacto = false") },

  // Agendar sin el sí
  { nombre: 'se agenda aunque el agente esté preguntando', archivo: 'motor',
    romper: cambiar("const pedidoCita = reservas && !pideConfirmacion(cleanForUser(reply)) ? extraerReserva(reply) : null;",
                    "const pedidoCita = reservas ? extraerReserva(reply) : null;") },
  { nombre: 'cualquier pregunta frena la cita', archivo: 'agente',
    romper: cambiar("  if (!t.endsWith('?')) return false;", "  if (t.endsWith('?')) return true;") },

  // El motor
  { nombre: 'con la hora ocupada sale igual el «te agendo»', archivo: 'motor',
    romper: cambiar("      visible = r.texto;\n", '') },
  { nombre: 'al cambiar el texto se pierden los bloques ocultos', archivo: 'motor',
    romper: cambiar("      guardado = r.texto + '\\n' + bloquesOcultos(reply);", "      guardado = r.texto;") },
  { nombre: 'la confirmación no se manda', archivo: 'motor',
    romper: cambiar("      try { await send(connection, contactId, confirmacionCita); } catch (e) { console.error('send error', e); }", '') },
  { nombre: 'la confirmación no queda en el historial', archivo: 'motor',
    romper: cambiar("      body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: confirmacionCita }),", "      body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: '' }),") },
  { nombre: 'un servicio no marcado no pasa a una persona', archivo: 'motor',
    romper: cambiar("reply.includes('[ESCALAR]') || escalarPorReserva", "reply.includes('[ESCALAR]')") },
  { nombre: 'la cita no se cuelga del contacto', archivo: 'motor',
    romper: cambiar("ejecutarReserva({ info: reservas, pedido: pedidoCita, contacto, leadId: conv.lead_id || null })", "ejecutarReserva({ info: reservas, pedido: pedidoCita, contacto, leadId: null })") },

  // Lo que se ve
  { nombre: 'el canal ve el bloque', archivo: 'motor',
    romper: cambiar("    .replace(/\\[RESERVA:.*?\\]/gs, '')\n    // Si la respuesta", "    // Si la respuesta") },
  { nombre: 'el inbox enseña el bloque', archivo: 'app',
    romper: cambiar("    .replace(/\\[RESERVA:.*?\\]/gs, '')\n    .replace(/\\[ESCALAR\\]/g, '')", "    .replace(/\\[ESCALAR\\]/g, '')") },
];
