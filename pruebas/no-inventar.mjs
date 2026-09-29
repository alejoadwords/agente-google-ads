// Que no salga un dato inventado: node pruebas/no-inventar.mjs
//
// La regla «no inventes» lleva en el prompt desde siempre, en mayúsculas y con
// la palabra INNEGOCIABLE. Y aun así, ante «muéstreme lo que tenga» y sin nada
// que enseñar, el modelo se inventó apartamentos con barrio y precio 7 de cada
// 8 veces. No es que no lea la regla: una regla es texto compitiendo con texto,
// y la conversación entera empuja hacia producir una lista.
//
// Una regla que de verdad no se puede romper no se le pide al modelo: se
// comprueba después. Nosotros sabemos exactamente qué lista le dimos.
//
// Medido con el modelo de verdad, mismo caso, ocho intentos: inventó al primer
// intento 3 veces, se corrigió las 3 al señalárselo, y llegaron al cliente 0.

import { readFileSync } from 'node:fs';
import { inventos, loQuePuedeCitar } from '../api/_inbox-engine.js';

const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

const AGENTE = {
  persona: 'Asesora de Certain & Pezzano.',
  business_ctx: 'Comisión del 3% más IVA. Administración 10% más IVA. PBX 605 385 0207.',
  faqs: [{ q: '¿El estudio tiene costo?', a: 'No, es gratuito.' }],
};
const INVENTARIO = { lineas: [
  '121513056 · Arriendo · Apartamento · Riomar, Barranquilla · 3 hab · 2 baños · $1.800.000',
  '121514278 · Arriendo · Apartamento · Villa Santos, Barranquilla · 3 hab · 2 baños · $1.850.000 · admón. $370.000 (por confirmar)',
]};
const MENSAJES = [{ role: 'user', content: 'puedo pagar hasta 2.500.000 mensuales' }];
const CITABLE = loQuePuedeCitar(AGENTE, INVENTARIO, MENSAJES);

console.log('\nLo que SÍ puede decir');
for (const [t, q] of [
  ['Riomar, 3 habitaciones, $1.800.000 (121513056)', 'un inmueble de la lista, con su código'],
  ['Villa Santos a $1.850.000 más administración de $370.000', 'y su administración'],
  ['Con los 2.500.000 que me menciona tenemos opciones', 'repetir lo que dijo el contacto'],
  ['La comisión de venta es del 3% más IVA', 'un porcentaje de su entrenamiento'],
  ['Puede llamarnos al 605 385 0207', 'el teléfono de la oficina, escrito como en su contexto'],
  ['Puede llamarnos al 6053850207', 'y también escrito de corrido'],
  ['alrededor de 1,8 millones', 'una forma redondeada de un precio que sí está'],
  ['Tenemos 2 opciones de 3 habitaciones', 'números pequeños: cantidades, no precios'],
  // Con un colador ancho, esto se leía como la cifra 20262027 y bloqueaba un
  // mensaje perfectamente bueno. Un falso positivo aquí cuesta una conversación
  // escalada sin motivo.
  ['El contrato va de 2026 a 2027', 'dos años seguidos no son una cifra'],
  ['Los contratos de 2024, 2025 y 2026', 'ni una lista de años separados por comas'],
  ['Son 3, 2, 1 y 4 según el inmueble', 'ni una lista de números sueltos'],
  ['La visita sería el 20 de marzo a las 10:30', 'ni una fecha con su hora'],
  ['', 'una respuesta vacía no revienta'],
]) {
  const r = inventos(t, CITABLE);
  ok(r.length === 0, q, 'marcó: ' + r.join(', '));
}

console.log('\nY lo que NO');
for (const [t, q] of [
  ['Apartamento en El Rosario — $1.200.000 mensuales', 'un precio que no está en ninguna parte'],
  ['tengo el 121599999 en Villa Country', 'un código que no existe'],
  ['la administración es de $450.000', 'una administración inventada'],
  ['1.450.000 mensuales', 'un importe sin el símbolo, escrito con puntos de mil'],
  ['Riomar a $1.800.000 y otro en El Prado a $2.300.000', 'uno bueno y otro inventado en la misma frase'],
]) {
  const r = inventos(t, CITABLE);
  ok(r.length > 0, q, 'no lo marcó');
}

console.log('\nY se comprueba contra TODO lo que puede citar');
ok(CITABLE.includes('121513056') && CITABLE.includes('3% más IVA') && CITABLE.includes('2.500.000'),
   'el inventario, su entrenamiento y lo que escribió el contacto');
ok(loQuePuedeCitar(null, null, null) === '', 'sin nada de eso, no revienta');
ok(inventos('$1.200.000', '').length === 1, 'y sin nada citable, todo importe es inventado');

console.log('\nEl mensaje inventado no sale');
const g = eng.slice(eng.indexOf('// ── El guardián ──'), eng.indexOf('// «Te estoy agendando'));
ok(g.length > 200, 'el guardián existe en el camino de la conversación real');
ok(/inventos\(cleanForUser\(reply\), citable\)/.test(g),
   'se comprueba el texto que iba a ver el contacto, no el bruto');
ok(/responderViendo\(system, hist, \[/.test(g),
   'y se le da UNA oportunidad de corregirse');
ok(/Eso es inventado y no se le puede decir a nadie/.test(g),
   'señalándole exactamente qué se inventó');
// El contacto no vio el mensaje que se bloqueó. Sin decírselo, el agente
// empezaba con «Tienes razón, disculpa» —pidiéndole perdón por algo que la
// persona no dijo, y tuteándola de paso.
ok(/No empieces con «tienes razón», «disculpa» ni «me equivoqué»/.test(g),
   'y avisándole de que el contacto no vio nada, para que no le pida perdón');
ok(/inventoForzado = true;/.test(g) && /\[ESCALAR\]/.test(g),
   'y si vuelve a inventar, se manda un texto seguro y lo coge una persona');
ok(/registrarError\(\{[\s\S]*?donde: 'el agente se inventó datos'/.test(g),
   'queda registrado: si pasa a menudo, hay que verlo');
// Y con QUÉ se inventó. La lista se vacía al corregirse, así que hay que
// guardarla antes: la nota quedaba sin un solo dato, midiendo nada.
ok(/const inventoOriginal = \[\.\.\.invento\];/.test(g),
   'y con lo que se inventó, no con la lista ya vaciada');
ok(/inventoOriginal\.join/.test(g), 'que es lo que se escribe');
// El orden importa: comprobar DESPUÉS de enviar no sirve de nada.
ok(eng.indexOf("donde: 'el agente se inventó datos'") < eng.indexOf("await send(connection, contactId, visible)"),
   'la comprobación va antes del envío, que es lo único que la hace servir de algo');

console.log('');
process.exit(mal ? 1 : 0);
