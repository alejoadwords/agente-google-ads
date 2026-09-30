// Informes y consultas sin el tope de mil filas: node pruebas/informes-sin-tope.mjs
//
// PostgREST devuelve mil filas como mucho, pidas lo que pidas, sin error ni
// aviso. El 30-09-2026 había una docena de consultas que pedían `limit=2000`,
// `limit=50000` o nada, y con ello:
//   · el informe de Conversaciones contaba 1.000 conversaciones y medía la
//     respuesta con los mensajes de solo 300; si la base fallaba, decía
//     «Aún no hay conversaciones»;
//   · productividad, NPS, pauta, voz y el consumo de IA contaban una parte y
//     la presentaban como el total;
//   · el panel decía que había mil usuarios como mucho;
//   · borrar un pipeline con más de mil leads movía mil y dejaba el resto
//     colgando de un pipeline borrado, invisibles en todas partes;
//   · un lead que volvía a escribir entraba duplicado si su ficha no estaba
//     entre las 500 más recientes.
//
// Se EJECUTA el código real contra un PostgREST de mentira que filtra y pagina
// como el de verdad: mil filas por respuesta, ni una más.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.ADMIN_SECRET = 'secreto-panel';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};
const resp = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...h } });

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

// ── Un PostgREST pequeño ────────────────────────────────────────────────────
// Filtra por eq, like, in, is.null y not.is.null; ignora el resto (select,
// order…); y corta en mil filas como el de verdad.
let T = {}, peticiones = [], rpcLotes = [], fallaRpc = false, fallaTabla = null;
const TECHO = 1000;
function cumple(fila, k, v) {
  if (!(k in fila)) return true;
  const x = fila[k];
  if (v === 'is.null') return x == null;
  if (v === 'not.is.null') return x != null;
  if (v.startsWith('eq.')) return String(x) === v.slice(3);
  if (v.startsWith('like.')) {
    const re = new RegExp('^' + v.slice(5).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return x != null && re.test(String(x));
  }
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x));
  return true;
}
function filtrar(tabla, sp) {
  return (T[tabla] || []).filter(f => [...sp.entries()].every(([k, v]) => cumple(f, k, v)));
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const metodo = init.method || 'GET';
  if (u.pathname.includes('jwks.json')) return resp(JWKS);
  if (u.hostname !== 'base.falsa') return resp({});
  peticiones.push({ metodo, url: decodeURIComponent(u.pathname + u.search), cuerpo: init.body });
  const tabla = u.pathname.replace('/rest/v1/', '');
  if (tabla === 'rpc/informe_conversaciones') {
    if (fallaRpc) return resp({ message: 'se cayó' }, 500);
    const ids = JSON.parse(init.body).p_ids;
    rpcLotes.push(ids.length);
    return resp(ids.map(id => ({ conversation_id: id, primera_entrada: '2026-09-01T10:00:00Z', primera_respuesta: '2026-09-01T10:05:00Z', mensajes: 3 })));
  }
  if (tabla === fallaTabla) return resp({ message: 'caída' }, 500);
  const filas = filtrar(tabla, u.searchParams);
  if (metodo === 'PATCH') {
    const cambios = JSON.parse(init.body);
    filas.forEach(f => Object.assign(f, cambios));
    return resp(filas.slice(0, TECHO));
  }
  if (metodo === 'DELETE') { T[tabla] = (T[tabla] || []).filter(f => !filas.includes(f)); return new Response(null, { status: 204 }); }
  if (metodo === 'POST') {
    const nuevas = [].concat(JSON.parse(init.body)).map((f, i) => ({ id: `nuevo-${tabla}-${i}`, ...f }));
    (T[tabla] = T[tabla] || []).push(...nuevas);
    return resp(nuevas, 201);
  }
  const offset = +(u.searchParams.get('offset') || 0);
  const limit = Math.min(+(u.searchParams.get('limit') || TECHO), TECHO);
  const pagina = filas.slice(offset, offset + limit);
  const cab = /count=exact/.test(init.headers?.Prefer || '') ? { 'Content-Range': `0-${pagina.length - 1}/${filas.length}` } : {};
  return resp(pagina, 200, cab);
};

const TOKEN = await tokenDe('dueno');
const pedir = (ruta, metodo = 'GET') => new Request('https://app.acuarius.app' + ruta, { method: metodo, headers: { Authorization: 'Bearer ' + TOKEN } });
const muchas = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const reiniciar = () => { peticiones = []; rpcLotes = []; fallaRpc = false; fallaTabla = null; };

