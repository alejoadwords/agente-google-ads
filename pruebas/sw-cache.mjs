// La caché del service worker: node pruebas/sw-cache.mjs
//
// Instalada en el celular, la aplicación se bajaba 2,2 MB de app.js antes de
// pintar nada. Ahora se sirve de la caché y se revalida por detrás.
//
// Un fallo de caché es de los que no se notan en meses y luego no hay forma de
// reproducirlos: el usuario tiene algo viejo guardado y nadie más lo ve. Por
// eso esto se ejecuta de verdad, con una Cache API y un fetch de mentira, en
// vez de leer el fichero y confiar.

import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

// ── Un navegador de mentira, con lo justo ───────────────────────────────────
function montar({ enRed = {}, enCache = {}, redCae = false } = {}) {
  const guardado = new Map(Object.entries(enCache));
  const pedidasARed = [];
  const cache = {
    match: async (req) => guardado.get(clave(req)),
    put: async (req, res) => { guardado.set(clave(req), res); },
    addAll: async () => {},
  };
  const clave = (r) => (typeof r === 'string' ? r : new URL(r.url).pathname);
  const caches = {
    open: async () => cache,
    match: async (req) => guardado.get(clave(req)),
    keys: async () => ['acuarius-v2'],
    delete: async () => true,
  };
  const fetchFalso = async (req) => {
    const p = clave(req);
    pedidasARed.push({ p, metodo: (req && req.method) || 'GET' });
    if (redCae) throw new Error('sin red');
    const v = enRed[p];
    if (v === undefined) return { ok: false, status: 404, clone: () => ({}), cuerpo: null };
    return { ok: true, status: 200, cuerpo: v, clone() { return { ...this }; } };
  };
  return { caches, fetchFalso, guardado, pedidasARed, clave };
}

// Se extrae el cuerpo del SW y se ejecuta con los oyentes capturados.
function cargarSW(entorno) {
  const oyentes = {};
  const self_ = {
    addEventListener: (n, f) => { oyentes[n] = f; },
    location: { origin: 'https://app.acuarius.app' },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [], openWindow: () => {} },
    registration: { showNotification: () => {} },
  };
  const Request_ = class { constructor(u, o = {}) { this.url = new URL(u, 'https://app.acuarius.app').href; this.method = o.method || 'GET'; this.mode = o.mode || 'cors'; } };
  new Function('self', 'caches', 'fetch', 'URL', 'Request', sw)(
    self_, entorno.caches, entorno.fetchFalso, URL, Request_);
  return { oyentes, Request: Request_ };
}

// Dispara el oyente de fetch y devuelve lo que respondió, o null si lo dejó pasar.
async function pedir(entorno, req) {
  const { oyentes } = cargarSW(entorno);
  let respuesta = null, respondio = false;
  await oyentes.fetch({ request: req, respondWith: (p) => { respondio = true; respuesta = p; } });
  return respondio ? await respuesta : null;
}

const R = (u, o) => ({ url: new URL(u, 'https://app.acuarius.app').href, method: (o && o.method) || 'GET', mode: (o && o.mode) || 'cors' });

console.log('\nAbre al instante con lo guardado\n');
{
  const e = montar({ enCache: { '/app.js': { ok: true, cuerpo: 'VIEJO', clone() { return this; } } },
                     enRed:   { '/app.js': 'NUEVO' } });
  const res = await pedir(e, R('/app.js'));
  chk('responde con la copia guardada, no espera a la red', res?.cuerpo === 'VIEJO', JSON.stringify(res?.cuerpo));
  // Y la red va por detrás: la próxima vez ya estará lo nuevo.
  await new Promise(r => setTimeout(r, 10));
  chk('pero pide la nueva por detrás', e.pedidasARed.some(x => x.p === '/app.js'));
  chk('y la guarda para la próxima', e.guardado.get('/app.js')?.cuerpo === 'NUEVO',
      JSON.stringify(e.guardado.get('/app.js')?.cuerpo));
}

console.log('\nLa primera visita no se queda sin nada\n');
{
  const e = montar({ enRed: { '/app.js': 'NUEVO' } });
  const res = await pedir(e, R('/app.js'));
  chk('sin nada guardado, espera a la red', res?.cuerpo === 'NUEVO', JSON.stringify(res?.cuerpo));
}

