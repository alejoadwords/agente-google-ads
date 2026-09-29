// La agenda completa y por asesor: node pruebas/agenda-por-asesor.mjs
//
// El 29-09-2026 el calendario de Certain & Pezzano escondía citas: pedía 500
// actividades ordenadas de la más antigua a la más nueva y en la cuadrícula
// había 643. El 29 salía con 19 de 70, el 30 vacío (45) y octubre vacío. Y el
// aviso de choque al agendar una cita mandaba ?desde=&hasta=, que el servidor
// no lee: comparaba con lo más viejo de la cuenta y no saltaba nunca.
//
// Se EJECUTA el endpoint real con una sesión de verdad y un Supabase de
// mentira que pagina como el de verdad (1.000 filas como mucho), y las
// funciones reales de la pantalla.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';

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

// ── El mundo de mentira ─────────────────────────────────────────────────────
const EQUIPO = { deysy: { owner_user_id: 'dueno', role: 'ventas', client_id: null }, jefa: { owner_user_id: 'dueno', role: 'admin', client_id: null } };
const ASESORES = [['deysy', 'Deysy Pacheco'], ['patri', 'Patricia Maria\tPerez Charris'], ['maira', 'Maira Ballesteros']];
let ACTS = [], LEADS = {}, peticiones = [], falla = null;
function sembrar(n, { pendientes = false } = {}) {
  ACTS = []; LEADS = {};
  for (let i = 0; i < n; i++) {
    const leadId = 'l' + (i % 300);
    const [asesor, nombre] = ASESORES[i % 3];
    if (!LEADS[leadId]) LEADS[leadId] = { id: leadId, name: 'Lead ' + i, assigned_to: asesor, assigned_name: nombre, stage: 'nuevo' };
    ACTS.push({ id: 'a' + String(i).padStart(5, '0'), user_id: 'dueno', client_id: null, lead_id: i % 97 === 0 ? null : leadId,
      type: i % 5 === 0 ? 'meeting' : 'task', title: 'Actividad ' + i, done: false,
      due_at: new Date(Date.UTC(2026, 8, 1) + i * 3600e3 / 2).toISOString() });
  }
  if (pendientes) ACTS.forEach(a => { a.due_at = new Date(Date.now() - 86400e3 + Number(a.id.slice(1)) * 60e3).toISOString(); });
}

globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  if (u.includes('jwks.json')) return resp(JWKS);
  if (u.includes('/team_members')) {
    const quien = (u.match(/member_user_id=eq\.([^&]+)/) || [])[1];
    return resp(EQUIPO[quien] ? [EQUIPO[quien]] : []);
  }
  if (u.includes('/rest/v1/activities')) {
    peticiones.push(u);
    if (falla) return resp({ message: falla }, 500);
    const limit = Math.min(Number((u.match(/[?&]limit=(\d+)/) || [])[1] || 1000), 1000);   // PostgREST corta en mil
    const offset = Number((u.match(/[?&]offset=(\d+)/) || [])[1] || 0);
    return resp(ACTS.slice(offset, offset + limit));
  }
  if (u.includes('/rest/v1/leads')) {
    const ids = ((u.match(/id=in\.\(([^)]*)\)/) || [])[1] || '').split(',').filter(Boolean);
    peticiones.push('leads:' + ids.length + ':' + u.length);
    return resp(ids.map(id => LEADS[id]).filter(Boolean));
  }
  return resp([]);
};

const mod = await import('../api/agenda.js');
const agenda = mod.default;
const { todasLasFilas, nombreLimpio } = mod;
async function pedir(sub, ruta) {
  peticiones = [];
  const r = await agenda(new Request('https://x/api/agenda' + ruta, { headers: { Authorization: 'Bearer ' + await tokenDe(sub) } }));
  return { status: r.status, d: await r.json() };
}
const RANGO = '?from=' + encodeURIComponent('2026-08-24T00:00:00Z') + '&to=' + encodeURIComponent('2026-10-09T00:00:00Z');

