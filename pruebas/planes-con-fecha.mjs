// Prueba del mecanismo de caducidad de planes.
//   node pruebas/planes-con-fecha.mjs
//
// LEE los dos ficheros del repositorio y ejecuta su lógica real con Clerk y
// Supabase simulados. Existe porque el agujero que tapa costó seis cuentas con
// plan Pro que no caducaba nadie: el cron exigía que el plan fuese literalmente
// 'trial', y una cuenta puesta a 'pro' a mano se saltaba la comprobación
// todos los días, para siempre.
import { readFileSync } from 'node:fs';

const T = []; const chk = (n, ok, d = '') => T.push([n, ok, d]);

// ── 1. La regla del cron, extraída del fichero real ────────────────────────
const cron = readFileSync(new URL('../api/cron-trials.js', import.meta.url), 'utf8');
chk('El cron ya no exige que el plan sea «trial»',
    /const dePago = \['pro', 'agency', 'agencia', 'individual'\]\.includes\(meta\.plan\)/.test(cron));
chk('Un plan de pago sin fecha NO se toca, pero se reporta',
    /if \(!meta\.hasta\) \{ sinFecha\.push/.test(cron) && /planes de pago SIN fecha de fin/.test(cron));
chk('Al vencer, baja a free y borra la fecha',
    /setMeta\(u\.id, \{ plan: 'free', hasta: null/.test(cron));
chk('Avisa antes de vencer, una sola vez',
    /restan <= 3 \* 86400000 && !meta\.aviso_fin/.test(cron));
chk('La prueba de siempre sigue funcionando',
    /if \(meta\.plan !== 'trial' \|\| !meta\.trial_until\) continue;/.test(cron));

// ── 2. La acción del panel, ejecutada de verdad ────────────────────────────
const admin = readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8');
const ini = admin.indexOf('async function handleSetPlan(req, res)');
const fin = admin.indexOf('\n// ── RECOMMENDATIONS');
const cuerpo = admin.slice(ini, fin);

let metaEscrita = null, pagoEscrito = null, clerkFalla = false, supaFalla = false;
let planActual = {};
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('/billing')) {
    if (supaFalla) return { ok: false };
    pagoEscrito = JSON.parse(opts.body); return { ok: true };
  }
  if (opts && opts.method === 'PATCH') return { ok: !clerkFalla };
  return { ok: true, json: async () => ({ public_metadata: planActual }) };
};
const CLERK_SECRET = 'x', SUPABASE_URL = 'https://x', SUPABASE_SERVICE_KEY = 'y';
const clerkUpdateMetadata = async (id, m) => { if (clerkFalla) return { ok: false, error: 'rechazado' }; metaEscrita = m; return { ok: true }; };
const handleSetPlan = new Function('req','res','CLERK_SECRET','SUPABASE_URL','SUPABASE_SERVICE_KEY','clerkUpdateMetadata','fetch','console',
  'return (' + cuerpo.replace('async function handleSetPlan(req, res)', 'async function _(req, res)') + ')(req, res)');
const correr = (body) => {
  metaEscrita = null; pagoEscrito = null;
  let salida = null, codigo = 200;
  const res = { status(c){ codigo=c; return this; }, json(d){ salida={...d, _codigo:codigo}; return d; } };
  return handleSetPlan({ body }, res, CLERK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, clerkUpdateMetadata, globalThis.fetch, console)
    .then(() => salida);
};

const hoy = new Date();
const enMeses = n => { const d = new Date(hoy); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0,10); };

let r = await correr({ userId:'u1', plan:'pro', meses:1, origen:'externo' });
chk('Pago externo: aplica el plan', r.ok === true && metaEscrita.plan === 'pro');
chk('  con fecha de fin a un mes', metaEscrita.hasta === enMeses(1), metaEscrita.hasta);
chk('  y deja constancia del origen', metaEscrita.origen === 'externo');
chk('  registra el pago en billing', pagoEscrito && pagoEscrito.status === 'active' && pagoEscrito.amount === 39);

r = await correr({ userId:'u1', plan:'agency', meses:1, origen:'externo' });
chk('Agency cobra $99 por mes', pagoEscrito.amount === 99, String(pagoEscrito.amount));

r = await correr({ userId:'u1', plan:'pro', meses:2, origen:'cortesia' });
chk('Cortesía: aplica el plan', metaEscrita.plan === 'pro' && metaEscrita.origen === 'cortesia');
chk('  con fecha a dos meses', metaEscrita.hasta === enMeses(2), metaEscrita.hasta);
chk('  y NO registra ningún pago', pagoEscrito === null);

// renovar a alguien que aún tiene tiempo suma, no recorta
const futuro = new Date(hoy); futuro.setMonth(futuro.getMonth() + 3);
planActual = { plan:'pro', hasta: futuro.toISOString().slice(0,10) };
r = await correr({ userId:'u1', plan:'pro', meses:1, origen:'externo' });
const esperado = new Date(futuro); esperado.setMonth(esperado.getMonth() + 1);
chk('Renovar a quien está al día SUMA al tiempo que le queda',
    metaEscrita.hasta === esperado.toISOString().slice(0,10), metaEscrita.hasta);
planActual = {};

r = await correr({ userId:'u1', plan:'free' });
chk('Bajar a free borra la fecha y el origen',
    metaEscrita.plan === 'free' && metaEscrita.hasta === null && metaEscrita.origen === null);
chk('  y no registra pago', pagoEscrito === null);

for (const [caso, body] of [
  ['sin userId', { plan:'pro', meses:1, origen:'externo' }],
  ['plan inventado', { userId:'u1', plan:'ultra', meses:1, origen:'externo' }],
  ['sin origen', { userId:'u1', plan:'pro', meses:1 }],
  ['meses fuera de rango', { userId:'u1', plan:'pro', meses:99, origen:'externo' }],
  ['meses no numéricos', { userId:'u1', plan:'pro', meses:'muchos', origen:'externo' }],
]) {
  r = await correr(body);
  chk(`Rechaza ${caso}`, r._codigo === 400 && !!r.error, JSON.stringify(r));
}

clerkFalla = true;
r = await correr({ userId:'u1', plan:'pro', meses:1, origen:'externo' });
chk('Si Clerk falla: no aplica el plan…', r._codigo === 502);
chk('  …y NO registra el pago (sería un cobro fantasma)', pagoEscrito === null);
clerkFalla = false;

supaFalla = true;
r = await correr({ userId:'u1', plan:'pro', meses:1, origen:'externo' });
chk('Si falla el registro del pago, el plan queda aplicado…', r.ok === true);
chk('  …pero se avisa a quien lo hizo', !!r.aviso && r.pago_registrado === false, JSON.stringify(r.aviso));
supaFalla = false;

let mal = 0;
for (const [n, ok, d] of T) { if (!ok) mal++; console.log((ok ? '  OK  ' : '  FALLA ') + n + (ok ? '' : '   → ' + d)); }
console.log('\n' + (mal ? `${mal} de ${T.length} FALLAN` : `Las ${T.length} comprobaciones pasan`));
process.exit(mal ? 1 : 0);
