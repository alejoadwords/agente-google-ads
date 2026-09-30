// Entrar a la cuenta de un cliente, el enlace de registro y el alta guiada
// (api/cuentas.js + api/onboarding.js), ejecutados de verdad contra Supabase.
//
// Clerk se simula —no se emiten accesos reales ni se toca ninguna cuenta— pero
// la firma del token SÍ se comprueba: se genera una llave propia y se le sirve
// a _sesion.js como si fuera la de Clerk. Así `act` viaja firmado igual que en
// producción y la prueba no puede «fabricarse» un claim que el servidor crea.
//
// Identidad propia: usuarios `user_prueba_cu_<hora>` que no existen en ningún
// otro sitio; todo lo que escriben se borra al final.
//
//   node pruebas/cuentas-soporte.mjs <carpeta con .env>
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2] + '/.env', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1); }
let mal = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const T = Date.now();
const ADMIN = 'user_prueba_cu_admin_' + T, CLIENTE = 'user_prueba_cu_cli_' + T, VIEJO = 'user_prueba_cu_viejo_' + T, OTRO = 'user_prueba_cu_otro_' + T;
const ADMIN_MAIL = (process.env.ADMIN_EMAILS || '').split(',')[0].trim();
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

// ── Clerk simulado ──────────────────────────────────────────────────────────
const usuarios = {
  [ADMIN]:   { id: ADMIN, first_name: 'Pruebacu' + (T % 100000), last_name: '', email: ADMIN_MAIL, created_at: T - 400 * 86400000, public_metadata: { plan: 'agency' } },
  [CLIENTE]: { id: CLIENTE, first_name: 'Cliente', last_name: 'Prueba', email: `cliente${T}@prueba.test`, created_at: T, public_metadata: { plan: 'trial', trial_until: new Date(T + 5 * 86400000).toISOString() } },
  [VIEJO]:   { id: VIEJO, first_name: 'Viejo', last_name: '', email: `viejo${T}@prueba.test`, created_at: T - 30 * 86400000, public_metadata: { plan: 'free' } },
  [OTRO]:    { id: OTRO, first_name: 'Otro', last_name: '', email: `otro${T}@prueba.test`, created_at: T, public_metadata: {} },
};
const clerkUser = u => ({ ...u, primary_email_address_id: 'e1', email_addresses: [{ id: 'e1', email_address: u.email }] });
const emitidos = { actor: [], revocados: [], signIn: [] };

const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'prueba-cu', alg: 'RS256', use: 'sig' };
const b64u = b => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
async function jwt(payload) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'prueba-cu', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), ...payload }));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(new Uint8Array(s));
}

const fetchReal = globalThis.fetch;
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith('/.well-known/jwks.json')) return J({ keys: [jwk] });
  if (u.startsWith('https://api.resend.com')) return J({ id: 'simulado' });
  if (u.startsWith('https://api.clerk.com/v1')) {
    const ruta = u.slice('https://api.clerk.com/v1'.length);
    const m = init.method || 'GET';
    let x;
    if ((x = ruta.match(/^\/users\/([^/?]+)\/metadata$/)) && m === 'PATCH') {
      const b = JSON.parse(init.body);
      usuarios[x[1]].public_metadata = { ...usuarios[x[1]].public_metadata, ...b.public_metadata };
      return J(clerkUser(usuarios[x[1]]));
    }
    if ((x = ruta.match(/^\/users\/([^/?]+)$/))) return usuarios[x[1]] ? J(clerkUser(usuarios[x[1]])) : J({ errors: [] }, 404);
    if (ruta.startsWith('/users?')) return J(ruta.includes('offset=0') ? Object.values(usuarios).map(clerkUser) : []);
    if (ruta === '/actor_tokens' && m === 'POST') { const b = JSON.parse(init.body); emitidos.actor.push(b); return J({ id: 'act_prueba_' + emitidos.actor.length, token: 'ticket-actor', status: 'pending' }); }
    if ((x = ruta.match(/^\/actor_tokens\/([^/]+)\/revoke$/))) { emitidos.revocados.push(x[1]); return J({ status: 'revoked' }); }
    if (ruta === '/sign_in_tokens' && m === 'POST') { const b = JSON.parse(init.body); emitidos.signIn.push(b); return J({ token: 'ticket-vuelta' }); }
    return J({ errors: [{ message: 'ruta no simulada ' + ruta }] }, 500);
  }
  return fetchReal(url, init);
};

