// Un 401 tiene que decir por qué: node pruebas/sesion-explica.mjs
//
// El 28-09-2026 «Plataformas de pauta» le devolvía «No autorizado» a la cuenta
// principal, con la sesión abierta y el resto de la aplicación funcionando.
// Revisando el código no se podía saber cuál de cinco cosas distintas había
// pasado, porque las 65 copias de `getUserId` terminan igual: `catch { return
// null; }`. Un 401 mudo convierte un fallo de cinco minutos en una tarde.
//
// Esta prueba FIRMA tokens de verdad con WebCrypto y los pasa por el
// verificador, para comprobar dos cosas:
//
//   1. que sigue dejando entrar exactamente a quien dejaba entrar —esto no
//      puede ablandar un permiso—;
//   2. que cada rechazo dice cuál de los cinco motivos fue, y que el único que
//      el usuario puede resolver solo —la sesión vencida— se le dice a él.

import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { verificarSesion, cuerpoSinSesion, respuestaSinSesion } from '../api/_sesion.js';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// ── Un Clerk de mentira, con llaves de verdad ───────────────────────────────
const par = await webcrypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const jwkPub = await webcrypto.subtle.exportKey('jwk', par.publicKey);
const KID = 'ins_prueba';
const LLAVES = { keys: [{ ...jwkPub, kid: KID, use: 'sig', alg: 'RS256' }] };

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function token({ sub = 'user_123', exp = Math.floor(Date.now() / 1000) + 3600,
                       kid = KID, firmaMala = false } = {}) {
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const p = b64url(JSON.stringify({ sub, exp }));
  const sig = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey,
    new TextEncoder().encode(h + '.' + p));
  const s = firmaMala ? b64url(new Uint8Array(256)) : b64url(sig);
  return h + '.' + p + '.' + s;
}

// `_registro-errores.js` se calla si no hay credenciales, y sin esto la
// comprobación de que SÍ anota daba cero llamadas por el motivo equivocado.
// Son valores de mentira: el `fetch` de abajo intercepta la petición.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejemplo.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'llave-de-mentira';

