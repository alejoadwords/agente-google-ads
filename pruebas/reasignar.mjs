// Reasignar un lead: node pruebas/reasignar.mjs
//
// Hay tres formas de reasignar —el chip del tablero, el desplegable del panel
// y el de la ficha— y las tres tienen que comportarse igual cuando el servidor
// dice que no. El chip ya revertía y lo dejaba escrito: «dejar la tarjeta
// mostrando un dueño que el servidor no guardó es peor que no haber hecho
// nada». El desplegable no lo hacía.
//
// Y algo peor: `teamAssignLead` no miraba `res.ok`, así que un 403 —un miembro
// que no puede reasignar— o un 500 pasaban por buenos y se anunciaba «Lead
// asignado a X» sobre algo que no se guardó.
//
// Se ejecuta la función real contra respuestas de mentira.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const trozo = (desde, hasta) => {
  const a = js.indexOf(desde);
  if (a < 0) throw new Error('No encontré en app.js: ' + desde);
  return js.slice(a, js.indexOf(hasta, a));
};

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const avisos = [];
let respuesta = null;
const codigo = [
  trozo('async function teamAssignLead(', '\n// El dueño necesita el equipo cargado'),
  'var crmDetailLead = null, agencyActiveClientId = null;',
  'function crmRender() {} function lfQuienRefrescar() {} function teamPopulateAssign() {}',
  'function showToast(m, t) { avisos.push({ m, t: t || "info" }); }',
  'return { teamAssignLead, fijar: (l) => { crmDetailLead = l; }, lead: () => crmDetailLead };',
].join('\n');
globalThis.avisos = avisos;
globalThis.fetchAuth = async () => respuesta;
const app = new Function(codigo)();

const selector = (id, texto) => ({ value: id, selectedIndex: 0, options: [{ text: texto }] });
const nuevo = () => ({ id: 'l1', assigned_to: 'u_maira', assigned_name: 'Maira Ballesteros' });

console.log('\nCuando sí se guarda\n');
{
  const lead = nuevo(); app.fijar(lead); avisos.length = 0;
  respuesta = { ok: true, status: 200, json: async () => ({}) };
  await app.teamAssignLead(selector('u_deysy', 'Deysy Pacheco'));
  chk('queda el responsable nuevo', lead.assigned_to === 'u_deysy' && lead.assigned_name === 'Deysy Pacheco',
      JSON.stringify(lead));
  chk('y se dice', /asignado a Deysy/.test(avisos.map(a => a.m).join(' ')), JSON.stringify(avisos));
}

console.log('\nCuando el servidor lo rechaza\n');
{
  const lead = nuevo(); app.fijar(lead); avisos.length = 0;
  // Un 403 no lanza: `fetchAuth` devuelve la respuesta igual. Sin mirar
  // `res.ok` esto pasaba por bueno.
  respuesta = { ok: false, status: 403, json: async () => ({ error: 'Tu perfil no puede reasignar leads' }) };
  await app.teamAssignLead(selector('u_deysy', 'Deysy Pacheco'));
  chk('el responsable vuelve a ser el de antes',
      lead.assigned_to === 'u_maira' && lead.assigned_name === 'Maira Ballesteros', JSON.stringify(lead));
  chk('NO se anuncia como guardado',
      !/asignado a Deysy/.test(avisos.map(a => a.m).join(' ')), JSON.stringify(avisos));
  chk('y se dice el motivo del servidor',
      /Tu perfil no puede reasignar/.test(avisos.map(a => a.m).join(' ')), JSON.stringify(avisos));
  chk('marcado como error', avisos.some(a => a.t === 'error'));
}

console.log('\nCuando se cae la red\n');
{
  const lead = nuevo(); app.fijar(lead); avisos.length = 0;
  globalThis.fetchAuth = async () => { throw new Error('Failed to fetch'); };
  await app.teamAssignLead(selector('', 'Sin asignar'));
  chk('también vuelve atrás', lead.assigned_to === 'u_maira', JSON.stringify(lead));
  globalThis.fetchAuth = async () => respuesta;
}

console.log('\nLas tres formas de reasignar deshacen igual\n');
{
  const chip = trozo('function crmReasignarChip(', '\n// ── Filtro por ejecutivo');
  chk('el chip del tablero revierte', /lead\.assigned_to = antesId; lead\.assigned_name = antesNombre;/.test(chip));
  const sel = trozo('async function teamAssignLead(', '\n// El dueño necesita el equipo');
  chk('el desplegable también', /lead\.assigned_to = antesId;/.test(sel));
  chk('y el desplegable del panel se devuelve a mano, que no se repinta solo',
      /teamPopulateAssign\(lead\)/.test(sel));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