const cuentas = (await import('../api/cuentas.js?v=' + T)).default;
const onboarding = (await import('../api/onboarding.js?v=' + T)).default;
const trial = (await import('../api/trial.js?v=' + T)).default;

async function llamar(h, { metodo = 'GET', q = '', cuerpo, sub, act } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sub) headers.Authorization = 'Bearer ' + await jwt(act ? { sub, act: { sub: act } } : { sub });
  const r = await h(new Request('https://app.acuarius.app/api/x' + q, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined }));
  return { s: r.status, d: await r.json().catch(() => ({})) };
}
const sbGet = p => fetchReal(`${SB}/rest/v1/${p}`, { headers: sbH }).then(r => r.json());

try {
  console.log('Puerta');
  let r = await llamar(cuentas, { q: '?lista=1' });
  ok(r.s === 401, 'sin sesión: 401');
  r = await llamar(cuentas, { q: '?lista=1', sub: CLIENTE });
  ok(r.s === 403, 'un cliente no ve la lista (403)');
  r = await llamar(cuentas, { q: '?lista=1', sub: ADMIN });
  ok(r.s === 200 && Array.isArray(r.d.cuentas), 'el admin sí');
  const cli = (r.d.cuentas || []).find(c => c.id === CLIENTE);
  ok(cli && cli.estado === 'prueba' && cli.correo === usuarios[CLIENTE].email, 'la prueba vigente sale como «prueba», con su correo');
  ok((r.d.cuentas || []).find(c => c.id === ADMIN)?.es_equipo === true, 'el admin sale marcado como equipo (no se ofrece «entrar»)');

  console.log('Entrar');
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'entrar', cuenta: CLIENTE, motivo: '' } });
  ok(r.s === 400, 'sin motivo no se entra');
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'entrar', cuenta: ADMIN, motivo: 'x y z' } });
  ok(r.s === 400, 'a la cuenta propia no');
  r = await llamar(cuentas, { metodo: 'POST', sub: CLIENTE, cuerpo: { accion: 'entrar', cuenta: OTRO, motivo: 'revisión' } });
  ok(r.s === 403 && !emitidos.actor.length, 'un cliente no puede entrar a otra cuenta, y no se emitió nada');
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'entrar', cuenta: CLIENTE, motivo: 'Prueba automática' } });
  ok(r.s === 200 && r.d.ticket === 'ticket-actor', 'el admin entra y recibe el ticket');
  const emit = emitidos.actor[0] || {};
  ok(emit.user_id === CLIENTE && emit.actor?.sub === ADMIN, 'el acceso es a nombre del CLIENTE con el admin como actor');
  ok(emit.session_max_duration_in_seconds === 3600, 'la sesión dura una hora como mucho');
  let log = await sbGet(`acceso_cuentas?cuenta_id=eq.${CLIENTE}&select=*`);
  ok(log.length === 1 && log[0].motivo === 'Prueba automática' && !log[0].fin, 'la entrada quedó anotada con su motivo, abierta');

  console.log('Dentro de la cuenta (sesión con act)');
  r = await llamar(cuentas, { q: '?lista=1', sub: CLIENTE, act: ADMIN });
  ok(r.s === 403, 'desde dentro no se abre la lista de cuentas');
  r = await llamar(cuentas, { metodo: 'POST', sub: CLIENTE, act: ADMIN, cuerpo: { accion: 'entrar', cuenta: OTRO, motivo: 'encadenar' } });
  ok(r.s === 403, 'ni se encadenan entradas');
  r = await llamar(trial, { metodo: 'POST', sub: CLIENTE, act: ADMIN });
  ok(r.d.reason === 'sesion_de_soporte', 'la prueba del cliente no se arranca desde soporte');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, act: ADMIN, cuerpo: { paso: 'moneda', moneda: 'COP' } });
  ok(r.s === 403, 'el alta no la completa quien revisa');
  r = await llamar(cuentas, { metodo: 'POST', sub: CLIENTE, act: OTRO, cuerpo: { accion: 'volver' } });
  ok(r.s === 403 && !emitidos.signIn.length, 'si quien está detrás no es del equipo, no hay regreso (ni ticket)');
  r = await llamar(cuentas, { metodo: 'POST', sub: CLIENTE, cuerpo: { accion: 'volver' } });
  ok(r.s === 400, 'una sesión normal no «vuelve» a ningún sitio');
  r = await llamar(cuentas, { metodo: 'POST', sub: CLIENTE, act: ADMIN, cuerpo: { accion: 'volver' } });
  ok(r.s === 200 && r.d.ticket === 'ticket-vuelta' && emitidos.signIn[0]?.user_id === ADMIN, 'volver da un ticket para el ADMIN');
  log = await sbGet(`acceso_cuentas?cuenta_id=eq.${CLIENTE}&select=fin`);
  ok(log[0]?.fin, 'y cierra la entrada en el registro');
  r = await llamar(cuentas, { q: '?accesos=1&cuenta=' + CLIENTE, sub: ADMIN });
  ok(r.s === 200 && r.d.accesos?.length === 1, 'el registro de accesos se lee');

  console.log('Enlace de registro');
  r = await llamar(cuentas, { q: '?enlace=1', sub: ADMIN });
  ok(r.s === 200 && r.d.enlace?.slug && r.d.enlace.url.includes('/registro/'), 'se crea un enlace al primer vistazo · ' + r.d.enlace?.slug);
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'enlace', slug: 'admin' } });
  ok(r.s === 400, 'las palabras reservadas no valen');
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'enlace', slug: 'x' } });
  ok(r.s === 400, 'demasiado corto tampoco');
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'enlace', slug: 'prueba-cu', video_url: 'https://evil.test/v' } });
  ok(r.s === 400, 'un video que no es de YouTube o Vimeo no se guarda');
  const SLUG = 'prueba-cu-' + (T % 1000000);
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'enlace', slug: SLUG, titulo: 'Tu prueba con el equipo de prueba', bienvenida: 'Hola {nombre}, quieres {objetivo} en {empresa}.', video_url: 'https://youtu.be/Qx7Rr1J6hgg' } });
  ok(r.s === 200 && r.d.enlace?.slug === SLUG, 'se guarda el enlace personalizado');
  r = await llamar(cuentas, { q: '?registro=' + SLUG });
  ok(r.s === 200 && r.d.ok && r.d.titulo.startsWith('Tu prueba') && !('user_id' in r.d), 'la página pública ve el título, no el dueño');
  r = await llamar(cuentas, { q: '?registro=no-existe-' + T });
  ok(r.d.ok === false, 'un enlace inexistente responde ok:false');
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'enviar-enlace', email: 'no-es-correo' } });
  ok(r.s === 400, 'enviar a un correo inválido: 400');

  console.log('Atribución');
  r = await llamar(cuentas, { metodo: 'POST', sub: VIEJO, cuerpo: { accion: 'atribuir', slug: SLUG } });
  ok(r.d.ok === false && r.d.motivo === 'cuenta antigua', 'una cuenta vieja no se deja atribuir');
  r = await llamar(cuentas, { metodo: 'POST', sub: ADMIN, cuerpo: { accion: 'atribuir', slug: SLUG } });
  ok(r.d.ok === false, 'nadie se atribuye su propio enlace');
  r = await llamar(cuentas, { metodo: 'POST', sub: CLIENTE, act: ADMIN, cuerpo: { accion: 'atribuir', slug: SLUG } });
  ok(r.d.ok === false, 'desde soporte no se atribuye');
  r = await llamar(cuentas, { metodo: 'POST', sub: CLIENTE, cuerpo: { accion: 'atribuir', slug: SLUG } });
  ok(r.d.ok === true && usuarios[CLIENTE].public_metadata.enlace === SLUG && usuarios[CLIENTE].public_metadata.enlace_de === ADMIN, 'la cuenta nueva queda con su enlace en Clerk');
  const enl = await sbGet(`enlaces_registro?slug=eq.${SLUG}&select=registros`);
  ok(enl[0]?.registros === 1, 'y el enlace cuenta un registro');
  r = await llamar(cuentas, { metodo: 'POST', sub: CLIENTE, cuerpo: { accion: 'atribuir', slug: SLUG } });
  ok(r.d.ya === true && (await sbGet(`enlaces_registro?slug=eq.${SLUG}&select=registros`))[0]?.registros === 1, 'atribuir dos veces no cuenta dos');

  console.log('Alta guiada');
  r = await llamar(onboarding, { sub: CLIENTE });
  ok(r.s === 200 && r.d.debe === true, 'una cuenta nueva sin alta: debe hacerla');
  r = await llamar(onboarding, { sub: VIEJO });
  ok(r.d.debe === false, 'una cuenta de antes del alta: no se la manda');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, cuerpo: { paso: 'moneda', empresa: { nombre: 'Estibas de Prueba', web: 'https://x.test', sector: 'Industria y manufactura', empleados: '10-49' } } });
  ok(r.s === 200 && r.d.onboarding?.empresa?.nombre === 'Estibas de Prueba', 'guarda la empresa');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, cuerpo: { paso: 'calendario', moneda: 'XYZ' } });
  ok(r.s === 400, 'una moneda inventada no');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, cuerpo: { paso: 'calendario', moneda: 'cop' } });
  ok(r.s === 200 && r.d.onboarding?.moneda === 'COP' && r.d.onboarding?.empresa?.nombre === 'Estibas de Prueba', 'guarda la moneda sin borrar la empresa');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, cuerpo: { paso: 'objetivo', telefono: '+57 300' } });
  ok(r.s === 400, 'un teléfono incompleto no');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, cuerpo: { paso: 'objetivo', telefono: '+57 300 123 4567' } });
  ok(r.d.onboarding?.telefono === '+573001234567', 'guarda el teléfono limpio');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, cuerpo: { accion: 'completar', objetivo: 'corto' } });
  ok(r.s === 400, 'un objetivo de una palabra no cierra el alta');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, cuerpo: { accion: 'completar', objetivo: 'Que ningún mensaje de WhatsApp se quede sin responder por la noche' } });
  ok(r.s === 200 && r.d.bienvenida && r.d.caso, 'completa: bienvenida y caso creados');
  const conv = (await sbGet(`support_conversations?user_id=eq.${CLIENTE}&select=mensajes`))[0];
  const bienv = conv?.mensajes?.[0] || {};
  ok(bienv.role === 'equipo' && bienv.firma === 'Equipo de Soporte — Acuarius', 'la bienvenida es un mensaje del equipo, firmado como Soporte');
  ok(bienv.content === 'Hola Cliente, quieres Que ningún mensaje de WhatsApp se quede sin responder por la noche en Estibas de Prueba.', 'usa el texto del ENLACE con {nombre}, {objetivo} y {empresa} cambiados');
  ok(bienv.video === 'https://youtu.be/Qx7Rr1J6hgg', 'y su video');
  const caso = (await sbGet(`support_tickets?user_id=eq.${CLIENTE}&select=*`))[0];
  ok(caso && /Estibas de Prueba/.test(caso.asunto) && /Teléfono: \+573001234567/.test(caso.detalle) && new RegExp('enlace: ' + SLUG).test(caso.detalle), 'el caso lleva empresa, teléfono y enlace');
  r = await llamar(onboarding, { metodo: 'POST', sub: CLIENTE, cuerpo: { accion: 'completar', objetivo: 'Que ningún mensaje de WhatsApp se quede sin responder por la noche' } });
  ok(r.d.ya === true && (await sbGet(`support_tickets?user_id=eq.${CLIENTE}&select=id`)).length === 1, 'completar dos veces no duplica la bienvenida ni el caso');
  r = await llamar(onboarding, { sub: CLIENTE });
  ok(r.d.debe === false, 'con el alta hecha ya no se le manda');
  r = await llamar(cuentas, { q: '?lista=1', sub: ADMIN });
  const cli2 = (r.d.cuentas || []).find(c => c.id === CLIENTE);
  ok(cli2?.empresa === 'Estibas de Prueba' && cli2?.enlace === SLUG && cli2?.onboarding === 'completo', 'la lista muestra empresa, enlace y alta completa');
} finally {
  // Limpieza: todo lo que escribieron las identidades de prueba.
  const ids = [ADMIN, CLIENTE, VIEJO, OTRO].join(',');
  for (const ruta of [`acceso_cuentas?cuenta_id=in.(${ids})`, `enlaces_registro?user_id=in.(${ids})`, `onboarding_cuenta?user_id=in.(${ids})`,
    `support_conversations?user_id=in.(${ids})`, `support_tickets?user_id=in.(${ids})`]) {
    const r = await fetchReal(`${SB}/rest/v1/${ruta}`, { method: 'DELETE', headers: sbH });
    if (!r.ok) console.log('  ! no se pudo limpiar ' + ruta.split('?')[0] + ' (' + r.status + ')');
  }
}
console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
