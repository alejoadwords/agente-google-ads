// Conectar el Google de la CUENTA exige firma: node pruebas/gcal-cuenta-firmada.mjs
//
// El agujero: /api/gcal-auth?userId=<cualquiera> y el callback guardaba la
// conexión a nombre de ese userId sin mirar nada. Quien conociera el id de
// Clerk de otra cuenta le colgaba SU Google, y las reuniones de la Agenda y las
// reservas —con nombre, teléfono y correo del cliente— se escribían en el
// calendario del atacante. YouTube compartía callback y el mismo agujero.
//
// Todo se EJECUTA: el endpoint que firma (con un JWT de verdad contra un JWKS
// de mentira), gcal-auth, yt-auth, el callback con states manipulados, y la
// función del navegador.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.LINK_SECRET = 'secreto-de-prueba';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
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

// Cuentas: «dueno» sin fila en team_members; «ventas» y «admin2» son de su equipo.
const EQUIPO = { ventas: { owner_user_id: 'dueno', role: 'ventas' }, admin2: { owner_user_id: 'dueno', role: 'admin' } };
const guardados = [];
let googleBien = true;
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  if (u.includes('jwks.json')) return resp(JWKS);
  if (u.includes('/team_members')) {
    const quien = (u.match(/member_user_id=eq\.([^&]+)/) || [])[1];
    return resp(EQUIPO[quien] ? [EQUIPO[quien]] : []);
  }
  if (u.startsWith('https://oauth2.googleapis.com/token')) return resp({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
  if (u.includes('/oauth2/v2/userinfo')) return resp({ email: 'atacante@x.co' });
  if (u.includes('/platform_connections')) { guardados.push(JSON.parse(init.body)); return resp(null, 201); }
  return resp([]);
};

const { crearEnlaceCuenta, abrirEnlaceCuenta, crearEnlaceCalendario } = await import('../api/_enlace-calendario.js');
const { default: enlaceHandler } = await import('../api/gcal-enlace.js');
const { default: gcalAuth } = await import('../api/gcal-auth.js');
const { default: ytAuth } = await import('../api/yt-auth.js');
const { default: callback } = await import('../api/oauth/gcal-callback.js');

function resFalsa() {
  const out = { status: 200, redirect: null, cuerpo: null };
  const res = {
    setHeader() {}, status(s) { out.status = s; return this; },
    send(b) { out.cuerpo = b; return this; }, json(b) { out.cuerpo = b; return this; },
    redirect(u) { out.redirect = u; return this; },
  };
  return { out, res };
}
async function correCallback(state, extra = {}) {
  guardados.length = 0;
  const { out, res } = resFalsa();
  await callback({ query: { code: 'c', state: JSON.stringify(state), ...extra } }, res);
  return { ...out, guardados: [...guardados] };
}

// ── 1. El enlace ────────────────────────────────────────────────────────────
console.log('\nEl enlace firmado\n');
{
  const t = await crearEnlaceCuenta('dueno', 'calendario');
  ok((await abrirEnlaceCuenta(t, 'calendario'))?.userId === 'dueno', 'ida y vuelta');
  ok((await abrirEnlaceCuenta(t, 'youtube')) === null, 'uno de calendario no sirve para YouTube');
  const yt = await crearEnlaceCuenta('dueno', 'youtube');
  ok((await abrirEnlaceCuenta(yt, 'calendario')) === null, 'ni uno de YouTube para el calendario');
  const trucado = t.replace(encodeURIComponent('dueno'), encodeURIComponent('victima'));
  ok(trucado !== t && (await abrirEnlaceCuenta(trucado, 'calendario')) === null, 'cambiar el usuario rompe la firma');
  ok((await abrirEnlaceCuenta(await crearEnlaceCuenta('dueno', 'calendario', -1), 'calendario'))?.caducado === true, 'caduca');
  const deRecurso = await crearEnlaceCalendario('dueno', 'ana');
  ok((await abrirEnlaceCuenta(deRecurso, 'calendario')) === null, 'el de una persona de reservas no sirve para la cuenta');
  ok((await abrirEnlaceCuenta(undefined, 'calendario')) === null && (await abrirEnlaceCuenta('dueno', 'calendario')) === null,
     'sin enlace, o con un userId pelado, nada');
}

// ── 2. Quién puede pedirlo ──────────────────────────────────────────────────
console.log('\nEl endpoint que firma, según la sesión\n');
async function pide(sub) {
  const h = sub ? { Authorization: 'Bearer ' + await tokenDe(sub) } : {};
  const r = await enlaceHandler(new Request('https://x/api/gcal-enlace', { method: 'POST', headers: h }));
  return { status: r.status, d: await r.json().catch(() => ({})) };
}
{
  const sin = await pide(null);
  ok(sin.status === 401 && !sin.d.url, 'sin sesión, nada');
  const d = await pide('dueno');
  const t = decodeURIComponent((d.d.url || '').split('?c=')[1] || '');
  ok(d.status === 200 && d.d.url.startsWith('/api/gcal-auth?c='), 'el dueño recibe un enlace a gcal-auth', JSON.stringify(d));
  ok((await abrirEnlaceCuenta((d.d.url || '').split('?c=')[1], 'calendario'))?.userId === 'dueno', 'firmado a SU nombre, sacado de la sesión');
  ok(!t.includes('userId='), 'y sin ningún userId que se pueda tocar a mano');
  const adm = await pide('admin2');
  ok(adm.status === 200 && (await abrirEnlaceCuenta(adm.d.url.split('?c=')[1], 'calendario'))?.userId === 'dueno',
     'un administrador del equipo lo conecta a nombre de la CUENTA (del dueño), que es donde la Agenda lo busca');
  const ven = await pide('ventas');
  ok(ven.status === 403 && !ven.d.url, 'un comercial no puede colgarle su Google a la cuenta');
  const r = await enlaceHandler(new Request('https://x/api/gcal-enlace', { method: 'GET' }));
  ok(r.status === 405, 'solo POST: un <img src> no puede sacar enlaces');
}

// ── 3. gcal-auth y yt-auth ──────────────────────────────────────────────────
console.log('\nLa entrada al OAuth\n');
{
  let { out, res } = resFalsa();
  await gcalAuth({ query: { userId: 'victima' } }, res);
  ok(out.redirect && !out.redirect.includes('accounts.google.com') && out.redirect.includes('enlace_invalido'),
     'gcal-auth con ?userId= suelto ya NO manda a Google', out.redirect);

  const t = await crearEnlaceCuenta('dueno', 'calendario');
  ({ out, res } = resFalsa());
  await gcalAuth({ query: { c: t } }, res);
  const st = out.redirect && JSON.parse(new URL(out.redirect).searchParams.get('state'));
  ok(out.redirect?.startsWith('https://accounts.google.com/') && st?.c === t && !('userId' in st),
     'con enlace firmado va a Google, y el state lleva la firma, no un userId', out.redirect);

  ({ out, res } = resFalsa());
  await gcalAuth({ query: { c: await crearEnlaceCuenta('dueno', 'calendario', -1) } }, res);
  ok(out.redirect?.includes('enlace_caducado'), 'uno caducado se dice caducado');

  ({ out, res } = resFalsa());
  await ytAuth({ query: { userId: 'victima' } }, res);
  ok(!out.redirect && out.status === 400, 'yt-auth con ?userId= suelto tampoco', JSON.stringify(out));
  ({ out, res } = resFalsa());
  await ytAuth({ query: { c: t } }, res);
  ok(!out.redirect && out.status === 400, 'ni con un enlace de CALENDARIO');
  const y = await crearEnlaceCuenta('dueno', 'youtube');
  ({ out, res } = resFalsa());
  await ytAuth({ query: { c: y } }, res);
  const sty = out.redirect && JSON.parse(new URL(out.redirect).searchParams.get('state'));
  ok(out.redirect?.startsWith('https://accounts.google.com/') && sty?.nonce === 'yt_connect' && sty?.c === y,
     'con el suyo de YouTube, sí');
}

// ── 4. El callback ──────────────────────────────────────────────────────────
console.log('\nEl callback, con el state en manos del navegador\n');
{
  const t = await crearEnlaceCuenta('dueno', 'calendario');
  const bien = await correCallback({ nonce: 'gcal_connect', c: t });
  ok(bien.guardados.length === 1 && bien.guardados[0].user_id === 'dueno' && bien.guardados[0].platform === 'google_calendar',
     'el camino bueno guarda a nombre de quien dice la firma', JSON.stringify(bien.guardados));
  ok(bien.redirect?.includes('gcal_connected=true'), 'y vuelve a la app diciendo que conectó');

  const viejo = await correCallback({ nonce: 'gcal_connect', userId: 'victima' });
  ok(viejo.guardados.length === 0 && viejo.redirect?.includes('enlace_invalido'),
     'el state de antes (userId suelto) NO guarda nada: es exactamente el ataque');

  const mezcla = await correCallback({ nonce: 'gcal_connect', c: t, userId: 'victima' });
  ok(mezcla.guardados.length === 1 && mezcla.guardados[0].user_id === 'dueno',
     'si le añaden un userId al lado de la firma, manda la firma', JSON.stringify(mezcla.guardados));

  const trucado = await correCallback({ nonce: 'gcal_connect', c: t.replace(encodeURIComponent('dueno'), encodeURIComponent('victima')) });
  ok(trucado.guardados.length === 0, 'una firma retocada no guarda nada');

  const cad = await correCallback({ nonce: 'gcal_connect', c: await crearEnlaceCuenta('dueno', 'calendario', -1) });
  ok(cad.guardados.length === 0 && cad.redirect?.includes('enlace_caducado'), 'una caducada tampoco, y lo dice');

  const cruce = await correCallback({ nonce: 'yt_connect', c: t });
  ok(cruce.guardados.length === 0, 'una firma de calendario con el nonce de YouTube no guarda nada');

  const y = await crearEnlaceCuenta('dueno', 'youtube');
  const yt = await correCallback({ nonce: 'yt_connect', c: y });
  ok(yt.guardados.length === 1 && yt.guardados[0].platform === 'youtube' && yt.guardados[0].user_id === 'dueno',
     'YouTube con su firma se guarda como youtube, a nombre de la firma');
  const ytViejo = await correCallback({ nonce: 'yt_connect', userId: 'victima' });
  ok(ytViejo.guardados.length === 0, 'y YouTube con userId suelto, nada');

  const noQuiso = await correCallback({ nonce: 'gcal_connect', c: t }, { error: 'access_denied', code: undefined });
  ok(noQuiso.guardados.length === 0 && noQuiso.redirect?.includes('access_denied'), 'si dijo que no en Google, se sigue avisando igual');
}

// ── 5. El navegador ─────────────────────────────────────────────────────────
console.log('\nEl botón de la Agenda\n');
{
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = js.indexOf('async function connectGoogleCalendar() {');
  ok(i > 0, 'la función existe');
  let prof = 0, j = js.indexOf('{', i);
  for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
  const src = js.slice(i, j + 1);
  const llamadas = [], toasts = [];
  const win = { location: { href: '' } };
  const hacer = (respuesta) => new Function('fetchAuth', 'showToast', 'window', 'clerkInstance',
    src + '; return connectGoogleCalendar;')(
    async (u, o) => { llamadas.push([u, o && o.method]); return respuesta; },
    (t, k) => toasts.push([t, k]), win, { user: { id: 'victima' } });

  await hacer(resp({ url: '/api/gcal-auth?c=FIRMA' }))();
  ok(llamadas[0]?.[0] === '/api/gcal-enlace' && llamadas[0]?.[1] === 'POST', 'pide el enlace al servidor, con sesión y por POST');
  ok(win.location.href === '/api/gcal-auth?c=FIRMA', 'y navega al que le devuelven');
  ok(!/userId/.test(src), 'no arma ningún ?userId= por su cuenta');

  win.location.href = '';
  await hacer(resp({ error: 'Solo el administrador de la cuenta conecta el Google Calendar de la Agenda.' }, 403))();
  ok(win.location.href === '' && toasts.some(([t, k]) => k === 'error' && /administrador/.test(t)),
     'si el servidor dice que no, se enseña POR QUÉ y no se navega', JSON.stringify(toasts));
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
