// Mutaciones de pruebas/reservas-google.mjs — node tools/mutar.mjs pruebas/mutaciones/reservas-google.mjs
//
// Cada una rompe algo que la prueba DEBE notar. Si alguna sobrevive, la
// prueba está en verde por casualidad.

export const SUITE = 'pruebas/reservas-google.mjs';
export const ARCHIVOS = {
  gcal: 'api/_gcal.js',
  publica: 'api/booking-public.js',
  enlace: 'api/_enlace-calendario.js',
  callback: 'api/oauth/gcal-callback.js',
  app: 'public/app.js',
  bookings: 'api/bookings.js',
};

const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // Qué ocupa
  { nombre: 'lo «Disponible» de Google bloquea', archivo: 'gcal',
    romper: cambiar("    if (ev.transparency === 'transparent') continue;\n", '') },
  { nombre: 'una invitación rechazada bloquea', archivo: 'gcal',
    romper: cambiar("    if (yo && yo.responseStatus === 'declined') continue;\n", '') },
  { nombre: 'nuestras propias citas se cuentan dos veces', archivo: 'gcal',
    romper: cambiar("    if (ev.extendedProperties?.private?.acuarius_cita) continue;\n", '') },
  { nombre: 'las citas de antes de la marca se cuentan dos veces', archivo: 'gcal',
    romper: cambiar("    if (ignorar && ignorar.has(ev.id)) continue;\n", '') },
  { nombre: 'el día entero se toma en UTC', archivo: 'gcal',
    romper: cambiar("      const zona = zonaCalendario || 'UTC';", "      const zona = 'UTC';") },
  { nombre: 'el lugar de trabajo del día bloquea', archivo: 'gcal',
    romper: cambiar("    if (ev.eventType === 'workingLocation') continue;\n", '') },

  // El lector
  { nombre: 'se le pide a Google sin singleEvents', archivo: 'gcal',
    romper: cambiar("singleEvents: 'true', ", '') },
  { nombre: 'un permiso retirado no se anota', archivo: 'gcal',
    romper: cambiar("    if (perdido) e.status = 401;\n", '') },
  { nombre: 'un fallo pasajero de Google se pinta en rojo', archivo: 'gcal',
    romper: cambiar("    if (perdido) e.status = 401;", "    e.status = 401;") },
  { nombre: 'un 401 de Google no se anota', archivo: 'gcal',
    romper: cambiar("      if (e.status === 401 || (e.status === 403 && !/limit|quota/i.test(e.message || ''))) {", "      if (false) {") },
  { nombre: 'el aviso rojo no se quita al volver a leer bien', archivo: 'gcal',
    romper: cambiar("      if (c.error) await marcarErrorCalendario(id, null);\n", '') },
  { nombre: 'se pregunta a Google aunque nadie tenga calendario', archivo: 'gcal',
    romper: cambiar("  if (!conCalendario.length) return out;\n", '') },
  { nombre: 'el token renovado no se guarda', archivo: 'gcal',
    romper: cambiar("      access_token: await cifrar(fresh.access_token),\n      token_expires_at", "      token_expires_at") },

  // La página pública
  { nombre: 'lo de Google no se suma a lo ocupado', archivo: 'publica',
    romper: cambiar("    if (porRecurso[id]) porRecurso[id].push(...tramos);", '') },
  { nombre: 'un calendario ilegible se da por LIBRE', archivo: 'publica',
    romper: cambiar("    out[id] = [todo()];\n  }\n  return out;", "  }\n  return out;") },
  { nombre: 'sin saber quién tiene calendario, se da todo por libre', archivo: 'publica',
    romper: cambiar("    return Object.fromEntries(ids.map(id => [id, [todo()]]));", "    return {};") },
  { nombre: 'lo de Ana se le aplica también a Luis', archivo: 'publica',
    romper: cambiar("    if (porRecurso[id]) porRecurso[id].push(...tramos);", "    for (const k of ids) porRecurso[k].push(...tramos);") },

  // El enlace
  { nombre: 'el enlace no comprueba la firma', archivo: 'enlace',
    romper: cambiar("  if (dif !== 0) return null;\n", '') },
  { nombre: 'el enlace no caduca', archivo: 'enlace',
    romper: cambiar("  if (!(Number(caduca) > Date.now())) return { caducado: true };\n", '') },
  { nombre: 'el enlace acepta firmas de otro uso', archivo: 'enlace',
    romper: cambiar("  if (prefijo !== PREFIJO || !userId || !resourceId) return null;", "  if (!userId || !resourceId) return null;") },

  // El callback
  { nombre: 'se guarda sin el permiso del calendario', archivo: 'callback',
    romper: cambiar("    if (tokens.scope && !String(tokens.scope).split(' ').includes(SCOPE_EVENTOS)) {", "    if (false) {") },
  { nombre: 'se dice «listo» sin probar a leer', archivo: 'callback',
    romper: cambiar("      await eventosGoogle(tokens.access_token, ahora.toISOString(), new Date(ahora.getTime() + 86400000).toISOString());", '') },
  { nombre: 'no se comprueba de quién es el recurso', archivo: 'callback',
    romper: cambiar("    `&user_id=eq.${encodeURIComponent(e.userId)}&select=id,nombre&limit=1`);", "    `&select=id,nombre&limit=1`);") },
  { nombre: 'el callback se fía del state sin firma', archivo: 'callback',
    romper: cambiar("  if (!e || e.caducado) {\n    return pagina(res, 400, { ok: false, titulo: 'Este enlace ya no vale',",
                    "  if (false) {\n    return pagina(res, 400, { ok: false, titulo: 'Este enlace ya no vale',") },

  // La pantalla
  { nombre: 'la fila no enseña el calendario', archivo: 'app',
    romper: cambiar("          '<div class=\"rsv-cal-linea\">' + rsvChipCalendario(r) + '</div>' +\n", '') },
  { nombre: 'un calendario caído se pinta como conectado', archivo: 'app',
    romper: cambiar("  if (c.error) return '<span class=\"rsv-chip mal rsv-cal\"", "  if (false) return '<span class=\"rsv-chip mal rsv-cal\"") },
  { nombre: 'no se avisa arriba de un calendario caído', archivo: 'app',
    romper: cambiar("  if (!caidos.length) return '';", "  return '';") },

  // Los tokens
  { nombre: 'la lista de recursos manda los tokens al navegador', archivo: 'bookings',
    romper: cambiar("booking_resource_calendars(email,error,error_at,updated_at)", "booking_resource_calendars(email,error,error_at,updated_at,access_token)") },
];
