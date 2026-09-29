// Procesos de venta en una cuenta sin cartera de clientes: node pruebas/procesos-sin-cartera.mjs
//
// El 29-09-2026 Karvio (cuenta Pro, sin clientes de agencia) creó su proceso y
// no lo veía en el CRM, ni encontraba cómo crear otro. Tres causas:
//  - con un solo proceso el selector escondía el nombre; con cero escondía
//    también el engranaje, que es la única puerta para crear;
//  - el gestor solo dejaba crear con un cliente elegido, regla pensada para
//    agencias: una cuenta sin cartera no tiene cliente que elegir;
//  - sin cliente, el tablero no filtraba por proceso (en una agencia «sin
//    cliente» es la vista de todos), así que dos procesos se mezclarían.
// Se ejecutan las funciones reales de app.js y el endpoint real de leads.

import { readFileSync } from 'node:fs';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const cuerpo = (firma) => {
  const i = js.indexOf(firma);
  if (i < 0) throw new Error('No encontré ' + firma);
  let prof = 0, j = i + firma.length - 1;
  for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
  return js.slice(i, j + 1);
};
const el = () => ({ style: {}, textContent: '', title: '', disabled: false, innerHTML: '', remove() {} });

console.log('\nEl selector del tablero\n');
{
  const dom = { 'pipe-selector': el(), 'pipe-select': el(), 'pipe-select-txt': el() };
  const f = new Function('document', 'crmPipelines', 'crmPipelineId', 'pipeAmbitoNombre',
    cuerpo('function pipeRenderSelector() {') + '; return pipeRenderSelector;');
  f({ getElementById: id => dom[id] }, [], null, () => null)();
  ok(dom['pipe-selector'].style.display === 'flex' && dom['pipe-select'].style.display === 'none', 'sin procesos se ve el engranaje para crear el primero');
  f({ getElementById: id => dom[id] }, [{ id: 'p1', name: 'Cierre de venta vehículos', is_default: true }], 'p1', () => null)();
  ok(dom['pipe-select'].style.display === 'inline-flex' && dom['pipe-select-txt'].textContent === 'Cierre de venta vehículos', 'con uno, se ve su nombre (antes se escondía)');
}

console.log('\nCrear procesos\n');
const gestor = (clientes, cargada, cliente) => {
  const dom = { 'pipe-lista': el(), 'pipe-conteo': el(), 'pipe-ambito': el(), 'pipe-btn-nuevo': el(), 'pipe-lat-cta': el() };
  const f = new Function('document', 'crmPipelines', 'pipeGestorSel', 'PIPE_MAX', 'pipeAmbitoNombre', 'esc', 'pipeRenderPanel', 'agencyClients', '_agencyCargada',
    cuerpo('function crmCuentaSinCartera() {') + '\n' + cuerpo('function pipeRenderLista() {') + '; return pipeRenderLista;');
  f({ getElementById: id => dom[id] }, [{ id: 'p1', name: 'X', is_default: true }], 'p1', 10, () => cliente, x => x, () => {}, clientes, cargada)();
  return dom;
};
{
  const d = gestor([], true, null);
  ok(!d['pipe-btn-nuevo'].disabled && /Crear proceso/.test(d['pipe-btn-nuevo'].textContent), 'una cuenta sin cartera puede crear procesos', d['pipe-btn-nuevo'].textContent);
  ok(d['pipe-ambito'].textContent === 'Procesos de la cuenta', 'y se llaman «de la cuenta»');
  const a = gestor([{ id: 'c1' }], true, null);
  ok(a['pipe-btn-nuevo'].disabled && /Elige un cliente/.test(a['pipe-btn-nuevo'].textContent), 'una agencia sin cliente elegido sigue sin poder (la regla de agosto se mantiene)');
  const b = gestor([{ id: 'c1' }], true, 'Certain');
  ok(!b['pipe-btn-nuevo'].disabled, 'y con su cliente elegido, sí');
  const c = gestor([], false, null);
  ok(c['pipe-btn-nuevo'].disabled, 'mientras no se sabe si tiene cartera, se trata como agencia');
  ok(/if \(!pipeAmbitoNombre\(\) && !crmCuentaSinCartera\(\)\) \{/.test(cuerpo('async function pipeCrear() {')), 'pipeCrear aplica la misma regla, no solo el botón');
}

console.log('\nEl tablero filtra por proceso\n');
const leadsPide = async (clientId, cargada, clientes, pipes, actual) => {
  let pedida = null;
  const f = new Function('crmAmbito', 'agencyActiveClientId', 'fetchAuth', 'crmPipelineId', 'crmPipelines', 'agencyClients', '_agencyCargada',
    'crmLeads', 'crmLeadsLoaded', 'crmFalloResuelto', 'crmFallo', 'console',
    'let crmTodos;' + cuerpo('function crmCuentaSinCartera() {') + '\n' + cuerpo('async function crmLoadLeads() {') + '; return crmLoadLeads;');
  await f(() => 'a', clientId, async (u) => { pedida = u; return { ok: false, status: 500, json: async () => ({}) }; }, actual, pipes, clientes, cargada,
    [], false, () => {}, () => {}, { error() {}, warn() {} })();
  return pedida;
};
{
  const pipes = [{ id: 'p1', is_default: true }, { id: 'p2' }];
  const u1 = await leadsPide(null, true, [], pipes, 'p1');
  ok(/pipeline_id=p1/.test(u1) && /con_sueltos=1/.test(u1), 'cuenta sin cartera, proceso principal: sus leads y los que no tienen proceso', u1);
  const u2 = await leadsPide(null, true, [], pipes, 'p2');
  ok(/pipeline_id=p2/.test(u2) && !/con_sueltos/.test(u2), 'otro proceso: solo los suyos', u2);
  const u3 = await leadsPide(null, true, [{ id: 'c1' }], pipes, 'p1');
  ok(!/pipeline_id/.test(u3), 'una agencia sin cliente elegido sigue viendo todo (vista de todos sus clientes)', u3);
  const u4 = await leadsPide('c1', true, [{ id: 'c1' }], pipes, 'p2');
  ok(/client_id=c1/.test(u4) && /pipeline_id=p2/.test(u4) && !/con_sueltos/.test(u4), 'y con cliente elegido, como siempre', u4);
}

console.log('\nEl servidor entiende con_sueltos\n');
{
  const src = readFileSync(new URL('../api/leads.js', import.meta.url), 'utf8');
  ok(src.includes("query += `&or=(pipeline_id.eq.${encodeURIComponent(pipelineId)},pipeline_id.is.null)`;"), 'con_sueltos pide el proceso O sin proceso');
  ok(/const scopeFilter = clientId\s*\n\s*\? `user_id=eq\.\$\{userId\}&client_id=eq\.\$\{clientId\}&deleted_at=is\.null`\s*\n\s*: `user_id=eq\.\$\{userId\}&deleted_at=is\.null`;/.test(src),
     'y no choca con otro or= en el alcance (que no lo tiene)');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
