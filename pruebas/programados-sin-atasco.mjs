// Los mensajes programados no se quedan en «enviando»: node pruebas/programados-sin-atasco.mjs
//
// 30-09-2026: cron-programados mandaba sus 40 en serie sin mirar el reloj. Si
// la función se cortaba a mitad de un envío, la fila se quedaba en «enviando»
// para siempre (solo se leen las «pendiente») y la pantalla decía «Enviándose
// ahora…» eternamente. Se ejecuta el cron real.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CRON_SECRET = 'cron';
delete process.env.TOKENS_KEY;
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const hace = (min) => new Date(Date.now() - min * 60000).toISOString();

let FILAS = [], salieron = [], lento = 0;
function sembrar(n, extra = []) {
  FILAS = Array.from({ length: n }, (_, i) => ({ id: 'p' + String(i).padStart(3, '0'), conversation_id: 'c1', texto: 'Hola ' + i, estado: 'pendiente', enviar_at: hace(1 + i / 100), reservado_at: null, error: null }));
  FILAS.push(...extra);
  salieron = [];
}
function cumple(f, q) {
  for (const [k, v] of q) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    if (k === 'or') {   // (reservado_at.is.null,reservado_at.lt.X)
      const lt = v.match(/reservado_at\.lt\.([^)]+)\)/)[1];
      if (!(f.reservado_at == null || f.reservado_at < lt)) return false;
      continue;
    }
    if (v.startsWith('eq.') && String(f[k]) !== v.slice(3)) return false;
    if (v.startsWith('lte.') && !(f[k] <= v.slice(4))) return false;
  }
  return true;
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = init.method || 'GET';
  if (lento) await new Promise(r => setTimeout(r, lento));
  if (u.startsWith('https://graph.facebook.com')) { salieron.push(JSON.parse(init.body || '{}')); return resp({ messages: [{ id: 'w' + salieron.length }] }); }
  const q = new URL(u.replace('/rest/v1', ''), 'https://x').searchParams;
  if (u.includes('/scheduled_messages')) {
    const hits = FILAS.filter(f => cumple(f, q));
    if (m === 'PATCH') { const b = JSON.parse(init.body); hits.forEach(f => Object.assign(f, b)); return resp(hits); }
    return resp(hits.sort((a, b) => a.enviar_at.localeCompare(b.enviar_at)).slice(0, Number(q.get('limit') || 1000)));
  }
  if (u.includes('/chat_conversations')) return m === 'GET' ? resp([{ id: 'c1', connection_id: 'cx1', channel: 'whatsapp', contact_id: '573001112233' }]) : resp([]);
  if (u.includes('/channel_connections')) return resp([{ id: 'cx1', channel: 'whatsapp', external_id: 'num1', access_token: 'tok', is_active: true }]);
  return m === 'GET' ? resp([]) : resp([]);
};
const mod = await import('../api/cron-programados.js');
const correr = async () => { const r = await mod.default(new Request('https://x/api/cron-programados', { headers: { authorization: 'Bearer cron' } })); return { s: r.status, d: await r.json() }; };

sembrar(5);
const r1 = await correr();
ok(r1.d.enviados === 5 && FILAS.every(f => f.estado === 'enviado'), 'los que tocan salen y quedan como enviados', JSON.stringify(r1.d));
ok(FILAS.every(f => f.reservado_at), 'y se apunta cuándo se tomaron (reservado_at)');

// Uno que se quedó a medias hace 20 min, otro de antes de la columna, y uno
// que se está enviando AHORA mismo en otra corrida.
sembrar(0, [
  { id: 'cortado', conversation_id: 'c1', texto: 'x', estado: 'enviando', enviar_at: hace(25), reservado_at: hace(20), error: null },
  { id: 'viejo', conversation_id: 'c1', texto: 'y', estado: 'enviando', enviar_at: hace(60 * 24), reservado_at: null, error: null },
  { id: 'enCurso', conversation_id: 'c1', texto: 'z', estado: 'enviando', enviar_at: hace(3), reservado_at: hace(1), error: null },
]);
const r2 = await correr();
const f = (id) => FILAS.find(x => x.id === id);
ok(f('cortado').estado === 'fallido' && f('viejo').estado === 'fallido', 'los que llevan más de 10 min «enviando» pasan a fallido (antes: para siempre)', JSON.stringify(FILAS.map(x => x.id + ':' + x.estado)));
ok(/Revisa en la conversación si le llegó/.test(f('cortado').error || ''), 'con el motivo a la vista, para que alguien decida si reenviar');
ok(f('enCurso').estado === 'enviando', 'uno que se está enviando ahora mismo no se toca');
ok(salieron.length === 0, 'y ninguno se reenvía solo (no se sabe si llegó: mejor avisar que duplicar)');
ok(r2.d.recuperados === 2, 'la corrida cuenta cuántos recuperó', JSON.stringify(r2.d));

sembrar(40);
lento = 120; process.env.PROGRAMADOS_TOPE_MS = '1500';
const t0 = Date.now();
const r3 = await correr();
const tardo = Date.now() - t0;
lento = 0; delete process.env.PROGRAMADOS_TOPE_MS;
ok(r3.d.sinTiempo > 0 && tardo < 3000, 'con el tiempo agotado deja de tomar nuevos (' + tardo + ' ms)', JSON.stringify(r3.d));
ok(FILAS.filter(x => x.estado === 'enviando').length === 0, 'y no deja ninguno a medias en «enviando»');
ok(FILAS.filter(x => x.estado === 'pendiente').length === r3.d.sinTiempo, 'los que no alcanzó siguen pendientes, para la corrida siguiente');
const r4 = await correr();
ok(FILAS.every(x => x.estado === 'enviado') && salieron.length === 40, 'y la siguiente corrida los manda, sin repetir ninguno', JSON.stringify(r4.d) + ' salieron=' + salieron.length);

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
