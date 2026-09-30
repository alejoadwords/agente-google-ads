// El recordatorio de notas sin abrir no se corta a mitad: node pruebas/notas-con-reloj.mjs
//
// 30-09-2026: cron-notas es edge (25 s) y su `maxDuration: 60` de vercel.json
// no aplicaba. Con muchas personas se cortaba a mitad sin decir nada, y la que
// ya tenía «apartado» el día se quedaba sin recordatorio. Se ejecuta el cron
// real con 30 personas y una base lenta.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CRON_SECRET = 'cron';
process.env.RESEND_API_KEY = 're_x';
process.env.CLERK_SECRET_KEY = 'sk';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const haceH = (h) => new Date(Date.now() - h * 3600e3).toISOString();

let NOTAS = [], APARTADOS = new Set(), correos = [], lento = 0, idsPedidos = [];
for (let p = 0; p < 30; p++) for (let k = 0; k < 20; k++) {
  NOTAS.push({ id: `n${p}-${k}`, user_id: 'dueno', lead_id: `l${p}-${k}`, content: 'Llámalo', created_at: haceH(30), metadata: { para: 'p' + p } });
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = init.method || 'GET';
  if (lento) await new Promise(r => setTimeout(r, lento));
  if (u.startsWith('https://api.resend.com')) { correos.push(JSON.parse(init.body).to[0]); return resp({ id: 'r' }); }
  if (u.includes('api.clerk.com')) return resp({ email_addresses: [{ email_address: 'x@x.co' }] });
  const q = new URL(u.replace('/rest/v1', ''), 'https://x').searchParams;
  if (u.includes('/cron_envios')) { const c = JSON.parse(init.body).clave; if (APARTADOS.has(c)) return resp({}, 409); APARTADOS.add(c); return new Response(null, { status: 201 }); }
  if (u.includes('/lead_activities')) {
    if (m === 'PATCH') { const n = NOTAS.find(x => x.id === q.get('id').slice(3)); n.metadata = JSON.parse(init.body).metadata; return new Response(null, { status: 204 }); }
    return resp(NOTAS.filter(n => !n.metadata.recordada_at).slice(0, 500));
  }
  if (u.includes('/team_members')) { const quien = q.get('member_user_id').slice(3); return resp([{ member_email: quien + '@x.co', member_name: quien }]); }
  if (u.includes('/leads')) { const ids = (q.get('id') || '').slice(4, -1).split(','); idsPedidos.push(ids.length); return resp(ids.map(id => ({ id, name: 'L' }))); }
  return m === 'GET' ? resp([]) : new Response(null, { status: 201 });
};
const cron = (await import('../api/cron-notas.js')).default;
const correr = async () => { const r = await cron(new Request('https://x/api/cron-notas', { headers: { authorization: 'Bearer cron' } })); return { s: r.status, d: await r.json() }; };

lento = 30; process.env.NOTAS_TOPE_MS = '1500';
const t0 = Date.now();
const r1 = await correr();
const tardo = Date.now() - t0;
lento = 0; delete process.env.NOTAS_TOPE_MS;
ok(r1.d.sin_tiempo > 0 && tardo < 3500, 'con poco tiempo deja de tomar personas y lo dice (' + tardo + ' ms)', JSON.stringify(r1.d));
ok(APARTADOS.size === r1.d.personas, 'solo aparta el día de quien de verdad atendió (nadie queda apartado sin su correo)', APARTADOS.size + ' apartados, ' + r1.d.personas + ' atendidas');
ok(idsPedidos.every(n => n <= 8), 'pide solo los nombres de los 8 leads que enseña el correo', JSON.stringify(idsPedidos.slice(0, 5)));
const r2 = await correr();
ok(r1.d.personas + r2.d.personas === 30 && correos.length === 30, 'la siguiente pasada atiende a las que faltaban', JSON.stringify(r2.d));
ok(NOTAS.every(n => n.metadata.recordada_at), 'y todas las notas quedan marcadas como recordadas');

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
