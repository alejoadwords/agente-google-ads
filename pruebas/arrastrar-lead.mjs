// Arrastrar un lead entre etapas: node pruebas/arrastrar-lead.mjs
//
// Estuvo roto para TODAS las cuentas: al soltar la tarjeta volvía a su columna
// aunque el cambio sí se guardaba, y solo se veía bien al recargar.
//
// La causa era una línea de `citaAbrir`:
//
//     if (!cfg) { onCancel?.(); return false; }
//
// `onCancel` significa «el usuario dijo que no», y ese callback DESHACE el
// movimiento. Llamarlo cuando simplemente no hay cita configurada —el caso de
// casi todas las etapas— deshacía en pantalla un movimiento que sí se guardaba.
//
// Aquí se EJECUTA el ciclo entero del soltar, no se lee.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const trozo = (desde, hasta) => {
  const a = js.indexOf(desde);
  if (a < 0) throw new Error('falta el inicio: ' + desde);
  const b = js.indexOf(hasta, a);
  if (b < 0) throw new Error('falta el fin «' + hasta.trim() + '» tras «' + desde + '»');
  return js.slice(a, b);
};

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

// Un DOM mínimo: solo lo que toca el camino de soltar.
const elemento = () => ({
  classList: { add() {}, remove() {} }, style: {}, innerHTML: '',
  addEventListener(tipo, fn) { (this._h = this._h || {})[tipo] = fn; },
  appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
  remove() {}, closest: () => null,
});
globalThis.document = {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: elemento, body: elemento(),
};
globalThis.setTimeout = (fn) => 0;   // nada diferido durante la prueba

const red = [];
globalThis.red = red;
globalThis.fetchAuth = async (url, opts) => {
  red.push(((opts && opts.method) || 'GET') + ' ' + url);
  return { ok: true, status: 200, json: async () => ({}), clone() { return this; } };
};

const codigo = [
  trozo('function crmSetupDrop(', '\n// ══ VISTA DE LISTA'),
  trozo('function etapaAlEntrar(', '\nfunction citaSugerida'),
  trozo('function citaAbrir(', '\nfunction citaCancelar'),
  `var crmLeads = [], crmStages = [], _citaCtx = null, pintados = 0, avisos = [];
   function crmRenderKanban() { pintados++; }
   function crmIsWonStage(k) { return k === 'ganado'; }
   function crmIsLostStage(k) { return k === 'perdido'; }
   function closeOpenModal() {}
   function esc(t) { return String(t == null ? '' : t); }
   function icn() { return ''; }
   function citaSugerida() { return { ini: new Date(), fin: new Date() }; }
   function citaRevisarChoque() {}
   function showToast(m) { avisos.push(m); }
   async function motivoDelFallo(r) { return new Error('HTTP ' + r.status); }
   function errRegistrar() {}
   return { crmSetupDrop, citaAbrir,
     estado: () => ({ crmLeads, pintados, red: globalThis.red, avisos }),
     preparar: (etapas, lead) => { crmStages = etapas; crmLeads = [lead]; pintados = 0; globalThis.red.length = 0; avisos.length = 0; } };`,
].join('\n');
const app = new Function(codigo)();

const soltar = async (etapaDestino) => {
  const col = elemento();
  app.crmSetupDrop(col, etapaDestino);
  await col._h.drop({ preventDefault() {}, dataTransfer: { getData: () => 'l1' } });
  await new Promise(r => process.nextTick(r));
};

const ETAPAS_SIN_CITA = [
  { key: 'negociacion', label: 'Propuesta de licencia presentada' },
  { key: 'periodo-de-prueba', label: 'Periodo de prueba' },
];

console.log('\nSoltar en una etapa normal (sin cita configurada)\n');
{
  const lead = { id: 'l1', name: 'Frozzdy', stage: 'negociacion' };
  app.preparar(ETAPAS_SIN_CITA, lead);
  await soltar('periodo-de-prueba');
  // Esto es lo que estaba roto: la etapa volvía sola a la de antes.
  chk('el lead se queda en la etapa donde se soltó',
      lead.stage === 'periodo-de-prueba', 'quedó en ' + lead.stage);
  const { red } = app.estado();
  chk('y se guarda en el servidor',
      red.some(r => r.startsWith('PUT /api/leads')), red.join(' | '));
  chk('con su registro en el historial',
      red.some(r => r.startsWith('POST /api/lead-activities')), red.join(' | '));
  chk('sin avisar de ningún error', app.estado().avisos.length === 0, app.estado().avisos.join(' | '));
}

console.log('\nSoltar en la MISMA etapa no hace nada\n');
{
  const lead = { id: 'l1', name: 'Frozzdy', stage: 'negociacion' };
  app.preparar(ETAPAS_SIN_CITA, lead);
  await soltar('negociacion');
  chk('ni guarda ni repinta', app.estado().red.length === 0 && app.estado().pintados === 0,
      JSON.stringify(app.estado().red));
}

console.log('\nUna etapa que SÍ pide cita se sigue comportando igual\n');
{
  const conCita = [
    { key: 'negociacion', label: 'Propuesta' },
    { key: 'visita', label: 'Cita de inmueble', al_entrar: { tipo: 'cita', titulo: 'Cita', duracion: 60 } },
  ];
  const lead = { id: 'l1', name: 'Frozzdy', stage: 'negociacion' };
  app.preparar(conCita, lead);
  await soltar('visita');
  // Ahí el movimiento lo confirma el modal: NO se guarda todavía.
  chk('no se guarda hasta agendar', !app.estado().red.length, app.estado().red.join(' | '));
  chk('y el lead queda a la espera en la etapa nueva', lead.stage === 'visita', lead.stage);
}

console.log('\nY `citaAbrir` no deshace nada cuando no hay nada que preguntar\n');
{
  let deshizo = false;
  const r = app.citaAbrir({ id: 'l1', name: 'x' }, { key: 'sin-cita', label: 'Sin cita' },
                          'negociacion', () => { deshizo = true; });
  chk('devuelve false', r === false, String(r));
  // `onCancel` es «el usuario dijo que no», no «no había nada que hacer».
  chk('y NO llama a onCancel', deshizo === false);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
