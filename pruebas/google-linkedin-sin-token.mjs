// Google Ads y LinkedIn, sin token en el navegador: node pruebas/google-linkedin-sin-token.mjs
//
// Lo mismo que se cerró en Meta el 28-09-2026, y en Google peor:
//  1. /api/google-ads-auth y /api/linkedin-auth se creían el ?userId= de la
//     URL: con un enlace ajeno, TU cuenta publicitaria quedaba en la de otro.
//  2. El callback de Google devolvía en la URL el token de acceso Y el de
//     renovación —que no caduca—; el de LinkedIn, el suyo. Acababan en el
//     historial, en los registros y en sessionStorage.
//  3. google-ads, refresh-google-token y get-connection le daban el token al
//     navegador, y aceptaban el que el navegador mandara.
//  4. /api/list-accounts y /api/linkedin-ads no pedían sesión: el primero,
//     con el userId de cualquiera, listaba SUS cuentas con SU token guardado.
//  5. LinkedIn guardaba el token sin cifrar.
//
// Todo se EJECUTA: los handlers reales con un JWT de verdad contra un JWKS de
// mentira, y un Google y un LinkedIn de mentira que apuntan qué token les llega.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.LINK_SECRET = 'secreto-de-prueba';
process.env.GOOGLE_CLIENT_ID = 'gid';
process.env.GOOGLE_CLIENT_SECRET = 'gsecreto';
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev';
process.env.LINKEDIN_CLIENT_ID = 'lid';
process.env.LINKEDIN_CLIENT_SECRET = 'lsecreto';
process.env.ADMIN_SECRET = 'secreto-admin';
delete process.env.GOOGLE_ADS_MCC_ID;
// Con llave: así se ve si lo que se guarda va cifrado.
process.env.TOKENS_KEY = Buffer.alloc(32, 7).toString('base64');

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

// ── El mundo de mentira ─────────────────────────────────────────────────────
// «dueno» no tiene fila en team_members; «ventas» y «admin2» son de su equipo.
const EQUIPO = { ventas: { owner_user_id: 'dueno', role: 'ventas' }, admin2: { owner_user_id: 'dueno', role: 'admin' } };
const enUnaHora = () => new Date(Date.now() + 3600e3).toISOString();
let BD = {};              // platform_connections: 'usuario|plataforma' → fila
let guardados = [];       // POST a platform_connections
let parches = [];         // PATCH a platform_connections
let guardarFalla = false;
let fuera = [];           // lo que se le pidió a Google / LinkedIn, con el token que llevaba
let renovaciones = 0;
function reiniciar() {
  BD = {
    'dueno|google_ads': { access_token: 'TOKEN-GUARDADO', refresh_token: 'REFRESH-GUARDADO', token_expires_at: enUnaHora(), account_id: '111' },
    'dueno|linkedin_ads': { access_token: 'LI-GUARDADO', account_name: 'Johana', token_expires_at: enUnaHora() },
  };
  guardados = []; parches = []; guardarFalla = false; fuera = []; renovaciones = 0;
}
reiniciar();

globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const m = init.method || 'GET';
  const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
  if (u.includes('jwks.json')) return resp(JWKS);
  if (u.includes('/team_members')) {
    const quien = (u.match(/member_user_id=eq\.([^&]+)/) || [])[1];
    return resp(EQUIPO[quien] ? [EQUIPO[quien]] : []);
  }
  if (u.includes('/platform_connections')) {
    if (m === 'POST') {
      guardados.push(JSON.parse(init.body));
      return guardarFalla ? resp({ message: 'no' }, 500) : resp(null, 201);
    }
    if (m === 'PATCH') { parches.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    if (m === 'DELETE') return resp([]);
    const usuario = (u.match(/user_id=eq\.([^&]+)/) || [])[1];
    const plataforma = (u.match(/platform=eq\.([^&]+)/) || [])[1];
    const fila = BD[usuario + '|' + plataforma];
    return resp(fila ? [{ platform: plataforma, ...fila }] : []);
  }
  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    const p = new URLSearchParams(init.body);
    if (p.get('grant_type') === 'refresh_token') { renovaciones++; return resp({ access_token: 'TOKEN-RENOVADO', expires_in: 3600 }); }
    return resp({ access_token: 'TOKEN-OAUTH-NUEVO', refresh_token: 'REFRESH-OAUTH-NUEVO', expires_in: 3600 });
  }
  if (u.includes('googleapis.com/oauth2/v2/userinfo')) return resp({ email: 'johana@x.co' });
  if (u.startsWith('https://googleads.googleapis.com')) {
    fuera.push({ u, auth });
    if (u.includes('listAccessibleCustomers')) return resp({ resourceNames: ['customers/111'] });
    return resp({ results: [] });
  }
  if (u.startsWith('https://www.linkedin.com/oauth/v2/accessToken')) return resp({ access_token: 'LI-OAUTH-NUEVO', expires_in: 5184000 });
  if (u.startsWith('https://api.linkedin.com')) {
    fuera.push({ u, auth });
    if (u.includes('/userinfo')) return resp({ given_name: 'Johana', family_name: 'P', email: 'j@x.co', sub: 'li1' });
    return resp({ elements: [{ id: 9, name: 'Cuenta LI' }] });
  }
  return resp([]);
};

const { crearEnlaceCuenta, abrirEnlaceCuenta } = await import('../api/_enlace-calendario.js');
const { default: enlace } = await import('../api/gcal-enlace.js');
const { default: gAuth } = await import('../api/google-ads-auth.js');
const { default: gCallback } = await import('../api/oauth/callback.js');
const { default: liAuth } = await import('../api/linkedin-auth.js');
const { default: liCallback } = await import('../api/linkedin-callback.js');
const { default: googleAds, tokenVigente } = await import('../api/google-ads.js');
const { default: refrescarGoogle } = await import('../api/refresh-google-token.js');
const { default: listaGoogle } = await import('../api/list-accounts.js');
const { default: liAds } = await import('../api/linkedin-ads.js');
const { default: admin } = await import('../api/admin.js');

function resFalsa() {
  const out = { status: 200, redirect: null, cuerpo: null };
  const res = {
    setHeader() {}, status(s) { out.status = s; return this; },
    json(b) { out.cuerpo = b; return this; }, send(b) { out.cuerpo = b; return this; }, end() { return this; },
    redirect(u) { out.redirect = u; return this; },
  };
  return { out, res };
}
async function nodo(handler, { sub, method = 'POST', query = {}, body, headers = {} } = {}) {
  const { out, res } = resFalsa();
  const h = { ...headers };
  if (sub) h.authorization = 'Bearer ' + await tokenDe(sub);
  await handler({ method, query, headers: h, body }, res);
  return out;
}
const soloTokens = (s) => /TOKEN-GUARDADO|REFRESH-GUARDADO|TOKEN-RENOVADO|LI-GUARDADO|TOKEN-OAUTH-NUEVO|REFRESH-OAUTH-NUEVO|LI-OAUTH-NUEVO/.test(String(s));

// ── 1. El enlace firmado ────────────────────────────────────────────────────
console.log('\nEl enlace firmado\n');
{
  const pide = async (sub, para) => {
    const r = await enlace(new Request('https://x/api/gcal-enlace?para=' + para, {
      method: 'POST', headers: sub ? { Authorization: 'Bearer ' + await tokenDe(sub) } : {},
    }));
    return { status: r.status, d: await r.json() };
  };
  const g = await pide('admin2', 'google');
  ok(g.status === 200 && g.d.url.startsWith('/api/google-ads-auth?c='), 'Google Ads: el servidor firma y manda a google-ads-auth', JSON.stringify(g.d));
  const cG = new URL('https://x' + g.d.url).searchParams.get('c');
  ok((await abrirEnlaceCuenta(cG, 'google'))?.userId === 'dueno', 'a nombre de la CUENTA (el dueño), no del miembro que lo pulsó');
  ok(!(await abrirEnlaceCuenta(cG, 'meta')) && !(await abrirEnlaceCuenta(cG, 'linkedin')) && !(await abrirEnlaceCuenta(cG, 'calendario')),
     'y no sirve para conectar Meta, LinkedIn ni el calendario');
  const l = await pide('dueno', 'linkedin');
  ok(l.status === 200 && l.d.url.startsWith('/api/linkedin-auth?c='), 'LinkedIn: igual, a linkedin-auth');
  const v = await pide('ventas', 'google');
  ok(v.status === 403 && /Google Ads/.test(v.d.error || ''), 'un comercial no, y el aviso habla de Google Ads', JSON.stringify(v.d));
  const v2 = await pide('ventas', 'linkedin');
  ok(v2.status === 403 && /LinkedIn/.test(v2.d.error || ''), 'y el de LinkedIn habla de LinkedIn', JSON.stringify(v2.d));
  ok((await pide(null, 'google')).status === 401, 'sin sesión, nada');
}

