// Que un fallo de red REAL se registre y el ruido no: node pruebas/registro-sin-ruido.mjs
//
// Ruido es lo que no es culpa nuestra: una navegación o una pestaña que se
// cierra (el navegador aborta lo que estaba en vuelo) y, desde el 02-10-2026,
// la conexión de la persona. Ese día llegó un aviso de «errores nuevos» que
// eran cinco pantallas cayendo en el mismo segundo: alguien sin internet.
//
// Se ejecutan el catch de _fetchAuthRaw y hayConexion() tal como están en
// public/app.js.
import fs from 'fs';
const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };

const i = src.indexOf('  } catch (e) {\n    // La red se cayó');
ok(i > 0, 'el catch de _fetchAuthRaw está donde se espera');
const FIN = '      throw e;\n    }\n';
const bloque = src.slice(i, src.indexOf(FIN, i) + FIN.length).replace('  } catch (e) {', '');
const AsyncFunction = (async () => {}).constructor;

// Corre el catch tal cual. `segundo` es lo que pasa en el reintento:
// 'ok' (responde), 'cae' (vuelve a fallar) o null (no debería reintentarse).
async function corre({ nombre = 'TypeError', oculto = false, seVa = false, abortada = false, hay = true, seVaDespues = false, metodo, segundo = 'cae', seVaEnLaEspera = false }) {
  const registrados = [];
  const reintentos = [];
  let preguntas = 0;
  const ctx = {
    e: { name: nombre, message: 'Failed to fetch' },
    opts: { signal: abortada ? { aborted: true } : undefined, ...(metodo ? { method: metodo } : {}) },
    document: { hidden: oculto },
    _paginaSeVa: seVa,
    url: '/api/lead-activities?id=1',
    opciones: { headers: { Authorization: 'Bearer t' } },
    errRegistrar: (m, d) => registrados.push(d),
    hayConexion: () => { preguntas++; return Promise.resolve(hay); },
    fetch: (u, o) => { reintentos.push({ u, o }); return segundo === 'ok' ? Promise.resolve({ ok: true, status: 200 }) : Promise.reject(new TypeError('Failed to fetch otra vez')); },
    // La espera de segundo y medio, sin esperar; y si toca, la pestaña se
    // oculta justo durante ella.
    setTimeout: (fn) => { if (seVaEnLaEspera) ctx.document.hidden = true; fn(); },
  };
  if (seVaDespues) ctx.hayConexion = () => { preguntas++; ctx.document.hidden = true; return Promise.resolve(true); };
  const f = new AsyncFunction(...Object.keys(ctx), 'let res;\n' + bloque + '\nreturn { res };');
  let salida, lanzo = null;
  try { salida = await f(...Object.values(ctx)); } catch (x) { lanzo = x; }
  await new Promise(r => setTimeout(r, 0));
  return { registrados, preguntas, reintentos, res: salida?.res, lanzo };
}

console.log('\nEl reintento');
let r = await corre({ segundo: 'ok' });
ok(r.reintentos.length === 1 && r.res?.ok && !r.lanzo && !r.registrados.length, 'una lectura que se cae y responde al reintento sigue como si nada, sin registrar', JSON.stringify(r));
ok(r.reintentos[0]?.o?.headers?.Authorization === 'Bearer t' && r.reintentos[0].u === '/api/lead-activities?id=1', 'el reintento lleva la misma URL y el mismo token');
r = await corre({ metodo: 'POST', segundo: 'ok' });
ok(r.reintentos.length === 0 && r.lanzo, 'un guardado (POST) NO se reintenta: podría duplicarse');
r = await corre({ metodo: 'patch', segundo: 'ok' });
ok(r.reintentos.length === 0, 'tampoco un PATCH, aunque venga en minúsculas');
r = await corre({ nombre: 'AbortError', segundo: 'ok' });
ok(r.reintentos.length === 0 && r.lanzo, 'una petición abortada no se reintenta');
r = await corre({ oculto: true, segundo: 'ok' });
ok(r.reintentos.length === 0, 'con la pestaña oculta no se reintenta');
r = await corre({ seVaEnLaEspera: true, segundo: 'ok' });
ok(r.reintentos.length === 0 && r.lanzo && !r.registrados.length, 'si la pestaña se oculta durante la espera, ni se reintenta ni se registra');
r = await corre({ segundo: 'cae' });
ok(r.reintentos.length === 1 && /otra vez/.test(r.lanzo?.message || ''), 'si el reintento también falla, lanza el error del reintento', r.lanzo?.message);