// ── 1. El corte ─────────────────────────────────────────────────────────────
console.log('\nEl calendario trae el mes entero\n');
{
  sembrar(643);
  const r = await pedir('dueno', RANGO);
  ok(r.status === 200 && r.d.activities.length === 643, 'las 643 actividades de Certain en septiembre, no 500', r.d.activities?.length);
  const ultima = r.d.activities[r.d.activities.length - 1];
  ok(ultima?.id === 'a00642', 'incluidas las ÚLTIMAS, que eran las que se perdían (el 29, el 30, octubre)');
  ok(r.d.truncado === false, 'y no se da por cortado');

  sembrar(2345);
  const r2 = await pedir('dueno', RANGO);
  const pags = peticiones.filter(p => p.includes('/activities'));
  ok(r2.d.activities.length === 2345 && pags.length === 3, 'con más de mil pide página a página (' + pags.length + ' páginas)', r2.d.activities.length);
  ok(new Set(r2.d.activities.map(a => a.id)).size === 2345, 'sin repetir ni saltarse ninguna');
  ok(pags.every(p => /order=due_at\.asc,id\.asc/.test(p)), 'con un orden estable (la hora y luego el id) para que la paginación no baile');

  const t = await todasLasFilas('https://base.falsa/rest/v1/activities?x=1', { pagina: 1000, techo: 2000 });
  ok(t.truncado === true && t.filas.length === 2000, 'con un techo, se dice que se cortó en vez de callarlo');

  falla = 'se cayó'; const r3 = await pedir('dueno', RANGO); falla = null;
  ok(r3.status === 502 && /No se pudo leer la agenda/.test(r3.d.error || ''), 'si la base falla, un error que se ve —antes era un mes vacío—', JSON.stringify(r3.d));
}

// ── 2. El asesor de cada actividad ──────────────────────────────────────────
console.log('\nCada actividad sabe de quién es\n');
{
  sembrar(643);
  const r = await pedir('dueno', RANGO);
  const a1 = r.d.activities.find(a => a.id === 'a00001');
  ok(a1?.asesor_id === 'patri' && a1?.asesor_nombre === 'Patricia Maria Perez Charris', 'el asesor sale del lead, con el nombre limpio del tabulador', JSON.stringify(a1));
  const sinLead = r.d.activities.find(a => !a.lead_id);
  ok(sinLead && sinLead.asesor_id === null, 'una actividad sin lead queda sin asesor');
  const tandas = peticiones.filter(p => p.startsWith('leads:')).map(p => p.split(':'));
  ok(tandas.length >= 2 && tandas.every(t => Number(t[1]) <= 150), 'los leads se piden por tandas de 150 (' + tandas.length + ' tandas)', tandas.map(t => t[1]).join(','));
  ok(tandas.every(t => Number(t[2]) < 8000), 'y ninguna URL se acerca al límite (antes, con 600 ids, pasaba de 20 KB)', Math.max(...tandas.map(t => Number(t[2]))));
  ok(nombreLimpio('  Patricia\tMaria  ') === 'Patricia Maria', 'nombreLimpio junta los espacios raros');
}

// ── 3. Quién ve qué ─────────────────────────────────────────────────────────
console.log('\nEl perfil Ventas sigue viendo solo lo suyo\n');
{
  sembrar(643);
  const v = await pedir('deysy', RANGO);
  const ajenas = v.d.activities.filter(a => a.lead_id && a.asesor_id !== 'deysy');
  ok(v.d.activities.length > 0 && ajenas.length === 0, 'Deysy ve las suyas y ni una de sus compañeras', ajenas.length + ' ajenas');
  ok(v.d.activities.some(a => !a.lead_id), 'y conserva las que no cuelgan de ningún lead');
  const j = await pedir('jefa', RANGO);
  ok(j.d.activities.length === 643, 'una administradora ve las de todo el equipo');
}

// ── 4. Tareas ───────────────────────────────────────────────────────────────
console.log('\nLa lista de tareas tampoco se corta\n');
{
  sembrar(1200, { pendientes: true });
  const r = await pedir('dueno', '?tareas=1&dias=90');
  ok(r.status === 200 && r.d.total === 1200, 'las 1.200 pendientes, no 400', r.d.total);
  falla = 'x'; const r2 = await pedir('dueno', '?tareas=1'); falla = null;
  ok(r2.status === 502, 'y si la base falla, se dice');
}

