// Mutaciones de pruebas/meta-conexion-firmada.mjs — node tools/mutar.mjs pruebas/mutaciones/meta-conexion-firmada.mjs

export const SUITE = 'pruebas/meta-conexion-firmada.mjs';
export const ARCHIVOS = {
  ads: 'api/meta-ads.js', auth: 'api/meta-auth.js', callback: 'api/meta-callback.js',
  enlace: 'api/gcal-enlace.js', firma: 'api/_enlace-calendario.js', app: 'public/app.js',
};
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // Candados
  { nombre: 'crear no fuerza la pausa', archivo: 'ads', romper: cambiar("    if (CON_ESTADO.has(arista)) p.status = 'PAUSED';\n", '') },
  { nombre: 'se puede activar algo que existe', archivo: 'ads', romper: cambiar("  if (!soloPausaONombre || ('status' in p && p.status !== 'PAUSED')) {", "  if (!soloPausaONombre) {") },
  { nombre: 'se puede tocar cualquier campo de algo que existe', archivo: 'ads', romper: cambiar("claves.every(k => k === 'name' || k === 'status')", "claves.every(() => true)") },
  { nombre: 'se puede borrar', archivo: 'ads', romper: cambiar("  if (m !== 'POST') return { error:", "  if (false) return { error:") },
  { nombre: 'se puede crear cualquier cosa en la cuenta', archivo: 'ads', romper: cambiar("    if (!raiz.startsWith('act_') || !CREABLES.has(arista)) {", "    if (!raiz.startsWith('act_')) {") },
  { nombre: 'cualquier ruta vale', archivo: 'ads', romper: cambiar("  if (!RUTA.test(e)) return { error:", "  if (false) return { error:") },
  { nombre: 'el proxy funciona sin sesión', archivo: 'ads', romper: cambiar("    if (!userIdProxy) return res.status(401).json({ error: 'No autorizado' });\n", '') },
  { nombre: 'el proxy usa el token del navegador', archivo: 'ads', romper: cambiar("    const tokenCuenta = conn?.access_token || '';", "    const tokenCuenta = (req.body && req.body.accessToken) || conn?.access_token || '';") },
  { nombre: 'los objetos viajan como [object Object]', archivo: 'ads', romper: cambiar("out[k] = v && typeof v === 'object' ? JSON.stringify(v) : String(v);", "out[k] = String(v);") },
  // OAuth
  { nombre: 'meta-auth deja pasar sin firma', archivo: 'auth', romper: cambiar("  if (!e || e.caducado) {\n    return res.redirect(", "  if (false) {\n    return res.redirect(") },
  { nombre: 'el callback no exige firma', archivo: 'callback', romper: cambiar("  if (!firma || firma.caducado) {\n    return res.redirect(", "  if (false) {\n    return res.redirect(") },
  { nombre: 'el callback se cree el userId del state', archivo: 'callback', romper: cambiar("  const userId = firma.userId;", "  const userId = JSON.parse(state || '{}').userId || firma.userId;") },
  { nombre: 'el token vuelve a viajar en la URL', archivo: 'callback', romper: cambiar("      meta_connected: 'true',\n", "      meta_connected: 'true',\n      meta_token: longData.access_token,\n") },
  { nombre: 'un fallo al guardar se calla', archivo: 'callback', romper: cambiar("    if (!guardado) return res.redirect('https://app.acuarius.app/?meta_error=save_failed');\n", '') },
  { nombre: 'la firma de Meta vale para el calendario', archivo: 'firma', romper: cambiar("meta: 'cuenta-meta'", "meta: 'cuenta-cal'") },
  { nombre: 'un comercial puede conectar Meta', archivo: 'enlace', romper: cambiar("  if (!admin) {\n    const esMeta", "  if (false) {\n    const esMeta") },
  { nombre: 'Meta se firma a nombre del miembro', archivo: 'enlace', romper: cambiar("crearEnlaceCuenta(quien.userId, para)", "crearEnlaceCuenta(sesion.id, para)") },
  // Navegador
  { nombre: 'el botón vuelve a mandar su userId', archivo: 'app', romper: cambiar("    window.location.href = d.url;\n  } catch (e) {\n    showToast('No se pudo empezar la conexión con Meta", "    window.location.href = '/api/meta-auth?userId=' + (clerkInstance?.user?.id || '');\n  } catch (e) {\n    showToast('No se pudo empezar la conexión con Meta") },
  { nombre: 'el agente vuelve a mandar el token', archivo: 'app', romper: cambiar("      body: JSON.stringify({ adAccountId: accountId, endpoint: resolvedEndpoint, method, params }),", "      body: JSON.stringify({ accessToken: token, adAccountId: accountId, endpoint: resolvedEndpoint, method, params }),") },
  { nombre: 'desconectar deja la copia persistente', archivo: 'app', romper: cambiar("    .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });", "    .forEach(() => {});") },
];
