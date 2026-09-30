// El seguimiento del agente no se atasca: node pruebas/seguimiento-sin-atasco.mjs
//
// 30-09-2026: el cron tomaba las 60 conversaciones calladas MÁS ANTIGUAS y
// saltaba sin marcar las que no podía retomar (ya seguidas, último mensaje de
// la persona, sin agente o sin canal, sin cupo). Esas ocupaban los 60 puestos
// durante 24 h y las conversaciones nuevas no se miraban nunca. Se ejecuta el
// cron real, a una hora hábil, con 250 atascadas y 50 recién calladas.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CRON_SECRET = 'cron';
process.env.CLERK_SECRET_KEY = 'sk';
delete process.env.TOKENS_KEY;
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

// Las 10:00 de Colombia (15:00 UTC): hora hábil para el cron.
const RealDate = Date;
const FIJO = RealDate.UTC(2026, 8, 30, 15, 0, 0);
let desfase = 0;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [FIJO + desfase + (RealDate.now() - T0)])); }
  static now() { return FIJO + desfase + (RealDate.now() - T0); }
};
const T0 = RealDate.now();
const hace = (min) => new RealDate(FIJO - min * 60000).toISOString();

let CONVS = [], MENSAJES = {}, enviados = [], lecturas = { conexiones: 0, agentes: 0, mensajes: 0 }, caeLista = false, lento = 0;
function sembrar() {
  CONVS = []; MENSAJES = {}; enviados = []; lecturas = { conexiones: 0, agentes: 0, mensajes: 0 };
  // 250 atascadas: calladas hace horas, pero el último mensaje es de la persona
  // (algo falló al responderle) — el cron no puede retomarlas.
  for (let i = 0; i < 250; i++) {
    const id = 'viejo' + i;
    CONVS.push({ id, user_id: 'u1', agent_id: 'ag1', connection_id: 'cx1', channel: 'whatsapp', contact_id: '57300' + i, status: 'bot',
      last_message_at: hace(600 + i), last_inbound_at: hace(600 + i), seguimiento_at: null });
    MENSAJES[id] = [{ role: 'user', content: 'hola' }];
  }
  // 50 recién calladas: el agente respondió hace 12–60 minutos y la persona no contestó.
  for (let i = 0; i < 50; i++) {
    const id = 'nuevo' + i;
    CONVS.push({ id, user_id: 'u1', agent_id: 'ag1', connection_id: 'cx1', channel: 'whatsapp', contact_id: '57311' + i, status: 'bot',
      last_message_at: hace(12 + i), last_inbound_at: hace(13 + i), seguimiento_at: null });
    MENSAJES[id] = [{ role: 'assistant', content: '¿En qué zona le interesa?' }, { role: 'user', content: 'Busco apartamento' }];
  }
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = init.method || 'GET';
  if (lento) await new Promise(r => setTimeout(r, lento));
  if (u.startsWith('https://graph.facebook.com')) { enviados.push(JSON.parse(init.body || '{}').to); return resp({ messages: [{ id: 'w' }] }); }
  if (u.includes('api.clerk.com')) return resp({ public_metadata: { plan: 'pro' } });
  const q = new URL(u.replace('/rest/v1', ''), 'https://x').searchParams;
  if (u.includes('/chat_conversations')) {
    if (m === 'PATCH') {
      const id = q.get('id').slice(3), c = CONVS.find(x => x.id === id), b = JSON.parse(init.body);
      Object.assign(c, b);
      return new Response(null, { status: 204 });
    }
    if (caeLista) return resp({ message: 'caída' }, 503);
    const corte = q.get('last_message_at').slice(3), ventana = q.get('last_inbound_at').slice(3);
    let filas = CONVS.filter(c => c.status === 'bot' && c.last_message_at < corte && c.last_inbound_at > ventana);
    const orden = q.get('order') || '';
    filas.sort((a, b) => orden.startsWith('last_message_at.desc') ? b.last_message_at.localeCompare(a.last_message_at) : a.last_message_at.localeCompare(b.last_message_at));
    const off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || 1000), 1000);
    return resp(filas.slice(off, off + lim));
  }
  if (u.includes('/chat_messages')) {
    if (m === 'POST') return new Response(null, { status: 201 });
    lecturas.mensajes++;
    return resp(MENSAJES[q.get('conversation_id').slice(3)] || []);
  }
  if (u.includes('/channel_connections')) { lecturas.conexiones++; return resp([{ id: 'cx1', channel: 'whatsapp', external_id: 'num1', access_token: 'tok', is_active: true }]); }
  if (u.includes('/chat_agents')) { lecturas.agentes++; return resp([{ tone: 'formal' }]); }
  if (u.includes('/ai_usage') || u.includes('/rpc/')) return resp([]);
  return m === 'GET' ? resp([]) : new Response(null, { status: 201 });
};