// ── 2. Google Ads: auth y callback ──────────────────────────────────────────
console.log('\nGoogle Ads: la ida y la vuelta de OAuth\n');
const stateDe = (redirect) => JSON.parse(new URL(redirect).searchParams.get('state'));
{
  reiniciar();
  const suelto = await nodo(gAuth, { method: 'GET', query: { userId: 'dueno' } });
  ok(/ads_error=enlace_invalido/.test(suelto.redirect || '') && !/accounts\.google\.com/.test(suelto.redirect || ''),
     'con ?userId= suelto ya NO manda a Google', suelto.redirect);
  const c = await crearEnlaceCuenta('dueno', 'google');
  const va = await nodo(gAuth, { method: 'GET', query: { c } });
  ok(/^https:\/\/accounts\.google\.com/.test(va.redirect || '') && stateDe(va.redirect).c === c && !('userId' in stateDe(va.redirect)),
     'con enlace firmado va a Google, con la firma en el state y sin userId', va.redirect);
  const cCal = await crearEnlaceCuenta('dueno', 'calendario');
  ok(/enlace_invalido/.test((await nodo(gAuth, { method: 'GET', query: { c: cCal } })).redirect || ''), 'un enlace del calendario no abre el de Google Ads');

  const vuelta = await nodo(gCallback, { method: 'GET', query: { code: 'COD', state: JSON.stringify({ c }) } });
  const g0 = guardados[0] || {};
  ok(g0.user_id === 'dueno' && g0.platform === 'google_ads', 'el camino bueno guarda a nombre de quien dice la firma', JSON.stringify(g0).slice(0, 120));
  ok(String(g0.access_token).startsWith('enc:v1:') && String(g0.refresh_token).startsWith('enc:v1:'), 'con los dos tokens cifrados');
  ok(/ads_connected=true/.test(vuelta.redirect || '') && !soloTokens(vuelta.redirect) && !/ads_token|ads_refresh|uid=/.test(vuelta.redirect),
     'y vuelve a la app SIN tokens ni uid en la URL', vuelta.redirect);

  reiniciar();
  const ataque = await nodo(gCallback, { method: 'GET', query: { code: 'COD', state: JSON.stringify({ nonce: 'google_ads_connect', userId: 'victima' }) } });
  ok(guardados.length === 0 && /enlace_invalido/.test(ataque.redirect || ''), 'el state de antes (userId suelto) no guarda nada: es el ataque', ataque.redirect);
  reiniciar();
  await nodo(gCallback, { method: 'GET', query: { code: 'COD', state: JSON.stringify({ c, userId: 'victima' }) } });
  ok(guardados[0]?.user_id === 'dueno', 'si le cuelan un userId al lado, manda la firma');
  reiniciar();
  const retocada = c.slice(0, -2) + (c.endsWith('AA') ? 'BB' : 'AA');
  await nodo(gCallback, { method: 'GET', query: { code: 'COD', state: JSON.stringify({ c: retocada }) } });
  ok(guardados.length === 0, 'una firma retocada no guarda nada');
  reiniciar(); guardarFalla = true;
  const falla = await nodo(gCallback, { method: 'GET', query: { code: 'COD', state: JSON.stringify({ c }) } });
  ok(/ads_error=save_failed/.test(falla.redirect || '') && !soloTokens(falla.redirect),
     'si no se puede guardar, se dice —y el token tampoco viaja en la URL—', falla.redirect);
}