console.log('\nQué se registra (después del reintento)');
r = await corre({});
ok(r.registrados.length === 1 && r.registrados[0] === 'red /api/lead-activities', 'un fallo que se repite con el servidor alcanzable SÍ se registra (es nuestro)', JSON.stringify(r));
r = await corre({ hay: false });
ok(r.registrados.length === 0 && r.preguntas === 1, 'si el servidor tampoco responde, era la conexión de la persona: no se registra');
r = await corre({ nombre: 'AbortError' });
ok(r.registrados.length === 0 && r.preguntas === 0, 'un abort NO, y ni se pregunta');
r = await corre({ abortada: true });
ok(r.registrados.length === 0, 'una petición cancelada a propósito tampoco');
r = await corre({ oculto: true });
ok(r.registrados.length === 0, 'con la pestaña oculta tampoco');
r = await corre({ seVa: true });
ok(r.registrados.length === 0, 'ni cuando la página se está cerrando');
r = await corre({ seVaDespues: true });
ok(r.registrados.length === 0, 'ni si empieza a cerrarse mientras se comprueba');
r = await corre({ metodo: 'POST' });
ok(r.registrados.length === 1, 'un guardado que falla se registra sin reintento');

console.log('\nLa comprobación de conexión');
const j = src.search(/^let _pingEnVuelo = null;/m);
const fin = src.indexOf('\n}\n', src.indexOf('function hayConexion()', j)) + 3;
ok(j > 0, 'hayConexion está en public/app.js');
function montar({ online = true, respuesta = 'ok' }) {
  const pedidos = [];
  const mundo = {
    navigator: { onLine: online },
    fetch: (url, init) => {
      pedidos.push({ url, init });
      if (respuesta === 'ok') return Promise.resolve({ ok: true, status: 204 });
      if (respuesta === 'cae') return Promise.reject(new TypeError('Failed to fetch'));
      return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 4000 ? 30 : ms === 5000 ? 60 : ms), // relojes cortos
    clearTimeout,
    AbortController,
  };
  const hay = new Function(...Object.keys(mundo), src.slice(j, fin) + '\nreturn hayConexion;')(...Object.values(mundo));
  return { hay, pedidos };
}
let m = montar({ online: false });
ok(await m.hay() === false && m.pedidos.length === 0, 'si el sistema dice que no hay red, no se pregunta al servidor');
m = montar({});
ok(await m.hay() === true && m.pedidos[0].url.startsWith('/api/ping?t=') && m.pedidos[0].init.cache === 'no-store', 'pregunta a /api/ping sin caché y responde que sí');
m = montar({ respuesta: 'cae' });
ok(await m.hay() === false, 'si /api/ping tampoco llega, no hay conexión');
m = montar({ respuesta: 'cuelga' });
ok(await m.hay() === false, 'si /api/ping no contesta a tiempo, tampoco');
m = montar({});
const [a, b, c] = await Promise.all([m.hay(), m.hay(), m.hay()]);
ok(a && b && c && m.pedidos.length === 1, 'cinco pantallas que caen juntas comparten UNA sola comprobación', m.pedidos.length);
await new Promise(r => setTimeout(r, 120));
await m.hay();
ok(m.pedidos.length === 2, 'pasado un rato se vuelve a preguntar', m.pedidos.length);

console.log('\n/api/ping');
const ping = (await import('../api/ping.js')).default;
const res = ping();
ok(res.status === 204 && res.headers.get('cache-control') === 'no-store', 'responde 204 y sin caché');

console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
