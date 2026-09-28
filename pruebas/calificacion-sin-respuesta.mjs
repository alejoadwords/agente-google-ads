// Un criterio sin respuesta no está respondido: node pruebas/calificacion-sin-respuesta.mjs
//
// Visto en la primera prueba real de un agente: la radiografía decía
// «Calificado (1 de 2)» con el presupuesto en rojo y el valor «sin
// información». El agente acababa de preguntarlo y nadie se lo había
// contestado.
//
// Pasaba porque el modelo, en vez de omitir lo que no sabe —que es justo lo que
// el prompt le pide—, a veces lo reporta como {"valor": "sin información",
// "cumple": false}. Y eso contaba como criterio RESPONDIDO. Con todos los
// criterios «respondidos», `evaluar` deja de esperar y suelta el veredicto: un
// lead llegaba al comercial marcado como calificado y sin presupuesto, o
// descartado sin haber dicho una palabra.
//
// Lo que se protege: que esas respuestas de relleno se caigan antes de contar,
// y que no se lleve por delante respuestas de verdad. «No» es una respuesta.

import { esNoRespuesta, extraerCalificacion, evaluar } from '../api/_qualify.js';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nLo que significa «todavía no me lo han dicho»');
const relleno = ['', '   ', 'sin información', 'sin informacion', 'sin datos', 'sin especificar',
  'no sé', 'no se', 'No lo dijo', 'no especificó', 'no indicó', 'no proporcionó',
  'pendiente', 'N/A', 'n/a', 'null', '—', '?', '...', 'ninguna', 'ninguno',
  'No disponible', 'no aplica', 'desconocido',
  // Con matices de tiempo, que es como los escribe el modelo.
  'sin información aún', 'no lo dijo todavía', 'no disponible por ahora'];
for (const v of relleno) ok(esNoRespuesta(v), JSON.stringify(v) + ' no es una respuesta');

console.log('\nY lo que sí lo es, aunque lo parezca');
const buenas = ['3 millones', 'Buenavista', 'Apartamento', 'Barranquilla',
  // «No» es una respuesta perfectamente válida a un criterio de sí o no.
  'no',
  'no tiene parqueadero', 'Sin ascensor', 'ninguno de los dos le sirve',
  'no quiere dar el presupuesto', 'no sabe manejar', 'sin amoblar'];
for (const v of buenas) ok(!esNoRespuesta(v), JSON.stringify(v) + ' sí es una respuesta');

console.log('\nEl caso exacto que lo destapó');
const REGLA = {
  activo: true,
  criterios: [{ clave: 'tipo', pregunta: '¿Qué tipo de inmueble?' },
              { clave: 'presupuesto', pregunta: '¿Qué presupuesto maneja?' }],
  minimo: 1,
  al_calificar: { escalar: true, etapa: 'calificado', etiqueta: 'calificado' },
  al_descartar: { etiqueta: 'no-calificado' },
};
const CON_RELLENO = '[CALIFICACION: {"tipo": {"valor": "Apartamento en Buenavista", "cumple": true}, ' +
  '"presupuesto": {"valor": "sin información", "cumple": false}}]';

const r = extraerCalificacion(CON_RELLENO);
ok(!('presupuesto' in r), 'el criterio de relleno no llega a las respuestas', JSON.stringify(r));
ok(r.tipo?.valor === 'Apartamento en Buenavista', 'y el que sí tiene respuesta, intacto');

const v = evaluar(REGLA, r);
ok(v.estado === 'pendiente',
   'el veredicto se queda pendiente, que es lo que toca: falta el presupuesto', v.estado);

console.log('\nY en cuanto lo contesta de verdad, califica');
const CONTESTADO = CON_RELLENO
  .replace('sin información', 'hasta 3 millones').replace('"cumple": false', '"cumple": true');
const v2 = evaluar(REGLA, extraerCalificacion(CONTESTADO));
ok(v2.estado === 'calificado', 'califica', v2.estado);
ok(v2.cumplidas === 2 && v2.total === 2, 'con los dos criterios contados', `${v2.cumplidas}/${v2.total}`);

console.log('\nUn «no» no se cae');
// Si «no» se tratara como relleno, un criterio de sí o no jamás se cerraría y
// la conversación se quedaría preguntando lo mismo para siempre.
const NEGATIVO = '[CALIFICACION: {"tipo": {"valor": "Casa", "cumple": true}, ' +
  '"presupuesto": {"valor": "no", "cumple": false}}]';
const rn = extraerCalificacion(NEGATIVO);
ok('presupuesto' in rn, '«no» cuenta como respondido');
ok(evaluar(REGLA, rn).estado !== 'pendiente',
   'así que el veredicto sale y la conversación avanza', evaluar(REGLA, rn).estado);

console.log('\nLo de siempre sigue funcionando');
ok(Object.keys(extraerCalificacion('sin bloque')).length === 0, 'un texto sin bloque no da nada');
ok(Object.keys(extraerCalificacion('[CALIFICACION: no es json]')).length === 0, 'un bloque roto tampoco revienta');
ok(extraerCalificacion('[CALIFICACION: {"_ruta": "arriendo"}]')._ruta === 'arriendo',
   'y la ruta sigue saliendo');
// La ruta no pasa por el filtro de relleno: es una cadena suelta, no un
// criterio, y perderla dejaría el lead en el tablero que no toca.
ok(extraerCalificacion('[CALIFICACION: {"_ruta": {"valor": "venta"}}]')._ruta === 'venta',
   'venga como cadena o como objeto');

console.log('');
process.exit(mal ? 1 : 0);