const cron = (await import('../api/cron-seguimiento.js')).default;
const correr = async () => { const r = await cron(new Request('https://x/api/cron-seguimiento', { headers: { authorization: 'Bearer cron' } })); return { s: r.status, d: await r.json() }; };

sembrar();
const r1 = await correr();
const nuevos = CONVS.filter(c => c.id.startsWith('nuevo') && c.seguimiento_at).length;
ok(r1.s === 200 && nuevos === 50, 'las 50 recién calladas reciben su seguimiento, aunque haya 250 atascadas (antes: ninguna)', JSON.stringify(r1.d) + ' nuevos=' + nuevos);
ok(enviados.length === 50, 'sale un mensaje por cada una', enviados.length);
ok(lecturas.conexiones === 1 && lecturas.agentes === 1, 'el canal y el agente se leen UNA vez por corrida (antes una por conversación)', JSON.stringify(lecturas));

const r2 = await correr();
ok(r2.d.enviados === 0, 'diez minutos después no se insiste: una sola vez por cada mensaje de la persona', JSON.stringify(r2.d));

// Las atascadas pueden ser MÁS recientes que las válidas: 250 que se callaron
// hace 11 min con el último mensaje de la persona, y las 50 buenas detrás.
sembrar();
CONVS.filter(c => c.id.startsWith('viejo')).forEach((c, i) => { c.last_message_at = hace(11 + i / 1000); c.last_inbound_at = hace(11); });
CONVS.filter(c => c.id.startsWith('nuevo')).forEach((c, i) => { c.last_message_at = hace(30 + i); c.last_inbound_at = hace(31 + i); });
const r5 = await correr();
ok(CONVS.filter(c => c.id.startsWith('nuevo') && c.seguimiento_at).length === 50, 'aunque las válidas queden detrás de 250 atascadas, se llega a ellas (segunda página)', JSON.stringify(r5.d));

// Un envío que falló deja la marca pero no mueve last_message_at: sigue
// calificando para la consulta. No se le puede volver a escribir.
sembrar();
CONVS.filter(c => c.id.startsWith('nuevo')).slice(0, 10).forEach(c => { c.seguimiento_at = hace(5); });
const r6 = await correr();
ok(r6.d.enviados === 40, 'a la que ya se le intentó no se le insiste aunque siga en la lista', JSON.stringify(r6.d));

sembrar();
lento = 60; process.env.SEGUIMIENTO_TOPE_MS = '2000';
const t0 = RealDate.now();
const r3 = await correr();
const tardo = RealDate.now() - t0;
lento = 0; delete process.env.SEGUIMIENTO_TOPE_MS;
ok(r3.s === 200 && r3.d.sinTiempo === true && tardo < 3500, 'con el tiempo agotado se detiene a tiempo (' + tardo + ' ms) y lo dice', JSON.stringify(r3.d));
ok(r3.d.enviados > 0 && CONVS.filter(c => c.id.startsWith('nuevo') && c.seguimiento_at).length === r3.d.enviados, 'y lo que alcanzó son las recién calladas, no las atascadas', JSON.stringify(r3.d));

sembrar();
caeLista = true;
const r4 = await correr();
caeLista = false;
ok(r4.s === 500 && /no se pudieron leer las conversaciones/.test(r4.d.error || ''), 'si no se pueden leer las conversaciones, falla a la vista (antes: «0 miradas, todo bien»)', JSON.stringify(r4.d));

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
