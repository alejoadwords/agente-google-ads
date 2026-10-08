// Cupo del Proyecto SEO (posiciones y GEO): node pruebas/cupo-seo.mjs
//
// Hasta el 08-10-2026 «Consultar IAs ahora» hacía hasta 40 llamadas de pago por
// clic sin tope ni registro, y «Actualizar posiciones» igual contra Serper.
//
// Se EJECUTAN los dos endpoints reales con una sesión firmada de verdad y un
// mundo de mentira: Supabase cuenta filas de ai_usage como el de verdad
// (content-range con limit=0), Clerk responde el plan, y las cuatro IAs y
// Serper contestan sin costar nada. Ninguna llamada sale a un proveedor.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CLERK_SECRET_KEY = 'sk_falsa';
process.env.SERPER_API_KEY = 'serper';
for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY']) process.env[k] = 'x';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : ''));
  if (!c) mal++;
};
const resp = (d, s = 200, cab = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...cab } });

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
const PLANES = { dueno: 'pro', agencia1: 'agency', gratis: 'free', asesor: 'free' };
const EQUIPO = { asesor: 'dueno' };
let USO = [], llamadas = { claude: 0, gemini: 0, chatgpt: 0, perplexity: 0, serper: 0 };
let contarFalla = false, perplexityFalla = false;

globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  if (u.includes('jwks.json')) return resp(JWKS);
  if (u.startsWith('https://api.clerk.com/v1/users/')) {
    const id = u.split('/').pop();
    return resp({ id, public_metadata: { plan: PLANES[id] }, email_addresses: [{ email_address: id + '@prueba.test' }] });
  }
  if (u.includes('/rest/v1/team_members')) {
    const quien = (u.match(/member_user_id=eq\.([^&]+)/) || [])[1];
    return resp(EQUIPO[quien] ? [{ owner_user_id: EQUIPO[quien] }] : []);
  }
  if (u.includes('/rest/v1/ai_usage')) {
    if ((init.method || 'GET') === 'POST') {
      const filas = [].concat(JSON.parse(init.body));
      filas.forEach(f => USO.push({ ...f, created_at: new Date().toISOString() }));
      return new Response(null, { status: 201 });
    }
    if (contarFalla) return resp({ message: 'caída' }, 503);
    const user = (u.match(/user_id=eq\.([^&]+)/) || [])[1];
    const origen = (u.match(/origen=eq\.([^&]+)/) || [])[1];
    const desde = (u.match(/created_at=gte\.([^&]+)/) || [])[1];
    const n = USO.filter(f => f.user_id === user && f.origen === origen && f.created_at >= desde).length;
    // Lo que devuelve PostgREST con limit=0 y count=exact.
    return resp([], 200, { 'content-range': '*/' + n });
  }
  if (u.startsWith('https://api.anthropic.com')) { llamadas.claude++; return resp({ content: [{ text: 'Recomiendo Acuarius y Competidor.' }], usage: { input_tokens: 100, output_tokens: 400 } }); }
  if (u.startsWith('https://generativelanguage')) { llamadas.gemini++; return resp({ candidates: [{ content: { parts: [{ text: 'Competidor es bueno.' }] } }], usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 300, thoughtsTokenCount: 200 } }); }
  if (u.startsWith('https://api.openai.com')) { llamadas.chatgpt++; return resp({ choices: [{ message: { content: 'Acuarius.' } }], usage: { prompt_tokens: 90, completion_tokens: 300 } }); }
  if (u.startsWith('https://api.perplexity.ai')) {
    llamadas.perplexity++;
    if (perplexityFalla) return resp({ error: { message: 'saldo agotado' } });
    return resp({ choices: [{ message: { content: 'Nada.' } }], usage: { prompt_tokens: 90, completion_tokens: 300 } });
  }
  if (u.startsWith('https://google.serper.dev')) {
    llamadas.serper++;
    return resp({ organic: [{ position: 1, title: 'x', link: 'https://otro.com' }, { position: 2, title: 'y', link: 'https://www.acuarius.app/' }] });
  }
  throw new Error('salida no prevista: ' + u);
};

const geo = (await import('../api/geo-rank.js')).default;
const seo = (await import('../api/seo-rank.js')).default;
const { CUPOS_SEO } = await import('../api/_cupo-seo.js');

// Node: req con cabeceras planas y res al estilo Vercel.
async function pedir(handler, sub, { method = 'POST', body, query } = {}) {
  const req = { method, body, query: query || {}, headers: { authorization: 'Bearer ' + await tokenDe(sub) } };
  let status = 200, json = null;
  const res = {
    setHeader() {}, status(s) { status = s; return this; },
    json(d) { json = d; return this; }, end() { return this; },
  };
  await handler(req, res);
  return { status, d: json };
}
const reiniciar = () => { USO = []; llamadas = { claude: 0, gemini: 0, chatgpt: 0, perplexity: 0, serper: 0 }; contarFalla = false; perplexityFalla = false; };
const sembrar = (user, origen, n) => { for (let i = 0; i < n; i++) USO.push({ user_id: user, origen, created_at: new Date().toISOString() }); };
const geoBody = (n) => ({ queries: Array.from({ length: n }, (_, i) => 'pregunta ' + i), domain: 'acuarius.app', brand: 'Acuarius', competitors: ['competidor.com'] });

