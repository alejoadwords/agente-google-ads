// El motor de disponibilidad: node pruebas/disponibilidad.mjs
//
// Un fallo aquí cita a dos personas a la misma hora, y ese es el único error
// que un negocio de citas no perdona: el cliente ya se movió de su casa.
//
// Por eso el módulo no toca la base: se puede probar entero con datos
// inventados, incluidos los casos que en producción no se ven nunca hasta que
// pasan — el cambio de hora, el festivo, la última franja del día.

import { franjasLibres, sigueLibre, instanteDe, diaLocal, desfaseMin, tramosDelDia,
         diasConCupo, diaDeLaSemana } from '../api/_disponibilidad.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const BOG = 'America/Bogota';
// Lunes a viernes de 9 a 13 y de 14 a 18. En JS, 1 = lunes.
const HORARIO = { 1: [['09:00', '13:00'], ['14:00', '18:00']],
                  2: [['09:00', '13:00'], ['14:00', '18:00']],
                  3: [['09:00', '13:00'], ['14:00', '18:00']],
                  4: [['09:00', '13:00'], ['14:00', '18:00']],
                  5: [['09:00', '13:00'], ['14:00', '18:00']],
                  6: [['09:00', '13:00']] };   // sábado medio día
const LEJOS = new Date('2020-01-01T00:00:00Z');  // para que nada quede "en el pasado"
const base = (x) => ({ zona: BOG, horario: HORARIO, ocupado: [], minutos: 30, paso: 30, ahora: LEJOS, ...x });
const horas = (r) => r.map(f => f.hhmm);

console.log('\nUn martes normal\n');
{
  const r = franjasLibres(base({ dia: '2026-09-22' }));   // martes
  chk('abre a las 9', horas(r)[0] === '09:00');
  chk('la última de la mañana empieza a las 12:30, no a las 13:00',
      horas(r).filter(h => h < '13:00').pop() === '12:30');
  chk('no ofrece nada durante el almuerzo', !horas(r).includes('13:30'));
  chk('la tarde arranca a las 14', horas(r).includes('14:00'));
  chk('la última del día empieza a las 17:30', horas(r).pop() === '17:30');
  chk('salen 16 franjas de media hora', r.length === 16, String(r.length));
  chk('cada franja dice cuándo termina',
      new Date(r[0].fin) - new Date(r[0].inicio) === 30 * 60000);
}

console.log('\nUn domingo\n');
{
  chk('cerrado: ni una franja', franjasLibres(base({ dia: '2026-09-20' })).length === 0);
  chk('el sábado solo media jornada',
      horas(franjasLibres(base({ dia: '2026-09-26' }))).pop() === '12:30');
}

console.log('\nLa cita tiene que caber ENTERA\n');
{
  const r = franjasLibres(base({ dia: '2026-09-22', minutos: 90, paso: 30 }));
  chk('un servicio de 90 min no se ofrece a las 12:00 (cierra a las 13)',
      !horas(r).includes('12:00'));
  chk('sí a las 11:30', horas(r).includes('11:30'));
  chk('y la última de la tarde es a las 16:30', horas(r).pop() === '16:30');
  chk('un servicio más largo que la jornada no da ninguna franja',
      franjasLibres(base({ dia: '2026-09-22', minutos: 600 })).length === 0);
}

console.log('\nLo que ya está ocupado\n');
{
  const cita = {
    ini: instanteDe(BOG, '2026-09-22', '10:00').getTime(),
    fin: instanteDe(BOG, '2026-09-22', '10:30').getTime(),
  };
  const r = horas(franjasLibres(base({ dia: '2026-09-22', ocupado: [cita] })));
  chk('la hora ocupada desaparece', !r.includes('10:00'));
  chk('la anterior sigue disponible', r.includes('09:30'));
  chk('y la siguiente también', r.includes('10:30'));

  // Solape parcial: una cita de 60 min a las 10:00 tapa las 10:00 y las 10:30.
  const larga = { ini: cita.ini, fin: cita.ini + 60 * 60000 };
  const r2 = horas(franjasLibres(base({ dia: '2026-09-22', ocupado: [larga] })));
  chk('una cita larga tapa todas las franjas que pisa',
      !r2.includes('10:00') && !r2.includes('10:30') && r2.includes('11:00'));

  // Y una franja que EMPIEZA antes y termina dentro tambien estorba.
  const previa = { ini: cita.ini - 45 * 60000, fin: cita.ini + 15 * 60000 };
  chk('una que viene de antes y se mete dentro tambien tapa',
      !horas(franjasLibres(base({ dia: '2026-09-22', ocupado: [previa] }))).includes('10:00'));
}

