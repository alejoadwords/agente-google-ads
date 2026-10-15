// Horas para llamar dentro del horario: node pruebas/horas-de-llamada.mjs
//
// Revisión del agente de Certain (14-10-2026): preguntaba «¿a qué hora?» en
// abierto y aceptó «el viernes a las 12:30», en la pausa del almuerzo. Ahora
// ofrece horas concretas y no puede confirmar una fuera del horario.

import { readFileSync } from 'fs';
import { horarioDelTexto, describirHorario, opcionesDeLlamada, horaFueraDeHorario, bloqueDeAhora, sinLlamarYo, respuestaSeguraDeHorario, relojDelNegocio } from '../api/_inbox-engine.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };

// El texto real del contexto de Certain.
const CERTAIN = 'OFICINA\nAtención de lunes a viernes, de 8:00 a. m. a 12:00 m. y de 2:00 p. m. a 5:00 p. m. Por chat se recibe a cualquier hora.';
const fr = horarioDelTexto(CERTAIN);
const MIE = 3, JUE = 4, VIE = 5, SAB = 6;
const h = (hh, mm = 0) => hh * 60 + mm;

console.log('\nEl horario de Certain');
ok(describirHorario(fr) === 'lunes a viernes de 8:00 a. m. a 12:00 m. y de 2:00 p. m. a 5:00 p. m.', 'se describe en palabras', describirHorario(fr));

console.log('\nOpciones que ofrece');
{
  const o = opcionesDeLlamada(fr, MIE, h(10, 10));
  ok(o.length === 3, 'tres opciones');
  ok(o[0].enDias === 0 && o[0].desde === h(11, 30), 'miércoles 10:10 → hoy 11:30 (una hora de margen, en punto o y media)', o[0]);
  ok(o[1].enDias === 0 && o[1].desde === h(14), 'y hoy 2:00 p. m., después del almuerzo — nunca a las 12:30', o[1]);
  ok(o.every(x => x.desde < h(12) || x.desde >= h(14)), 'ninguna cae en la pausa del mediodía', o);
  const tarde = opcionesDeLlamada(fr, VIE, h(16, 40));
  ok(tarde[0].enDias === 3 && tarde[0].desde === h(9), 'viernes 4:40 p. m. → el lunes (salta el fin de semana)', tarde[0]);
  const conFestivo = opcionesDeLlamada(fr, VIE, h(18), k => k === 3);
  ok(conFestivo[0].enDias === 4, 'si el lunes es festivo, empieza el martes', conFestivo[0]);
}

console.log('\nLo que NO puede confirmar (frases de la captura)');
const fuera = (t, dia = MIE, min = h(10)) => horaFueraDeHorario(t, fr, dia, min);
ok(fuera('Perfecto, te llamamos el viernes a las 12:00 p. m. Voy a compartir toda tu información') !== null, '«el viernes a las 12:00 p. m.» → fuera (cierra a las 12)');
ok(fuera('Listo, entonces el viernes a las 12:30 p. m. Perfecto, así queda registrado.') !== null, '«el viernes a las 12:30 p. m.» → fuera (almuerzo)');
ok(fuera('Te llamamos el sábado a la 1 p. m.') !== null, 'sábado → fuera');
ok(fuera('Te llamamos mañana a las 7:00 a. m.') !== null, 'antes de abrir → fuera');
ok(fuera('Un asesor te llama hoy a las 9:00 a. m.', MIE, h(10)) !== null, 'hoy a una hora que ya pasó → fuera');

console.log('\nLo que sí puede decir');
ok(fuera('Perfecto, te llamamos el viernes a las 3:00 p. m.') === null, 'viernes 3:00 p. m. → dentro');
ok(fuera('Listo, mañana a las 9:30 a. m. te llama un asesor.') === null, 'mañana 9:30 a. m. → dentro');
ok(fuera('Te llamamos el viernes a las 4 de la tarde') === null, '«a las 4 de la tarde» → dentro');
ok(fuera('A esa hora ya no estamos; atendemos hasta las 5:00 p. m. de lunes a viernes.') === null, 'explicar el horario o rechazar una hora no cuenta');
ok(fuera('¿Te sirve el viernes a las 10:00 a. m. o a las 3:00 p. m.?') === null, 'ofrecer dos horas válidas → bien');
ok(fuera('El apartamento tiene 3 habitaciones y está en Olaya.') === null, 'números que no son horas no cuentan');
ok(horaFueraDeHorario('el viernes a las 12:30', null, VIE, h(10)) === null, 'sin horario configurado no se inventa ninguno');