// ── 1. GEO ──────────────────────────────────────────────────────────────────
console.log('\nGEO: cada llamada a una IA queda en ai_usage y gasta cupo\n');
{
  reiniciar();
  const r = await pedir(geo, 'dueno', { body: geoBody(3) });
  ok(r.status === 200, 'un reporte de 3 preguntas responde 200', r);
  ok(Object.values(llamadas).reduce((a, b) => a + b, 0) === 12, '3 preguntas × 4 IAs = 12 llamadas', llamadas);
  const filas = USO.filter(f => f.origen === 'geo');
  ok(filas.length === 12, 'y 12 filas con origen geo en ai_usage', filas.length);
  ok(filas.every(f => f.user_id === 'dueno' && f.costo > 0), 'imputadas a la cuenta y con costo');
  ok(new Set(filas.map(f => f.modelo)).size === 4, 'una por motor (geo:claude, geo:gemini…)');
  ok(r.d.cupo?.usados === 12 && r.d.cupo?.restante === CUPOS_SEO.geo.pro - 12, 'la respuesta trae el cupo ya descontado', r.d.cupo);
  ok(!JSON.stringify(r.d.results).includes('_gasto'), 'el costo interno no viaja al navegador');
}
{
  reiniciar();
  perplexityFalla = true;
  const r = await pedir(geo, 'dueno', { body: geoBody(2) });
  ok(USO.filter(f => f.origen === 'geo').length === 6, 'la IA que falla no gasta cupo (6 de 8)');
  ok(USO.filter(f => f.origen === 'geo-fallida').length === 2 && USO.filter(f => f.origen === 'geo-fallida').every(f => f.costo === 0),
    'pero queda registrada como geo-fallida a costo cero');
  ok(r.d.cupo?.usados === 6, 'y el contador devuelto cuenta solo las buenas', r.d.cupo);
}
{
  reiniciar();
  sembrar('dueno', 'geo', CUPOS_SEO.geo.pro - 10);
  const r = await pedir(geo, 'dueno', { body: geoBody(3) });
  ok(r.status === 429 && r.d.sinCupo, 'con 10 restantes, un reporte de 12 se rechaza entero', r);
  ok(Object.values(llamadas).every(n => n === 0), 'sin llamar a ninguna IA', llamadas);
  ok(/necesita 12 consultas.*te quedan 10/.test(r.d.error), 'y el mensaje dice cuánto necesita y cuánto queda', r.d.error);
  const r2 = await pedir(geo, 'dueno', { body: geoBody(2) });
  ok(r2.status === 200 && r2.d.cupo.restante === 2, 'uno de 8 sí cabe', r2.d.cupo);
}
{
  reiniciar();
  sembrar('dueno', 'geo', CUPOS_SEO.geo.pro);
  const r = await pedir(geo, 'dueno', { body: geoBody(1) });
  ok(r.status === 429 && /Usaste las 200/.test(r.d.error), 'agotado: «Usaste las 200 consultas…»', r.d);
}
{
  reiniciar();
  sembrar('dueno', 'geo', CUPOS_SEO.geo.pro);
  const r = await pedir(geo, 'asesor', { body: geoBody(1) });
  ok(r.status === 429, 'el asesor gasta del cupo de su dueño, no de uno propio', r.status);
}
{
  reiniciar();
  contarFalla = true;
  const r = await pedir(geo, 'dueno', { body: geoBody(1) });
  ok(r.status === 200, 'si no se puede contar se deja pasar (no se frena a un cliente por una caída)', r.status);
  ok(r.d.cupo?.error === true, 'pero la respuesta dice que el contador es dudoso, no «0 usadas»', r.d.cupo);
}
{
  reiniciar();
  const r = await pedir(geo, 'gratis', { body: geoBody(1) });
  ok(r.status === 403 && r.d.upgrade, 'plan free: 403 con upgrade, sin llamar a nadie', r);
  ok(llamadas.claude === 0, 'ninguna IA llamada');
}