// ── 3. LinkedIn: auth y callback ────────────────────────────────────────────
console.log('\nLinkedIn: la ida y la vuelta de OAuth\n');
{
  reiniciar();
  const suelto = await nodo(liAuth, { method: 'GET', query: { userId: 'dueno' } });
  ok(/linkedin_error=enlace_invalido/.test(suelto.redirect || ''), 'con ?userId= suelto ya NO manda a LinkedIn', suelto.redirect);
  const c = await crearEnlaceCuenta('dueno', 'linkedin');
  const va = await nodo(liAuth, { method: 'GET', query: { c } });
  ok(/^https:\/\/www\.linkedin\.com/.test(va.redirect || '') && stateDe(va.redirect).c === c, 'con enlace firmado va a LinkedIn');
  const vuelta = await nodo(liCallback, { method: 'GET', query: { code: 'COD', state: JSON.stringify({ c }) } });
  const g0 = guardados[0] || {};
  ok(g0.user_id === 'dueno' && String(g0.access_token).startsWith('enc:v1:'), 'guarda a nombre de la firma y CIFRADO (antes iba en claro)', JSON.stringify(g0).slice(0, 120));
  ok(/linkedin_connected=true/.test(vuelta.redirect || '') && !soloTokens(vuelta.redirect) && !/linkedin_token/.test(vuelta.redirect),
     'y vuelve SIN el token en la URL', vuelta.redirect);
  reiniciar();
  await nodo(liCallback, { method: 'GET', query: { code: 'COD', state: JSON.stringify({ userId: 'victima' }) } });
  ok(guardados.length === 0, 'el state de antes no guarda nada');
  reiniciar(); guardarFalla = true;
  const falla = await nodo(liCallback, { method: 'GET', query: { code: 'COD', state: JSON.stringify({ c }) } });
  ok(/linkedin_error=save_failed/.test(falla.redirect || ''), 'si no se puede guardar, se dice', falla.redirect);
}

// ── 4. google-ads: solo el token guardado ───────────────────────────────────
console.log('\nEl proxy de Google Ads\n');
{
  reiniciar();
  const leg = await nodo(googleAds, { sub: 'dueno', body: { customerId: '111', query: 'SELECT campaign.id FROM campaign', accessToken: 'TOKEN-AJENO' } });
  ok(fuera.length > 0 && fuera.every(f => f.auth === 'Bearer TOKEN-GUARDADO'), 'la consulta del agente usa el token guardado aunque el navegador mande otro',
     fuera.map(f => f.auth).join(','));
  ok(!JSON.stringify(leg.cuerpo).includes('TOKEN') && !('_refreshedToken' in (leg.cuerpo || {})), 'y no devuelve ningún token', JSON.stringify(leg.cuerpo));

  reiniciar();
  await nodo(googleAds, { sub: 'ventas', method: 'GET', query: { action: 'get-campaigns', customerId: '111', accessToken: 'TOKEN-AJENO' } });
  ok(fuera.length > 0 && !fuera.some(f => f.auth.includes('AJENO')), 'las acciones ignoran ?accessToken= (y un miembro trabaja con el de la cuenta)',
     fuera.map(f => f.auth).join(','));

  reiniciar();
  BD['dueno|google_ads'].token_expires_at = new Date(Date.now() + 60e3).toISOString();
  await nodo(googleAds, { sub: 'dueno', method: 'GET', query: { action: 'get-campaigns', customerId: '111' } });
  ok(renovaciones === 1 && fuera[0]?.auth === 'Bearer TOKEN-RENOVADO' && String(parches[0]?.access_token).startsWith('enc:v1:'),
     'si al token le queda menos de 5 min, se renueva ANTES de usarlo y se guarda cifrado', `renov=${renovaciones} auth=${fuera[0]?.auth}`);

  reiniciar();
  const st = await nodo(googleAds, { sub: 'dueno', method: 'GET', query: { action: 'status' } });
  ok(st.cuerpo?.connected === true && st.cuerpo?.puede_renovar === true && !soloTokens(JSON.stringify(st.cuerpo)), 'status dice «conectado» sin dar el token', JSON.stringify(st.cuerpo));
  const st2 = await nodo(googleAds, { sub: 'sin_google', method: 'GET', query: { action: 'status' } });
  ok(st2.cuerpo?.connected === false, 'y «no conectado» cuando no lo hay');
  const nada = await nodo(googleAds, { sub: 'sin_google', method: 'GET', query: { action: 'get-campaigns', customerId: '111', accessToken: 'TOKEN-AJENO' } });
  ok(nada.status === 401 && nada.cuerpo?.needsConnect && fuera.length === 0, 'sin conexión guardada, un token del navegador no abre nada', JSON.stringify(nada.cuerpo));
  const sin = await nodo(googleAds, { method: 'GET', query: { action: 'status' } });
  ok(sin.status === 401, 'sin sesión, 401');

  reiniciar();
  BD['dueno|google_ads'] = { access_token: 'TOKEN-GUARDADO', refresh_token: null, token_expires_at: new Date(Date.now() - 1e3).toISOString() };
  const v = await tokenVigente('dueno');
  ok(v.token === 'TOKEN-GUARDADO' && renovaciones === 0, 'sin refresh_token se intenta con el que hay (si ya no vale, lo dirá el 401)');
  BD['dueno|google_ads'] = { access_token: null, refresh_token: null };
  const v2 = await tokenVigente('dueno');
  ok(!v2.token && v2.needsConnect, 'y sin nada, «conecta Google Ads»', JSON.stringify(v2));
}

