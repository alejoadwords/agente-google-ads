// Mutaciones de pruebas/gcal-cuenta-firmada.mjs — node tools/mutar.mjs pruebas/mutaciones/gcal-cuenta-firmada.mjs
//
// Cada una vuelve a abrir, por un sitio distinto, la puerta de colgarle tu
// Google a una cuenta ajena. Si alguna sobrevive, la prueba no la cuida.

export const SUITE = 'pruebas/gcal-cuenta-firmada.mjs';
export const ARCHIVOS = {
  enlace: 'api/_enlace-calendario.js',
  endpoint: 'api/gcal-enlace.js',
  auth: 'api/gcal-auth.js',
  yt: 'api/yt-auth.js',
  callback: 'api/oauth/gcal-callback.js',
  app: 'public/app.js',
};

const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  // La firma
  { nombre: 'la firma no se comprueba', archivo: 'enlace',
    romper: cambiar("  if (dif !== 0) return null;\n", '') },
  { nombre: 'la de calendario vale para YouTube', archivo: 'enlace',
    romper: cambiar("if (!PREFIJO_CUENTA[para] || prefijo !== PREFIJO_CUENTA[para] || !userId || partes.length !== 3) return null;",
                    "if (!prefijo.startsWith('cuenta') || !userId) return null;") },
  { nombre: 'el enlace de la cuenta no caduca', archivo: 'enlace',
    romper: (s) => s.replace("  if (!(Number(caduca) > Date.now())) return { caducado: true };\n  return { userId };", "  return { userId };") },

  // El endpoint
  { nombre: 'el endpoint firma sin sesión', archivo: 'endpoint',
    romper: cambiar("  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'gcal-enlace'), 401);", "") },
  { nombre: 'un comercial puede conectar el de la cuenta', archivo: 'endpoint',
    romper: cambiar("  if (!admin) return json(", "  if (false) return json(") },
  { nombre: 'se firma a nombre del miembro, no de la cuenta', archivo: 'endpoint',
    romper: cambiar("crearEnlaceCuenta(quien.userId, 'calendario')", "crearEnlaceCuenta(sesion.id, 'calendario')") },
  { nombre: 'el endpoint acepta GET', archivo: 'endpoint',
    romper: cambiar("  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);", "") },

  // La entrada
  { nombre: 'gcal-auth deja pasar sin firma', archivo: 'auth',
    romper: cambiar("    if (!e || e.caducado) return res.redirect('https://app.acuarius.app/?gcal_error=' + (e?.caducado ? 'enlace_caducado' : 'enlace_invalido'));", "") },
  { nombre: 'yt-auth deja pasar sin firma', archivo: 'yt',
    romper: cambiar("  if (!e || e.caducado) {\n    return res.status(", "  if (false) {\n    return res.status(") },

  // El callback
  { nombre: 'el callback no exige firma', archivo: 'callback',
    romper: cambiar("  if (!firma || firma.caducado) {\n    return res.redirect(", "  if (false) {\n    return res.redirect(") },
  { nombre: 'el callback se cree el userId del state', archivo: 'callback',
    romper: cambiar("  const userId = firma.userId;", "  const userId = JSON.parse(state || '{}').userId || firma.userId;") },
  { nombre: 'el callback no distingue calendario de YouTube', archivo: 'callback',
    romper: cambiar("abrirEnlaceCuenta(firmado, esYoutube ? 'youtube' : 'calendario')", "abrirEnlaceCuenta(firmado, 'calendario') || abrirEnlaceCuenta(firmado, 'youtube')") },

  // El navegador
  { nombre: 'el botón vuelve a mandar su userId', archivo: 'app',
    romper: cambiar("    window.location.href = d.url;", "    window.location.href = '/api/gcal-auth?userId=' + (clerkInstance?.user?.id || '');") },
  { nombre: 'un rechazo del servidor se calla', archivo: 'app',
    romper: cambiar("    showToast('No se pudo empezar la conexión con Google Calendar: ' + String(e.message || e), 'error');", "") },
];
