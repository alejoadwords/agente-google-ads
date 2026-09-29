// El plan se lee en cada petición, y la baja de correo se respeta en todo:
// node pruebas/plan-por-peticion.mjs
//
// 1. campaigns, automations, team y proposals guardaban el plan en variables
//    del módulo (`_lastPlan`, `_emailsExtra`, `_seatsExtra`). En una función
//    que sigue caliente, esas variables las comparten las peticiones de
//    CLIENTES DISTINTOS: después de una cuenta de pago, la siguiente cuenta
//    gratis heredaba su plan, sus paquetes de correo y sus asientos.
// 2. Los pasos de automatización que envían correo —«Enviar correo», «Encuesta
//    NPS» y «Pedir reseña»— no miraban la etiqueta `no-email`: le seguían
//    escribiendo a quien se había dado de baja. Y el de «Enviar correo» no
//    llevaba enlace de baja, así que ni siquiera se podía pedir.
//
// Todo se EJECUTA: una sola carga de cada módulo (la misma «instancia
// caliente») atendiendo a varios usuarios seguidos.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CLERK_SECRET_KEY = 'sk_prueba';
process.env.RESEND_API_KEY = 're_prueba';
process.env.CRON_SECRET = 'secreto-cron';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

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

// Tres cuentas: una Agency con paquetes extra, una Pro y una gratis.
const CLERK = {
  agencia: { plan: 'agency', emails_extra: '3', seats_extra: '2' },
  pro: { plan: 'pro' },
  gratis: {},
};
let correos = [], guardados = [];
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const m = init.method || 'GET';
  if (u.includes('jwks.json')) return resp(JWKS);
  if (u.startsWith('https://api.clerk.com/v1/users/')) {
    const id = u.split('/users/')[1].split('?')[0];
    return resp({ id, public_metadata: CLERK[id] || {}, email_addresses: [{ email_address: id + '@prueba.co' }] });
  }
  if (u.startsWith('https://api.resend.com')) {
    correos.push(JSON.parse(init.body));
    return resp({ id: 're_' + correos.length });
  }
  if (u.includes('/rest/v1/')) {
    if (m !== 'GET') { guardados.push({ u, m, body: init.body }); return resp([{ id: 'nuevo' }], 201); }
    // Un enlace de reseñas configurado: sin él, «Pedir reseña» se corta antes
    // de mirar la baja y la prueba no probaría nada.
    if (u.includes('agent_key=eq.__resenas__')) return resp([{ profile_data: { _cuenta: { url: 'https://g.page/r/x/review' } } }]);
    return resp([]);
  }
  return resp({});
};

async function pedir(mod, sub, ruta, opts = {}) {
  const r = await mod.default(new Request('https://x' + ruta, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + await tokenDe(sub), 'Content-Type': 'application/json' },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  }));
  return { status: r.status, d: await r.json().catch(() => ({})) };
}

// ── 1. El plan no se hereda ─────────────────────────────────────────────────
console.log('\nUna cuenta no hereda el plan de la anterior\n');
{
  const campaigns = await import('../api/campaigns.js');
  const a = await pedir(campaigns, 'agencia', '/api/campaigns');
  ok(a.d.quota?.plan === 'agency' && a.d.quota?.extra_packs === 3, 'campañas: la Agency ve su plan y sus 3 paquetes', JSON.stringify(a.d.quota));
  const g = await pedir(campaigns, 'gratis', '/api/campaigns');
  ok(g.d.quota?.plan === 'free' && !g.d.quota?.extra_packs, 'y la cuenta gratis que llega DESPUÉS ve el suyo, no el de la Agency', JSON.stringify(g.d.quota));
  const p = await pedir(campaigns, 'pro', '/api/campaigns');
  ok(p.d.quota?.plan === 'pro' && !p.d.quota?.extra_packs, 'una Pro tampoco se queda con los paquetes de la Agency', JSON.stringify(p.d.quota));
}
{
  const automations = await import('../api/automations.js');
  const cuerpo = { name: 'Bienvenida', trigger: 'lead_created', steps: [{ type: 'send_email', subject: 'Hola', body: 'Hola' }] };
  const a = await pedir(automations, 'pro', '/api/automations', { method: 'POST', body: cuerpo });
  ok(a.status !== 403, 'automatizaciones: la Pro crea', a.status + ' ' + JSON.stringify(a.d).slice(0, 120));
  const g = await pedir(automations, 'gratis', '/api/automations', { method: 'POST', body: cuerpo });
  ok(g.status === 403 && g.d.upgrade, 'y la gratis que llega después NO se cuela por el gate', g.status + ' ' + JSON.stringify(g.d).slice(0, 120));
}
{
  const proposals = await import('../api/proposals.js');
  const cuerpo = { title: 'Propuesta', content: 'Texto' };
  const a = await pedir(proposals, 'agencia', '/api/proposals', { method: 'POST', body: cuerpo });
  ok(a.status !== 403, 'propuestas: la Agency crea', a.status + ' ' + JSON.stringify(a.d).slice(0, 120));
  const g = await pedir(proposals, 'gratis', '/api/proposals', { method: 'POST', body: cuerpo });
  ok(g.status === 403, 'y la gratis que llega después no', g.status + ' ' + JSON.stringify(g.d).slice(0, 120));
}
{
  const team = await import('../api/team.js');
  const a = await pedir(team, 'agencia', '/api/team');
  const g = await pedir(team, 'gratis', '/api/team');
  ok(a.d.seats?.plan === 'agency' && g.d.seats?.plan === 'free', 'equipo: cada cuenta con su plan', JSON.stringify([a.d.seats, g.d.seats]));
  ok(g.d.seats?.total < a.d.seats?.total, 'y la gratis no hereda los asientos extra de la Agency', JSON.stringify([a.d.seats?.total, g.d.seats?.total]));
}

