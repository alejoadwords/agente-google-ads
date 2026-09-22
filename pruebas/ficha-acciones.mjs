// Las acciones de la ficha funcionan: node pruebas/ficha-acciones.mjs
//
// Todas ellas —agendar, propuesta, cambiar de proceso, cambiar de etapa—
// empiezan con `if (!crmDetailLead) return;`. Si ese global está en null no
// pasa NADA y no se dice nada: el botón se pulsa y la aplicación se queda
// quieta. Así estuvo la ficha un día entero.
//
// Había dos formas de anularlo, y las dos pasaban:
//   1. `crmAbrirFicha` llamaba a `crmCloseDetail()` DESPUÉS de apuntar el lead.
//   2. `agnScheduleForLead` y `prpOpenForLead` cierran el panel antes de abrir
//      lo suyo, así que la primera acción funcionaba y mataba la siguiente.
//
// La prueba EJECUTA el ciclo con un DOM de mentira en vez de mirar el texto:
// la guarda anterior comprobaba que existiera `crmDetailLead = lead` —existía—
// y no que sobreviviera.

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

const clases = { remove() {}, add() {} };
globalThis.document = { getElementById: () => ({ classList: clases, style: {}, innerHTML: '' }), querySelector: () => null };

const codigo = [
  trozo('function crmCloseDetail()', '\nasync function crmLoadLinkedConversations'),
  trozo('function agnScheduleForLead()', '\n// ══ ROUTER'),
  'var crmDetailLead = null, lfLead = null;',
  'var abiertos = [];',
  'function agnModalOpen(id) { abiertos.push("agenda:" + id); }',
  'return { crmCloseDetail, agnScheduleForLead, fijar: (l) => { lfLead = l; crmDetailLead = l; },' +
  ' estado: () => ({ crmDetailLead, lfLead }), abiertos: () => abiertos, cerrarFicha: () => { lfLead = null; } };',
].join('\n');
const app = new Function(codigo)();

console.log('\nCerrar el panel no deja sin lead a la ficha\n');
{
  const lead = { id: 'l1', name: 'Lead de prueba' };
  app.fijar(lead);
  app.crmCloseDetail();
  chk('con la ficha abierta, el lead sobrevive',
      app.estado().crmDetailLead === lead, String(app.estado().crmDetailLead));
}

console.log('\nUna acción no mata a la siguiente\n');
{
  const lead = { id: 'l1', name: 'Lead de prueba' };
  app.fijar(lead);
  app.agnScheduleForLead();
  chk('la primera acción abre lo suyo', app.abiertos().includes('agenda:l1'), app.abiertos().join(','));
  // Esta es la que fallaba: agendar cerraba el panel y anulaba el lead.
  chk('y la segunda TAMBIÉN encuentra el lead',
      app.estado().crmDetailLead === lead, 'quedó en ' + String(app.estado().crmDetailLead));
  app.agnScheduleForLead();
  chk('así que se puede volver a pulsar',
      app.abiertos().filter(x => x === 'agenda:l1').length === 2, app.abiertos().join(','));
}

console.log('\nCon la ficha cerrada se comporta como siempre\n');
{
  app.fijar({ id: 'l2' });
  app.cerrarFicha();
  app.crmCloseDetail();
  chk('cerrar el panel sí anula el lead', app.estado().crmDetailLead === null,
      String(app.estado().crmDetailLead));
}

console.log('\nY el orden dentro de crmAbrirFicha\n');
{
  const abrir = trozo('async function crmAbrirFicha(', '\nfunction lfCerrar()');
  const iCierra = abrir.indexOf('crmCloseDetail();');
  const iApunta = abrir.indexOf('crmDetailLead = lead;');
  chk('se cierra el panel ANTES de apuntar el lead',
      iCierra > 0 && iApunta > 0 && iCierra < iApunta, `cierra@${iCierra} apunta@${iApunta}`);
  chk('y no se vuelve a cerrar después',
      abrir.indexOf('crmCloseDetail();', iApunta) === -1);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
