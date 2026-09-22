// La lista de tareas del panel lateral: node pruebas/panel-tareas.mjs
//
// El panel lateral es la vista que más se abre de toda la aplicación: sale con
// cada clic en un lead. `/api/agenda?lead_id=` le devuelve TODAS las
// actividades del contacto, citas incluidas, y hasta ahora las pintaba como
// tareas con casilla: una reserva que había hecho el propio cliente parecía un
// pendiente que alguien se apuntó.
//
// Se ejecuta la función de verdad contra un DOM de mentira. No hace falta
// navegador ni base: lo que se comprueba es lo que sale pintado.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const trozo = (desde, hasta) => {
  const a = js.indexOf(desde);
  if (a < 0) throw new Error('No encontré en app.js: ' + desde);
  return js.slice(a, js.indexOf(hasta, a));
};

const cajas = { 'crm-d-tareas-section': { style: {} }, 'crm-d-tareas': { innerHTML: '' } };
globalThis.document = { getElementById: (id) => cajas[id] || null };
globalThis.esc = (t) => String(t == null ? '' : t)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
globalThis.crmDetailLead = { id: 'l1' };
globalThis.puedoGestionar = () => true;

const codigo = trozo('const lfEsCita = ', 'async function crmCargarTareasLead') +
  trozo('function crmPintarTareasLead()', '\nasync function crmTareaHecha');
globalThis._crmTareasFallo = false;
const crmPintarTareasLead = new Function(codigo + '\nreturn crmPintarTareasLead;')();

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

// Mezcladas, como llegan de verdad.
globalThis._crmTareasLead = [
  { id: 't1', type: 'task', title: 'Llamar al cliente', due_at: new Date(Date.now() + 864e5).toISOString(), done: false },
  { id: 'm1', type: 'meeting', title: 'Visita al apartamento', due_at: new Date(Date.now() + 2 * 864e5).toISOString(), done: false },
  { id: 'm2', type: 'meeting', title: null, due_at: null, done: false },
];
crmPintarTareasLead();
const html = cajas['crm-d-tareas'].innerHTML;

console.log('\nLa cita se distingue de la tarea\n');
chk('se pintan las tres filas',
    (html.match(/class="crm-d-tarea[" ]/g) || []).length === 3,
    String((html.match(/class="crm-d-tarea[" ]/g) || []).length));
chk('una tarea NO se marca como cita', !/Llamar al cliente[\s\S]{0,200}Cita ·/.test(html));
chk('una cita sí', /Visita al apartamento[\s\S]{0,200}Cita ·/.test(html));
// Sin título, «Tarea» sería mentira; y una cita sin hora existe.
chk('una cita sin título se llama «Cita», no «Tarea»', />Cita<\/div>/.test(html));
chk('sin fecha no se inventa una', /Sin fecha/.test(html));
chk('la casilla dice qué hace al marcarla', /Marcar la cita como atendida/.test(html));

console.log('\nLo que ya funcionaba sigue igual\n');
chk('la sección se muestra cuando hay filas', cajas['crm-d-tareas-section'].style.display === 'flex');
{
  // Lo hecho se sigue viendo, para poder destildarlo: una casilla que solo va
  // en un sentido no es una casilla.
  globalThis._crmTareasLead = [{ id: 't9', type: 'task', title: 'Ya hecha', due_at: null, done: true }];
  crmPintarTareasLead();
  const h = cajas['crm-d-tareas'].innerHTML;
  chk('una tarea hecha se sigue viendo, tildada', /checkbox" checked/.test(h) && /Ya hecha/.test(h));
  chk('y se puede destildar', /Destilda para volver a dejarla pendiente/.test(h));
}
{
  globalThis._crmTareasLead = [];
  crmPintarTareasLead();
  chk('sin nada, la sección se esconde en vez de dejar un hueco',
      cajas['crm-d-tareas-section'].style.display === 'none' && cajas['crm-d-tareas'].innerHTML === '');
}
{
  // Un lead de otro comercial se ve pero no se toca.
  globalThis.puedoGestionar = () => false;
  globalThis._crmTareasLead = [{ id: 't1', type: 'task', title: 'De otro', due_at: null, done: false }];
  crmPintarTareasLead();
  const h = cajas['crm-d-tareas'].innerHTML;
  chk('sin permiso la casilla va deshabilitada y se dice por qué',
      /disabled/.test(h) && /Este lead lo lleva otra persona/.test(h));
}

{
  // Si la consulta falla, la caja decía «Ninguna tarea pendiente». Es la misma
  // mentira que se quitó de las otras cajas de la ficha.
  globalThis._crmTareasFallo = true;
  globalThis._crmTareasLead = [];
  crmPintarTareasLead();
  const h = cajas['crm-d-tareas'].innerHTML;
  console.log('\nSi la consulta falla, no se dice «ninguna»\n');
  chk('se dice que no se pudieron cargar', /No se pudieron cargar/.test(h), h.slice(0, 80));
  chk('y la sección se queda a la vista, no se esconde',
      cajas['crm-d-tareas-section'].style.display === 'flex');
  globalThis._crmTareasFallo = false;
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
