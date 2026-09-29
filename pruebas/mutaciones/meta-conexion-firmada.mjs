// Mutaciones de pruebas/meta-conexion-firmada.mjs — node tools/mutar.mjs pruebas/mutaciones/meta-conexion-firmada.mjs

export const SUITE = 'pruebas/meta-conexion-firmada.mjs';
export const ARCHIVOS = {
  ads: 'api/meta-ads.js', auth: 'api/meta-auth.js', callback: 'api/meta-callback.js',
  enlace: 'api/gcal-enlace.js', firma: 'api/_enlace-calendario.js', app: 'public/app.js',
  lista: 'api/meta-list-accounts.js', refresco: 'api/refresh-meta-token.js',
  waAuth: 'api/whatsapp-auth.js', waCallback: 'api/whatsapp-callback.js',
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
  { nombre: 'un comercial puede conectar Meta', archivo: 'enlace', romper: cambiar("  if (!admin) {\n    const para", "  if (false) {\n    const para") },
  { nombre: 'Meta se firma a nombre del miembro', archivo: 'enlace', romper: cambiar("crearEnlaceCuenta(quien.userId, para)", "crearEnlaceCuenta(sesion.id, para)") },
  // Navegador
  { nombre: 'el botón vuelve a mandar su userId', archivo: 'app', romper: cambiar("    window.location.href = d.url;\n  } catch (e) {\n    showToast('No se pudo empezar la conexión con Meta", "    window.location.href = '/api/meta-auth?userId=' + (clerkInstance?.user?.id || '');\n  } catch (e) {\n    showToast('No se pudo empezar la conexión con Meta") },
  { nombre: 'el agente vuelve a mandar el token', archivo: 'app', romper: cambiar("      body: JSON.stringify({ adAccountId: accountId, endpoint: resolvedEndpoint, method, params }),", "      body: JSON.stringify({ accessToken: token, adAccountId: accountId, endpoint: resolvedEndpoint, method, params }),") },
  { nombre: 'desconectar deja la copia persistente', archivo: 'app', romper: cambiar("    .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });", "    .forEach(() => {});") },
  // El token fuera del navegador
  { nombre: 'las lecturas aceptan el token del navegador', archivo: 'ads', romper: cambiar("    const token = guardado?.access_token || '';", "    const token = req.query.accessToken || guardado?.access_token || '';") },
  { nombre: 'status da el token', archivo: 'ads', romper: cambiar("        connected: !!token,", "        connected: !!token, token,") },
  { nombre: 'la lista de cuentas sin sesión', archivo: 'lista', romper: cambiar("  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'meta-list-accounts'), 401);", "") },
  { nombre: 'la lista de cuentas usa el token del cuerpo', archivo: 'lista', romper: cambiar("  const accessToken = await tokenDeLaCuenta(userId);", "  const accessToken = (await req.clone().json().catch(() => ({}))).accessToken || await tokenDeLaCuenta(userId);") },
  { nombre: 'el refresco devuelve el token', archivo: 'refresco', romper: cambiar("return res.status(200).json({ ok: true, expires_at: conn.token_expires_at, refreshed: false });", "return res.status(200).json({ ok: true, access_token: conn.access_token, expires_at: conn.token_expires_at, refreshed: false });") },
  { nombre: 'la purga no borra el token viejo', archivo: 'app', romper: cambiar("    localStorage.removeItem('meta_access_token_persist');\n  } catch (e) {}\n}", "  } catch (e) {}\n}") },
  { nombre: 'la purga pierde la conexión', archivo: 'app', romper: cambiar("    if (viejo) marcarMeta(true);", "    if (viejo) marcarMeta(false);") },
  { nombre: 'el navegador vuelve a guardar el token', archivo: 'app', romper: cambiar("      marcarMeta(true);\n      sessionStorage.setItem('meta_user_name', mConn.account_name || '');", "      marcarMeta(true);\n      sessionStorage.setItem('meta_access_token', mConn.access_token);\n      sessionStorage.setItem('meta_user_name', mConn.account_name || '');") },
  // WhatsApp
  { nombre: 'whatsapp-auth deja pasar sin firma', archivo: 'waAuth', romper: cambiar("  if (!e || e.caducado) {\n    return res.redirect('https://app.acuarius.app/?wa_error=", "  if (false) {\n    return res.redirect('https://app.acuarius.app/?wa_error=") },
  { nombre: 'el callback de WhatsApp se cree el state', archivo: 'waCallback', romper: cambiar("    if (firma && !firma.caducado) { userId = firma.userId; agentId = firma.agentId; clientId = firma.clientId; }", "    userId = s.userId || ''; agentId = s.agentId || ''; clientId = s.clientId || '';") },
  { nombre: 'el agente no se comprueba', archivo: 'enlace', romper: cambiar("      if (!r?.[0]) return json({ error: 'Ese agente no es de tu cuenta.' }, 404);", "") },
  { nombre: 'el cliente no se acota', archivo: 'enlace', romper: cambiar("    if (clienteAjeno(quien, pedidoCliente)) return json({ error: 'No tienes acceso a ese cliente.' }, 403);", "") },
  { nombre: 'la firma de WhatsApp no lleva el agente', archivo: 'firma', romper: cambiar("Date.now() + minutos * 60000, limpio(agentId), limpio(clientId)].join('|');", "Date.now() + minutos * 60000, '', limpio(clientId)].join('|');") },
];
