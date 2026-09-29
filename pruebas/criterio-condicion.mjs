// La condición de un criterio, cuando es otra pregunta: node pruebas/criterio-condicion.mjs
//
// Un criterio tiene dos campos: qué averiguar, y qué respuesta lo da por bueno.
// En la pantalla el segundo era un recuadro sin etiqueta —solo un texto de
// ejemplo que desaparece al escribir— y un cliente escribió ahí OTRA pregunta:
//
//   averigua: Qué presupuesto maneja
//   se considera que cumple si: Cuál es el mejor horario para contactarlo
//
// Eso no tiene sentido, y el modelo lo resolvía metiendo la respuesta del
// horario en la casilla del presupuesto. El resumen que le llegaba al comercial
// decía que el presupuesto del cliente era «Celular: 3213456789».

import { readFileSync } from 'node:fs';
import { lineaCondicion } from '../api/_qualify.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const htm = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nUna pregunta escrita ahí se trata como una pregunta');
for (const c of ['Cuál es el mejor horario para contactarlo y si prefiere llamada o WhatsApp',
                 'En qué ciudad y en qué zona o barrio', '¿Tiene parqueadero?',
                 'cual es su presupuesto', 'Cuántas habitaciones necesita', 'Dónde trabaja',
                 'si prefiere llamada o whatsapp?']) {
  ok(/Y también/.test(lineaCondicion(c)), JSON.stringify(c.slice(0, 44)));
}
ok(/Apunta las dos cosas en el valor/.test(lineaCondicion('¿en qué zona?')),
   'y se le pide que apunte las dos respuestas, no una');

console.log('\nY una condición de verdad sigue siendo una condición');
for (const c of ['Chapinero o Usaquén', 'más de 200 millones', 'que sea en el norte',
                 'como máximo 3 millones', 'estrato 4, 5 o 6', 'vive en Barranquilla',
                 'tiene los papeles al día', 'desde 2 millones']) {
  const l = lineaCondicion(c);
  ok(/Se considera que cumple si/.test(l), JSON.stringify(c.slice(0, 40)), l.trim());
}
// «que» sin tilde es un relativo, «qué» con tilde pregunta. Es lo único que los
// distingue, y con `\b` de JavaScript la «é» no cuenta como letra: `\bqué\b` no
// casa nunca.
ok(!/Y también/.test(lineaCondicion('que sea en el norte')), 'un «que» sin tilde no es una pregunta');
ok(/Y también/.test(lineaCondicion('En qué ciudad busca')), 'y uno con tilde sí, aunque vaya en medio');
ok(!/Y también/.test(lineaCondicion('como máximo 3 millones')),
   '«como» se queda fuera: «como máximo» es una condición de las de verdad');
ok(lineaCondicion('') === '' && lineaCondicion(null) === '', 'sin condición, no se añade nada');

console.log('\nY la pantalla ya no se presta a la confusión');
ok(/class="cal-crit-lbl">Qué debe averiguar/.test(app), 'el primer campo tiene su nombre a la vista');
ok(/Qué respuesta lo da por bueno/.test(app), 'y el segundo dice lo que de verdad es');
ok(/opcional — vacío = cualquiera vale/.test(app), 'y que se puede dejar vacío');
ok(/\.cal-crit-lbl\{/.test(htm), 'con su estilo');
ok(!/placeholder="Se considera que cumple si…/.test(app),
   'ya no se explica solo en un texto que desaparece al escribir');

console.log('');
process.exit(mal ? 1 : 0);
