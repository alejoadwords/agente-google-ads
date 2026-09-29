// Conectar Instagram al inbox: node pruebas/instagram-mensajes.mjs
//
// Sin el permiso instagram_manage_messages, conectar un canal de Instagram
// «funcionaba»: la página quedaba suscrita y el canal aparecía vivo, pero Meta
// no entregaba ni un mensaje directo. Se comprobó contra Meta el 28-09-2026:
// leer las conversaciones de Instagram de una página devuelve
// «(#230) Requires instagram_manage_messages permission».
//
// Ahora, antes de guardar el canal, se prueba a leer los mensajes. Se EJECUTA
// el endpoint real con una sesión de verdad y una Graph API de mentira.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
delete process.env.TOKENS_KEY;

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

let conversaciones = null;   // lo que contesta Meta al leer los mensajes de Instagram
let graph = [], guardados = [];
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const m = init.method || 'GET';
  if (u.includes('jwks.json')) return resp(JWKS);
  if (u.includes('/team_members')) return resp([]);
  if (u.includes('/platform_connections')) return resp([{ access_token: 'TOKEN-DE-LA-CUENTA' }]);
  if (u.includes('/channel_connections')) {
    if (m === 'GET') return resp([]);
    guardados.push(JSON.parse(init.body));
    return resp([{ id: 'c1', ...JSON.parse(init.body) }], 201);
  }
  if (u.startsWith('https://graph.facebook.com')) {
    graph.push({ u, m });
    if (u.includes('/conversations')) return resp(conversaciones);
    if (u.includes('/subscribed_apps')) return resp({ success: true });
    if (u.includes('/me/accounts')) return resp({ data: [{ id: 'p1', name: 'Página' }] });
    return resp({ name: 'Página', access_token: 'TOKEN-PAGINA', instagram_business_account: { id: 'ig1', username: 'tienda' } });
  }
  return resp([]);
};

const mod = await import('../api/channel-connections.js');
const handler = mod.default;
const { errorMensajesInstagram } = mod;

async function conectar(channel, token) {
  graph = []; guardados = [];
  const r = await handler(new Request('https://x/api/channel-connections?action=connect_page', {
    method: 'POST', headers: { Authorization: 'Bearer ' + await tokenDe('dueno'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, page_id: 'p1' }),
  }));
  return { status: r.status, d: await r.json().catch(() => ({})), graph: [...graph], guardados: [...guardados] };
}

console.log('\nInstagram sin el permiso de mensajes\n');
{
  conversaciones = { error: { code: 230, message: '(#230) Requires instagram_manage_messages permission to manage the object' } };
  const r = await conectar('instagram');
  ok(r.status === 400 && r.guardados.length === 0, 'NO se guarda el canal: estaría vivo y sordo', JSON.stringify(r.d));
  ok(/permiso de mensajes de Instagram/.test(r.d.error || '') && /vuelve a conectar/.test(r.d.error || ''), 'y se dice qué falta y qué hacer', r.d.error);
  ok(r.d.falta_permiso === 'instagram_manage_messages', 'con el permiso nombrado, para la pantalla');
  ok(!r.graph.some(g => g.u.includes('/subscribed_apps')), 'ni siquiera se suscribe la página');
}

console.log('\nInstagram con la cuenta cerrada a apps\n');
{
  conversaciones = { error: { code: 10, message: 'To access messages, the Instagram account must allow access to messages in Connected Tools' } };
  const r = await conectar('instagram');
  ok(r.status === 400 && r.guardados.length === 0 && /Permitir acceso a los mensajes/.test(r.d.error || ''),
     'se explica el interruptor de Instagram que hay que activar', r.d.error);
}

console.log('\nInstagram con todo en orden\n');
{
  conversaciones = { data: [] };
  const r = await conectar('instagram');
  ok(r.status === 201 && r.guardados.length === 1, 'se guarda el canal', JSON.stringify(r.d).slice(0, 160));
  ok(r.guardados[0]?.external_id === 'ig1' && r.guardados[0]?.channel === 'instagram', 'con el id de la cuenta de Instagram, que es el que escucha el webhook');
  ok(r.graph.some(g => g.u.includes('/p1/conversations') && g.u.includes('platform=instagram')), 'después de comprobar que los mensajes se leen');
}

console.log('\nMessenger no cambia\n');
{
  conversaciones = { error: { code: 230, message: 'no debería consultarse' } };
  const r = await conectar('messenger');
  ok(r.status === 201 && r.guardados.length === 1 && !r.graph.some(g => g.u.includes('/conversations')),
     'Messenger se conecta sin la comprobación de Instagram');
}

console.log('\nLos mensajes de error\n');
{
  ok(errorMensajesInstagram({ code: 230, message: 'x' }).falta_permiso === 'instagram_manage_messages', 'el 230 es el permiso');
  ok(errorMensajesInstagram({ message: 'Requires instagram_manage_messages permission' }).falta_permiso === 'instagram_manage_messages', 'aunque el código no llegue');
  ok(/Instagram no dejó leer/.test(errorMensajesInstagram({ code: 1, message: 'Algo raro' }).error), 'y lo demás se dice con el texto de Meta');
}

console.log('\nLa lista de páginas usa el token de la cuenta\n');
{
  graph = [];
  await handler(new Request('https://x/api/channel-connections?action=list_pages&token=TOKEN-AJENO', {
    headers: { Authorization: 'Bearer ' + await tokenDe('dueno') },
  }));
  ok(graph[0]?.u.includes('TOKEN-DE-LA-CUENTA') && !graph.some(g => g.u.includes('TOKEN-AJENO')), 'un ?token= del navegador se ignora');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
