// Las tareas vencidas en el Pulso: node pruebas/pulso-tareas-vencidas.mjs
//
// Lo que hay que proteger:
//
//   1. Que el número salga del montón que reparte el SERVIDOR y no se vuelva a
//      calcular aquí. `api/agenda.js` corta por día, no por hora, y deja fuera
//      las tareas de leads ganados o perdidos — eso es lo que le inflaba el
//      panel a Certain hasta 27 «vencidas» que no lo eran. Un segundo criterio
//      en el navegador garantiza que el Pulso y la lista de Tareas discrepen, y
//      entonces no se puede creer a ninguno de los dos.
//   2. Que si las tareas no se pudieron cargar se DIGA. Callarse deja al
//      usuario creyendo que está al día; decir «ninguna» es mentirle.
//   3. Que el aviso lleve a las vencidas ya filtradas, no a la lista entera.
//
// Se ejecuta la función de verdad contra un servidor de mentira.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const trozo = (desde, hasta) => {
  const a = js.indexOf(desde);
  if (a < 0) throw new Error('No encontré en app.js: ' + desde);
  return js.slice(a, js.indexOf(hasta, a));
};

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

const hace = (dias) => new Date(Date.now() - dias * 864e5).toISOString();

// Monta pulsoCrmCards con todo lo que toca por fuera puesto a mano.
async function correr({ vencidas, tareasFallan = false }) {
  const pasos = [];
  const ctx = {
    clerkInstance: { user: { id: 'u1' } },
    agencyActiveClientId: null,
    _pulsoLeadsCache: [],
    fetchAuth: async () => ({ ok: true, json: async () => ({ leads: [
      { id: 'l1', name: 'Andrea Parra', stage: 'nuevo', created_at: hace(40), updated_at: hace(40) },
    ] }) }),
    // El reparto llega hecho del servidor. Si aquí se recalculara, esta prueba
    // no lo notaría: por eso abajo se comprueba que el código no lo hace.
    crmTareasCargar: async () => !tareasFallan,
    crmTareasCrudas: tareasFallan ? null : { vencidas, hoy: [], proximas: [] },
    leadCerrado: () => false,
    tieneSeguimientoProgramado: () => false,
    pulsoAbrirLista: () => pasos.push('lista-de-leads'),
    pulsoIrATareas: (c) => pasos.push('ir-a-tareas:' + c),
    console,
  };
  const src = trozo('async function pulsoCrmCards()', '\n// ── Lista de leads detrás');
  const f = new Function(...Object.keys(ctx), src + '; return pulsoCrmCards;');
  const cards = await f(...Object.values(ctx))();
  return { cards, pasos, ctx };
}

// ── Hay vencidas ───────────────────────────────────────────────────────────
console.log('\nCon tareas vencidas');
let r = await correr({ vencidas: [
  { id: 't1', title: 'Llamar para confirmar visita', due_at: hace(6), lead: { name: 'Keiner Manotas' } },
  { id: 't2', title: 'Enviar propuesta',             due_at: hace(2), lead: { name: 'Luz Yasmin' } },
  { id: 't3', title: 'Segunda llamada',              due_at: hace(1), lead: { name: 'Carolina Duarte' } },
] });
const v = r.cards[0];
ok(!!v, 'sale una tarjeta');
ok(r.cards.indexOf(v) === 0, 'va PRIMERA: un pendiente pasado de fecha manda sobre un lead frío');
ok(/3 tareas vencidas/.test(v.title), 'dice cuántas son', v && v.title);
ok(v.tone === 'warn', 'con el tono de aviso, no el de todo va bien');
ok(/Keiner Manotas/.test(v.body), 'nombra la MÁS atrasada, que es la primera del montón', v && v.body);
ok(/hace 6 días/.test(v.body), 'y cuánto lleva esperando', v && v.body);
ok(/Llamar para confirmar visita/.test(v.body), 'con el texto de la tarea, no solo el nombre');

v.act();
ok(r.pasos.includes('ir-a-tareas:vencidas'),
   'el botón lleva a Tareas YA FILTRADO por vencidas, no a la lista entera', JSON.stringify(r.pasos));

// ── Una sola ───────────────────────────────────────────────────────────────
console.log('\nCuando es una sola');
r = await correr({ vencidas: [{ id: 't1', title: 'Llamar', due_at: hace(1), lead: { name: 'Ana' } }] });
ok(/1 tarea vencida/.test(r.cards[0].title), 'en singular', r.cards[0].title);
ok(/hace 1 día\b/.test(r.cards[0].body), 'y «1 día», no «1 días»', r.cards[0].body);

// ── Ninguna ────────────────────────────────────────────────────────────────
console.log('\nSin vencidas');
r = await correr({ vencidas: [] });
ok(!r.cards.some(c => /vencida/.test(c.title)),
   'no se inventa una tarjeta para decir que no hay nada');

// ── No se pudieron cargar ──────────────────────────────────────────────────
console.log('\nSi las tareas no cargan');
r = await correr({ vencidas: [], tareasFallan: true });
const f = r.cards.find(c => /No se pudieron cargar/.test(c.title));
ok(!!f, 'se dice a la cara que no se pudieron cargar');
ok(!r.cards.some(c => /0 tareas|ninguna tarea/i.test(c.title + c.body)),
   'y NO se afirma que no hay vencidas: no se sabe');
if (f) { f.act(); ok(r.pasos.includes('ir-a-tareas:'), 'y deja abrir Tareas para mirarlo a mano'); }

// ── El número no se recalcula en el navegador ──────────────────────────────
console.log('\nDe dónde sale el número');
const src = trozo('async function pulsoCrmCards()', '\n// ── Lista de leads detrás');
const sinComentarios = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const bloque = sinComentarios.slice(0, sinComentarios.indexOf('const stale'));
ok(/crmTareasCrudas\s*&&\s*crmTareasCrudas\.vencidas/.test(bloque),
   'el montón se lee tal cual del servidor');
ok(!/tareaVencida\(|tareaPasada\(|due_at[^)]*<[^)]*Date\.now/.test(bloque),
   'y NO se vuelve a decidir aquí qué está vencido: dos criterios = dos números distintos');

// ── El filtro se pone ANTES de cambiar de vista ────────────────────────────
console.log('\nEl orden al navegar');
const ir = trozo('function pulsoIrATareas(cuando)', '\nfunction pulsoIrALead');
ok(ir.indexOf('tarFiltro.cuando') < ir.indexOf('crmSetView'),
   'primero se escribe el filtro y después se cambia de vista: al revés pinta sin filtrar');
ok(!/typeof tarFiltro/.test(ir),
   'no se comprueba con typeof: sobre un `let` sin inicializar typeof LANZA');

// ── Lo invocado existe de verdad ───────────────────────────────────────────
console.log('\nLo que se llama existe');
for (const fn of ['pulsoIrATareas', 'crmTareasCargar', 'tarRender', 'crmSetView']) {
  ok(new RegExp('(async )?function ' + fn + '\\b').test(js), `${fn}() existe`);
}
ok(/let crmTareasCrudas/.test(js), 'crmTareasCrudas está declarada');
ok(/crmTareasCrudas = d;/.test(js), 'y se llena con lo que devuelve el servidor');
ok(/crmTareasCrudas = null;/.test(js),
   'y se pone en null si falla: null es «no se sabe», {} sería «ninguna»');

console.log('');
process.exit(mal ? 1 : 0);
