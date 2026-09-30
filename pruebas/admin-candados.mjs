// Los candados del panel cuando falta configuración: node pruebas/admin-candados.mjs
//
// 30-09-2026: la comprobación del secreto comparaba la cabecera con
// ADMIN_SECRET tal cual, así que sin la variable `undefined === undefined`
// dejaba pasar una petición SIN cabecera. Y el bloqueo de borrar cuentas del
// equipo dependía solo de ADMIN_EMAILS. Se importa el panel real SIN esas dos
// variables.

delete process.env.ADMIN_SECRET;
delete process.env.ADMIN_EMAILS;
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CLERK_SECRET_KEY = 'sk';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.clerk.com')) return resp({ id: 'u', email_addresses: [{ id: 'e', email_address: 'alejandro@acuarius.app' }], primary_email_address_id: 'e', public_metadata: {} });
  if (u.includes('jwks.json')) return resp({ keys: [] });
  return resp([]);
};
const admin = (await import('../api/admin.js')).default;
async function llamar(action, headers = {}) {
  let estado = 200, datos = null;
  const res = { setHeader() {}, status(s) { estado = s; return res; }, json(d) { datos = d; return res; }, end() { return res; }, send(d) { datos = d; return res; } };
  await admin({ method: 'GET', headers, query: { action, id: 'user_x' }, body: {} }, res);
  return { s: estado, d: datos };
}
const r = await llamar('user-footprint');
ok(r.s === 401 || r.s === 403, 'sin ADMIN_SECRET configurado, una petición sin cabecera NO entra al panel', r.s + ' ' + JSON.stringify(r.d).slice(0, 100));
const r2 = await llamar('user-footprint', { 'x-admin-secret': '' });
ok(r2.s === 401 || r2.s === 403, 'ni con la cabecera vacía', r2.s);

// El bloqueo de las cuentas del equipo, aunque falte ADMIN_EMAILS.
process.env.ADMIN_SECRET = 'ahora-si';
const admin2 = (await import('../api/admin.js?v=2')).default;
let estado = 200, datos = null;
const res = { setHeader() {}, status(s) { estado = s; return res; }, json(d) { datos = d; return res; }, end() { return res; } };
await admin2({ method: 'GET', headers: { 'x-admin-secret': 'ahora-si' }, query: { action: 'user-footprint', id: 'user_x' }, body: {} }, res);
ok(estado === 200 && (datos?.bloqueos || []).some(b => /equipo de Acuarius/.test(b)), 'sin ADMIN_EMAILS, una cuenta del equipo sigue bloqueada para borrar', estado + ' ' + JSON.stringify(datos?.bloqueos));

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
