// Borrar una cuenta por completo desde el panel (api/admin.js
// ?action=user-footprint / ?action=delete-user), contra Supabase real.
//
// Identidad propia: `user_prueba_del_<hora>`, con filas encadenadas por claves
// foráneas (conversación → lead → canal → agente) y un lead de OTRA cuenta
// asignado a ella. Clerk se simula: aquí no se borra ningún usuario real.
//
//   node pruebas/borrar-cuenta.mjs <carpeta con .env>   (necesita ADMIN_SECRET)
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2] + '/.env', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1); }
let mal = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const T = Date.now();
const U = 'user_prueba_del_' + T, OTRA = 'user_prueba_delotra_' + T, ADMINU = 'user_prueba_deladm_' + T;
const CORREO = `borrame${T}@prueba.test`;
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const fetchReal = globalThis.fetch;
const sb = (ruta, metodo = 'GET', cuerpo) => fetchReal(`${SB}/rest/v1/${ruta}`, { method: metodo, headers: sbH, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(t); return t ? JSON.parse(t) : null; });

// Clerk simulado
const clerk = {
  [U]: { id: U, first_name: 'Borrame', email: CORREO, public_metadata: { plan: 'pro', origen: 'hotmart', hasta: '2099-01-01' } },
  [ADMINU]: { id: ADMINU, first_name: 'Adm', email: (process.env.ADMIN_EMAILS || '').split(',')[0], public_metadata: {} },
};
const borradosClerk = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const m = u.match(/^https:\/\/api\.clerk\.com\/v1\/users\/([^/?]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if ((init.method || 'GET') === 'DELETE') { borradosClerk.push(id); delete clerk[id]; return new Response('{"deleted":true}', { status: 200 }); }
    const c = clerk[id];
    if (!c) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ ...c, primary_email_address_id: 'e', email_addresses: [{ id: 'e', email_address: c.email }] }), { status: 200 });
  }
  return fetchReal(url, init);
};

const handler = (await import('../api/admin.js?v=' + T)).default;
async function llamar(action, { metodo = 'GET', query = {}, cuerpo, secreto = process.env.ADMIN_SECRET } = {}) {
  let estado = 200, datos = null;
  const res = { setHeader() {}, status(s) { estado = s; return res; }, json(d) { datos = d; return res; }, end() { return res; } };
  await handler({ method: metodo, headers: { 'x-admin-secret': secreto }, query: { action, ...query }, body: cuerpo || {} }, res);
  return { s: estado, d: datos };
}

try {
  // Siembra: cadena de claves foráneas + un lead ajeno asignado a la cuenta.
  await sb('users', 'POST', [{ id: U, email: CORREO }, { id: OTRA, email: `otra${T}@prueba.test` }]);
  const [ag] = await sb('chat_agents', 'POST', { user_id: U, name: 'Agente prueba' });
  const [ch] = await sb('channel_connections', 'POST', { user_id: U, channel: 'whatsapp', external_id: 'sim_prueba_del_' + T, agent_id: ag.id });
  const [ld] = await sb('leads', 'POST', { user_id: U, name: 'Lead prueba' });
  const [ajeno] = await sb('leads', 'POST', { user_id: OTRA, name: 'Lead ajeno', assigned_to: U, assigned_name: 'Borrame' });
  const [cv] = await sb('chat_conversations', 'POST', { user_id: U, channel: 'whatsapp', contact_id: '57300' + T, connection_id: ch.id, lead_id: ld.id, agent_id: ag.id });
  await sb('chat_messages', 'POST', { conversation_id: cv.id, role: 'user', content: 'hola' });

  let r = await llamar('user-footprint', { query: { id: U }, secreto: 'malo' });
  ok(r.s === 401, 'sin el secreto del panel: 401');
  r = await llamar('user-footprint', { query: { id: U + "' or 1=1" } });
  ok(r.s === 400, 'un id raro se rechaza antes de tocar nada');
  r = await llamar('user-footprint', { query: { id: U } });
  ok(r.s === 200 && r.d.correo === CORREO, 'la huella trae el correo');
  ok(r.d.huella?.['leads.user_id'] === 1 && r.d.huella?.['chat_conversations.user_id'] === 1 && r.d.huella?.['users.id'] === 1, 'y lo que hay en cada tabla');
  ok(r.d.avisos.some(a => /Hotmart/.test(a)), 'avisa de que un plan pagado NO se cancela solo');
  ok(!r.d.bloqueos.length, 'sin bloqueos');

  r = await llamar('user-footprint', { query: { id: ADMINU } });
  ok(r.d.bloqueos.some(b => /equipo de Acuarius/.test(b)), 'una cuenta del equipo queda bloqueada');
  r = await llamar('delete-user', { metodo: 'PUT', cuerpo: { id: ADMINU, confirmar: clerk[ADMINU].email } });
  ok(r.s === 409 && !borradosClerk.length, 'y no se borra aunque se confirme');

  r = await llamar('delete-user', { metodo: 'PUT', cuerpo: { id: U, confirmar: 'otro@correo.com' } });
  ok(r.s === 400 && /escribe exactamente/.test(r.d.error), 'confirmar con otro correo no borra');
  ok((await sb(`leads?user_id=eq.${U}&select=id`)).length === 1 && !borradosClerk.length, 'y de verdad no se tocó nada');

  r = await llamar('delete-user', { metodo: 'PUT', cuerpo: { id: U, confirmar: CORREO.toUpperCase(), motivo: 'prueba automática' } });
  ok(r.s === 200 && r.d.ok, 'con el correo bien escrito, borra');
  ok(borradosClerk.includes(U), 'también en Clerk');
  const quedan = await fetchReal(`${SB}/rest/v1/rpc/cuenta_huella`, { method: 'POST', headers: sbH, body: JSON.stringify({ uid: U }) }).then(r => r.json());
  ok(Object.keys(quedan).length === 0, 'no queda ni una fila de la cuenta');
  ok((await sb(`chat_messages?conversation_id=eq.${cv.id}&select=id`)).length === 0, 'los mensajes cayeron con su conversación');
  const aj = (await sb(`leads?id=eq.${ajeno.id}&select=assigned_to,assigned_name`))[0];
  ok(aj && aj.assigned_to === null && aj.assigned_name === null, 'el lead de la otra cuenta sigue, pero sin asignar');
  const constancia = (await sb(`cuentas_eliminadas?cuenta_id=eq.${U}&select=*`))[0];
  ok(constancia && constancia.correo === CORREO && constancia.clerk_ok === true && constancia.filas?.['leads.user_id'] === 1, 'queda constancia del borrado');

  r = await llamar('delete-user', { metodo: 'PUT', cuerpo: { id: U, confirmar: U } });
  ok(r.s === 200, 'repetir sobre una cuenta ya borrada no rompe (se confirma con el id)');
} finally {
  for (const id of [U, OTRA]) await fetchReal(`${SB}/rest/v1/rpc/borrar_cuenta`, { method: 'POST', headers: sbH, body: JSON.stringify({ uid: id }) }).catch(() => {});
  await fetchReal(`${SB}/rest/v1/cuentas_eliminadas?cuenta_id=in.(${U},${OTRA})`, { method: 'DELETE', headers: sbH });
}
console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
