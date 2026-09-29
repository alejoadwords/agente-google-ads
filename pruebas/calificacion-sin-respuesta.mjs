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
import { extractCapturedData } from '../api/_inbox-engine.js';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nLo que significa «todavía no me lo han dicho»');
const relleno = ['', '   ', 'sin información', 'sin informacion', 'sin datos', 'sin especificar',
  // Los participios. «No especificado» disparó un veredicto sin presupuesto en
  // el PRIMER mensaje de una conversación real: el lead salió calificado y se
  // repartió a un comercial sin que nadie hubiera dicho cuánto podía pagar.
  'No especificado', 'no especificada', 'no indicado', 'no mencionado',
  'no proporcionado', 'no definido', 'no confirmado', 'no suministrado', 'no dicho',
  // Y la FORMA, porque el modelo inventa frases nuevas para decir lo mismo.
  // Esta salió en una prueba real y volvió a disparar el veredicto en el
  // primer mensaje: «Sin presupuesto ni horario definidos».
  'Sin presupuesto ni horario definidos', 'sin presupuesto definido',
  'sin zona determinada', 'sin monto establecido',
  'sin horario ni medio de contacto definidos',
  'no sé', 'no se', 'No lo dijo', 'no especificó', 'no indicó', 'no proporcionó',
  'pendiente', 'N/A', 'n/a', 'null', '—', '?', '...', 'ninguna', 'ninguno',
  'No disponible', 'no aplica', 'desconocido',
  // Con matices de tiempo, que es como los escribe el modelo.
  'sin información aún', 'no lo dijo todavía', 'no disponible por ahora'];
for (const v of relleno) ok(esNoRespuesta(v), JSON.stringify(v) + ' no es una respuesta');

console.log('\nY lo que sí lo es, aunque lo parezca');
const buenas = ['3 millones', 'Buenavista', 'Apartamento', 'Barranquilla',
  // Y lo que la regla general de participios se tragaba: «no amoblado» es una
  // respuesta perfectamente buena a «¿lo quiere amoblado?».
  'no amoblado', 'no remodelado', 'no negociable', 'sin amoblar',
  // Y lo que la forma general NO puede tragarse: son respuestas de verdad.
  'sin ascensor', 'sin parqueadero', 'sin remodelar', 'presupuesto flexible',
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

// ── El historial entero, no el primer bloque ────────────────────────────────
//
// A extraerCalificacion se le pasa tanto UN mensaje como todo el historial
// concatenado. Leyendo solo el primer bloque se quedaba con la foto del primer
// turno —un criterio respondido— y un lead que ya había contestado las cuatro
// preguntas retrocedía a «pendiente» en cuanto el modelo emitía un bloque
// corto. En pendiente no se le asigna asesor a nadie: el lead se queda quieto.
console.log('\nDel historial se acumulan todos los bloques');
{
  const b = (o) => 'texto [CALIFICACION: ' + JSON.stringify(o) + ']';
  const uno = { tipo: { valor: 'apartamento', cumple: true } };
  const todo = {
    tipo: { valor: 'apartamento', cumple: true },
    zona: { valor: 'Buenavista', cumple: true },
    presupuesto: { valor: '3 millones', cumple: true },
    horario: { valor: 'tarde', cumple: true },
  };
  const hist = [b(uno), b(todo), b(uno)].join('\n');
  const r = extraerCalificacion(hist);
  ok(Object.keys(r).length === 4,
     'un bloque corto al final no borra lo ya respondido', Object.keys(r).join(','));
  ok(r.presupuesto?.valor === '3 millones', 'y el valor que se conserva es el bueno', r.presupuesto?.valor);

  // Gana el último: si el cliente se corrige, vale lo que dijo después.
  const corregido = [b({ presupuesto: { valor: '2 millones', cumple: true } }),
                     b({ presupuesto: { valor: '4 millones', cumple: true } })].join('\n');
  ok(extraerCalificacion(corregido).presupuesto?.valor === '4 millones',
     'y si se corrige, manda lo último que dijo');

  ok(Object.keys(extraerCalificacion(b(todo))).length === 4,
     'un solo mensaje sigue funcionando igual');
  ok(Object.keys(extraerCalificacion('sin bloque ninguno')).length === 0, 'y sin bloque, nada');

  // Un JSON a medias —el modelo se quedó sin tokens a mitad del bloque— no
  // puede seguir buscando su llave de cierre dentro del bloque siguiente: se
  // llevaría por delante las respuestas buenas que venían después.
  const conRoto = [b(uno), 'x [CALIFICACION: {"zona":{"valor":] ', b(todo)].join('\n');
  ok(Object.keys(extraerCalificacion(conRoto)).length === 4,
     'un bloque roto no se lleva por delante a los buenos',
     Object.keys(extraerCalificacion(conRoto)).join(','));
}
// Y lo mismo con el bloque de datos capturados, que viaja por el mismo sitio.
console.log('\nLos datos capturados también se acumulan');
{
  const b = (o) => 'hola [CAPTURA: ' + JSON.stringify(o) + ']';
  const hist = [b({ nombre: 'Andrés' }),
                b({ nombre: 'Andrés', celular: '3012457788', presupuesto: '3000000', zona: 'Buenavista' }),
                b({ nombre: 'Andrés' })].join('\n');
  const r = extractCapturedData(hist);
  ok(Object.keys(r).length === 4, 'un bloque corto al final no borra lo capturado', Object.keys(r).join(','));
  ok(extractCapturedData([b({ celular: '300' }), b({ celular: '301' })].join('\n')).celular === '301',
     'y si el cliente se corrige, vale lo último');
  ok(Object.keys(extractCapturedData('nada de nada')).length === 0, 'sin bloque, nada');
  ok(Object.keys(extractCapturedData([b({ a: 1 }), 'x [CAPTURA: {roto]', b({ c: 3 })].join('\n'))).length === 2,
     'y un bloque roto no se lleva por delante a los buenos');
}

console.log('');
process.exit(mal ? 1 : 0);