// ── 5. La pantalla ──────────────────────────────────────────────────────────
console.log('\nLa pantalla\n');
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const cuerpo = (firma) => {
  const i = js.indexOf(firma);
  if (i < 0) throw new Error('No encontré ' + firma);
  let prof = 0, j = i + firma.length - 1;
  for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
  return js.slice(i, j + 1);
};
{
  const porAsesor = new Function(cuerpo('function agnPorAsesor(acts, y, m) {') + '; return agnPorAsesor;')();
  const acts = [
    { due_at: '2026-09-10T15:00:00Z', asesor_id: 'patri', asesor_nombre: 'Patricia Perez' },
    { due_at: '2026-09-11T15:00:00Z', asesor_id: 'patri', asesor_nombre: 'Patricia Perez' },
    { due_at: '2026-09-12T15:00:00Z', asesor_id: 'deysy', asesor_nombre: 'Deysy Pacheco' },
    { due_at: '2026-09-12T15:00:00Z', asesor_id: null },
    { due_at: '2026-10-02T15:00:00Z', asesor_id: 'maira', asesor_nombre: 'Maira' },   // otro mes: no cuenta
  ];
  const g = porAsesor(acts, 2026, 8);
  ok(g.length === 3 && g.find(p => p.id === 'patri').total === 2, 'cuenta por asesor solo el mes visible', JSON.stringify(g));
  ok(g[0].id === 'deysy' && g[1].id === 'patri' && g[2].id === '__nadie__', 'en orden alfabético y «Sin asignar» al final');

  const filtro = new Function('esc', cuerpo('function agnFiltroAsesores(gente, elegido) {') + '; return agnFiltroAsesores;')(x => String(x));
  ok(filtro([g[0]], '') === '', 'con una sola persona no se pinta el desplegable');
  const html = filtro(g, 'patri');
  ok(/<select id="agn-f-asesor"/.test(html) && !/tar-chip/.test(html), 'es un desplegable, no una fila de botones (con 20 asesores no cabría)');
  ok(/<option value="">Todo el equipo \(4\)<\/option>/.test(html), '«Todo el equipo» con su total', html.slice(0, 300));
  ok(/<option value="patri" data-nombre="Patricia Perez" selected>Patricia Perez \(2\)<\/option>/.test(html), 'y la elegida marcada, con su número');
  const veinte = Array.from({ length: 20 }, (_, i) => ({ id: 'u' + i, nombre: 'Asesor ' + i, total: i }));
  ok((filtro(veinte, '').match(/<option/g) || []).length === 21, 'con veinte asesores, veinte opciones y «Todo el equipo»');
}
{
  // agnLoad: un error del servidor se dice, no se pinta como un mes vacío.
  const toasts = [];
  const cargar = new Function('fetchAuth', 'showToast', 'agencyActiveClientId',
    'let agnCursor = new Date(2026, 8, 1), agnActivities = [1], agnGcal = { checked: true };' +
    cuerpo('async function agnLoad() {') + '; return async () => { await agnLoad(); return agnActivities; };')(
    async () => ({ ok: false, status: 502, json: async () => ({ error: 'No se pudo leer la agenda (HTTP 500). Reintenta en unos segundos.' }) }),
    (t, k) => toasts.push([t, k]), null);
  const quedan = await cargar();
  ok(quedan.length === 0 && toasts[0]?.[1] === 'error' && /No se pudo leer la agenda/.test(toasts[0][0]), 'un 502 del servidor sale como aviso con su motivo', JSON.stringify(toasts));
}
{
  // El aviso de choque: el día correcto y solo las reuniones de quien atiende.
  const pedidas = [];
  const dia = [
    { type: 'meeting', due_at: '2026-10-05T15:00:00.000Z', asesor_id: 'deysy', title: 'Reunión de Deysy' },
    { type: 'meeting', due_at: '2026-10-05T15:00:00.000Z', asesor_id: 'patri', title: 'Reunión de Patricia' },
    { type: 'task', due_at: '2026-10-05T15:00:00.000Z', asesor_id: 'deysy', title: 'Seguimiento de Deysy' },
  ];
  const box = { innerHTML: '' };
  const ini = new Date('2026-10-05T15:30:00.000Z');
  const revisar = new Function('document', 'citaCuando', 'crmAmbitoCliente', 'fetchAuth', '_citaCtx', 'esc', 'icn', 'citaHora',
    cuerpo('async function citaRevisarChoque() {') + '; return citaRevisarChoque;')(
    { getElementById: () => box }, () => ({ ini, fin: new Date(ini.getTime() + 3600e3) }), () => '',
    async (u) => { pedidas.push(u); return { json: async () => ({ activities: dia }) }; },
    { lead: { assigned_to: 'deysy' } }, x => String(x), () => '', () => '');
  await revisar();
  const q = new URL('https://x' + pedidas[0]).searchParams;
  ok(q.get('from') && q.get('to') && !q.get('desde'), 'pide el día con from/to, que es lo que lee el servidor', pedidas[0]);
  const ancho = new Date(q.get('to')) - new Date(q.get('from'));
  ok(ancho > 23 * 3600e3 && ancho < 24 * 3600e3 + 1, 'y exactamente ese día');
  ok(box.innerHTML.includes('Reunión de Deysy') && !box.innerHTML.includes('Patricia') && !box.innerHTML.includes('Seguimiento'),
     'avisa del choque con la reunión de SU asesora, no con las de otras ni con un seguimiento', box.innerHTML.slice(0, 200));
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