// El entorno del edge: `crypto`, y un `fetch` que responde por Clerk.
// En Node 24 `globalThis.crypto` es de solo lectura, así que se redefine.
if (globalThis.crypto !== webcrypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
let clerkResponde = { ok: true, json: LLAVES };
// Se apuntan las llamadas para poder comprobar que el motivo SE ANOTA de
// verdad, no solo que la palabra `registrarError` aparece en el fichero.
// `_registro-errores.js` lo escribe con un POST a `rpc/registrar_error`.
const idas = [];
globalThis.fetch = async (url, opts) => {
  idas.push({ url: String(url), cuerpo: opts && opts.body ? String(opts.body) : null });
  if (String(url).includes('registrar_error')) return { ok: true, status: 200, json: async () => ({}) };
  if (clerkResponde.explota) throw new Error('sin red');
  return { ok: clerkResponde.ok, status: clerkResponde.status || 200,
           json: async () => clerkResponde.json };
};
const pedir = (auth) => ({ headers: { get: (k) => (k.toLowerCase() === 'authorization' ? auth : null) } });
// La misma petición como la ve una función NODE: `req.headers` es un objeto
// plano con las claves en minúscula, no un `Headers` con `.get()`.
const pedirNode = (auth) => ({ headers: auth === null ? {} : { authorization: auth } });

// ── 1. Lo bueno sigue entrando ──────────────────────────────────────────────
console.log('\nUn token bueno entra, como siempre\n');
{
  const r = await verificarSesion(pedir('Bearer ' + await token()));
  ok(r.id === 'user_123', 'devuelve el sub de Clerk', JSON.stringify(r));
  ok(r.motivo === null, 'y sin motivo de rechazo', String(r.motivo));
  ok(r.vencida === false, 'ni marca de vencida');
}
{
  // El prefijo se ha escrito de las dos formas por ahí. Que no cambie nada.
  const t = await token();
  ok((await verificarSesion(pedir('bearer ' + t))).id === 'user_123',
     'el prefijo «bearer» en minúscula también vale');
}

console.log('\nY lo mismo desde una función Node, que lee las cabeceras de otra forma\n');
{
  const t = await token();
  ok((await verificarSesion(pedirNode('Bearer ' + t))).id === 'user_123',
     'un token bueno entra igual con req.headers como objeto plano');
  const r = await verificarSesion(pedirNode(null));
  ok(r.id === null && /sin cabecera/.test(r.motivo),
     'y sin cabecera se distingue igual', r.motivo);
  const v = await verificarSesion(pedirNode('Bearer ' + await token({ exp: Math.floor(Date.now() / 1000) - 60 })));
  ok(v.vencida === true, 'y la sesión vencida también');
  // Y no se rompe con algo que no tenga cabeceras en absoluto.
  ok((await verificarSesion({})).id === null, 'una petición sin headers no revienta');
}

// ── 2. Cada rechazo dice cuál fue ───────────────────────────────────────────
console.log('\nY cada rechazo dice cuál de los cinco motivos fue\n');
{
  const r = await verificarSesion(pedir(null));
  ok(r.id === null, 'sin cabecera no entra');
  ok(/sin cabecera/.test(r.motivo), 'y se llama por su nombre', r.motivo);
}
{
  const r = await verificarSesion(pedir('Bearer '));
  ok(r.id === null && /vac/.test(r.motivo), 'una cabecera vacía se distingue de no tenerla', r.motivo);
}
{
  const r = await verificarSesion(pedir('Bearer esto-no-es-un-jwt'));
  ok(r.id === null && /tres partes/.test(r.motivo), 'un token sin forma de JWT lo dice', r.motivo);
}
{
  const r = await verificarSesion(pedir('Bearer ' + await token({ exp: Math.floor(Date.now() / 1000) - 120 })));
  ok(r.id === null, 'un token vencido no entra');
  ok(/venció hace/.test(r.motivo), 'y dice cuánto hace', r.motivo);
  ok(r.vencida === true, 'y se marca como vencida: es el único que el usuario arregla solo');
}
{
  const r = await verificarSesion(pedir('Bearer ' + await token({ firmaMala: true })));
  ok(r.id === null && /firma no cuadra/.test(r.motivo), 'una firma falsa lo dice', r.motivo);
  ok(r.vencida === false, 'y NO se confunde con una sesión vencida: eso mandaría a volver a entrar '
     + 'a quien tiene un token falsificado');
}
{
  const r = await verificarSesion(pedir('Bearer ' + await token({ kid: 'otro_kid' })));
  ok(r.id === null && /kid/.test(r.motivo), 'un kid que Clerk no conoce lo dice', r.motivo);
}
{
  // Las llaves se guardan diez minutos, así que para probar «Clerk no
  // responde» hace falta un módulo SIN caché. Se importa una copia limpia con
  // una consulta en la ruta: es lo mismo que hace el navegador con `?v=`, y
  // evita tener que abrir un agujero de pruebas en el código que se despliega.
  const limpio = async () => (await import('../api/_sesion.js?nueva=' + Math.random())).verificarSesion;

  // El que más rabia da: el token es bueno y aun así se rechaza, porque no
  // pudimos preguntar. Sin nombre propio parece un permiso denegado.
  clerkResponde = { explota: true };
  const v1 = await limpio();
  const r = await v1(pedir('Bearer ' + await token()));
  ok(r.id === null && /llaves de Clerk/.test(r.motivo),
     'sin llaves guardadas y con Clerk caído, se dice que fue Clerk', r.motivo);

  clerkResponde = { ok: false, status: 503, json: {} };
  const v2 = await limpio();
  const r2 = await v2(pedir('Bearer ' + await token()));
  ok(r2.id === null && /503/.test(r2.motivo), 'y con qué código contestó', r2.motivo);

  // Y lo que arregla la caché: si ya teníamos llaves buenas, un Clerk caído NO
  // puede echar a nadie. El token sigue siendo válido; el que no contesta es
  // el de al lado.
  const v3 = await limpio();
  clerkResponde = { ok: true, json: LLAVES };
  ok((await v3(pedir('Bearer ' + await token()))).id === 'user_123', 'primero entra bien');
  clerkResponde = { explota: true };
  ok((await v3(pedir('Bearer ' + await token()))).id === 'user_123',
     'y con Clerk sin responder sigue entrando: las llaves guardadas valen más que un rechazo');
  // Las dos formas de caerse: no contestar, y contestar mal. La segunda se me
  // escapó y un mutante sobrevivió por ahí.
  clerkResponde = { ok: false, status: 503, json: {} };
  ok((await v3(pedir('Bearer ' + await token()))).id === 'user_123',
     'y si contesta 503, igual: tampoco echa a nadie con llaves buenas guardadas');

  clerkResponde = { ok: true, json: LLAVES };
}
{
  // La caché no puede dejar fuera a un token firmado con una llave NUEVA: si
  // Clerk las rota, quedarse con las viejas rechazaría a todo el mundo hasta
  // que caduque. Ante un `kid` que no está, se vuelve a preguntar.
  const { verificarSesion: v } = await import('../api/_sesion.js?rotacion=' + Math.random());
  clerkResponde = { ok: true, json: LLAVES };
  ok((await v(pedir('Bearer ' + await token()))).id === 'user_123', 'con las llaves de hoy, entra');

  const otroPar = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  const jwk2 = await webcrypto.subtle.exportKey('jwk', otroPar.publicKey);
  const KID2 = 'ins_rotada';
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID2 }));
  const pl = b64url(JSON.stringify({ sub: 'user_456', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sg = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', otroPar.privateKey,
    new TextEncoder().encode(h + '.' + pl));
  clerkResponde = { ok: true, json: { keys: [...LLAVES.keys, { ...jwk2, kid: KID2, use: 'sig', alg: 'RS256' }] } };
  ok((await v(pedir('Bearer ' + h + '.' + pl + '.' + b64url(sg)))).id === 'user_456',
     'y si Clerk rota la llave, se vuelve a preguntar en vez de rechazar');
  clerkResponde = { ok: true, json: LLAVES };
}

// ── 3. Qué le llega al usuario, y qué se anota ──────────────────────────────
console.log('\nAl usuario, lo que puede hacer; al registro, el motivo real\n');
{
  const r = await respuestaSinSesion({ motivo: 'el token venció hace 40 s', vencida: true }, 'pauta');
  const d = await r.json();
  ok(r.status === 401, 'sigue siendo un 401', String(r.status));
  ok(/vuelve a entrar/i.test(d.error), 'a la sesión vencida se le dice qué hacer', d.error);
  ok(d.sesion_vencida === true, 'y viaja la marca, para que la pantalla pueda actuar');
  // El motivo técnico NO puede salir al navegador.
  ok(!/token|firma|kid/i.test(d.error), 'sin contarle la criptografía a nadie', d.error);
}
{
  const r = await respuestaSinSesion({ motivo: 'la firma no cuadra con la llave X', vencida: false }, 'pauta');
  const d = await r.json();
  ok(d.error === 'No autorizado', 'lo demás sigue siendo «No autorizado»', d.error);
  ok(!d.sesion_vencida, 'y sin la marca: no mandaría a volver a entrar a quien no lo arreglaría así');
}

// ── 4. El instrumento no puede hacer ruido ──────────────────────────────────
//
// Una petición sin cabecera llega sola —un robot, una pestaña vieja— y anotar
// todas llenaría el registro. Un registro que llora sin motivo deja de leerse.
{
  const fuente = readFileSync(new URL('../api/_sesion.js', import.meta.url), 'utf8');
  // La parte que decide qué se anota vive ahora en `anotarSesion`, que usan
  // los dos caminos: el que construye el cuerpo y el que solo registra.
  const cuerpo = fuente.slice(fuente.indexOf('export async function anotarSesion'),
                              fuente.indexOf('/** Para el endpoint'));
  ok(/motivo === 'sin cabecera Authorization'\) return;/.test(cuerpo),
     'la petición sin cabecera NO se anota: es ruido, no un fallo', cuerpo.slice(0, 200));
  ok(/registrarError/.test(cuerpo), 'las demás sí se anotan, con su motivo');
}
{
  // Ejecutado, no leído: la comprobación de texto daba verde aunque el
  // registrador fuera un sustituto vacío. Se mira si SALE la anotación.
  idas.length = 0;
  await respuestaSinSesion({ motivo: 'la firma no cuadra con la llave X', vencida: false }, 'pauta');
  const anotada = idas.filter((x) => x.url.includes('registrar_error'));
  ok(anotada.length === 1, 'la anotación SALE de verdad', String(anotada.length) + ' llamadas');
  ok(anotada[0] && /la firma no cuadra/.test(anotada[0].cuerpo || ''),
     'y lleva el motivo real dentro', (anotada[0] || {}).cuerpo);
  ok(anotada[0] && /pauta\/sesion/.test(anotada[0].cuerpo || ''),
     'y de qué endpoint fue');

  idas.length = 0;
  await respuestaSinSesion({ motivo: 'sin cabecera Authorization', vencida: false }, 'pauta');
  ok(idas.filter((x) => x.url.includes('registrar_error')).length === 0,
     'y la petición sin cabecera no anota nada, ejecutándolo');
  // Y si el registrador se cae, la respuesta tiene que salir igual: el
  // instrumento no puede tumbar el endpoint que vigila. Se ejecuta con un
  // registrador que revienta.
  const antes = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('registrar_error')) throw new Error('la base no contesta');
    return antes(url, opts);
  };
  let salio = null;
  try {
    salio = await respuestaSinSesion({ motivo: 'la firma no cuadra', vencida: false }, 'pauta');
  } catch (e) { salio = null; }
  globalThis.fetch = antes;
  ok(salio && salio.status === 401,
     'si no se puede anotar, la respuesta sale igual', salio ? String(salio.status) : 'reventó');
}

