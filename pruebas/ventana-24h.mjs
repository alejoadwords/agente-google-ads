// El aviso antes de que se cierre la ventana de 24 h: node pruebas/ventana-24h.mjs
//
// 30-09-2026: desde que existe (14-08) no creó ni una tarea. Pedía `status`
// del lead —la columna es `stage`—, PostgREST daba error, el lead se tomaba
// por inexistente y la conversación se marcaba como avisada sin tarea. Además
// un fallo al crear la tarea también se marcaba, y las de cuentas con el aviso
// apagado ocupaban los 120 puestos. Se ejecuta el cron real contra un
// Supabase de mentira que, como el de verdad, rechaza columnas que no existen.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CRON_SECRET = 'cron';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const haceH = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const COLUMNAS_LEADS = ['id', 'name', 'phone', 'client_id', 'stage', 'closed_at'];
let CONVS = [], LEADS = {}, TAREAS = [], REGLAS = {}, falla = {}, lento = 0;
function sembrar() { CONVS = []; LEADS = {}; TAREAS = []; REGLAS = {}; falla = {}; }
function conv(id, user, horasDesdeInbound, lead = { stage: 'nuevo' }) {
  CONVS.push({ id, user_id: user, lead_id: 'l-' + id, contact_name: 'C ' + id, channel: 'whatsapp', status: 'bot', aviso_ventana_at: null, last_inbound_at: haceH(horasDesdeInbound) });
  LEADS['l-' + id] = { id: 'l-' + id, name: 'Lead ' + id, phone: '300', client_id: null, closed_at: null, ...lead };
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = init.method || 'GET';
  if (lento) await new Promise(r => setTimeout(r, lento));
  const q = new URL(u.replace('/rest/v1', ''), 'https://x').searchParams;
  if (u.includes('/chat_conversations')) {
    if (m === 'PATCH') { const c = CONVS.find(x => x.id === q.get('id').slice(3)); Object.assign(c, JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    const [gt, lt] = q.getAll('last_inbound_at').map(v => v.slice(3));
    const filas = CONVS.filter(c => c.aviso_ventana_at == null && c.last_inbound_at > gt && c.last_inbound_at < lt)
      .sort((a, b) => a.last_inbound_at.localeCompare(b.last_inbound_at));
    const off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || 1000), 1000);
    return resp(filas.slice(off, off + lim));
  }
  if (u.includes('/leads')) {
    const pedidas = (q.get('select') || '').split(',');
    const malas = pedidas.filter(c => !COLUMNAS_LEADS.includes(c));
    if (malas.length) return resp({ code: '42703', message: `column leads.${malas[0]} does not exist` }, 400);
    if (falla.leads) return resp({ message: 'caída' }, 503);
    const l = LEADS[q.get('id').slice(3)];
    return resp(l ? [l] : []);
  }
  if (u.includes('/user_profiles')) { const uid = q.get('user_id').slice(3); return resp(REGLAS[uid] ? [{ profile_data: REGLAS[uid] }] : []); }
  if (u.includes('/activities')) {
    if (m === 'POST') { if (falla.crear) return resp({ message: 'no' }, 500); TAREAS.push(JSON.parse(init.body)); return resp([{ id: 't' }], 201); }
    return resp(TAREAS.filter(t => t.lead_id === q.get('lead_id').slice(3)));
  }
  return m === 'GET' ? resp([]) : new Response(null, { status: 201 });
};
const cron = (await import('../api/cron-ventana.js')).default;
const correr = async () => { const r = await cron(new Request('https://x/api/cron-ventana', { headers: { authorization: 'Bearer cron' } })); return { s: r.status, d: await r.json() }; };
const marcada = (id) => !!CONVS.find(c => c.id === id).aviso_ventana_at;

sembrar();
conv('a', 'u1', 21);                          // quedan 3 h: toca avisar (por defecto, 4 h antes)
conv('b', 'u1', 21.5, { stage: 'Ganado' });    // cerrado por etapa
conv('c', 'u1', 21.2, { closed_at: haceH(1) }); // cerrado por fecha de cierre
conv('d', 'u1', 14);                          // quedan 10 h: todavía no
const r1 = await correr();
ok(TAREAS.length === 1 && TAREAS[0].lead_id === 'l-a', 'crea la tarea de aviso (antes: ninguna desde el 14-08)', JSON.stringify(r1.d));
ok(marcada('a'), 'y marca la conversación como avisada');
ok(marcada('b') && marcada('c'), 'un lead ganado o cerrado no recibe aviso, y se marca para no volver a mirarlo');
ok(!marcada('d'), 'la que todavía no toca no se marca: se revisa en la próxima pasada');

sembrar();
conv('e', 'u1', 21);
falla.crear = true;
const r2 = await correr();
ok(!marcada('e') && r2.d.errores === 1, 'si no se pudo crear la tarea, NO se marca como avisada (antes sí)', JSON.stringify(r2.d));
falla.crear = false;
await correr();
ok(marcada('e') && TAREAS.length === 1, 'y la pasada siguiente la crea');

sembrar();
conv('f', 'u1', 21);
falla.leads = true;
const r3 = await correr();
ok(!marcada('f') && TAREAS.length === 0, 'si no se pudo leer el lead, tampoco se marca', JSON.stringify(r3.d));

// 300 conversaciones de una cuenta con el aviso apagado, más antiguas que las
// de una cuenta con el aviso encendido.
sembrar();
REGLAS.apagado = { ventana_24h: false };
for (let i = 0; i < 300; i++) conv('x' + i, 'apagado', 22 + i / 1000);
for (let i = 0; i < 5; i++) conv('y' + i, 'u2', 21 + i / 10);
const r4 = await correr();
ok(TAREAS.filter(t => t.user_id === 'u2').length === 5, 'las de una cuenta con el aviso encendido se atienden aunque haya 300 de otra con el aviso apagado delante (antes: ninguna)', JSON.stringify(r4.d));

sembrar();
for (let i = 0; i < 60; i++) conv('z' + i, 'u1', 21 + i / 100);
lento = 40; process.env.VENTANA_TOPE_MS = '1500';
const t0 = Date.now();
const r5 = await correr();
const tardo = Date.now() - t0;
lento = 0; delete process.env.VENTANA_TOPE_MS;
ok(r5.d.sinTiempo === true && tardo < 3000, 'con el tiempo agotado se detiene y lo dice (' + tardo + ' ms)', JSON.stringify(r5.d));
const r6 = await correr();
ok(TAREAS.length === 60, 'y la pasada siguiente completa las que faltaban', TAREAS.length + ' ' + JSON.stringify(r6.d));

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
