// Que el agente trate de usted cuando se le pide: node pruebas/trato-usted.mjs
//
// Un cliente puso su agente en formal, cargó 31 preguntas frecuentes y 8.335
// caracteres de contexto que repetían «trate siempre de usted», y el agente le
// contestó «¡Hola! Te ayudo con gusto» en el primer mensaje.
//
// No era desobediencia del modelo. La instrucción era media línea colgada de
// otra —«Habla como una persona real, cálida y natural. Usa "usted".»— dentro
// de un prompt donde las otras cuarenta líneas tutean al agente: «habla»,
// «dilo», «hazlo», «no seas». Un modelo pequeño copia el registro que tiene
// alrededor antes que una cláusula suelta.
//
// Medido con Haiku sobre seis primeros mensajes reales: con la instrucción
// vieja, 6 de 6 respuestas tuteaban; con esta, 0 de 6.
//
// Aquí no se llama al modelo —costaría dinero en cada ejecución y no sería
// determinista—, se protege lo que hizo que funcionara: que la instrucción sea
// la primera, vaya sola, traiga ejemplo y no admita excepciones.

import { readFileSync } from 'node:fs';
import { tratamiento, buildSystemPrompt } from '../api/_inbox-engine.js';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

const AGENTE = (tone) => ({
  name: 'Aura', tone, persona: 'Asesora.', business_ctx: 'Inmobiliaria.',
  faqs: [], capture_fields: ['nombre', 'celular'],
});

console.log('\nEn formal, la instrucción es inequívoca');
const f = tratamiento('formal');
ok(/USTED/.test(f), 'lo dice en mayúsculas: es la única línea del prompt que las lleva');
ok(/ayudarle|cuénteme/.test(f), 'y con un ejemplo de cómo suena');
ok(/nunca|Nunca/.test(f) && /«tú»/.test(f), 'nombra explícitamente lo que NO debe usar');
ok(/aunque|ni siquiera/.test(f),
   'y cubre el caso que lo rompía: que la persona tutee al agente primero');
ok(/no tiene excepciones/i.test(f), 'sin puertas traseras');

console.log('\nEn informal, la de siempre');
const i = tratamiento('informal');
ok(/de tú/.test(i) && !/USTED/.test(i), 'habla de tú');
ok(/ayudo|cuéntame/.test(i), 'también con ejemplo');
ok(tratamiento(undefined) === i, 'y sin tono configurado, informal: es el de LatAm');
ok(tratamiento('') === i && tratamiento(null) === i, 'con vacío o null, igual');

console.log('\nY llega al prompt en el sitio que importa');
const pFormal = buildSystemPrompt(AGENTE('formal'), {}, null, null, 'whatsapp', null);
const pInformal = buildSystemPrompt(AGENTE('informal'), {}, null, null, 'whatsapp', null);

ok(pFormal.includes(f), 'el prompt en formal lleva la instrucción entera');
ok(!pFormal.includes('Usa "tú"') && !/Háblale de tú/.test(pFormal),
   'y ni rastro de la de tutear');
ok(pInformal.includes(i) && !/TRÁTALE DE USTED/.test(pInformal), 'y al revés en informal');

// Que vaya PRIMERA es la mitad del arreglo: abajo del todo se diluye entre las
// demás. Se comprueba contra el bloque de comportamiento, no contra un número
// de línea, que se desplaza en cuanto alguien añade una instrucción.
const bloque = pFormal.slice(pFormal.indexOf('CÓMO DEBES COMPORTARTE:'));
const lineas = bloque.split('\n').filter(l => l.startsWith('- '));
ok(lineas[0] === f.trim(), 'es la PRIMERA instrucción de comportamiento, no una del montón',
   lineas[0]?.slice(0, 60));

// Y sola: el fallo original fue ir pegada a otra con un punto en medio.
ok(!/cálida y natural.*usted/i.test(pFormal),
   'y no cuelga de «habla como una persona real», que es como se perdía');

console.log('');
process.exit(mal ? 1 : 0);