// ── 1. Informe de Conversaciones ────────────────────────────────────────────
console.log('\nInforme de Conversaciones');
{
  const h = (await import('../api/chat-conversations.js')).default;
  T = {
    team_members: [],
    chat_conversations: muchas(2500, i => ({ id: 'c' + i, user_id: 'dueno', channel: 'whatsapp', status: 'bot', created_at: '2026-09-10T00:00:00Z' })),
    channel_connections: [{ user_id: 'dueno', channel: 'whatsapp', channel_name: 'WA', is_active: true }],
  };
  reiniciar();
  const r = await h(pedir('/api/chat-conversations?report=1&from=2026-01-01'));
  const d = await r.json();
  ok(r.status === 200 && d.conversations?.length === 2500, 'trae las 2.500 conversaciones, no mil', d.conversations?.length);
  ok(d.total_mensajes === 7500, 'el total de mensajes lo suma la base de todas ellas', d.total_mensajes);
  ok(rpcLotes.reduce((s, n) => s + n, 0) === 2500 && rpcLotes.every(n => n <= 500), 'los tiempos se piden para todas, en lotes de 500', rpcLotes.join(','));
  const pares = d.messages.filter(m => m.conversation_id === 'c2400');
  ok(pares.length === 2 && pares[0].role === 'user' && pares[1].role !== 'user', 'hasta la conversación 2.400 trae su par entrada→respuesta');
  ok(!peticiones.some(p => p.url.startsWith('/rest/v1/chat_messages')), 'no baja los mensajes al servidor: los resume la base');

  reiniciar(); fallaRpc = true;
  const r2 = await h(pedir('/api/chat-conversations?report=1&from=2026-01-01'));
  const d2 = await r2.json();
  ok(r2.status === 502 && /No se pudo/.test(d2.error || ''), 'si la base falla lo dice (502), no pinta «aún no hay conversaciones»', r2.status);
  reiniciar(); fallaTabla = 'chat_conversations';
  const r3 = await h(pedir('/api/chat-conversations?report=1&from=2026-01-01'));
  ok(r3.status === 502, 'y lo mismo si falla la lectura de conversaciones', r3.status);
}

// ── 2. Productividad ────────────────────────────────────────────────────────
console.log('\nInforme de productividad (actividades)');
{
  const h = (await import('../api/lead-activities.js')).default;
  T = { team_members: [], lead_activities: muchas(2300, i => ({ id: 'a' + i, user_id: 'dueno', type: 'llamada', created_at: '2026-09-10T00:00:00Z' })) };
  reiniciar();
  const r = await h(pedir('/api/lead-activities?from=2026-09-01'));
  const d = await r.json();
  ok(r.status === 200 && d.activities?.length === 2300, 'trae las 2.300 actividades, no 2.000 ni mil', d.activities?.length);
  reiniciar(); fallaTabla = 'lead_activities';
  const r2 = await h(pedir('/api/lead-activities?from=2026-09-01'));
  ok(r2.status === 500, 'un fallo se devuelve como error', r2.status);
}

// ── 3. NPS ──────────────────────────────────────────────────────────────────
console.log('\nNPS');
{
  const h = (await import('../api/nps.js')).default;
  T = {
    team_members: [], leads: [],
    nps_responses: muchas(1500, i => ({ id: 'n' + i, user_id: 'dueno', client_id: null, score: i < 1200 ? 10 : 0, sent_at: '2026-09-10T00:00:00Z' })),
  };
  reiniciar();
  const r = await h(pedir('/api/nps'));
  const d = await r.json();
  ok(r.status === 200 && d.sent === 1500 && d.answered === 1500, 'cuenta las 1.500 respuestas', `${r.status} ${d.sent}`);
  ok(d.nps === 60, 'y el NPS sale del total (1.200 promotores, 300 detractores = 60), no de las mil últimas', d.nps);
  reiniciar(); fallaTabla = 'nps_responses';
  const r2 = await h(pedir('/api/nps'));
  ok(r2.status === 502, 'si la base falla lo dice en vez de enseñar un NPS vacío', r2.status);
}

