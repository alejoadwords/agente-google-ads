// La conexión de Meta Ads, cerrada: node pruebas/meta-conexion-firmada.mjs
//
// Antes de App Review, tres agujeros:
//  1. /api/meta-auth se creía el ?userId= de la URL: con un enlace ajeno, TU
//     token de Meta —que gestiona anuncios— acababa guardado en la cuenta de
//     otro.
//  2. El callback devolvía el token en la URL (?meta_token=…).
//  3. El proxy del agente ([META_API]) ejecutaba cualquier cosa que escribiera
//     el modelo, sin sesión y con el token que mandara el navegador. A Meta le
//     decimos que todo se crea EN PAUSA: eso lo tiene que garantizar el
//     servidor.
//
// Todo se EJECUTA: los handlers reales con un JWT de verdad contra un JWKS de
// mentira y una Graph API de mentira que apunta lo que le piden.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.LINK_SECRET = 'secreto-de-prueba';
process.env.META_APP_ID = 'app';
process.env.META_APP_SECRET = 'secreto';
delete process.env.META_LOGIN_CONFIG_ID;
delete process.env.TOKENS_KEY;

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

// ── Sesiones de verdad ──────────────────────────────────────────────────────
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const par = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const JWKS = { keys: [{ ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
async function tokenDe(sub) {
  const cab = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const cuerpo = b64u(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(`${cab}.${cuerpo}`));
  return `${cab}.${cuerpo}.${b64u(new Uint8Array(firma))}`;
}

// «dueno» no tiene fila en team_members; «ventas» y «admin2» son de su equipo.
const EQUIPO = { ventas: { owner_user_id: 'dueno', role: 'ventas' }, admin2: { owner_user_id: 'dueno', role: 'admin' },
  adminCli: { owner_user_id: 'dueno', role: 'admin', client_id: 'cliA' } };
let graph = [];          // lo que se le pidió a la Graph API
let guardados = [];      // lo que se guardó en platform_connections
let guardarFalla = false;
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  if (u.includes('jwks.json')) return resp(JWKS);
  if (u.includes('/team_members')) {
    const quien = (u.match(/member_user_id=eq\.([^&]+)/) || [])[1];
    return resp(EQUIPO[quien] ? [EQUIPO[quien]] : []);
  }
  if (u.includes('/chat_agents')) return resp(u.includes('id=eq.ag1') && u.includes('user_id=eq.dueno') ? [{ id: 'ag1' }] : []);
  if (u.includes('/platform_connections')) {
    if ((init.method || 'GET') === 'POST') {
      guardados.push(JSON.parse(init.body));
      return guardarFalla ? resp({ message: 'no' }, 500) : resp(null, 201);
    }
    return resp(u.includes('user_id=eq.dueno') ? [{ access_token: 'TOKEN-DE-LA-CUENTA', account_id: 'act_1',
      token_expires_at: new Date(Date.now() + 50 * 86400000).toISOString() }] : []);
  }
  if (u.startsWith('https://graph.facebook.com')) {
    graph.push({ u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (u.includes('/oauth/access_token')) return resp({ access_token: 'TOKEN-NUEVO', expires_in: 5184000 });
    if (u.includes('/me?')) return resp({ id: 'fb1', name: 'Johana', email: 'j@x.co' });
    return resp({ data: [], id: 'nuevo' });
  }
  return resp([]);
};

const { crearEnlaceCuenta, abrirEnlaceCuenta } = await import('../api/_enlace-calendario.js');
const { default: metaAds, candadoProxy } = await import('../api/meta-ads.js');
const { default: metaAuth } = await import('../api/meta-auth.js');
const { default: metaCallback } = await import('../api/meta-callback.js');
const { default: enlace } = await import('../api/gcal-enlace.js');

function resFalsa() {
  const out = { status: 200, redirect: null, cuerpo: null };
  const res = {
    setHeader() {}, status(s) { out.status = s; return this; },
    json(b) { out.cuerpo = b; return this; }, send(b) { out.cuerpo = b; return this; }, end() { return this; },
    redirect(u) { out.redirect = u; return this; },
  };
  return { out, res };
}

// ── 1. Los candados, uno por uno ────────────────────────────────────────────
console.log('\nLo que el agente puede pedirle a Meta\n');
{
  const c = (e, m, p) => candadoProxy(e, m, p);
  ok(!c('act_1/campaigns', 'GET', {}).error, 'leer campañas, sí');
  ok(!c('act_1/insights', 'GET', { level: 'campaign' }).error, 'leer métricas, sí');
  ok(!c('120248730036960252', 'GET', {}).error, 'leer un objeto por su id, sí');
  const crear = c('act_1/campaigns', 'POST', { name: 'X', objective: 'OUTCOME_LEADS', status: 'ACTIVE' });
  ok(!crear.error && crear.params.status === 'PAUSED', 'crear una campaña pidiéndola ACTIVA: se crea EN PAUSA igual', JSON.stringify(crear));
  ok(c('act_1/adsets', 'POST', { name: 'Y' }).params?.status === 'PAUSED', 'un conjunto sin estado: en pausa');
  ok(c('act_1/ads', 'POST', { name: 'Z', status: 'ACTIVE' }).params?.status === 'PAUSED', 'un anuncio: en pausa');
  ok(!c('act_1/adcreatives', 'POST', { name: 'W' }).error, 'una pieza creativa, sí (no lleva estado)');
  ok(!!c('120248730036960252', 'POST', { status: 'ACTIVE' }).error, 'ACTIVAR algo que existe: no');
  ok(!!c('120248730036960252', 'POST', { daily_budget: 900000 }).error, 'subirle el presupuesto: no');
  ok(!!c('120248730036960252', 'POST', { status: 'ARCHIVED' }).error, 'archivarlo: no');
  ok(!c('120248730036960252', 'POST', { status: 'PAUSED' }).error, 'pausarlo: sí');
  ok(!c('120248730036960252', 'POST', { name: 'Nuevo nombre' }).error, 'renombrarlo: sí');
  ok(!!c('120248730036960252', 'DELETE', {}).error, 'borrar: no');
  ok(!!c('act_1/campaigns', 'DELETE', {}).error, 'un DELETE sobre una cuenta tampoco se cuela como creación');
  ok(!!c('act_1/customaudiences', 'POST', { name: 'lista' }).error, 'crear otra cosa (audiencias): no');
  ok(!!c('1234/subscribed_apps', 'POST', {}).error, 'suscribir o tocar páginas: no');
  ok(!!c('act_1/campaigns?access_token=x', 'GET', {}).error && !!c('../me', 'GET', {}).error && !!c('https://evil/x', 'GET', {}).error,
     'rutas raras (con query, con ../, una URL entera): no');
}

// ── 2. El proxy, ejecutado ──────────────────────────────────────────────────
console.log('\nEl proxy del agente\n');
async function proxy(sub, body) {
  graph = [];
  const { out, res } = resFalsa();
  const headers = sub ? { authorization: 'Bearer ' + await tokenDe(sub), 'content-type': 'application/json' } : {};
  await metaAds({ method: 'POST', query: {}, headers, body }, res);
  return { ...out, graph: [...graph] };
}
{
  const sin = await proxy(null, { endpoint: 'act_1/campaigns', method: 'GET', accessToken: 'ALGUNO' });
  ok(sin.status === 401 && sin.cuerpo?.error === 'No autorizado' && sin.graph.length === 0,
     'sin sesión, «No autorizado» y nada llega a Meta (antes bastaba mandar un token)', JSON.stringify(sin.cuerpo));

  const crea = await proxy('dueno', { endpoint: 'act_1/campaigns', method: 'POST', params: { name: 'X', status: 'ACTIVE' }, accessToken: 'TOKEN-DEL-NAVEGADOR' });
  const g = crea.graph[0];
  ok(crea.status === 200 && g && g.body.status === 'PAUSED', 'la campaña llega a Meta EN PAUSA', JSON.stringify(g?.body));
  ok(g && g.body.access_token === 'TOKEN-DE-LA-CUENTA', 'con el token GUARDADO de la cuenta, no el que mandó el navegador');

  const act = await proxy('dueno', { endpoint: '120248730036960252', method: 'POST', params: { status: 'ACTIVE' } });
  ok(act.status === 400 && act.graph.length === 0, 'activar: 400 y ni una llamada a Meta');

  const ven = await proxy('ventas', { endpoint: 'act_1/campaigns', method: 'GET' });
  ok(ven.graph[0]?.u.includes('TOKEN-DE-LA-CUENTA'), 'un miembro del equipo usa el token de la cuenta del dueño');

  const get = await proxy('dueno', { endpoint: 'act_1/insights', method: 'GET', params: { time_range: { since: '2026-09-01', until: '2026-09-28' } } });
  ok(get.graph[0]?.u.includes('time_range={"since":"2026-09-01","until":"2026-09-28"}'),
     'los parámetros que son objetos viajan como JSON, no como [object Object]', get.graph[0]?.u);

  const nadie = await proxy('sin_meta', { endpoint: 'act_1/campaigns', method: 'GET' });
  ok(nadie.status === 401 && nadie.cuerpo?.needsConnect === true && nadie.graph.length === 0, 'sin Meta conectado, se pide conectar');
}

// ── 3. Quién saca el enlace ─────────────────────────────────────────────────
console.log('\nEl enlace para conectar Meta\n');
async function pide(sub, para) {
  const h = sub ? { Authorization: 'Bearer ' + await tokenDe(sub) } : {};
  const r = await enlace(new Request('https://x/api/gcal-enlace' + (para ? '?para=' + para : ''), { method: 'POST', headers: h }));
  return { status: r.status, d: await r.json().catch(() => ({})) };
}
{
  const d = await pide('dueno', 'meta');
  const t = (d.d.url || '').split('?c=')[1];
  ok(d.status === 200 && d.d.url.startsWith('/api/meta-auth?c='), 'el dueño recibe un enlace a meta-auth');
  ok((await abrirEnlaceCuenta(t, 'meta'))?.userId === 'dueno', 'firmado a nombre de la cuenta');
  ok((await abrirEnlaceCuenta(t, 'calendario')) === null, 'y no sirve para conectar el calendario');
  const adm = await pide('admin2', 'meta');
  ok((await abrirEnlaceCuenta(adm.d.url.split('?c=')[1], 'meta'))?.userId === 'dueno',
     'un administrador lo conecta a nombre de la CUENTA, que es donde lo busca meta-ads');
  const ven = await pide('ventas', 'meta');
  ok(ven.status === 403 && /Meta Ads/.test(ven.d.error || ''), 'un comercial no, y el aviso habla de Meta');
  ok((await pide(null, 'meta')).status === 401, 'sin sesión, nada');
  const cal = await pide('dueno', null);
  ok(cal.d.url.startsWith('/api/gcal-auth?c='), 'sin ?para= sigue siendo el del calendario');
}

// ── 4. La entrada al OAuth y la vuelta ──────────────────────────────────────
console.log('\nmeta-auth y el callback\n');
{
  let { out, res } = resFalsa();
  await metaAuth({ query: { userId: 'victima' } }, res);
  ok(out.redirect && !out.redirect.includes('facebook.com') && out.redirect.includes('meta_error=enlace_invalido'),
     'con ?userId= suelto ya NO manda a Facebook', out.redirect);

  const t = await crearEnlaceCuenta('dueno', 'meta');
  ({ out, res } = resFalsa());
  await metaAuth({ query: { c: t } }, res);
  const st = out.redirect && JSON.parse(new URL(out.redirect).searchParams.get('state'));
  ok(out.redirect?.includes('facebook.com') && st?.c === t && !('userId' in st), 'con enlace firmado va a Facebook, con la firma en el state');

  ({ out, res } = resFalsa());
  await metaAuth({ query: { c: await crearEnlaceCuenta('dueno', 'calendario') } }, res);
  ok(!out.redirect?.includes('facebook.com'), 'un enlace de calendario no abre el de Meta');

  const vuelta = async (state, extra = {}) => {
    guardados = [];
    const r = resFalsa();
    await metaCallback({ query: { code: 'c', state: JSON.stringify(state), ...extra } }, r.res);
    return { ...r.out, guardados: [...guardados] };
  };
  const bien = await vuelta({ nonce: 'meta_ads_connect', c: t });
  ok(bien.guardados.length === 1 && bien.guardados[0].user_id === 'dueno' && bien.guardados[0].platform === 'meta_ads',
     'el camino bueno guarda a nombre de quien dice la firma');
  ok(bien.redirect?.includes('meta_connected=true') && !/meta_token|TOKEN-NUEVO/.test(bien.redirect),
     'y vuelve a la app SIN el token en la URL', bien.redirect);

  const viejo = await vuelta({ nonce: 'meta_ads_connect', userId: 'victima' });
  ok(viejo.guardados.length === 0 && viejo.redirect.includes('enlace_invalido'), 'el state de antes (userId suelto) no guarda nada: es el ataque');
  const mezcla = await vuelta({ nonce: 'meta_ads_connect', c: t, userId: 'victima' });
  ok(mezcla.guardados[0]?.user_id === 'dueno', 'si le cuelan un userId al lado, manda la firma');
  const trucado = await vuelta({ nonce: 'meta_ads_connect', c: t.replace(encodeURIComponent('dueno'), encodeURIComponent('victima')) });
  ok(trucado.guardados.length === 0, 'una firma retocada no guarda nada');

  guardarFalla = true;
  const falla = await vuelta({ nonce: 'meta_ads_connect', c: t });
  guardarFalla = false;
  ok(falla.redirect.includes('meta_error=save_failed') && !/TOKEN-NUEVO/.test(falla.redirect),
     'si no se puede guardar, se dice —y el token tampoco viaja en la URL—', falla.redirect);
}

// ── 5. El navegador ─────────────────────────────────────────────────────────
console.log('\nEl navegador\n');
{
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const cuerpo = (firma) => {
    const i = js.indexOf(firma);
    if (i < 0) throw new Error('No encontré ' + firma);
    // Desde la llave que ABRE la función (el final de la firma), no la primera
    // que aparezca: `params = {}` tiene una antes.
    let prof = 0, j = i + firma.length - 1;
    for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
    return js.slice(i, j + 1);
  };
  const llamadas = [], toasts = [];
  const win = { location: { href: '' } };
  // Desde el 29-09-2026 el botón de Meta es un atajo del genérico irAConectar,
  // que comparten Google Ads y LinkedIn.
  const ir = new Function('fetchAuth', 'showToast', 'window',
    cuerpo('async function irAConectar(para, nombre) {') + '\n' + cuerpo('function irAConectarMeta() {') + '; return irAConectarMeta;')(
    async (u, o) => { llamadas.push([u, o && o.method]); return resp({ url: '/api/meta-auth?c=FIRMA' }); },
    (t, k) => toasts.push([t, k]), win);
  await ir();
  ok(llamadas[0]?.[0] === '/api/gcal-enlace?para=meta' && llamadas[0]?.[1] === 'POST' && win.location.href === '/api/meta-auth?c=FIRMA',
     'el botón pide el enlace firmado al servidor y navega a él');
  ok(!/api\/meta-auth'\s*\+/.test(js) && !/meta-auth\?userId/.test(js), 'ya no queda ningún /api/meta-auth?userId= en app.js');

  const enviados = [];
  const sesion = { meta_access_token: 'TOKEN-EN-EL-NAVEGADOR', meta_ad_account_id: 'act_1' };
  const call = new Function('fetchAuth', 'sessionStorage', 'metaConectado', cuerpo('async function callMetaAPI(endpoint, method = \'GET\', params = {}) {') + '; return callMetaAPI;')(
    async (u, o) => { enviados.push(JSON.parse(o.body)); return resp({ data: [] }); },
    { getItem: (k) => sesion[k] || null }, () => true);
  await call('act_{AD_ACCOUNT_ID}/campaigns', 'GET', {});
  ok(enviados[0] && !('accessToken' in enviados[0]) && !JSON.stringify(enviados[0]).includes('TOKEN-EN-EL-NAVEGADOR'),
     'el agente ya no manda el token al proxy', JSON.stringify(enviados[0]));
}

{
  // Desconectar tiene que durar: antes quedaba la copia de localStorage y al
  // recargar Meta volvía a salir conectado, con un token ya revocado.
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const firma = 'function disconnectMetaAds() {';
  const i = js.indexOf(firma);
  let prof = 0, j = i + firma.length - 1;
  for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
  const mem = (ini) => { const d = { ...ini }; return { d, getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = v; }, removeItem: k => { delete d[k]; } }; };
  const ses = mem({ meta_access_token: 'T', meta_user_name: 'J' });
  const loc = mem({ meta_access_token_persist: 'T', meta_user_name_persist: 'J', meta_ad_account_id_persist: 'act_1', otra_cosa: 'x' });
  const pedidos = [];
  const marcas = [];
  new Function('sessionStorage', 'localStorage', 'updateMetaUI', 'hidePlatformDashboard', 'clerkInstance', 'fetchAuth', 'metaAccounts', 'metaActiveAccount', 'marcarMeta',
    js.slice(i, j + 1) + '; return disconnectMetaAds;')(ses, loc, () => {}, () => {}, { user: { id: 'dueno' } },
    (u, o) => { pedidos.push([u, o && o.body]); return Promise.resolve(resp({ ok: true })); }, [], null, (si) => marcas.push(si))();
  ok(marcas.includes(false), 'y quita la marca de «conectado»');
  ok(!Object.keys(ses.d).length, 'desconectar borra la sesión del navegador');
  ok(!('meta_access_token_persist' in loc.d) && !('meta_ad_account_id_persist' in loc.d) && loc.d.otra_cosa === 'x',
     'y las copias persistentes (sin tocar lo demás)', JSON.stringify(loc.d));
  ok(pedidos.some(([u, b]) => u.includes('disconnect-platform') && /meta_ads/.test(b || '')), 'y pide al servidor que borre el token');
}

// ── 6. El token ya no vive en el navegador ──────────────────────────────────
console.log('\nEl token de Meta vive en el servidor\n');
{
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // Ningún sitio vuelve a GUARDAR el token en el navegador.
  const guarda = js.match(/setItem\(\s*'meta_access_token(_persist)?'/g) || [];
  ok(guarda.length === 0, 'ningún sitio de app.js guarda el token de Meta', String(guarda.length));
  // Cada llamada a un endpoint de Meta, hasta que se cierra: ninguna lleva token.
  const llamadas = [];
  for (const m of js.matchAll(/\/api\/(meta-ads|meta-list-accounts)/g)) {
    const fin = js.indexOf('});', m.index);
    const corta = js.indexOf(');', m.index);
    llamadas.push(js.slice(m.index, Math.min(fin < 0 ? Infinity : fin, corta < 0 ? Infinity : corta, m.index + 900)));
  }
  const conToken = llamadas.filter(t => /accessToken/.test(t));
  ok(llamadas.length >= 8 && conToken.length === 0, 'ni lo manda a los endpoints de Meta (' + llamadas.length + ' llamadas revisadas)',
     conToken.map(t => t.slice(0, 90)).join(' | '));

  // La marca y la purga, ejecutadas.
  const seccion = js.slice(js.indexOf('function metaConectado() {'), js.indexOf('let metaAccounts = [];'));
  const mem = (ini) => { const d = { ...ini }; return { d, getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; };
  const ses = mem({}), loc = mem({ meta_access_token_persist: 'TOKEN-VIEJO' });
  const m = new Function('sessionStorage', 'localStorage', seccion + '; return { metaConectado, marcarMeta };')(ses, loc);
  ok(!('meta_access_token_persist' in loc.d), 'al arrancar se borra el token que quedara de antes', JSON.stringify(loc.d));
  ok(m.metaConectado() === true, 'pero se conserva que había conexión (sin parpadeo)');
  m.marcarMeta(false);
  ok(m.metaConectado() === false && !Object.keys(ses.d).length && !Object.keys(loc.d).length, 'desmarcar deja el navegador limpio');
}
{
  // meta-ads?action=status: dice si hay conexión, sin dar el token.
  const { out, res } = resFalsa();
  await metaAds({ method: 'GET', query: { action: 'status' }, headers: { authorization: 'Bearer ' + await tokenDe('dueno') } }, res);
  ok(out.cuerpo?.connected === true && !JSON.stringify(out.cuerpo).includes('TOKEN-DE-LA-CUENTA'), 'status dice «conectado» sin dar el token', JSON.stringify(out.cuerpo));
  const r2 = resFalsa();
  await metaAds({ method: 'GET', query: { action: 'status' }, headers: { authorization: 'Bearer ' + await tokenDe('sin_meta') } }, r2.res);
  ok(r2.out.cuerpo?.connected === false, 'y «no conectado» cuando no lo hay');

  // Las lecturas usan el token guardado aunque el navegador mande otro.
  graph = [];
  const r3 = resFalsa();
  await metaAds({ method: 'GET', query: { action: 'get-ad-accounts', accessToken: 'TOKEN-AJENO' }, headers: { authorization: 'Bearer ' + await tokenDe('dueno') } }, r3.res);
  ok(graph[0]?.u.includes('TOKEN-DE-LA-CUENTA') && !graph.some(g => g.u.includes('TOKEN-AJENO')), 'un token mandado por el navegador se ignora');
}
{
  // meta-list-accounts: antes sin sesión y con el token del cuerpo.
  const { default: lista } = await import('../api/meta-list-accounts.js');
  graph = [];
  const sin = await lista(new Request('https://x/api/meta-list-accounts', { method: 'POST', body: JSON.stringify({ accessToken: 'ALGUNO' }) }));
  ok(sin.status === 401 && graph.length === 0, 'la lista de cuentas sin sesión: 401 y nada llega a Meta (antes era un relé abierto)');
  const con = await lista(new Request('https://x/api/meta-list-accounts', { method: 'POST', headers: { Authorization: 'Bearer ' + await tokenDe('ventas') }, body: JSON.stringify({ accessToken: 'TOKEN-AJENO' }) }));
  ok(con.status === 200 && graph[0]?.u.includes('TOKEN-DE-LA-CUENTA') && !graph.some(g => g.u.includes('TOKEN-AJENO')),
     'con sesión usa el token guardado de la cuenta, no el que manda el navegador');
}
{
  // refresh-meta-token renueva en el servidor y NO devuelve el token.
  const { default: refrescar } = await import('../api/refresh-meta-token.js');
  const src = readFileSync(new URL('../api/refresh-meta-token.js', import.meta.url), 'utf8');
  ok(!/json\(\{[^}]*access_token/.test(src), 'refresh-meta-token no devuelve el token en ninguna respuesta');
  const { out, res } = resFalsa();
  await refrescar({ method: 'GET', query: {}, headers: { authorization: 'Bearer ' + await tokenDe('dueno') } }, res);
  ok(out.cuerpo?.ok === true && !JSON.stringify(out.cuerpo || {}).includes('TOKEN-DE-LA-CUENTA'), 'y ejecutado, tampoco', JSON.stringify(out.cuerpo));
}
{
  // admin get-connection: para Meta, sin el token (salvo el backoffice).
  const src = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
  // Desde el 29-09-2026 la lista incluye Google Ads y LinkedIn; se ejecuta de
  // verdad en pruebas/google-linkedin-sin-token.mjs.
  ok(/SIN_TOKEN_AL_NAVEGADOR = new Set\(\[[^\]]*'meta_ads'/.test(src) && /const sinToken = SIN_TOKEN_AL_NAVEGADOR\.has\(platform\) && !authCheck\(req\);/.test(src) && /\.\.\.\(sinToken \? \{\} : \{ access_token: c\.access_token \}\)/.test(src),
     'get-connection de Meta ya no da el token al navegador');
}

// ── 7. WhatsApp ─────────────────────────────────────────────────────────────
// El mismo agujero: userId, agente y cliente viajaban sueltos en la URL.
console.log('\nConectar WhatsApp\n');
{
  const { crearEnlaceWhatsapp, abrirEnlaceWhatsapp } = await import('../api/_enlace-calendario.js');
  const t = await crearEnlaceWhatsapp('dueno', 'ag1', 'cliA');
  const a = await abrirEnlaceWhatsapp(t);
  ok(a && a.userId === 'dueno' && a.agentId === 'ag1' && a.clientId === 'cliA', 'la firma lleva cuenta, agente y cliente');
  ok((await abrirEnlaceWhatsapp(t.replace('ag1', 'ag9'))) === null, 'cambiar el agente rompe la firma');
  ok((await abrirEnlaceWhatsapp(t.replace('cliA', 'cliB'))) === null, 'cambiar el cliente también');
  ok((await abrirEnlaceWhatsapp(await crearEnlaceCuenta('dueno', 'meta'))) === null, 'un enlace de Meta Ads no sirve para WhatsApp');

  const pideWa = async (sub, body) => {
    const r = await enlace(new Request('https://x/api/gcal-enlace?para=whatsapp', { method: 'POST',
      headers: { Authorization: 'Bearer ' + await tokenDe(sub), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const bien = await pideWa('dueno', { agentId: 'ag1', clientId: 'cliA' });
  const f = await abrirEnlaceWhatsapp((bien.d.url || '').split('?c=')[1]);
  ok(bien.d.url?.startsWith('/api/whatsapp-auth?c=') && f?.userId === 'dueno' && f?.agentId === 'ag1', 'el dueño recibe el enlace, con su agente dentro');
  ok((await pideWa('dueno', { agentId: 'agente-ajeno' })).status === 404, 'un agente que no es de la cuenta: no');
  ok((await pideWa('ventas', {})).status === 403, 'un comercial no conecta números');
  ok((await pideWa('adminCli', { clientId: 'cliB' })).status === 403, 'un admin acotado a un cliente no conecta para otro');
  const acot = await pideWa('adminCli', {});
  ok((await abrirEnlaceWhatsapp(acot.d.url.split('?c=')[1]))?.clientId === 'cliA', 'y lo suyo queda firmado a SU cliente');

  const { default: waAuth } = await import('../api/whatsapp-auth.js');
  process.env.META_WA_CONFIG_ID = 'cfg';
  let r = resFalsa();
  await waAuth({ query: { userId: 'victima', agentId: 'x' } }, r.res);
  ok(r.out.redirect && !r.out.redirect.includes('facebook.com') && r.out.redirect.includes('wa_error'), 'whatsapp-auth con userId suelto ya no manda a Facebook', r.out.redirect);
  r = resFalsa();
  await waAuth({ query: { c: t } }, r.res);
  ok(r.out.redirect?.includes('facebook.com') && JSON.parse(new URL(r.out.redirect).searchParams.get('state')).c === t, 'con el enlace firmado, sí');

  const { default: waCallback } = await import('../api/whatsapp-callback.js');
  graph = [];
  r = resFalsa();
  await waCallback({ query: { code: 'c', state: JSON.stringify({ nonce: 'whatsapp_connect', userId: 'victima', agentId: 'x' }) } }, r.res);
  ok(r.out.redirect?.includes('wa_error') && !graph.some(g => g.u.includes('oauth/access_token')), 'la vuelta con el state de antes no toca Meta ni guarda nada', r.out.redirect);
  graph = [];
  r = resFalsa();
  await waCallback({ query: { code: 'c', state: JSON.stringify({ nonce: 'whatsapp_connect', c: t }) } }, r.res);
  ok(graph.some(g => g.u.includes('oauth/access_token')), 'con la firma, sigue adelante');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
