// Los tres primeros arreglos de escala (30-09-2026): node pruebas/escala-tres-primeros.mjs
//
// 1. Disparadores de inactividad: ~200 llamadas por automatización en cada
//    corrida y siempre los mismos 100 leads. Con ~10 automatizaciones se comían
//    los 120 s y no se ejecutaba ningún paso de nadie.
// 2. /api/voz: cada pestaña preguntaba cada 3 s si estaba en la beta.
// 3. /api/soporte GET: pedía el correo a Clerk cada 2 min por pestaña sin usarlo.
// Todo se EJECUTA contra un Supabase de mentira que corta en mil filas.

import { readFileSync } from 'node:fs';
process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CLERK_SECRET_KEY = 'sk';
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

// ── Mundo de mentira ────────────────────────────────────────────────────────
let LEADS = [], JOBS = [], TAREAS = [], llamadas = [], clerk = 0;
const hace = (d) => new Date(Date.now() - d * 864e5).toISOString();
function sembrar(n, { conTrabajo = 0 } = {}) {
  LEADS = Array.from({ length: n }, (_, i) => ({ id: 'l' + String(i).padStart(5, '0'), user_id: 'u1', client_id: null, stage: 'nuevo', closed_at: null, deleted_at: null, updated_at: hace(10 + (i % 50)) }));
  JOBS = LEADS.slice(0, conTrabajo).map(l => ({ id: 'j' + l.id, automation_id: 'a1', lead_id: l.id }));
  TAREAS = []; llamadas = [];
}
function filtra(u, filas) {
  const q = new URL(u.replace('/rest/v1', ''), 'https://x').searchParams;
  let r = filas;
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    if (v.startsWith('eq.')) r = r.filter(f => String(f[k] ?? '') === v.slice(3));
    else if (v === 'is.null') r = r.filter(f => f[k] == null);
    else if (v.startsWith('lt.')) r = r.filter(f => f[k] < v.slice(3));
    else if (v.startsWith('in.(')) { const s = new Set(v.slice(4, -1).split(',')); r = r.filter(f => s.has(f[k])); }
  }
  const off = Number(q.get('offset') || 0), lim = Math.min(Number(q.get('limit') || 1000), 1000);
  return r.slice(off, off + lim);
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = init.method || 'GET';
  if (u.includes('api.clerk.com')) { clerk++; return resp({ public_metadata: { plan: 'pro' }, email_addresses: [{ email_address: 'x@y.co' }] }); }
  if (!u.includes('/rest/v1/')) return resp({});
  llamadas.push(m + ' ' + u.split('/rest/v1')[1].split('?')[0]);
  if (u.includes('/automation_jobs')) {
    if (m === 'POST') { const rows = JSON.parse(init.body); JOBS.push(...rows); return new Response(null, { status: 201 }); }
    return resp(filtra(u, JOBS));
  }
  if (u.includes('/leads')) return resp(filtra(u, LEADS));
  if (u.includes('/activities')) return resp(filtra(u, TAREAS));
  if (u.includes('/automations')) return resp([{ id: 'a1', user_id: 'u1', client_id: null, active: true, trigger: { type: 'lead_inactive', days: 3 } }]);
  return m === 'GET' ? resp([]) : new Response(null, { status: 201 });
};

const motor = await import('../api/cron-automations.js');
const auto = { id: 'a1', user_id: 'u1', client_id: null, trigger: { type: 'lead_inactive', days: 3 } };
const lejos = Date.now() + 60e3;

