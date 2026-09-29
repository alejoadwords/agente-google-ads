// Mutaciones de pruebas/reservas-cambios.mjs — node tools/mutar.mjs pruebas/mutaciones/reservas-cambios.mjs
//
// Cada una rompe algo que la prueba DEBE notar. Si alguna sobrevive, la
// prueba está en verde por casualidad.

export const SUITE = 'pruebas/reservas-cambios.mjs';
export const ARCHIVOS = {
  agente: 'api/_reservas-agente.js',
  reservas: 'api/_reservas.js',
  motor: 'api/_inbox-engine.js',
  app: 'public/app.js',
};

const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // Solo SUS citas
  { nombre: 'se leen las citas de cualquier contacto', archivo: 'agente',
    romper: cambiar("&lead_id=eq.${encodeURIComponent(leadId)}` +\n    `&resource_id=not.is.null", "` +\n    `&resource_id=not.is.null") },
  { nombre: 'se enseñan las pasadas', archivo: 'agente',
    romper: cambiar("&cancelled_at=is.null&due_at=gte.${encodeURIComponent(ahora.toISOString())}`", "&cancelled_at=is.null`") },
  { nombre: 'un servicio sin marcar se puede mover', archivo: 'agente',
    romper: cambiar("movible: !!(servicio && servicio.agente_reserva === true),", "movible: !!servicio,") },
  { nombre: 'mover no mira si es movible', archivo: 'agente',
    romper: (s) => s.replace("if (!cita.movible || !serv) {", "if (!serv) {")
      .replace("const serv = info && info.catalogo.servicios.find(s => s.id === cita.service_id);",
               "const serv = info && (info.catalogo.todos || info.catalogo.servicios).find(s => s.id === cita.service_id);") },

  // Cancelar
  { nombre: 'cancelar no marca la fila', archivo: 'reservas',
    romper: cambiar("body: JSON.stringify({ cancelled_at: new Date().toISOString(), booking_status: 'cancelada' }),", "body: JSON.stringify({ booking_status: 'cancelada' }),") },
  { nombre: 'cancelar no borra el evento de Google', archivo: 'reservas',
    romper: cambiar("      await gcalEnSuCalendario(cita.user_id, cita.resource_id, 'DELETE', '/' + cita.gcal_event_id, null, true);\n    } catch (e) {\n      await registrarError({ origen: 'reservas', donde: 'cancelar en google'",
                    "    } catch (e) {\n      await registrarError({ origen: 'reservas', donde: 'cancelar en google'") },
  { nombre: 'el ensayo cancela de verdad', archivo: 'agente',
    romper: cambiar("    if (simular) return { ok: true, simulada: true, texto: '(Ensayo: no se canceló nada)", "    if (false) return { ok: true, simulada: true, texto: '(Ensayo: no se canceló nada)") },

  // Cambiar
  { nombre: 'la cita se tapa a sí misma al moverla', archivo: 'reservas',
    romper: cambiar("    if (ignorar && f.id === ignorar) continue;\n", '') },
  { nombre: 'mover no vuelve a mirar el hueco', archivo: 'reservas',
    romper: cambiar("  const hueco = await comprobarHueco(neg, { servicio, recursos, inicio, pedido, ignorar: cita.id });\n  if (hueco.error) return hueco;\n  const libre = hueco.libre;\n  const fin",
                    "  const libre = elegibles(servicio, recursos, pedido || null)[0];\n  const fin") },
  { nombre: 'los recordatorios viejos se quedan', archivo: 'reservas',
    romper: cambiar("      recordatorios_enviados: [],\n", '') },
  { nombre: 'mover no borra el evento viejo de Google', archivo: 'reservas',
    romper: cambiar("      await gcalEnSuCalendario(cita.user_id, cita.resource_id, 'DELETE', '/' + cita.gcal_event_id, null, true).catch(() => {});\n", '') },
  { nombre: 'la hora nueva se toma en UTC', archivo: 'agente',
    romper: cambiar("const inicio = instanteDe(zona, pedido.dia, pedido.hora.padStart(5, '0'));", "const inicio = new Date(pedido.dia + 'T' + pedido.hora.padStart(5, '0') + ':00Z');") },
  { nombre: 'pedir otra persona se ignora', archivo: 'agente',
    romper: cambiar("        servicio: serv, recursos: info.catalogo.recursos, inicio, pedido: pedidoRecurso ? pedidoRecurso.id : null });", "        servicio: serv, recursos: info.catalogo.recursos, inicio, pedido: null });") },
  { nombre: 'el ensayo mueve de verdad', archivo: 'agente',
    romper: cambiar("  const r = simular\n", "  const r = false\n") },
  { nombre: 'al fallar no se dice que la cita sigue', archivo: 'agente',
    romper: cambiar("const texto = 'Tu cita del ' + cuando + ' sigue en pie. ' +", "const texto =") },

  // El motor
  { nombre: 'el prompt no lleva sus citas', archivo: 'motor',
    romper: cambiar("${bloqueCitas(suyas)}", '') },
  { nombre: 'se cancela aunque el agente esté preguntando', archivo: 'motor',
    romper: cambiar("const pedidoCambio = suyas && conSi ? extraerCambio(reply) : null;", "const pedidoCambio = suyas ? extraerCambio(reply) : null;") },
  { nombre: 'la regla del sí no conoce «cancelo»', archivo: 'agente',
    romper: (s) => s.replace("(agendo|dejo|reservo|cancelo|cambio|paso|muevo)", "(agendo|dejo|reservo)")
      .replace("(agendo|reservo|dejo|cancelo|cambio|muevo|cancelamos|cambiamos)", "(agendo|reservo|dejo)") },
  { nombre: 'con el cambio fallido sale igual el texto del agente', archivo: 'motor',
    romper: (s) => s.replace("    } else {\n      visible = r.texto;\n      guardado = r.texto + '\\n' + bloquesOcultos(reply);\n      escalarPorReserva = !!r.escalar;\n    }\n  }\n  if (pedidoCita) {",
                             "    }\n  }\n  if (pedidoCita) {") },
  { nombre: 'cancelar y reservar en el mismo mensaje hace las dos', archivo: 'motor',
    romper: cambiar("const pedidoCita = !pedidoCambio && reservas && conSi ? extraerReserva(reply) : null;", "const pedidoCita = reservas && conSi ? extraerReserva(reply) : null;") },

  // La promesa sin bloque
  { nombre: 'no se reintenta la promesa sin bloque', archivo: 'motor',
    romper: cambiar("    if (otra && (traeBloqueDeCita(otra) || pideConfirmacion(cleanForUser(otra)))) reply = otra;", "    if (false) reply = otra;") },
  { nombre: 'la promesa sin bloque no pasa a una persona', archivo: 'motor',
    romper: cambiar("escalarPorReserva || promesaSinBloque", "escalarPorReserva") },
  { nombre: 'pasar con un asesor se toma por promesa', archivo: 'agente',
    romper: cambiar("(estoy|voy a|vamos a) (agend|cambi|cancel|reserv)|", "(estoy|voy a|vamos a) (agend|cambi|cancel|reserv|pas)|") },

  // Lo que se ve
  { nombre: 'el inbox enseña el bloque de cambiar', archivo: 'app',
    romper: cambiar(".replace(/\\[(RESERVA|CANCELAR_CITA|CAMBIAR_CITA):.*?\\]/gs, '')\n    .replace(/\\[ESCALAR\\]/g, '')", ".replace(/\\[RESERVA:.*?\\]/gs, '')\n    .replace(/\\[ESCALAR\\]/g, '')") },
];
