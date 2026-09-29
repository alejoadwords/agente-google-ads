// Mutaciones de pruebas/google-linkedin-sin-token.mjs — node tools/mutar.mjs pruebas/mutaciones/google-linkedin-sin-token.mjs

export const SUITE = 'pruebas/google-linkedin-sin-token.mjs';
export const ARCHIVOS = {
  firma: 'api/_enlace-calendario.js', enlace: 'api/gcal-enlace.js',
  gAuth: 'api/google-ads-auth.js', gCallback: 'api/oauth/callback.js',
  liAuth: 'api/linkedin-auth.js', liCallback: 'api/linkedin-callback.js',
  ads: 'api/google-ads.js', refresco: 'api/refresh-google-token.js', lista: 'api/list-accounts.js',
  li: 'api/linkedin-ads.js', admin: 'api/admin.js', app: 'public/app.js',
};
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // Firma
  { nombre: 'la firma de Google vale para Meta', archivo: 'firma', romper: cambiar("google: 'cuenta-gads'", "google: 'cuenta-meta'") },
  { nombre: 'un comercial puede conectar Google Ads', archivo: 'enlace', romper: cambiar("  if (!admin) {\n    const para", "  if (false) {\n    const para") },
  { nombre: 'Google se firma a nombre del miembro', archivo: 'enlace', romper: cambiar("crearEnlaceCuenta(quien.userId, para)", "crearEnlaceCuenta(sesion.id, para)") },
  { nombre: '?para=google cae en el calendario', archivo: 'enlace', romper: cambiar("google: '/api/google-ads-auth?c=', ", "") },
  // Google OAuth
  { nombre: 'google-ads-auth deja pasar sin firma', archivo: 'gAuth', romper: cambiar("  if (!e || e.caducado) {", "  if (false) {") },
  { nombre: 'el callback de Google no exige firma', archivo: 'gCallback', romper: cambiar("  if (!firma || firma.caducado) {", "  if (false) {") },
  { nombre: 'el callback de Google se cree el userId del state', archivo: 'gCallback', romper: cambiar("  const userId = firma.userId;", "  const userId = JSON.parse(state || '{}').userId || firma.userId;") },
  { nombre: 'el refresh_token vuelve a la URL', archivo: 'gCallback', romper: cambiar("      `&ads_email=${encodeURIComponent(userInfo.email || '')}`", "      `&ads_email=${encodeURIComponent(userInfo.email || '')}&ads_refresh=${tokens.refresh_token}`") },
  { nombre: 'un fallo al guardar Google se calla', archivo: 'gCallback', romper: cambiar("    if (!guardado) return res.redirect('https://app.acuarius.app/?ads_error=save_failed');\n", '') },
  // LinkedIn OAuth
  { nombre: 'linkedin-auth deja pasar sin firma', archivo: 'liAuth', romper: cambiar("  if (!e || e.caducado) {", "  if (false) {") },
  { nombre: 'el callback de LinkedIn no exige firma', archivo: 'liCallback', romper: cambiar("  if (!firma || firma.caducado) {", "  if (false) {") },
  { nombre: 'LinkedIn se guarda en claro', archivo: 'liCallback', romper: cambiar("    access_token:     await cifrar(token),", "    access_token:     token,") },
  { nombre: 'el token de LinkedIn vuelve a la URL', archivo: 'liCallback', romper: cambiar("      linkedin_connected: 'true',\n", "      linkedin_connected: 'true',\n      linkedin_token:     accessToken,\n") },
  { nombre: 'un fallo al guardar LinkedIn se calla', archivo: 'liCallback', romper: cambiar("    if (!guardado) return res.redirect('https://app.acuarius.app/?linkedin_error=save_failed');\n", '') },
  // google-ads
  { nombre: 'la consulta del agente acepta el token del cuerpo', archivo: 'ads', romper: cambiar("    const activeToken = vig.token;", "    const activeToken = (req.body && req.body.accessToken) || vig.token;") },
  { nombre: 'las acciones aceptan ?accessToken=', archivo: 'ads', romper: cambiar("    const token = vig.token;", "    const token = req.query.accessToken || vig.token;") },
  { nombre: 'vuelve el _refreshedToken', archivo: 'ads', romper: cambiar("      return res.status(200).json({ results: data.results || [] });", "      return res.status(200).json({ results: data.results || [], _refreshedToken: activeToken });") },
  { nombre: 'no se renueva antes de usar', archivo: 'ads', romper: cambiar("vence - Date.now() > 5 * 60 * 1000", "vence - Date.now() > -1e12") },
  { nombre: 'status da el token', archivo: 'ads', romper: cambiar("        puede_renovar: !!conn?.refresh_token,", "        puede_renovar: !!conn?.refresh_token, token: conn?.access_token,") },
  // Renovar, listar, get-connection
  { nombre: 'refresh-google-token devuelve el token', archivo: 'refresco', romper: cambiar("      ok:           true,\n      expires_at:   expiresAt,", "      ok:           true, access_token: refreshed.access_token,\n      expires_at:   expiresAt,") },
  { nombre: 'get-connection da el token de Google', archivo: 'admin', romper: cambiar("new Set(['meta_ads', 'google_ads', 'linkedin_ads'])", "new Set(['meta_ads', 'linkedin_ads'])") },
  { nombre: 'get-connection da el token de LinkedIn', archivo: 'admin', romper: cambiar("new Set(['meta_ads', 'google_ads', 'linkedin_ads'])", "new Set(['meta_ads', 'google_ads'])") },
  { nombre: 'save-connection vuelve a aceptar tokens de la app', archivo: 'admin', romper: cambiar("  if (!authCheck(req)) {\n    return res.status(403)", "  if (false) {\n    return res.status(403)") },
  { nombre: 'save-connection guarda en claro', archivo: 'admin', romper: cambiar("    access_token:     await cifrar(access_token),", "    access_token,") },
  { nombre: 'list-accounts sin sesión', archivo: 'lista', romper: cambiar("  if (!sesion.id) return res.status(401).json(await cuerpoSinSesion(sesion, 'list-accounts'));\n  const userId = await cuentaDe(sesion.id);", "  const userId = (req.body || {}).userId || await cuentaDe(sesion.id || 'x');") },
  { nombre: 'list-accounts usa el token del cuerpo', archivo: 'lista', romper: cambiar("  let accessToken = conn?.access_token || null;", "  let accessToken = (req.body || {}).accessToken || conn?.access_token || null;") },
  // linkedin-ads
  { nombre: 'linkedin-ads sin sesión', archivo: 'li', romper: cambiar("  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'linkedin-ads'), 401);\n  const userId = await cuentaDe(sesion.id);", "  const userId = await cuentaDe(sesion.id || 'dueno');") },
  { nombre: 'linkedin-ads usa el token del cuerpo', archivo: 'li', romper: cambiar("  const accessToken = conn?.access_token || '';", "  const accessToken = body.accessToken || conn?.access_token || '';") },
  // Navegador
  { nombre: 'el botón de Google vuelve a mandar su userId', archivo: 'app', romper: cambiar("  return irAConectar('google', 'Google Ads');", "  window.location.href = '/api/google-ads-auth?userId=' + (clerkInstance?.user?.id || '');") },
  { nombre: 'el agente vuelve a mandar el token de Google', archivo: 'app', romper: cambiar("      body: JSON.stringify({ customerId, query: gaqlQuery }),", "      body: JSON.stringify({ customerId, query: gaqlQuery, accessToken: sessionStorage.getItem('ads_access_token') }),") },
  { nombre: 'la purga de Google deja el refresh_token', archivo: 'app', romper: cambiar("    ['ads_access_token', 'ads_refresh_token'].forEach(k => {", "    ['ads_access_token'].forEach(k => {") },
  { nombre: 'desmarcar LinkedIn deja la marca persistente', archivo: 'app', romper: cambiar("    else { sessionStorage.removeItem('linkedin_conectado'); localStorage.removeItem('linkedin_conectado_persist'); }", "    else { sessionStorage.removeItem('linkedin_conectado'); }") },
];