console.log('\nDisparadores de inactividad\n');
{
  sembrar(2500, { conTrabajo: 300 });
  const c = await motor.candidatosInactivos(auto, lejos);
  const leads = llamadas.filter(x => x.includes('/leads')).length;
  const jobs = llamadas.filter(x => x.includes('/automation_jobs')).length;
  ok(c.length === motor.NUEVOS_POR_AUTOMATIZACION, 'encola hasta 100 nuevos por automatización y corrida', c.length);
  ok(c.every(l => !JOBS.some(j => j.lead_id === l.id)), 'ninguno de los que ya tenían trabajo (antes volvían siempre los mismos 100)');
  ok(llamadas.length <= 5 && leads <= 2 && jobs === 1, 'con pocas consultas: ' + llamadas.length + ' (antes ~200, una por lead)', llamadas.join(' | '));

  sembrar(1500, { conTrabajo: 1200 });
  const c2 = await motor.candidatosInactivos(auto, lejos);
  ok(c2.length === 100 && c2.every(l => Number(l.id.slice(1)) >= 1200 || !JOBS.some(j => j.lead_id === l.id)),
     'con 1.200 ya encolados, llega a los que están pasado el registro mil', c2.length);

  sembrar(150);
  TAREAS = [{ lead_id: LEADS[5].id, done: false, cancelled_at: null, due_at: new Date(Date.now() + 864e5).toISOString() }];
  LEADS[7].closed_at = hace(1); LEADS[8].stage = 'Ganado';
  const c3 = await motor.candidatosInactivos(auto, lejos);
  const ids = new Set(c3.map(l => l.id));
  ok(!ids.has(LEADS[5].id), 'el que tiene una tarea agendada no está inactivo (se respeta)');
  ok(!ids.has(LEADS[7].id) && !ids.has(LEADS[8].id), 'ni los cerrados');

  // 30.000 inactivos y casi todos ya encolados: sin reloj recorrería 30 páginas.
  sembrar(30000, { conTrabajo: 29950 });
  const c4 = await motor.candidatosInactivos(auto, Date.now() - 1);
  const paginas = llamadas.filter(x => x.includes('/leads')).length;
  ok(paginas === 0 && c4.length === 0, 'con el tiempo agotado no se queda recorriendo páginas de leads (' + paginas + ')');
  const src = readFileSync(new URL('../api/cron-automations.js', import.meta.url), 'utf8');
  ok(/export const TOPE_DISPARADORES_MS = 45 \* 1000;/.test(src) && /if \(Date\.now\(\) >= hasta\) \{ sinTiempo\+\+; continue; \}/.test(src),
     'la fase de disparadores se corta a los 45 s y deja el resto para ejecutar pasos');
  ok(src.indexOf('await processInactiveTriggers()') < src.indexOf('await processJobs()'), 'y después se ejecutan los trabajos');
}

console.log('\nLa beta de voz se pregunta una vez\n');
{
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = js.indexOf('let _vozEstado = null;'), j = js.indexOf('function vozAbrir()');
  let peticiones = 0, enciende = 0, falla = false;
  const f = new Function('VozReco', 'vozMicPermitido', 'fetchAuth', 'document', 'vozColocar', 'vozEnchufar',
    js.slice(i, j) + '; return vozArrancar;')(
    true, () => true, async () => { peticiones++; if (falla) throw new TypeError('Failed to fetch'); return { ok: true, json: async () => ({ habilitado: true }) }; },
    { getElementById: () => ({ classList: { add() {} }, setAttribute() {} }) }, () => {}, () => { enciende++; });
  for (let k = 0; k < 40; k++) await f();     // dos minutos de sopMostrarBurbuja cada 3 s
  ok(peticiones === 1, 'cuarenta llamadas seguidas preguntan UNA vez (antes 40)', peticiones);
  ok(enciende === 1, 'y la voz se enchufa una vez, no cada 3 s', enciende);

  const g = new Function('VozReco', 'vozMicPermitido', 'fetchAuth', 'document', 'vozColocar', 'vozEnchufar',
    js.slice(i, j) + '; return vozArrancar;')(
    true, () => true, async () => { peticiones++; throw new TypeError('Failed to fetch'); }, { getElementById: () => null }, () => {}, () => {});
  peticiones = 0;
  for (let k = 0; k < 40; k++) await g();
  ok(peticiones === 1, 'si falla, no insiste cada 3 s: espera 5 minutos', peticiones);
}

console.log('\nEl GET de soporte no llama a Clerk\n');
{
  const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const JWKS = { keys: [{ ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
  const cab = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const cuerpo = b64u(JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(`${cab}.${cuerpo}`));
  const token = `${cab}.${cuerpo}.${b64u(new Uint8Array(firma))}`;
  const previo = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).includes('jwks.json') ? resp(JWKS) : previo(u, i);
  const soporte = (await import('../api/soporte.js')).default;
  clerk = 0;
  const r = await soporte(new Request('https://x/api/soporte', { headers: { Authorization: 'Bearer ' + token } }));
  ok(r.status === 200 && clerk === 0, 'el GET responde sin consultar a Clerk (antes una llamada cada 2 min por pestaña)', r.status + ' clerk=' + clerk);
  const src = readFileSync(new URL('../api/soporte.js', import.meta.url), 'utf8');
  ok(src.indexOf("const email = await correoDe(actorId, payload);") > src.indexOf("if (req.method === 'GET') {"), 'el correo se pide solo al escribir');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
