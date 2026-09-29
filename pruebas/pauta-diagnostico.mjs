// Diagnóstico de campañas: node pruebas/pauta-diagnostico.mjs
//
// Marketing → Plataformas de pauta → Diagnóstico. Errores que cuestan dinero,
// oportunidades de mejora y lo que funciona, cada uno con el número que lo
// sostiene, y una sola acción: pausar lo que gasta sin resultado.
//
// Se EJECUTA todo: las reglas con datos inventados, el endpoint real con una
// sesión de verdad y las redes de mentira, y la función que lo pinta.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev';
delete process.env.TOKENS_KEY;

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

const { diagnosticar, UMBRALES } = await import('../api/_diagnostico-pauta.js');
const AHORA = new Date('2026-09-28T15:00:00Z');
const camp = (o) => ({ red: 'meta', conexion_id: 'cx1', id: 'c' + Math.random().toString(36).slice(2, 7), nombre: 'Campaña', estado: 'active',
  moneda: 'COP', inversion: 0, impresiones: 0, clics: 0, conv: 0, crm: { leads: 0 }, cpl_real: null,
  ultimos7: { impresiones: 500, frecuencia: 1.5 }, ...o });
const claves = (hs) => hs.map(h => h.clave);

// ── 1. Las reglas ───────────────────────────────────────────────────────────
console.log('\nErrores\n');
{
  const h = diagnosticar({ campanas: [camp({ id: 'parada', nombre: 'Parada', ultimos7: { impresiones: 0 } })], ahora: AHORA });
  ok(claves(h).includes('no_entrega') && h[0].tipo === 'error', 'activa y sin una impresión en 7 días: error', JSON.stringify(claves(h)));
  const p = diagnosticar({ campanas: [camp({ estado: 'paused', ultimos7: { impresiones: 0 } })], ahora: AHORA });
  ok(!claves(p).includes('no_entrega'), 'pausada y sin impresiones no es un error: está pausada');
  const n = diagnosticar({ campanas: [camp({ ultimos7: { impresiones: 0 }, creada: '2026-09-28T10:00:00Z' })], ahora: AHORA });
  ok(!claves(n).includes('no_entrega'), 'recién creada (menos de 2 días) no se da por parada');
  const conRech = diagnosticar({
    campanas: [camp({ id: 'x1', nombre: 'Con rechazos', ultimos7: { impresiones: 0 } })],
    rechazados: [{ red: 'meta', conexion_id: 'cx1', campana_id: 'x1', campana_nombre: 'Con rechazos', anuncio: 'A1', motivo: 'Texto engañoso' }],
    ahora: AHORA,
  });
  ok(claves(conRech).includes('anuncio_rechazado'), 'un anuncio rechazado es un error');
  ok(/rechazados: empieza por ahí/.test(conRech.find(x => x.clave === 'no_entrega')?.detalle || ''), 'y si la campaña no entrega, el detalle apunta a los rechazos');
  ok(/Texto engañoso/.test(conRech.find(x => x.clave === 'anuncio_rechazado')?.detalle || ''), 'con el motivo que dio la red');
  const cuenta = diagnosticar({ cuentas: [{ red: 'meta', conexion_id: 'cx1', nombre: 'Acuarius', estado_meta: 3 }], ahora: AHORA });
  ok(cuenta[0]?.clave === 'cuenta_bloqueada' && /pago pendiente/.test(cuenta[0].titulo), 'la cuenta con un pago pendiente se dice', cuenta[0]?.titulo);
  ok(!diagnosticar({ cuentas: [{ red: 'meta', nombre: 'X', estado_meta: 1 }] }).length, 'una cuenta activa no da aviso');
}
{
  // Gasto sin leads, con CPL medio de la cuenta: 3 leads a 20.000 = 60.000.
  const base = [camp({ id: 'buena', nombre: 'Buena', inversion: 100000, clics: 300, crm: { leads: 5 }, cpl_real: 20000 })];
  const h = diagnosticar({ campanas: [...base, camp({ id: 'mala', nombre: 'Mala', inversion: 70000, clics: 200, crm: { leads: 0 } })], ahora: AHORA });
  const g = h.find(x => x.clave === 'gasto_sin_leads');
  ok(g && g.campana.id === 'mala', 'gastó lo de 3 leads al costo medio y no trajo ninguno: error', JSON.stringify(claves(h)));
  ok(g?.accion?.tipo === 'pausar' && g.accion.campana_id === 'mala' && g.accion.conexion_id === 'cx1', 'con la acción de pausar ESA campaña');
  const poco = diagnosticar({ campanas: [...base, camp({ id: 'mala', inversion: 30000, clics: 200 })], ahora: AHORA });
  ok(!claves(poco).includes('gasto_sin_leads'), 'con menos gasto que eso, es pronto para concluir');
  const pausada = diagnosticar({ campanas: [...base, camp({ id: 'mala', estado: 'paused', inversion: 70000, clics: 200 })], ahora: AHORA });
  ok(!pausada.find(x => x.clave === 'gasto_sin_leads')?.accion, 'si ya está pausada, no se ofrece pausarla');
  const conv = diagnosticar({ campanas: [...base, camp({ id: 'mala', inversion: 70000, clics: 200, conv: 4 })], ahora: AHORA });
  ok(!claves(conv).includes('gasto_sin_leads'), 'si la red cuenta conversiones, no se afirma que no trajo nada');
  // Una campaña de tráfico no busca leads: no se le reprocha no traerlos.
  const trafico = diagnosticar({ campanas: [...base, camp({ id: 'traf', objetivo: 'OUTCOME_TRAFFIC', inversion: 70000, clics: 260 })], ahora: AHORA });
  ok(!claves(trafico).includes('gasto_sin_leads'), 'una campaña de TRÁFICO sin leads no es un error (lo destapó la de Acuarius)');
  ok(claves(diagnosticar({ campanas: [...base, camp({ id: 'ld', objetivo: 'OUTCOME_LEADS', inversion: 70000, clics: 260 })], ahora: AHORA })).includes('gasto_sin_leads'),
     'una de LEADS sin leads, sí');
  // Sin CPL medio (ningún lead aún): a partir de 50 clics.
  ok(claves(diagnosticar({ campanas: [camp({ inversion: 20000, clics: UMBRALES.clicsParaConcluir })], ahora: AHORA })).includes('gasto_sin_leads'),
     'sin CPL de referencia, 50 clics sin un lead también es error');
  ok(!claves(diagnosticar({ campanas: [camp({ inversion: 20000, clics: 20 })], ahora: AHORA })).includes('gasto_sin_leads'),
     'y con 20 clics, todavía no');
}