// ── 5. Renovar, listar y get-connection: sin token de vuelta ────────────────
console.log('\nNingún camino le devuelve el token al navegador\n');
{
  reiniciar();
  const r = await nodo(refrescarGoogle, { sub: 'dueno', body: {} });
  ok(r.cuerpo?.ok === true && !soloTokens(JSON.stringify(r.cuerpo)), 'refresh-google-token: vigente, sin token', JSON.stringify(r.cuerpo));
  BD['dueno|google_ads'].token_expires_at = new Date(Date.now() - 1e3).toISOString();
  const r2 = await nodo(refrescarGoogle, { sub: 'dueno', body: {} });
  ok(r2.cuerpo?.ok === true && r2.cuerpo?.refreshed === true && renovaciones === 1 && !soloTokens(JSON.stringify(r2.cuerpo)),
     'y renovado, tampoco', JSON.stringify(r2.cuerpo));

  for (const plataforma of ['google_ads', 'linkedin_ads']) {
    reiniciar();
    const gc = await nodo(admin, { sub: 'dueno', method: 'GET', query: { action: 'get-connection', platform: plataforma } });
    ok(gc.cuerpo?.connected === true && !('access_token' in (gc.cuerpo || {})), `get-connection de ${plataforma}: «conectado», sin el token`, JSON.stringify(gc.cuerpo));
  }
  reiniciar();
  const bo = await nodo(admin, { method: 'GET', query: { action: 'get-connection', platform: 'google_ads', userId: 'dueno' }, headers: { 'x-admin-secret': 'secreto-admin' } });
  ok(bo.cuerpo?.access_token === 'TOKEN-GUARDADO', 'el backoffice, con su secreto, lo sigue recibiendo');

  reiniciar();
  const sc = await nodo(admin, { sub: 'dueno', query: { action: 'save-connection' },
    body: { platform: 'google_ads', access_token: 'TOKEN-INVENTADO', refresh_token: 'R' } });
  ok(sc.status === 403 && guardados.length === 0, 'save-connection desde la app ya no guarda un token que no salió de nuestro OAuth', JSON.stringify(sc.cuerpo));
  const scBo = await nodo(admin, { query: { action: 'save-connection' }, headers: { 'x-admin-secret': 'secreto-admin' },
    body: { userId: 'dueno', platform: 'google_ads', access_token: 'TOKEN-DEL-PANEL', refresh_token: 'R' } });
  ok(scBo.status === 200 && String(guardados[0]?.access_token).startsWith('enc:v1:'), 'el backoffice sí, y ahora se guarda cifrado', JSON.stringify(guardados[0]).slice(0, 100));

  reiniciar();
  const la0 = await nodo(listaGoogle, { body: { userId: 'dueno', accessToken: 'TOKEN-AJENO' } });
  ok(la0.status === 401 && fuera.length === 0, 'list-accounts sin sesión: 401, aunque traiga un userId (antes listaba SUS cuentas)', JSON.stringify(la0.cuerpo));
  const la = await nodo(listaGoogle, { sub: 'admin2', body: { userId: 'victima', accessToken: 'TOKEN-AJENO' } });
  ok(fuera.length > 0 && fuera.every(f => f.auth === 'Bearer TOKEN-GUARDADO') && !soloTokens(JSON.stringify(la.cuerpo)),
     'con sesión: la cuenta sale de la sesión, el token es el guardado y no vuelve', fuera.map(f => f.auth).join(','));
  const la2 = await nodo(listaGoogle, { sub: 'sin_google', body: {} });
  ok(la2.status === 401 && la2.cuerpo?.needsConnect, 'sin Google conectado lo dice, para que la pantalla deje de pintar «conectado»');
}