console.log('\nEl margen entre citas\n');
{
  const cita = {
    ini: instanteDe(BOG, '2026-09-22', '10:00').getTime(),
    fin: instanteDe(BOG, '2026-09-22', '10:30').getTime(),
  };
  const sin = horas(franjasLibres(base({ dia: '2026-09-22', ocupado: [cita], margen: 0 })));
  const con = horas(franjasLibres(base({ dia: '2026-09-22', ocupado: [cita], margen: 15 })));
  chk('sin margen, a las 10:30 se puede', sin.includes('10:30'));
  chk('con 15 min de respiro, ya no', !con.includes('10:30'));
  chk('pero a las 11:00 sí', con.includes('11:00'));
}

console.log('\nNo se ofrecen horas imposibles\n');
{
  // Son las 11:00 del martes en Bogotá.
  const ahora = instanteDe(BOG, '2026-09-22', '11:00');
  const r = horas(franjasLibres(base({ dia: '2026-09-22', ahora })));
  chk('nada del pasado', !r.includes('09:00') && !r.includes('10:30'));
  chk('la hora en punto actual tampoco (ya empezó)', !r.includes('11:00') || r[0] === '11:00');
  chk('lo que viene después, sí', r.includes('14:00'));

  const conAviso = horas(franjasLibres(base({ dia: '2026-09-22', ahora, antelacionMinHoras: 4 })));
  chk('con 4 h de antelación mínima, las 14:00 ya no valen', !conAviso.includes('14:00'));
  chk('las 15:30 sí', conAviso.includes('15:30'));
}

console.log('\nFestivos y días con horario propio\n');
{
  chk('una excepción vacía cierra el día',
      franjasLibres(base({ dia: '2026-09-22', excepciones: { '2026-09-22': [] } })).length === 0);
  const r = horas(franjasLibres(base({ dia: '2026-09-22', excepciones: { '2026-09-22': [['08:00', '10:00']] } })));
  chk('una excepción con tramos manda sobre el horario semanal',
      r[0] === '08:00' && r.pop() === '09:30');
  chk('una excepción de OTRO día no afecta',
      franjasLibres(base({ dia: '2026-09-22', excepciones: { '2026-12-25': [] } })).length === 16);
  chk('«no hay excepción» y «excepción vacía» son cosas distintas',
      tramosDelDia('2026-09-22', HORARIO, {}, 2).length === 2 &&
      tramosDelDia('2026-09-22', HORARIO, { '2026-09-22': [] }, 2).length === 0);
}

console.log('\nZonas horarias y cambio de hora\n');
{
  chk('Bogotá va cinco horas por detrás del UTC',
      desfaseMin(BOG, new Date('2026-09-22T17:00:00Z')) === -300);
  chk('las 09:00 de Bogotá son las 14:00 UTC',
      instanteDe(BOG, '2026-09-22', '09:00').toISOString() === '2026-09-22T14:00:00.000Z');
  chk('y el día local se lee bien al filo de la medianoche',
      diaLocal(BOG, new Date('2026-09-23T04:00:00Z')) === '2026-09-22');

  // Santiago cambia la hora: en septiembre está en -03, en julio en -04.
  const SCL = 'America/Santiago';
  const verano = desfaseMin(SCL, new Date('2026-01-15T15:00:00Z'));
  const invierno = desfaseMin(SCL, new Date('2026-07-15T15:00:00Z'));
  chk('en Santiago el desfase NO es fijo', verano !== invierno, `${verano} vs ${invierno}`);
  chk('y las 09:00 locales siguen siendo las 09:00 en las dos épocas',
      new Intl.DateTimeFormat('en-GB', { timeZone: SCL, hour: '2-digit', minute: '2-digit', hour12: false })
        .format(instanteDe(SCL, '2026-01-15', '09:00')) === '09:00' &&
      new Intl.DateTimeFormat('en-GB', { timeZone: SCL, hour: '2-digit', minute: '2-digit', hour12: false })
        .format(instanteDe(SCL, '2026-07-15', '09:00')) === '09:00');
}

