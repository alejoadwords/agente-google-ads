// Prueba del registro de errores.  node pruebas/errores.mjs
//
// Comprueba las tres cosas de las que depende que la alerta sirva:
//   1. que la firma agrupe el MISMO fallo y separe los distintos,
//   2. que conErrores() atrape la excepción en vez de dejar un 500 mudo,
//   3. que el registro nunca tumbe la petición que lo provocó.
process.env.SUPABASE_URL = 'https://simulado';
process.env.SUPABASE_SERVICE_KEY = 'clave';

const escritos = [];
let fallarAlEscribir = false;
globalThis.fetch = async (url, opts) => {
  if (fallarAlEscribir) throw new Error('Supabase caído');
  escritos.push(JSON.parse(opts.body));
  return { ok: true, json: async () => ({}) };
};
const { registrarError, conErrores } = await import('../api/_registro-errores.js');

const T = []; const chk = (n, ok, d = '') => T.push([n, ok, d]);
const silencio = console.error; console.error = () => {};

// ── 1. Agrupación ───────────────────────────────────────────────────────────
escritos.length = 0;
await registrarError({ origen:'api', donde:'leads', error:new Error('lead 3f2a1b9c-1111-2222-3333-444455556666 no existe') });
await registrarError({ origen:'api', donde:'leads', error:new Error('lead 9a8b7c6d-9999-8888-7777-666655554444 no existe') });
chk('El mismo fallo con distinto id = una sola firma',
    escritos[0].p_firma === escritos[1].p_firma, escritos.map(e=>e.p_firma).join(' vs '));

escritos.length = 0;
await registrarError({ origen:'api', donde:'leads', error:new Error('no se pudo guardar') });
await registrarError({ origen:'api', donde:'agenda', error:new Error('no se pudo guardar') });
chk('El mismo mensaje en sitios distintos = firmas distintas',
    escritos[0].p_firma !== escritos[1].p_firma);

escritos.length = 0;
await registrarError({ origen:'api', donde:'x', error:new Error('cupo user_3ABC agotado tras 47 intentos') });
await registrarError({ origen:'api', donde:'x', error:new Error('cupo user_9XYZ agotado tras 3 intentos') });
chk('Usuarios y números distintos = misma firma', escritos[0].p_firma === escritos[1].p_firma);

// ── 2. El envoltorio ────────────────────────────────────────────────────────
escritos.length = 0;
const roto = conErrores('prueba', async () => { throw new TypeError('x.y no es una función'); });
const r = await roto(new Request('https://x/api/prueba'));
chk('Una excepción devuelve 500 controlado', r.status === 500);
chk('  y con un mensaje para el usuario, no una traza',
    /Ya estamos avisados/.test(await r.clone().text()));
chk('  y queda registrada', escritos.length === 1 && /no es una función/.test(escritos[0].p_mensaje),
    JSON.stringify(escritos[0] && escritos[0].p_mensaje));
chk('  con la traza guardada aparte', !!escritos[0].p_detalle);

escritos.length = 0;
const bueno = conErrores('prueba', async () => new Response('ok', { status: 200 }));
const r2 = await bueno(new Request('https://x/api/prueba'));
chk('Una respuesta normal pasa intacta', r2.status === 200 && escritos.length === 0);

// ── 3. Nunca tumba la petición ──────────────────────────────────────────────
fallarAlEscribir = true;
escritos.length = 0;
let reventó = false;
try { await registrarError({ origen:'api', donde:'x', error:new Error('algo') }); } catch { reventó = true; }
chk('Si el registro falla, no lanza', !reventó);
const r3 = await conErrores('prueba', async () => { throw new Error('doble fallo'); })(new Request('https://x/api/p'));
chk('  y el envoltorio sigue respondiendo 500', r3.status === 500);
fallarAlEscribir = false;


// ── 4. El aviso distingue ruido de red de fallos reales ─────────────────────
// Lee la regla del propio cron para no probar una copia.
import { readFileSync } from 'node:fs';
const cron = readFileSync(new URL('../api/cron-errores.js', import.meta.url), 'utf8');
const ini = cron.indexOf('const esRuidoDeRed = e =>');
const fin = cron.indexOf(';', cron.indexOf('.length < 2', ini)) + 1;
const esRuidoDeRed = new Function('return ' + cron.slice(ini + 'const esRuidoDeRed = '.length, fin))();
const caso = (mensaje, veces, cuentas) => esRuidoDeRed({ mensaje, veces, usuarios: Array.from({length: cuentas}, (_, i) => 'u' + i) });
chk('Un «Failed to fetch» suelto en una cuenta es ruido: no avisa',
    caso('sin respuesta del servidor: Failed to fetch', 1, 1) === true);
chk('Un 504 suelto en una cuenta espera', caso('HTTP 504', 1, 1) === true);
chk('El mismo fallo de red 3 veces SÍ avisa', caso('sin respuesta del servidor: Failed to fetch', 3, 1) === false);
chk('El mismo fallo de red en 2 cuentas SÍ avisa', caso('sin respuesta del servidor: Failed to fetch', 1, 2) === false);
chk('Un 500 con código de base de datos avisa siempre, aunque sea una vez',
    caso('HTTP 500: {"code":"23503"', 1, 1) === false);
chk('Un TypeError del navegador avisa siempre', caso('Cannot read properties of null', 1, 1) === false);

console.error = silencio;
let mal = 0;
for (const [n, ok, d] of T) { if (!ok) mal++; console.log((ok ? '  OK  ' : '  FALLA ') + n + (ok ? '' : '   → ' + d)); }
console.log('\n' + (mal ? `${mal} de ${T.length} FALLAN` : `Las ${T.length} comprobaciones pasan`));
process.exit(mal ? 1 : 0);