// ── 6. linkedin-ads ─────────────────────────────────────────────────────────
console.log('\nEl proxy de LinkedIn\n');
{
  reiniciar();
  const llama = async (sub, body) => {
    const r = await liAds(new Request('https://x/api/linkedin-ads', {
      method: 'POST', headers: sub ? { Authorization: 'Bearer ' + await tokenDe(sub) } : {}, body: JSON.stringify(body),
    }));
    return { status: r.status, d: await r.json() };
  };
  const sin = await llama(null, { action: 'list-accounts', accessToken: 'ALGUNO' });
  ok(sin.status === 401 && fuera.length === 0, 'sin sesión: 401 y nada llega a LinkedIn (antes era un relé abierto)');
  const con = await llama('ventas', { action: 'list-accounts', accessToken: 'TOKEN-AJENO' });
  ok(con.status === 200 && con.d.accounts?.length === 1 && fuera.every(f => f.auth === 'Bearer LI-GUARDADO'),
     'con sesión usa el token guardado de la cuenta, no el del navegador', fuera.map(f => f.auth).join(','));
  const st = await llama('dueno', { action: 'status' });
  ok(st.d.connected === true && st.d.name === 'Johana' && !soloTokens(JSON.stringify(st.d)), 'status: conectado, sin token', JSON.stringify(st.d));
  const nada = await llama('sin_li', { action: 'list-accounts', accessToken: 'TOKEN-AJENO' });
  ok(nada.status === 401 && nada.d.needsConnect, 'sin conexión, «conecta LinkedIn», aunque el navegador traiga un token');
}

