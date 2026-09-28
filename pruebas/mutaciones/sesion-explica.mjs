// Mutaciones de pruebas/sesion-explica.mjs — node tools/mutar.mjs pruebas/mutaciones/sesion-explica.mjs
//
// Cada una rompe algo que la prueba DEBE notar. Si alguna sobrevive, la
// prueba está en verde por casualidad.

export const SUITE = 'pruebas/sesion-explica.mjs';
export const ARCHIVOS = {
  sesion: 'api/_sesion.js',
  app: 'public/app.js',
  pauta: 'api/pauta.js',
};

const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'un token vencido entra', archivo: 'sesion',
    romper: cambiar("  if (payload && payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {", "  if (false) {") },
  { nombre: 'la firma no se comprueba', archivo: 'sesion',
    romper: cambiar("    if (!ok) return mal('la firma no cuadra con la llave ' + header.kid);", "") },
  { nombre: 'la sesión vencida no se marca como tal', archivo: 'sesion',
    romper: cambiar("return mal('el token venció hace ' + hace + ' s', true);", "return mal('el token venció hace ' + hace + ' s');") },
  { nombre: 'una firma falsa se marca como sesión vencida', archivo: 'sesion',
    romper: cambiar("    if (!ok) return mal('la firma no cuadra con la llave ' + header.kid);", "    if (!ok) return mal('la firma no cuadra con la llave ' + header.kid, true);") },
  { nombre: 'Clerk caído se confunde con falta de permiso', archivo: 'sesion',
    romper: cambiar("    return mal(e && e.codigo\n      ? e.message\n      : 'no se pudieron traer las llaves de Clerk: ' + (e && e.message));",
                    "    return mal('no autorizado');") },
  { nombre: 'la caché se queda con llaves viejas tras una rotación', archivo: 'sesion',
    romper: cambiar("  const tiene = frescas && (_llaves.keys || []).some(k => k.kid === kid);", "  const tiene = frescas;") },
  { nombre: 'con Clerk caído se echa a quien tenía llaves buenas', archivo: 'sesion',
    romper: cambiar("  if (frescas && tiene) return _llaves;", "") },
  { nombre: 'el motivo técnico se le cuenta al usuario', archivo: 'sesion',
    romper: cambiar("    ? { error: 'Tu sesión venció. Vuelve a entrar para seguir.', sesion_vencida: true }", "    ? { error: 'Tu sesión venció: ' + motivo, sesion_vencida: true }") },
  { nombre: 'se anota también la petición sin cabecera (ruido)', archivo: 'sesion',
    romper: cambiar("  if (!motivo || motivo === 'sin cabecera Authorization') return;", "  if (!motivo) return;") },
  { nombre: 'no se anota nada', archivo: 'sesion',
    romper: cambiar("      origen: 'api', donde: donde + '/sesion',", "      origen: 'api', donde: 'otra-cosa',") },
  { nombre: 'el kid desconocido no se distingue', archivo: 'sesion',
    romper: cambiar("    return mal('ninguna llave de Clerk tiene el kid ' + header.kid", "    return mal('rechazado' + (") },
  { nombre: 'vuelve la condición vieja del reintento', archivo: 'app',
    romper: cambiar("  const salioSinToken = !opciones.headers || !opciones.headers.Authorization;", "  const salioSinToken = false;") },
  { nombre: 'no se espera a la sesión antes de reintentar', archivo: 'app',
    romper: cambiar("    if (salioSinToken) await clerkReady();", "") },
  { nombre: 'no se avisa de la sesión vencida', archivo: 'app',
    romper: cambiar("      if (d && d.sesion_vencida) sesionVencida(d.error);", "") },
  { nombre: 'el aviso se repite en cada petición', archivo: 'app',
    romper: cambiar("  if (_yaAvisadoVencida) return;\n  _yaAvisadoVencida = true;", "") },
  { nombre: 'pauta vuelve al 401 mudo', archivo: 'pauta',
    romper: cambiar("  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'pauta'), 401);", "  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);") },
  // El fallo del token de dos horas
  { nombre: 'vuelve a mandarse el token vencido', archivo: 'app',
    romper: cambiar("  if (token && tokenYaVencio(token)) {", "  if (false) {") },
  { nombre: 'se tira el token pero no se limpia el guardado', archivo: 'app',
    romper: cambiar("    sessionToken = null;\n    token = null;", "    token = null;") },
  { nombre: 'no se avisa cuando no hay sesión de la que sacar otro', archivo: 'app',
    romper: cambiar("    if (!(clerkInstance && clerkInstance.session)) sesionVencida();", "") },
  { nombre: 'se avisa aunque SÍ haya sesión (aviso en falso)', archivo: 'app',
    romper: cambiar("    if (!(clerkInstance && clerkInstance.session)) sesionVencida();", "    sesionVencida();") },
  { nombre: 'el margen de cinco segundos desaparece', archivo: 'app',
    romper: cambiar("    return !!(p.exp && p.exp * 1000 <= Date.now() + 5000);", "    return false;") },
];