console.log('\nLo que NUNCA se cachea\n');
{
  const e = montar({ enRed: { '/api/leads': 'DATOS' } });
  chk('los datos pasan de largo, sin tocar la caché', (await pedir(e, R('/api/leads'))) === null);
  // La lista blanca de abajo ya deja fuera /api, así que esta guarda es una
  // SEGUNDA capa y por eso no se puede distinguir ejecutándola. Se comprueba
  // que siga escrita: el día que la lista blanca crezca, es lo único que
  // impediría cachear un lead.
  chk('y además la guarda explícita sigue puesta',
      /url\.pathname\.startsWith\('\/api\/'\)\) return/.test(sw));

  const e2 = montar({});
  chk('otros dominios ni se miran',
      (await pedir(e2, { url: 'https://clerk.acuarius.app/x.js', method: 'GET', mode: 'cors' })) === null);

  // ESTA es la importante: la barra de versión pregunta la huella con HEAD. Si
  // se la respondiera desde la caché, vería siempre la huella vieja, no
  // avisaría nunca, y el arreglo se habría comido a su propia red de
  // seguridad sin que nada fallara.
  const e3 = montar({ enCache: { '/app.js': { ok: true, cuerpo: 'VIEJO', clone() { return this; } } } });
  chk('un HEAD llega a la red, o la barra de versión no avisaría nunca',
      (await pedir(e3, R('/app.js', { method: 'HEAD' }))) === null);

  const e4 = montar({ enRed: { '/app.js': 'X' } });
  chk('un POST tampoco se toca', (await pedir(e4, R('/app.js', { method: 'POST' }))) === null);
}

console.log('\nUna respuesta rota no se queda guardada\n');
{
  // Cachear un 500 deja la aplicación rota hasta que alguien limpie el
  // navegador, que es justo lo que no queremos volver a pedirle a nadie.
  const e = montar({ enRed: {} });   // 404
  await pedir(e, R('/app.js'));
  await new Promise(r => setTimeout(r, 10));
  chk('un 404 no entra en la caché', !e.guardado.has('/app.js'), JSON.stringify([...e.guardado.keys()]));
}

console.log('\nSin conexión\n');
{
  const e = montar({ redCae: true, enCache: { '/app.js': { ok: true, cuerpo: 'GUARDADO', clone() { return this; } } } });
  const res = await pedir(e, R('/app.js'));
  chk('con algo guardado, la app abre igual', res?.cuerpo === 'GUARDADO', JSON.stringify(res?.cuerpo));

  const e2 = montar({ redCae: true, enCache: { '/offline.html': { ok: true, cuerpo: 'SIN CONEXIÓN', clone() { return this; } } } });
  const res2 = await pedir(e2, R('/app.js'));
  chk('sin nada guardado, sale la página de cortesía', res2?.cuerpo === 'SIN CONEXIÓN', JSON.stringify(res2?.cuerpo));
}

console.log('\nLa navegación no llena la caché de copias del mismo HTML\n');
{
  // El catch-all de vercel.json devuelve el shell para CUALQUIER ruta que no
  // sea /api. Guardando por ruta, cada pantalla visitada dejaría su propia
  // copia del mismo HTML.
  // La red responde a AMBAS rutas: si no, la ruta profunda daría 404, no se
  // cachearía nada, y un `[].every()` sobre una caché vacía es cierto —la
  // aserción pasaría sin comprobar nada—.
  const e = montar({ enRed: { '/': 'SHELL', '/crm/lead/abc-123': 'SHELL' } });
  await pedir(e, R('/crm/lead/abc-123', { mode: 'navigate' }));
  await new Promise(r => setTimeout(r, 10));
  const claves = [...e.guardado.keys()];
  chk('se guardó algo, para que la comprobación no sea vacía', claves.length === 1, JSON.stringify(claves));
  chk('y una ruta profunda se guarda como "/"', claves[0] === '/', JSON.stringify(claves));
}

console.log('\nLas páginas que NO son la aplicación llegan a la red\n');
{
  // Este es el fallo que se coló: la primera versión respondía con la carcasa
  // a cualquier navegación, así que /movil.html mostraba el CRM de siempre.
  // Y con él habrían caído las otras dieciséis páginas reales de public/:
  // la propuesta del cliente, las reservas, los términos... y sso-callback,
  // que es donde vuelve Google al conectar una cuenta.
  const paginas = ['/movil.html', '/p/abc123', '/reservar/xyz', '/form/abc',
                   '/sso-callback.html', '/terms.html', '/offline.html', '/propuesta.html'];
  for (const ruta of paginas) {
    const e = montar({ enRed: { [ruta]: 'PAGINA', '/': 'SHELL' } });
    const res = await pedir(e, R(ruta, { mode: 'navigate' }));
    chk(`${ruta} no recibe la carcasa`, res === null, res ? JSON.stringify(res.cuerpo) : '');
  }
}

console.log('\nY las rutas que SÍ son la aplicación siguen abriendo al instante\n');
{
  for (const ruta of ['/', '/crm', '/crm/lead/abc-123', '/marketing/campanas', '/analisis']) {
    const e = montar({ enCache: { '/': { ok: true, cuerpo: 'SHELL', clone() { return this; } } },
                       enRed: { '/': 'SHELL' } });
    const res = await pedir(e, R(ruta, { mode: 'navigate' }));
    chk(`${ruta} sale de la caché`, res?.cuerpo === 'SHELL', res ? JSON.stringify(res.cuerpo) : 'no respondió');
  }
}

console.log('\nSubir la versión de la caché tira la anterior\n');
{
  chk('el nombre cambió respecto al anterior', /acuarius-v3/.test(sw) && !/carcasa-v1/.test(sw));
  chk('y se borran las claves que no son la actual', /claves\.filter\(\(k\) => k !== CACHE\)/.test(sw));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