// ── 7. El navegador ─────────────────────────────────────────────────────────
console.log('\nEl navegador\n');
{
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const cuerpo = (firma) => {
    const i = js.indexOf(firma);
    if (i < 0) throw new Error('No encontré ' + firma);
    let prof = 0, j = i + firma.length - 1;
    for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
    return js.slice(i, j + 1);
  };
  const mem = (ini) => { const d = { ...ini }; return { d, getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; };

  // Los botones piden el enlace firmado.
  for (const [fn, para, destino] of [['connectLinkedInAds', 'linkedin', '/api/linkedin-auth?c=F']]) {
    const llamadas = [], win = { location: { href: '' } };
    const f = new Function('fetchAuth', 'showToast', 'window',
      cuerpo('async function irAConectar(para, nombre) {') + '\n' + cuerpo(`function ${fn}() {`) + `; return ${fn};`)(
      async (u, o) => { llamadas.push([u, o && o.method]); return resp({ url: destino }); }, () => {}, win);
    await f();
    ok(llamadas[0]?.[0] === '/api/gcal-enlace?para=' + para && win.location.href === destino, `${fn}: pide el enlace firmado y navega a él`);
  }
  {
    const llamadas = [], win = { location: { href: '' } };
    const f = new Function('fetchAuth', 'showToast', 'window', 'userPlan', 'isAdminUser', 'metaConectado', 'openUpgradeFlow',
      cuerpo('async function irAConectar(para, nombre) {') + '\n' + cuerpo('function connectGoogleAds() {') + '; return connectGoogleAds;')(
      async (u, o) => { llamadas.push([u, o && o.method]); return resp({ url: '/api/google-ads-auth?c=F' }); }, () => {}, win, 'pro', () => false, () => false, () => {});
    await f();
    ok(llamadas[0]?.[0] === '/api/gcal-enlace?para=google' && win.location.href === '/api/google-ads-auth?c=F', 'connectGoogleAds: pide el enlace firmado y navega a él');
    const toasts = [];
    const g = new Function('fetchAuth', 'showToast', 'window', cuerpo('async function irAConectar(para, nombre) {') + '; return irAConectar;')(
      async () => resp({ error: 'Solo el administrador de la cuenta conecta Google Ads.' }, 403), (t, k) => toasts.push([t, k]), { location: { href: '' } });
    await g('google', 'Google Ads');
    ok(toasts[0]?.[1] === 'error' && /Solo el administrador/.test(toasts[0][0]), 'si el servidor no firma, se dice con su motivo', JSON.stringify(toasts));
  }
  ok(!/google-ads-auth'\s*\+|google-ads-auth\?userId|linkedin-auth'\s*\+|linkedin-auth\?userId/.test(js), 'ya no queda ningún ?userId= hacia los OAuth en app.js');

  // Nada guarda ni manda un token.
  ok(!/setItem\('(ads_access_token|ads_refresh_token|linkedin_access_token)/.test(js), 'nadie guarda un token de Google o LinkedIn en el navegador');
  ok(!/accessToken:|[?&]accessToken=|_refreshedToken/.test(js), 'ni lo manda en ninguna petición ni espera uno renovado');
  ok(!/params\.get\('(ads_token|ads_refresh|linkedin_token)'\)/.test(js), 'ni lo lee de la URL de vuelta');

  // La consulta del agente, ejecutada.
  const enviados = [];
  const q = new Function('fetchAuth', 'sessionStorage', 'localStorage', 'clerkInstance', 'marcarAds', 'updateAdsUI',
    cuerpo('async function queryGoogleAds(gaqlQuery) {') + '; return queryGoogleAds;')(
    async (u, o) => { enviados.push(JSON.parse(o.body)); return resp({ results: [], _refreshedToken: 'X' }); },
    mem({ ads_customer_id: '111', ads_access_token: 'TOKEN-EN-EL-NAVEGADOR' }), mem({}), { user: { id: 'dueno' } }, () => {}, () => {});
  await q('SELECT campaign.id FROM campaign');
  ok(enviados[0]?.customerId === '111' && !JSON.stringify(enviados[0]).includes('TOKEN') && !('userId' in enviados[0]),
     'queryGoogleAds manda la cuenta y la consulta, nada más', JSON.stringify(enviados[0]));

  // Las marcas y la purga, ejecutadas.
  for (const [ini, fin, marca, funcs, viejo] of [
    ['function adsConectado() {', '(function checkAdsCallback() {', 'adsConectado', 'marcarAds', { ads_access_token_persist: 'T', ads_refresh_token_persist: 'R' }],
    ['function liConectado() {', '(function checkLinkedInCallback() {', 'liConectado', 'marcarLi', { linkedin_access_token_persist: 'T' }],
  ]) {
    const seccion = js.slice(js.indexOf(ini), js.indexOf(fin));
    const ses = mem({}), loc = mem(viejo);
    const f = new Function('sessionStorage', 'localStorage', seccion + `; return { ${marca}, ${funcs} };`)(ses, loc);
    ok(!Object.keys(viejo).some(k => k in loc.d), `${marca}: al arrancar se borra el token que quedara de antes`, JSON.stringify(loc.d));
    ok(f[marca]() === true, `${marca}: pero se conserva que había conexión (sin parpadeo)`);
    f[funcs](false);
    ok(f[marca]() === false && !Object.keys(ses.d).length && !Object.keys(loc.d).length, `${funcs}(false) deja el navegador limpio`);
  }
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
