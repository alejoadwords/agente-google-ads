// Prueba de la red de seguridad de tareas de api/lead-activities.js.
//   node pruebas/tareas-red-de-seguridad.mjs
//
// LEE el endpoint del repositorio y ejecuta su bloque real con Supabase
// simulado — no lleva una copia dentro, así que si alguien cambia el endpoint,
// esto prueba el código nuevo y no una foto vieja. Sin sesión ni navegador.
//
// Existe porque esta función falló DOS veces delante de un cliente: una porque
// el arreglo vivía solo en el navegador y una pestaña abierta seguía creando
// tareas fantasma, y otra porque new Date('basura' + ':00-05:00') devuelve el
// 1 de enero de 2000 en vez de una fecha inválida.
import { readFileSync } from 'node:fs';

const fuente = readFileSync(new URL('../api/lead-activities.js', import.meta.url), 'utf8');
const desde = fuente.indexOf('    // ── Una «tarea» tiene que ser una tarea de verdad');
const hasta = fuente.indexOf('    // Trabajar el lead ES actividad');
if (desde < 0 || hasta < 0) {
  console.error('No se encontró el bloque en api/lead-activities.js — ¿lo movieron o renombraron?');
  process.exit(1);
}
const BLOQUE = fuente.slice(desde, hasta);

const cuerpo = `
  escrituras.length = 0; existentes = ya;
  const payload = { metadata }; const errores = [];
  const ce = console.error; console.error = (...a) => errores.push(a.map(String).join(' '));
${BLOQUE}
  console.error = ce;
  return { escrituras: escrituras.slice(), errores };
`;
const escrituras = [];
let existentes = [];
const SUPABASE_URL = 'https://simulado';
const sbHeaders = () => ({});
globalThis.fetch = async (url, opts) => {
  if (opts && opts.method === 'POST') { escrituras.push(JSON.parse(opts.body)); return { ok: true, json: async () => [{ id: 'NEW' }] }; }
  return { ok: true, json: async () => existentes };
};
const correrRaw = new Function('type','content','metadata','lead','lead_id','userId','ya',
  'escrituras','existentes','SUPABASE_URL','sbHeaders','fetch',
  'return (async () => {' + cuerpo + '})()');
const correr = ({ type, content, metadata, lead, lead_id = 'L1', userId = 'U1', ya = [] }) => {
  existentes = ya;
  return correrRaw(type, content, metadata, lead, lead_id, userId, ya, escrituras, existentes, SUPABASE_URL, sbHeaders, globalThis.fetch);
};

const T = []; const chk = (n, ok, d = '') => T.push([n, ok, d]);
let r = await correr({ type:'tarea', content:'Seguimiento', metadata:{ due_date:'2026-09-07T10:30' }, lead:{ client_id:'pro_main' } });
chk('Navegador viejo: crea la tarea real', r.escrituras.length === 1);
const a = r.escrituras[0] || {};
chk('  va a activities con type task', a.type === 'task');
chk('  hereda el client_id del lead', a.client_id === 'pro_main');
chk('  10:30 en Colombia se guarda como 15:30Z', a.due_at === '2026-09-07T15:30:00.000Z', a.due_at);
chk('  nace pendiente', a.done === false);
chk('  el título es lo que escribió el usuario', a.title === 'Seguimiento');

r = await correr({ type:'tarea', content:'S', metadata:{ due_date:'2026-09-07T10:30', activity_id:'A1' }, lead:{} });
chk('Navegador nuevo (manda activity_id): no duplica', r.escrituras.length === 0);
r = await correr({ type:'tarea', content:'S', metadata:{ due_date:'2026-09-07T10:30' }, lead:{}, ya:[{ id:'YA' }] });
chk('Si ya existe una con esa fecha: no duplica', r.escrituras.length === 0);
r = await correr({ type:'tarea', content:'X', metadata:{ due_date:'2026-09-07T10:30:00-03:00' }, lead:{} });
chk('Fecha que ya trae zona horaria: se respeta', (r.escrituras[0] || {}).due_at === '2026-09-07T13:30:00.000Z', (r.escrituras[0] || {}).due_at);

for (const b of ['mañana por la tarde','2026-13-45T99:99','0000-00-00T00:00','07/09/2026','null','undefined','2026-09-07']) {
  r = await correr({ type:'tarea', content:'X', metadata:{ due_date:b }, lead:{} });
  chk(`Fecha inválida «${b}»: no crea nada`, r.escrituras.length === 0, JSON.stringify((r.escrituras[0] || {}).due_at));
  chk('  y queda constancia en el log', r.errores.some(e => /ilegible|rango/.test(e)), r.errores.join('|'));
}
for (const [b, q] of [['2019-01-01T10:00','del pasado'], ['2099-01-01T10:00','del futuro']]) {
  r = await correr({ type:'tarea', content:'X', metadata:{ due_date:b }, lead:{} });
  chk(`Fecha absurda ${q} (${b.slice(0,4)}): no crea nada`, r.escrituras.length === 0);
}
r = await correr({ type:'nota', content:'Le llamé', metadata:{}, lead:{} });
chk('Una nota no crea tareas', r.escrituras.length === 0);
r = await correr({ type:'tarea', content:'X', metadata:{}, lead:{} });
chk('Tarea sin fecha: no crea nada', r.escrituras.length === 0);

let mal = 0;
for (const [n, ok, d] of T) { if (!ok) mal++; console.log((ok ? '  OK  ' : '  FALLA ') + n + (ok ? '' : '   → ' + d)); }
console.log('\n' + (mal ? `${mal} de ${T.length} FALLAN` : `Las ${T.length} comprobaciones pasan`));
process.exit(mal ? 1 : 0);