console.log('\nEl prompt ofrece las opciones');
{
  const b = bloqueDeAhora('America/Bogota', new Date('2026-10-14T15:10:00Z'), CERTAIN);   // miércoles 10:10 a. m.
  ok(/HORARIO PARA LLAMAR O CONTACTAR/.test(b) && /lunes a viernes de 8:00 a\. m\. a 12:00 m\./.test(b), 'el bloque trae el horario');
  ok(/NO dejes la pregunta abierta/.test(b) && /hoy a las 11:30 a\. m\./.test(b), 'y las horas concretas para ofrecer', b.slice(b.indexOf('HORARIO')));
}

console.log('\nQuién llama y por qué no se puede');
ok(sinLlamarYo('¿Te llamo el viernes a las 2:00 p. m.?') === '¿Te llamamos el viernes a las 2:00 p. m.?', '«¿Te llamo…?» → «¿Te llamamos…?»');
ok(sinLlamarYo('Perfecto, le llamo mañana') === 'Perfecto, le llamamos mañana', 'también en usted');
ok(sinLlamarYo('Un asesor te llama mañana') === 'Un asesor te llama mañana', '«un asesor te llama» se queda igual');
ok(sinLlamarYo('Te llamamos el viernes') === 'Te llamamos el viernes', 'lo que ya está bien no se toca');
ok(sinLlamarYo('Me llamo Aura') === 'Me llamo Aura', '«me llamo Aura» es su nombre, no una llamada');
{
  const b = bloqueDeAhora('America/Bogota', new Date('2026-10-14T15:10:00Z'), CERTAIN);
  ok(/los sábados no atendemos/.test(b), 'el prompt pide decir el motivo exacto (día sin atención)');
  ok(/nunca «te llamo»/.test(b), 'y que no diga «te llamo»');
}
const eng2 = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
ok((eng2.match(/sinLlamarYo\(/g) || []).length >= 4, 'la corrección de «te llamo» está en la conversación real y en el probador');

console.log('\nLa última red: si insiste, sale un mensaje seguro');
{
  // Miércoles 5:30 p. m. en Bogotá; el agente insistió en «hoy a las 5:30» (captura de Certain).
  const reloj = relojDelNegocio('America/Bogota', new Date('2026-10-14T22:30:00Z'), CERTAIN);
  const orig = 'Perfecto, voy a registrar que te llamen hoy a las 5:30 p. m. [CALIFICACION: {"criterio_4": {"valor": "llamada", "cumple": true}}]';
  const f = horaFueraDeHorario(orig, reloj.franjas, reloj.dia, reloj.min, reloj.festivo);
  ok(!!f, 'la respuesta de la captura se detecta');
  const r = respuestaSeguraDeHorario(reloj, f, orig);
  ok(horaFueraDeHorario(r, reloj.franjas, reloj.dia, reloj.min, reloj.festivo) === null, 'el mensaje seguro nunca tiene una hora fuera', r);
  ok(/^A esa hora ya cerramos\./.test(r), 'dice el motivo exacto', r);
  ok(/mañana a las 9:00 a\. m\. o mañana a las 3:00 p\. m\./.test(r), 'y ofrece dos horas válidas', r);
  ok(/\[CALIFICACION: \{"criterio_4"/.test(r), 'conserva la calificación oculta de la respuesta original');
  ok(!/p\. m\.\./.test(r), 'sin puntos dobles');
  ok(/¿Le sirve/.test(respuestaSeguraDeHorario(reloj, f, orig, true)), 'con trato de usted');
  const sabado = horaFueraDeHorario('Listo, te llamamos el sábado a la 1 p. m.', reloj.franjas, reloj.dia, reloj.min, reloj.festivo);
  ok(/^Ese día no atendemos/.test(respuestaSeguraDeHorario(reloj, sabado, '')), 'sábado → «Ese día no atendemos»');
}
const eng3 = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
ok((eng3.match(/respuestaSeguraDeHorario\(reloj, fuera, (bruto|reply)/g) || []).length === 2, 'la última red está en la conversación real y en el probador');

console.log('\nCableado');
const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
ok((eng.match(/const fuera = .*horaFueraDeHorario\(/g) || []).length === 2, 'el guardián está en la conversación real y en el probador');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