// ── 5. Que pauta lo use de verdad ───────────────────────────────────────────
{
  const pauta = readFileSync(new URL('../api/pauta.js', import.meta.url), 'utf8');
  ok(/verificarSesion\(req\)/.test(pauta), 'api/pauta.js verifica con el nuevo camino');
  ok(/cuerpoSinSesion\(sesion, 'pauta'\)/.test(pauta), 'y contesta con su motivo');
  ok(/jsonResp\(await cuerpoSinSesion/.test(pauta),
     'por su PROPIO jsonResp: varios endpoints meten ahí sus cabeceras CORS');
  // Dos verificadores en el mismo fichero acaban separándose.
  ok(!/async function getUserId/.test(pauta),
     'y ya no le queda la copia vieja: dos verificadores en un fichero se separan con el tiempo');
}

// ── 6. El reintento cuando la petición salió SIN token ──────────────────────
//
// El defecto que produce exactamente este síntoma: si `clerkReady()` agota sus
// diez segundos antes de que llegue la sesión, la petición sale sin token, el
// servidor contesta 401 y —como tampoco hay sesión al volver— NO se
// reintentaba. Un tropiezo de un instante se quedaba congelado en la pantalla
// como un «No autorizado» que parece falta de permisos.
console.log('\nSi la petición salió sin token, se reintenta\n');
{
  // EJECUTADA, no leída. Mirar el texto de la función dejaba pasar el mutante
  // que pone `salioSinToken = false`: la línea seguía estando y la prueba
  // seguía en verde. Comprobar la regla en vez del camino es exactamente el
  // fallo que trajo aquí esta pantalla.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const firma = 'async function _fetchAuthRaw(url, opts = {}) {';
  const i = app.indexOf(firma);
  if (i < 0) throw new Error('No encontré _fetchAuthRaw en app.js: revisa esta prueba');
  // Contando llaves desde la que ABRE el cuerpo. Cortar por un comentario de
  // más abajo es frágil: basta reordenar el fichero para que la prueba lea
  // media función y reviente sin que nada esté roto.
  let prof = 0, j = i + firma.length - 1;
  for (; j < app.length; j++) {
    if (app[j] === '{') prof++;
    else if (app[j] === '}' && --prof === 0) break;
  }
  const src = app.slice(i, j + 1);

  // El escenario del fallo: la sesión llega TARDE. El primer intento sale sin
  // token, el servidor contesta 401 y hasta ahora nadie reintentaba.
  const correr = async ({ sesionLlegaTarde }) => {
    const peticiones = [];
    let haySesion = !sesionLlegaTarde;
    const entorno = {
      getAuthHeaders: async ({ fresh } = {}) => (haySesion
        ? { 'Content-Type': 'application/json', Authorization: 'Bearer token' + (fresh ? '-fresco' : '') }
        : { 'Content-Type': 'application/json' }),
      // Esperar a la sesión es justo lo que la deja llegar.
      clerkReady: async () => { haySesion = true; return true; },
      // El objeto es fijo y lo que cambia es `session`: pasarlo por un getter
      // del entorno no servía —`new Function` lo evalúa UNA vez, al construir
      // el ámbito— y entonces la sesión nunca llegaba, por el banco y no por
      // el código.
      clerkInstance: { get session() { return haySesion ? {} : null; } },
      sessionToken: null,
      errRegistrar: () => {},
      cuentaSuspendida: () => {},
      sesionVencida: () => {},
      document: { hidden: false },
      _paginaSeVa: false,
      fetch: async (url, opts) => {
        peticiones.push((opts.headers || {}).Authorization || null);
        const conToken = !!(opts.headers || {}).Authorization;
        return { status: conToken ? 200 : 401,
                 clone: () => ({ json: async () => ({}) }) };
      },
    };
    const nombres = Object.keys(entorno);
    const f = new Function(...nombres, src + '\n; return _fetchAuthRaw;');
    const res = await f(...nombres.map((n) => entorno[n]))('/api/pauta');
    return { peticiones, estado: res.status };
  };

  const tarde = await correr({ sesionLlegaTarde: true });
  ok(tarde.peticiones.length === 2,
     'si la petición salió SIN token y el servidor da 401, se reintenta',
     JSON.stringify(tarde.peticiones));
  ok(tarde.peticiones[0] === null && !!tarde.peticiones[1],
     'el primer intento va sin token y el segundo con uno', JSON.stringify(tarde.peticiones));
  ok(tarde.estado === 200,
     'y la pantalla acaba con sus datos, no con «No autorizado»', String(tarde.estado));

  const aTiempo = await correr({ sesionLlegaTarde: false });
  ok(aTiempo.peticiones.length === 1,
     'y si la sesión ya estaba, no se reintenta de más', JSON.stringify(aTiempo.peticiones));
}
{
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  ok(/if \(d && d\.sesion_vencida\) sesionVencida\(d\.error\)/.test(app),
     'y si aun así venció, se le dice al usuario en vez de dejar la pantalla muerta');
  const i = app.indexOf('function sesionVencida');
  const fn = app.slice(i, app.indexOf('\n}', i));
  ok(/_yaAvisadoVencida/.test(fn), 'una sola vez: al abrir una pantalla salen diez peticiones');
}

// ── 7. Un token vencido NO se manda ─────────────────────────────────────────
//
// El fallo que tenía a alguien golpeando la API con un token de hacía DOS
// HORAS, setenta y un veces seguidas: cuando `clerkInstance.session`
// desaparece —la pestaña durmió, se cerró sesión en otra, Clerk perdió el
// hilo— `getAuthHeaders` se quedaba con el último token que consiguió y lo
// mandaba igual. 401, sin reintento —tampoco había sesión— y nadie limpiaba
// el guardado. `uso-pantallas` late cada minuto: setenta y un minutos así.
//
// Mandar un token muerto es PEOR que no mandar ninguno: el 401 se lee como
// falta de permisos cuando lo que hay que hacer es volver a entrar.
console.log('\nUn token vencido no se manda, venga de donde venga\n');
{
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const desde = app.indexOf('function tokenYaVencio(t) {');
  const firma = 'async function getAuthHeaders({ fresh = false } = {}) {';
  const i = app.indexOf(firma);
  if (desde < 0 || i < 0) throw new Error('No encontré getAuthHeaders en app.js: revisa esta prueba');
  let prof = 0, j = i + firma.length - 1;
  for (; j < app.length; j++) {
    if (app[j] === '{') prof++;
    else if (app[j] === '}' && --prof === 0) break;
  }
  const src = app.slice(desde, j + 1);

  const correr = async ({ haySesion, guardado, daClerk, fresh = false }) => {
    const avisos = [];
    const entorno = {
      clerkReady: async () => true,
      clerkInstance: haySesion ? { session: { getToken: async () => daClerk } } : null,
      sesionVencida: (m) => avisos.push(m || 'vencida'),
      atob: globalThis.atob,
    };
    const nombres = Object.keys(entorno);
    // `sessionToken` se lee Y se escribe dentro, así que no puede ir por valor:
    // se declara en el ámbito generado y se devuelve al final.
    const cuerpo = 'let sessionToken = __inicial;\n' + src
      + '\n; return getAuthHeaders({ fresh: __fresh }).then(h => ({ h, sessionToken }));';
    const f = new Function(...nombres, '__inicial', '__fresh', cuerpo);
    const { h, sessionToken } = await f(...nombres.map((n) => entorno[n]), guardado, fresh);
    return { auth: h.Authorization || null, guardadoDespues: sessionToken, avisos };
  };

  const vivo = await token();
  const muerto = await token({ exp: Math.floor(Date.now() / 1000) - 7200 });   // dos horas

  const r1 = await correr({ haySesion: false, guardado: muerto });
  ok(r1.auth === null, 'sin sesión y con un token vencido guardado, NO se manda', String(r1.auth).slice(0, 40));
  ok(r1.guardadoDespues === null, 'y se tira el guardado, para no repetirlo cada minuto',
     String(r1.guardadoDespues).slice(0, 30));
  ok(r1.avisos.length === 1, 'y se le dice a la persona: esto no se arregla solo', String(r1.avisos.length));

  const r2 = await correr({ haySesion: false, guardado: vivo });
  ok(r2.auth === 'Bearer ' + vivo,
     'pero si el guardado sigue vivo, se manda: no hay por qué echar a nadie');
  ok(r2.avisos.length === 0, 'y sin avisar de nada');

  const r3 = await correr({ haySesion: true, guardado: null, daClerk: vivo });
  ok(r3.auth === 'Bearer ' + vivo, 'con sesión, se usa el que da Clerk');
  ok(r3.guardadoDespues === vivo, 'y se guarda para la siguiente');

  // El caso feo: hay sesión, pero Clerk devuelve uno ya vencido.
  const r4 = await correr({ haySesion: true, guardado: null, daClerk: muerto });
  ok(r4.auth === null, 'si hasta Clerk devuelve uno vencido, tampoco se manda');
  ok(r4.avisos.length === 0,
     'pero NO se avisa: hay sesión, así que el reintento con token fresco puede arreglarlo');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);
