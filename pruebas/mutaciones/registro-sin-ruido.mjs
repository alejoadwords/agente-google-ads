// Mutaciones de pruebas/registro-sin-ruido.mjs — node tools/mutar.mjs pruebas/mutaciones/registro-sin-ruido.mjs

export const SUITE = 'pruebas/registro-sin-ruido.mjs';
export const ARCHIVOS = { app: 'public/app.js', ping: 'api/ping.js' };
const cambiar = (de, a) => (s) => s.replace(de, a);

export const MUTACIONES = [
  { nombre: 'registra sin comprobar la conexión', archivo: 'app', romper: cambiar('hayConexion().then(hay => { if (hay && !seVa()) errRegistrar(mensaje, donde); });', 'errRegistrar(mensaje, donde);') },
  { nombre: 'no mira si se va mientras comprueba', archivo: 'app', romper: cambiar('if (hay && !seVa()) errRegistrar', 'if (hay) errRegistrar') },
  { nombre: 'sin mirar onLine', archivo: 'app', romper: cambiar("if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false);", '') },
  { nombre: 'comprobación por petición', archivo: 'app', romper: cambiar('if (!_pingEnVuelo) {', 'if (true) {') },
  { nombre: 'comprobación eterna', archivo: 'app', romper: cambiar('setTimeout(() => { _pingEnVuelo = null; }, 5000);', '') },
  { nombre: 'sin plazo', archivo: 'app', romper: cambiar('const reloj = setTimeout(() => ctl.abort(), 4000);', 'const reloj = 0;') },
  { nombre: 'ping cacheado', archivo: 'app', romper: cambiar("{ cache: 'no-store', signal: ctl.signal }", '{ signal: ctl.signal }') },
  { nombre: 'ping con caché en el servidor', archivo: 'ping', romper: cambiar("'Cache-Control': 'no-store'", "'Cache-Control': 'max-age=60'") },
  { nombre: 'registra con la pestaña oculta', archivo: 'app', romper: cambiar("(document.hidden || _paginaSeVa)", '_paginaSeVa') },
];