// ── 4. Borrar un pipeline con más de mil leads ──────────────────────────────
console.log('\nBorrar un pipeline');
{
  const h = (await import('../api/pipelines.js')).default;
  T = {
    team_members: [],
    pipelines: [{ id: 'p1', user_id: 'dueno', client_id: null, is_default: false, position: 1 }, { id: 'p0', user_id: 'dueno', client_id: null, is_default: true, position: 0 }],
    pipeline_stages: [{ pipeline_id: 'p0', key: 'nuevo' }, { pipeline_id: 'p0', key: 'contactado' }, { pipeline_id: 'p1', key: 'visita' }],
    leads: muchas(2600, i => ({ id: 'l' + i, user_id: 'dueno', pipeline_id: 'p1', stage: i % 2 ? 'contactado' : 'visita' })),
  };
  reiniciar();
  const r = await h(pedir('/api/pipelines?id=p1', 'DELETE'));
  ok(r.status === 200, 'se borra', r.status);
  const quedan = T.leads.filter(l => l.pipeline_id === 'p1').length;
  ok(quedan === 0, 'ningún lead queda colgando del pipeline borrado', quedan);
  ok(T.leads.filter(l => l.stage === 'contactado').length === 1300, 'los de una etapa que existe en el destino la conservan');
  ok(T.leads.filter(l => l.stage === 'nuevo').length === 1300 && !T.leads.some(l => l.stage === 'visita'), 'los de una etapa que no existe caen en «nuevo»');
}

// ── 5. Panel: usuarios y consumo de IA ──────────────────────────────────────
console.log('\nPanel de administración');
{
  const h = (await import('../api/admin.js')).default;
  const llamar = async (action, query = {}) => {
    let estado = 200, datos;
    const res = { setHeader() {}, status(s) { estado = s; return res; }, json(x) { datos = x; return res; }, end() { return res; } };
    await h({ method: 'GET', headers: { 'x-admin-secret': 'secreto-panel' }, query: { action, ...query }, body: {} }, res);
    return { s: estado, d: datos };
  };
  T = {
    users: muchas(1800, i => ({ id: 'u' + i, email: `u${i}@x.co`, plan: 'free', status: 'active', created_at: '2026-01-01T00:00:00Z' })),
    billing: [], activity_logs: [],
    ai_usage: muchas(3200, i => ({ id: 'ia' + i, user_id: 'u' + (i % 5), origen: 'chat', costo: 0.01, created_at: new Date().toISOString() })),
  };
  reiniciar();
  let r = await llamar('users');
  ok(r.s === 200 && r.d.total === 1800 && r.d.pages === 90, 'la lista de usuarios cuenta 1.800 y 90 páginas, no mil', `${r.d?.total} ${r.d?.pages}`);
  r = await llamar('metrics');
  ok(r.s === 200 && JSON.stringify(r.d).includes('1800'), 'las métricas cuentan los 1.800 usuarios');
  r = await llamar('uso-ia');
  ok(r.s === 200 && r.d.llamadas === 3200 && Math.abs(r.d.total - 32) < 0.001, 'el consumo de IA suma las 3.200 llamadas', `${r.d?.llamadas} ${r.d?.total}`);
  reiniciar(); fallaTabla = 'ai_usage';
  r = await llamar('uso-ia');
  ok(r.s === 502, 'y si la base falla no dice «$0 gastado»', r.s);
}

// ── 6. Un lead que vuelve a escribir ────────────────────────────────────────
console.log('\nLead que vuelve a escribir');
{
  const { intakeLead } = await import('../api/_lead-intake.js');
  // 1.500 leads con teléfono, todos terminados en 99 para que el filtro por la
  // cola no alcance a descartarlos y haga falta pasar de la primera página. El
  // que vuelve es el más antiguo de todos, fuera de los 500 de antes.
  T = {
    leads: muchas(1500, i => ({ id: 'L' + i, user_id: 'dueno', client_id: null, deleted_at: null, name: 'Lead ' + i,
      phone: '+57 300 ' + String(100000 + i).slice(-5) + '99', created_at: new Date(Date.UTC(2026, 0, 1) + (1500 - i) * 60e3).toISOString(), tags: [] })),
  };
  const viejo = T.leads[1499];
  reiniciar();
  let lead;
  try { lead = await intakeLead('dueno', null, { name: 'Vuelve', phone: '300' + viejo.phone.replace(/\D/g, '').slice(-7) }); } catch (e) { lead = { error: e.message }; }
  const creados = peticiones.filter(p => p.metodo === 'POST' && p.url.startsWith('/rest/v1/leads')).length;
  ok(creados === 0, 'no crea un duplicado', creados);
  ok((lead?.lead?.id || lead?.id) === viejo.id, 'lo reconoce aunque sea el más antiguo de la cuenta', JSON.stringify(lead).slice(0, 120));
  const busqueda = peticiones.find(p => p.url.startsWith('/rest/v1/leads') && /phone=like/.test(p.url));
  ok(!!busqueda, 'la base filtra por la cola del número en vez de traer los últimos 500');
}

console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