// ── 2. Posiciones ───────────────────────────────────────────────────────────
console.log('\nPosiciones: cada keyword queda en ai_usage; si no cabe todo se hace una parte\n');
const kwBody = (n) => ({ keywords: Array.from({ length: n }, (_, i) => 'kw ' + i), domain: 'acuarius.app' });
{
  reiniciar();
  const r = await pedir(seo, 'dueno', { body: kwBody(5) });
  ok(r.status === 200 && r.d.results.length === 5, '5 keywords responden', r.status);
  ok(r.d.results[0].position === 2, 'y la posición se sigue calculando bien');
  ok(USO.filter(f => f.origen === 'seo-posiciones').length === 5, '5 filas seo-posiciones');
  ok(r.d.cupo.usados === 5 && r.d.sinCupo === 0, 'cupo devuelto y nada fuera', r.d);
}
{
  reiniciar();
  sembrar('dueno', 'seo-posiciones', CUPOS_SEO.posiciones.pro - 3);
  const r = await pedir(seo, 'dueno', { body: kwBody(5) });
  ok(r.status === 200 && r.d.results.length === 3 && r.d.sinCupo === 2, 'con 3 restantes se consultan 3 y se avisa de 2', r.d);
  ok(llamadas.serper === 3, 'solo 3 llamadas a Serper', llamadas.serper);
  const r2 = await pedir(seo, 'dueno', { body: kwBody(5) });
  ok(r2.status === 429 && r2.d.sinCupo === 5 && /Usaste las 500/.test(r2.d.error), 'agotado: 429 con las 5 fuera', r2.d);
}
{
  reiniciar();
  sembrar('agencia1', 'seo-posiciones', 7);
  sembrar('agencia1', 'geo', 40);
  const r = await pedir(seo, 'agencia1', { method: 'GET', query: { action: 'cupo' } });
  ok(r.status === 200 && r.d.plan === 'agency', 'GET ?action=cupo devuelve el plan', r.d);
  ok(r.d.posiciones.usados === 7 && r.d.posiciones.cupo === CUPOS_SEO.posiciones.agency, 'el de posiciones', r.d.posiciones);
  ok(r.d.geo.usados === 40 && r.d.geo.restante === CUPOS_SEO.geo.agency - 40, 'y el de GEO a la vez', r.d.geo);
  contarFalla = true;
  const r2 = await pedir(seo, 'agencia1', { method: 'GET', query: { action: 'cupo' } });
  ok(r2.d.geo.error === true && r2.d.posiciones.error === true && r2.d.geo.usados === undefined,
    'si no se puede contar dice error, nunca usados: 0', r2.d);
  const r3 = await pedir(seo, 'gratis', { method: 'GET', query: { action: 'cupo' } });
  ok(r3.status === 403 && r3.d.upgrade, 'free: 403 upgrade');
}

// ── 3. Las dos puntas: lo que lee la pantalla es lo que manda el servidor ──
console.log('\nLa pantalla lee las claves que manda el servidor\n');
{
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const ini = app.indexOf('let seoCupo = null;');
  const fin = app.indexOf('// ── Tab: Competencia ──');
  const trozo = app.slice(ini, fin);
  ok(ini > 0, 'la pantalla tiene su estado de cupo');
  ok(trozo.includes("'/api/seo-rank?action=cupo'"), 'pregunta a GET /api/seo-rank?action=cupo');
  ok(/c\.restante/.test(trozo) && /c\.cupo/.test(trozo) && /c\.error/.test(trozo), 'y lee restante, cupo y error');
  ok(/seoCupoActualizar\('posiciones', data\.cupo\)/.test(trozo) && /data\.sinCupo/.test(trozo), 'posiciones usa data.cupo y data.sinCupo');
  const geoTrozo = app.slice(app.indexOf('async function seoGeoUpdate'), app.indexOf('function seoGeoGenerateQueries'));
  ok(/data\.sinCupo/.test(geoTrozo) && /seoCupoActualizar\('geo', data\.cupo\)/.test(geoTrozo), 'GEO usa data.cupo y data.sinCupo');

  // Agentes apagados: ningún botón de la pantalla llama al agente sin la guarda.
  const pantalla = app.slice(app.indexOf('function seoRenderSetup'), app.indexOf('// ── SET DE ÍCONOS SVG'));
  const llamadasAgente = ['seoResearchKeywords()', 'seoAnalyzeCompetition()', 'seoAuditPage()', 'seoContentPlan()', 'seoGenerateContent(', 'seoGeoGenerateQueries()'];
  for (const f of llamadasAgente) {
    const lineas = pantalla.split('\n').filter(l => l.includes('onclick="' + f));
    ok(lineas.length > 0 && lineas.every(l => /AGENTES_ACTIVOS/.test(l) || /const auditBar = !AGENTES_ACTIVOS/.test(pantalla)),
      'el botón ' + f + ' solo aparece con los agentes activos', lineas);
  }
  ok(!/agente SEO/.test(pantalla), 'ningún texto de la pantalla nombra al «agente SEO»');
  const oaa = app.slice(app.indexOf('async function openAgentAndAsk'), app.indexOf('async function launchInitialAudit'));
  ok(/if \(!AGENTES_ACTIVOS\)/.test(oaa), 'y openAgentAndAsk avisa en vez de mandar a Inicio en silencio');
}

console.log(mal ? `\n${mal} fallaron\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);