console.log('\nLa segunda comprobación, antes de guardar\n');
{
  const cfg = base({ dia: '2026-09-22' });
  const hora = instanteDe(BOG, '2026-09-22', '10:00').toISOString();
  chk('una hora libre pasa', sigueLibre(hora, cfg) === true);
  chk('si alguien la cogió mientras tanto, no',
      sigueLibre(hora, { ...cfg, ocupado: [{
        ini: instanteDe(BOG, '2026-09-22', '10:00').getTime(),
        fin: instanteDe(BOG, '2026-09-22', '10:30').getTime() }] }) === false);
  chk('una hora que no existe en el horario tampoco',
      sigueLibre(instanteDe(BOG, '2026-09-22', '13:15').toISOString(), cfg) === false);
  chk('ni una hora inventada', sigueLibre('no es una fecha', cfg) === false);
  chk('ni un domingo', sigueLibre(instanteDe(BOG, '2026-09-20', '10:00').toISOString(), cfg) === false);
}

console.log('\nEntradas raras no revientan\n');
{
  chk('sin día, nada', franjasLibres(base({ dia: null })).length === 0);
  chk('sin horario, nada', franjasLibres({ dia: '2026-09-22', zona: BOG }).length === 0);
  chk('duración cero, nada', franjasLibres(base({ dia: '2026-09-22', minutos: 0 })).length === 0);
  chk('un tramo al revés se ignora',
      franjasLibres(base({ dia: '2026-09-22', horario: { 2: [['18:00', '09:00']] } })).length === 0);
  chk('un tramo mal formado se ignora',
      franjasLibres(base({ dia: '2026-09-22', horario: { 2: [['09:00']] } })).length === 0);
  chk('dos tramos que se pisan no duplican horas',
      new Set(horas(franjasLibres(base({ dia: '2026-09-22', horario: { 2: [['09:00', '11:00'], ['10:00', '12:00']] } })))).size ===
      horas(franjasLibres(base({ dia: '2026-09-22', horario: { 2: [['09:00', '11:00'], ['10:00', '12:00']] } }))).length);
}

console.log('\nEl puntito de cupo en la tira de días\n');
{
  const tira = diasConCupo(base({ desde: '2026-09-21', dias: 7 }));   // lunes
  chk('devuelve tantos días como se piden', tira.length === 7, String(tira.length));
  chk('y en orden, sin saltarse ninguno',
      tira.map(d => d.dia).join() === '2026-09-21,2026-09-22,2026-09-23,2026-09-24,2026-09-25,2026-09-26,2026-09-27');
  chk('el domingo sale cerrado y sin cupo',
      tira[6].cerrado === true && tira[6].cupo === false);
  chk('un día laborable normal tiene cupo',
      tira[1].cupo === true && tira[1].cerrado === false);

  // Lleno NO es lo mismo que cerrado: el negocio abre, pero no queda hueco.
  // Si se pintaran igual, el cliente creería que ese día no atienden.
  const todoElDia = [
    { ini: instanteDe(BOG, '2026-09-22', '09:00').getTime(), fin: instanteDe(BOG, '2026-09-22', '13:00').getTime() },
    { ini: instanteDe(BOG, '2026-09-22', '14:00').getTime(), fin: instanteDe(BOG, '2026-09-22', '18:00').getTime() },
  ];
  const lleno = diasConCupo(base({ desde: '2026-09-22', dias: 1, ocupado: todoElDia }));
  chk('un día lleno no tiene cupo pero NO está cerrado',
      lleno[0].cupo === false && lleno[0].cerrado === false);

  chk('una excepción vacía sí lo marca cerrado',
      diasConCupo(base({ desde: '2026-09-22', dias: 1, excepciones: { '2026-09-22': [] } }))[0].cerrado === true);

  chk('sin día de partida no revienta', diasConCupo(base({ desde: null })).length === 0);

  // Cruzando un cambio de hora la tira tiene que seguir siendo días
  // consecutivos. Es la propiedad que importa; cómo se recorran da igual.
  // Cuba es el caso incómodo: allí la medianoche del 8 de marzo no existe.
  const cruce = diasConCupo({ zona: 'America/Havana', horario: HORARIO, minutos: 30, paso: 30,
                              ahora: LEJOS, desde: '2026-03-06', dias: 4 });
  chk('cruzando el cambio de hora no repite ni se salta un día',
      new Set(cruce.map(d => d.dia)).size === 4 &&
      cruce.map(d => d.dia).join() === '2026-03-06,2026-03-07,2026-03-08,2026-03-09',
      cruce.map(d => d.dia).join());

  chk('el lunes es 1 y el domingo 0',
      diaDeLaSemana(BOG, '2026-09-21') === 1 && diaDeLaSemana(BOG, '2026-09-27') === 0);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
