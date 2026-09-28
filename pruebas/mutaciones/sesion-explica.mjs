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
    romper: cambiar("    return mal('no se pudieron traer las llaves de Clerk: ' + (e && e.message));", "    return mal('no autorizado');") },
  { nombre: 'el motivo técnico se le cuenta al usuario', archivo: 'sesion',
    romper: cambiar("    ? { error: 'Tu sesión venció. Vuelve a entrar para seguir.', sesion_vencida: true }", "    ? { error: 'Tu sesión venció: ' + motivo, sesion_vencida: true }") },
  { nombre: 'se anota también la petición sin cabecera (ruido)', archivo: 'sesion',
    romper: cambiar("  if (motivo && motivo !== 'sin cabecera Authorization') {", "  if (motivo) {") },
  { nombre: 'no se anota nada', archivo: 'sesion',
    romper: cambiar("        origen: 'api', donde: donde + '/sesion',", "        origen: 'api', donde: 'otra-cosa',") },
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
    romper: cambiar("  if (!userId) return await respuestaSinSesion(sesion, 'pauta', CORS);", "  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);") },
];