// ── 2. La baja de correo en las automatizaciones ────────────────────────────
console.log('\nLas automatizaciones respetan la baja\n');
{
  const motor = await import('../api/cron-automations.js');
  const unsubscribe = await import('../api/unsubscribe.js');
  const auto = { id: 'au1', user_id: 'pro', client_id: null };
  const job = { id: 'j1' };
  const conBaja = { id: 'l1', name: 'Ana', email: 'ana@x.co', tags: ['cliente', 'no-email'] };
  const sinBaja = { id: 'l2', name: 'Beto', email: 'beto@x.co', tags: ['cliente'] };

  correos = [];
  const r1 = await motor.actionSendEmail({ subject: 'Hola {{nombre}}', body: 'Te escribo' }, conBaja, auto, job);
  ok(r1.result === 'skipped' && /baja/.test(r1.detail) && correos.length === 0, '«Enviar correo» no le escribe a quien se dio de baja', JSON.stringify(r1));
  const r2 = await motor.actionSendNps({}, conBaja, auto);
  ok(r2.result === 'skipped' && correos.length === 0, 'ni la encuesta NPS', JSON.stringify(r2));
  const r3 = await motor.actionPedirResena({ canal: 'email' }, conBaja, auto);
  ok(r3.result === 'skipped' && /baja/.test(r3.detail) && correos.length === 0, 'ni el pedido de reseña por correo', JSON.stringify(r3));
  const r3b = await motor.actionPedirResena({ canal: 'email' }, sinBaja, auto);
  ok(r3b.result === 'sent' && correos.length === 1, '(y a quien no se dio de baja, la reseña sí le llega: la prueba llega hasta el envío)', JSON.stringify(r3b));

  correos = [];
  const r4 = await motor.actionSendEmail({ subject: 'Hola {{nombre}}', body: 'Te escribo' }, sinBaja, auto, job);
  const enviado = correos[0] || {};
  ok(r4.result === 'sent' && enviado.to?.[0] === 'beto@x.co', 'a quien no se dio de baja sí le llega', JSON.stringify(r4));
  const enlace = (String(enviado.html).match(/href="(https:\/\/app\.acuarius\.app\/api\/unsubscribe\?[^"]+)"/) || [])[1];
  ok(!!enlace && /Darte de baja/.test(enviado.html), 'con un enlace de baja en el pie (antes no tenía ninguno)');
  ok(enviado.headers?.['List-Unsubscribe'] === '<' + enlace + '>' && enviado.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click',
     'y la cabecera de baja en un clic, como las campañas', JSON.stringify(enviado.headers));

  // El enlace lo tiene que aceptar el endpoint de baja real, que firma igual.
  const q = Object.fromEntries(new URL(enlace).searchParams);
  let estado = 0, parche = null;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/leads') && (init.method || 'GET') === 'GET') return resp([{ id: 'l2', tags: ['cliente'] }]);
    if (u.includes('/rest/v1/leads')) { parche = JSON.parse(init.body); return new Response(null, { status: 204 }); }
    return prev(url, init);
  };
  const res = { setHeader() {}, status(s) { estado = s; return this; }, send() { return this; } };
  await unsubscribe.default({ query: q, headers: {} }, res);
  globalThis.fetch = prev;
  ok(estado === 200 && parche?.tags?.includes('no-email'), 'el enlace funciona: la baja le pone no-email al contacto', estado + ' ' + JSON.stringify(parche));
  const falso = { ...q, s: q.s.replace(/.$/, c => (c === 'a' ? 'b' : 'a')) };
  await unsubscribe.default({ query: falso, headers: {} }, res);
  ok(estado === 403, 'y un enlace retocado no');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