console.log('\nOportunidades y lo que funciona\n');
{
  const cs = [
    camp({ id: 'a', nombre: 'Media', inversion: 100000, crm: { leads: 5 }, cpl_real: 20000 }),
    camp({ id: 'b', nombre: 'Cara', inversion: 150000, crm: { leads: 2 }, cpl_real: 75000 }),
    camp({ id: 'c', nombre: 'Barata', inversion: 40000, crm: { leads: 5 }, cpl_real: 8000 }),
  ];
  const h = diagnosticar({ campanas: cs, ahora: AHORA });
  const cara = h.find(x => x.clave === 'cpl_alto');
  ok(cara && cara.campana.id === 'b' && cara.tipo === 'oportunidad', 'la campaña con lead muy caro es oportunidad', JSON.stringify(claves(h)));
  ok(/veces el promedio/.test(cara?.titulo || ''), 'y dice cuántas veces');
  ok(h.some(x => x.clave === 'cpl_bueno' && x.campana.id === 'c' && x.tipo === 'bien'), 'la de lead barato sale en «lo que funciona»');
  ok(!h.some(x => x.campana?.id === 'a' && ['cpl_alto', 'cpl_bueno'].includes(x.clave)), 'la del promedio no sale en ninguna');
}
{
  const ctr = diagnosticar({ campanas: [camp({ impresiones: 5000, clics: 10 })], ahora: AHORA });
  ok(claves(ctr).includes('ctr_bajo'), 'CTR de 0,2 % con 5.000 impresiones: oportunidad');
  ok(!claves(diagnosticar({ campanas: [camp({ impresiones: 500, clics: 1 })], ahora: AHORA })).includes('ctr_bajo'), 'con pocas impresiones no se juzga');
  ok(!claves(diagnosticar({ campanas: [camp({ red: 'google', impresiones: 5000, clics: 10 })], ahora: AHORA })).includes('ctr_bajo'),
     'en Google no: mezclaría búsqueda con display');
  ok(claves(diagnosticar({ campanas: [camp({ ultimos7: { impresiones: 900, frecuencia: 4.2 } })], ahora: AHORA })).includes('frecuencia_alta'),
     'frecuencia de 4,2 en 7 días: el público se cansó');
}
{
  const c = camp({ id: '555', nombre: 'Leads fríos', inversion: 50000, crm: { leads: 3 }, cpl_real: 16000, claves: ['id:555', 'nom:leads frios'] });
  const leads = [
    { campana_clave: 'id:555', stage: 'nuevo', updated_at: '2026-09-20T10:00:00Z' },
    { campana_clave: 'nom:leads frios', stage: 'contactado', updated_at: '2026-09-21T10:00:00Z' },
    { campana_clave: 'id:555', stage: 'ganado', updated_at: '2026-09-01T10:00:00Z' },
    { campana_clave: 'id:555', stage: 'nuevo', updated_at: '2026-09-28T10:00:00Z' },
  ];
  const h = diagnosticar({ campanas: [c], leads, ahora: AHORA });
  const f = h.find(x => x.clave === 'leads_sin_atender');
  ok(f && /^2 leads/.test(f.titulo), 'cuenta los leads de ESA campaña sin tocar hace más de 3 días, por id y por nombre', f?.titulo);
}
{
  const h = diagnosticar({
    campanas: [camp({ impresiones: 5000, clics: 10 }), camp({ id: 'p', ultimos7: { impresiones: 0 } })],
    cuentas: [{ red: 'meta', nombre: 'X', estado_meta: 2 }], ahora: AHORA,
  });
  const orden = h.map(x => x.tipo);
  ok(orden.indexOf('oportunidad') > orden.lastIndexOf('error'), 'primero los errores, luego las oportunidades', orden.join(','));
}

