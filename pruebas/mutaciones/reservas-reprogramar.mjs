// Mutaciones de pruebas/reservas-reprogramar.mjs — node tools/mutar.mjs pruebas/mutaciones/reservas-reprogramar.mjs

export const SUITE = 'pruebas/reservas-reprogramar.mjs';
export const ARCHIVOS = { publica: 'api/booking-public.js', reservas: 'api/_reservas.js' };

const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'el negocio se busca solo por cuenta', archivo: 'publica',
    romper: cambiar("` +\n    `&client_id=eq.${encodeURIComponent(cita.client_id || '')}&select=*&limit=1`", "&select=*&limit=1`") },
  { nombre: 'las horas para cambiar cuentan la propia cita', archivo: 'publica',
    romper: cambiar("return jsonResp({ horas: await horasDelDia(neg, servicio, puede, dia, cita.id) });", "return jsonResp({ horas: await horasDelDia(neg, servicio, puede, dia, null) });") },
  { nombre: 'mover cuenta la propia cita', archivo: 'reservas',
    romper: cambiar("    if (ignorar && f.id === ignorar) continue;\n", '') },
  { nombre: 'no se intenta primero con la misma persona', archivo: 'publica',
    romper: cambiar("    const conMisma = puede.some(r => r.id === cita.resource_id);", "    const conMisma = false;") },
  { nombre: 'no se prueba con otra persona si la suya está ocupada', archivo: 'publica',
    romper: cambiar("    if (!r || r.ocupada) r = await moverCita(", "    if (!r) r = await moverCita(") },
  { nombre: 'no se avisa del cambio de persona', archivo: 'publica',
    romper: cambiar("cambio_persona: r.cita.resource_id !== cita.resource_id", "cambio_persona: false") },
  { nombre: 'con la página apagada se deja cambiar', archivo: 'publica',
    romper: cambiar("    : !neg.activo ? 'El negocio no está tomando reservas en línea ahora mismo. Escríbele para cambiarla.'\n", "") },
  { nombre: 'una cancelada se puede cambiar', archivo: 'publica',
    romper: cambiar("    if (cancelada) return jsonResp({ error: 'Esta cita está cancelada. Reserva una nueva desde la página del negocio.' }, 409);\n", "") },
  { nombre: 'las horas se piden de una cita cancelada', archivo: 'publica',
    romper: cambiar("    if (cancelada || pasada || noSePuedeCambiar) return jsonResp(", "    if (false) return jsonResp(") },
  { nombre: 'los recordatorios viejos se quedan', archivo: 'reservas',
    romper: cambiar("      recordatorios_enviados: [],\n", '') },
  { nombre: 'mover no mira el hueco', archivo: 'reservas',
    romper: cambiar("  const hueco = await comprobarHueco(neg, { servicio, recursos, inicio, pedido, ignorar: cita.id });\n  if (hueco.error) return hueco;\n  const libre = hueco.libre;\n  const fin",
                    "  const libre = elegibles(servicio, recursos, pedido || null)[0];\n  const fin") },
];