// ── 2. El endpoint ──────────────────────────────────────────────────────────
console.log('\nEl endpoint real\n');
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const par = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const JWKS = { keys: [{ ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
async function tokenDe(sub) {
  const cab = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const cuerpo = b64u(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(`${cab}.${cuerpo}`));
  return `${cab}.${cuerpo}.${b64u(new Uint8Array(firma))}`;
}
let red = [];
const CONEXION = { id: 'cx1', platform: 'meta_ads', account_id: 'act_111', account_name: 'Acuarius', access_token: 'TOK', client_id: null };
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const m = init.method || 'GET';
  if (u.includes('jwks.json')) return resp(JWKS);
  if (u.includes('/team_members')) return resp(u.includes('member_user_id=eq.ventas') ? [{ owner_user_id: 'dueno', role: 'ventas' }] : []);
  if (u.includes('/platform_connections')) return resp([CONEXION]);
  if (u.includes('/leads?')) return resp([]);
  if (u.startsWith('https://graph.facebook.com')) {
    red.push({ u, m, body: init.body ? JSON.parse(init.body) : null });
    if (m === 'POST') return resp({ success: true });
    if (u.includes('/act_111/insights') && u.includes('frequency')) return resp({ data: [] });
    if (u.includes('/act_111/insights')) return resp({ data: [{ campaign_id: '900', campaign_name: 'Con datos', spend: '1000', impressions: '100', clicks: '5', actions: [] }] });
    if (u.includes('/act_111/campaigns') && u.includes('effective_status')) {
      return resp({ data: [{ id: '900', name: 'Con datos', effective_status: 'ACTIVE' }, { id: '901', name: 'Parada todo el mes', effective_status: 'ACTIVE', created_time: '2026-08-26T21:13:50-0500' }] });
    }
    if (u.includes('/act_111/campaigns')) return resp({ data: [{ id: '900', status: 'ACTIVE' }] });
    if (u.includes('/act_111/ads')) return resp({ data: [] });
    if (u.includes('/act_111?')) return resp({ name: 'Acuarius', account_status: 1 });
    if (u.includes('/901?')) return resp({ account_id: '111', name: 'Parada todo el mes', status: 'ACTIVE' });
    if (u.includes('/999?')) return resp({ account_id: '222', name: 'De otra cuenta' });
    return resp({});
  }
  if (u.startsWith('https://googleads')) { red.push({ u, m, body: init.body ? JSON.parse(init.body) : null }); return resp({ results: [] }); }
  return resp([]);
};
const { default: pauta } = await import('../api/pauta.js');
const pedir = async (sub, qs, body) => {
  red = [];
  const r = await pauta(new Request('https://x/api/pauta?' + (qs || ''), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + await tokenDe(sub), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  return { status: r.status, d: await r.json().catch(() => ({})), red: [...red] };
};
{
  const r = await pedir('dueno', 'diagnostico=1');
  ok(r.status === 200, 'el diagnóstico responde', JSON.stringify(r.d).slice(0, 200));
  // «Con datos» gastó en el mes pero nada en los últimos 7 días: también está
  // parada, y también sale. La que importa aquí es la otra.
  const paradas = (r.d.hallazgos || []).filter(h => h.clave === 'no_entrega').map(h => h.campana.id);
  ok(paradas.includes('901') && paradas.includes('900'),
     'encuentra la campaña activa que no entregó NADA en el mes, aunque no salga en los informes de métricas', JSON.stringify((r.d.hallazgos || []).map(h => h.clave)));
  ok(r.d.revisadas === 2 && r.d.puede_pausar === true, 'cuenta las dos campañas y el dueño puede pausar');
  ok(!r.red.some(x => x.m === 'POST'), 'diagnosticar no escribe nada en Meta');
}
{
  const r = await pedir('dueno', '', { accion: 'pausar', conexion_id: 'cx1', campana_id: '901' });
  const post = r.red.find(x => x.m === 'POST');
  ok(r.status === 200 && post && post.u.endsWith('/901') && post.body.status === 'PAUSED', 'pausar manda a Meta status PAUSED para esa campaña', JSON.stringify(r.d));
  ok(Object.keys(post?.body || {}).sort().join(',') === 'access_token,status', 'y nada más: ni presupuesto ni nombre');
  const ajena = await pedir('dueno', '', { accion: 'pausar', conexion_id: 'cx1', campana_id: '999' });
  ok(ajena.status === 404 && !ajena.red.some(x => x.m === 'POST'), 'una campaña de OTRA cuenta publicitaria no se pausa');
  const ven = await pedir('ventas', '', { accion: 'pausar', conexion_id: 'cx1', campana_id: '901' });
  ok(ven.status === 403 && !ven.red.some(x => x.m === 'POST'), 'un comercial no pausa campañas');
  const rara = await pedir('dueno', '', { accion: 'pausar', conexion_id: 'cx1', campana_id: '901/../act_111' });
  ok(!rara.red.some(x => x.m === 'POST' && x.u.includes('act_111')) && rara.red[0]?.u.includes('/901111?') ,
     'un id con trucos se reduce a sus dígitos antes de preguntarle nada a Meta', rara.red[0]?.u);
}
{
  CONEXION.platform = 'google_ads'; CONEXION.account_id = '123-456-7890'; CONEXION.token_expires_at = new Date(Date.now() + 3600e3).toISOString();
  CONEXION.extra_data = { login_customer_id: '' };
  const r = await pedir('dueno', '', { accion: 'pausar', conexion_id: 'cx1', campana_id: '777' });
  const mut = r.red.find(x => x.u.includes(':mutate'));
  ok(mut && mut.u.includes('/customers/1234567890/campaigns:mutate') && mut.body.operations[0].update.status === 'PAUSED'
     && mut.body.operations[0].update.resourceName === 'customers/1234567890/campaigns/777' && mut.body.operations[0].updateMask === 'status',
     'en Google, un mutate que solo cambia el estado a PAUSED, dentro de SU cuenta', JSON.stringify(mut?.body));
  CONEXION.platform = 'meta_ads'; CONEXION.account_id = 'act_111';
}

// ── 3. La pantalla ──────────────────────────────────────────────────────────
console.log('\nLo que se pinta\n');
{
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const firma = 'function pautaPintarDiagnostico(d) {';
  const i = js.indexOf(firma);
  let prof = 0, j = i + firma.length - 1;
  for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
  const el = { innerHTML: '' };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pinta = new Function('document', 'esc', 'icn', 'emptyAgua', 'pautaRedChip', 'pautaNum', 'pautaFecha', js.slice(i, j + 1) + '; return pautaPintarDiagnostico;')(
    { getElementById: () => el }, esc, (n) => '<i data-icn="' + n + '"></i>', (ic, t) => '<div class="vacio">' + t + '</div>',
    (r) => '<span>' + r + '</span>', (n) => String(n), (s) => s);
  const hs = diagnosticar({
    campanas: [camp({ id: 'b1', nombre: 'Buena', inversion: 100000, crm: { leads: 5 }, cpl_real: 20000 }),
               camp({ id: 'm1', nombre: 'Mala', inversion: 70000, clics: 200 })], ahora: AHORA,
  });
  pinta({ cuentas: [{ id: 'cx1', red: 'meta', nombre: 'Acuarius' }], hallazgos: hs, revisadas: 2, puede_pausar: true, desde: '2026-08-30', hasta: '2026-09-28' });
  ok(/Errores — cuestan dinero ahora/.test(el.innerHTML) && /gastó/.test(el.innerHTML), 'pinta el grupo de errores con el hallazgo');
  ok(/pautaPausar\(/.test(el.innerHTML) && /Pausar campaña/.test(el.innerHTML), 'con el botón de pausar');
  pinta({ cuentas: [{ id: 'cx1', red: 'meta', nombre: 'Acuarius' }], hallazgos: hs, revisadas: 2, puede_pausar: false, desde: 'a', hasta: 'b' });
  ok(!/pautaPausar\(/.test(el.innerHTML), 'sin permiso de pausar, sin botón');
  pinta({ cuentas: [{ id: 'cx1', red: 'meta', nombre: 'Acuarius' }], hallazgos: [], revisadas: 3, puede_pausar: true, desde: 'a', hasta: 'b' });
  ok(/No encontramos nada que corregir/.test(el.innerHTML), 'sin hallazgos: «nada que corregir»');
  pinta({ cuentas: [{ id: 'cx1', red: 'meta', nombre: 'Acuarius', error: 'El permiso caducó.' }], hallazgos: [], revisadas: 0, puede_pausar: true, desde: 'a', hasta: 'b' });
  ok(/No se pudo revisar Acuarius/.test(el.innerHTML) && !/nada que corregir/.test(el.innerHTML),
     'si una cuenta no se pudo revisar, se dice y NO se afirma que todo está en orden');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
