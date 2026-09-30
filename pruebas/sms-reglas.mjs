// SMS: reglas puras de api/_sms.js — node pruebas/sms-reglas.mjs
//
// Móviles válidos, tildes que se cambian para no pasar a Unicode, cuántos
// créditos gasta un texto, festivos de Colombia y el horario de la Ley 2300.
// Sin base de datos: el saldo real lo prueba pruebas/sms-saldo.mjs.

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };
const m = await import('../api/_sms.js');

console.log('\nTeléfonos');
ok(m.normalizarTelefono('300 123 4567') === '573001234567', 'un móvil de 10 dígitos se pasa a formato internacional');
ok(m.normalizarTelefono('+57 (315) 555-0000') === '573155550000', 'con +57 y símbolos también');
ok(m.normalizarTelefono('601 7654321') === null, 'un fijo de Bogotá no es un móvil');
ok(m.normalizarTelefono('+1 305 555 1234') === null, 'un número de otro país no se acepta');
ok(m.normalizarTelefono('') === null && m.normalizarTelefono(null) === null, 'vacío tampoco');

console.log('\nTexto y créditos');
const t = m.prepararTexto('Hola María, ¿cómo estás? Él está aquí. Año nuevo “feliz” – ¡ya!');
ok(t === 'Hola Maria, ¿como estas? Él esta aqui. Año nuevo "feliz" - ¡ya!', 'á í ó ú y comillas tipográficas se cambian; ñ, É, ¿ y ¡ se quedan', t);
ok(m.contarSegmentos(t).codificacion === 'gsm', 'y el texto sigue siendo GSM (160 por SMS)');
ok(m.contarSegmentos('a'.repeat(160)).segmentos === 1 && m.contarSegmentos('a'.repeat(161)).segmentos === 2, '160 caracteres son 1 SMS; 161 son 2');
ok(m.contarSegmentos('a'.repeat(306)).segmentos === 2 && m.contarSegmentos('a'.repeat(307)).segmentos === 3, 'los largos se parten de a 153');
ok(m.contarSegmentos('€'.repeat(80)).segmentos === 1 && m.contarSegmentos('€'.repeat(81)).segmentos === 2, 'el € ocupa dos posiciones');
const emoji = m.contarSegmentos('Hola 😀');
ok(emoji.codificacion === 'unicode' && emoji.segmentos === 1, 'un emoji obliga a Unicode');
ok(m.contarSegmentos('a' + '😀'.repeat(67)).segmentos === 3, 'los largos en Unicode se parten de a 67 (135 unidades = 3 SMS)');
ok(m.contarSegmentos('😀'.repeat(36)).segmentos === 2, 'y en Unicode caben 70 unidades (36 emojis = 72 → 2 SMS)');

console.log('\nFestivos y horario (hora de Bogotá)');
const f26 = m.festivosColombia(2026);
ok(f26.size === 18, 'Colombia tiene 18 festivos en 2026', f26.size);
for (const [d, n] of [['2026-01-12', 'Reyes (6 ene → lunes 12)'], ['2026-04-02', 'Jueves santo'], ['2026-04-03', 'Viernes santo'],
  ['2026-05-18', 'Ascensión'], ['2026-06-08', 'Corpus Christi'], ['2026-06-15', 'Sagrado Corazón'], ['2026-07-20', 'Independencia'],
  ['2026-10-12', 'Día de la Raza (lunes)'], ['2026-11-02', 'Todos los Santos (1 nov → lunes 2)'], ['2026-12-08', 'Inmaculada']]) {
  ok(f26.has(d), n, d);
}
ok(!f26.has('2026-01-06'), 'el 6 de enero de 2026 (martes) no es festivo: se corrió al lunes');
const bog = (s) => new Date(s + '-05:00');
ok(m.enHorarioPermitido(bog('2026-10-01T07:00')), 'jueves 7:00 sí');
ok(!m.enHorarioPermitido(bog('2026-10-01T06:59')), 'jueves 6:59 no');
ok(!m.enHorarioPermitido(bog('2026-10-01T19:00')), 'jueves 19:00 ya no');
ok(m.enHorarioPermitido(bog('2026-10-03T14:59')) && !m.enHorarioPermitido(bog('2026-10-03T15:00')), 'sábado hasta las 15:00');
ok(!m.enHorarioPermitido(bog('2026-10-04T10:00')), 'domingo nunca');
ok(!m.enHorarioPermitido(bog('2026-10-12T10:00')), 'festivo nunca (12 de octubre)');
ok(m.siguienteHorario(bog('2026-10-01T20:00')).getTime() === bog('2026-10-02T07:00').getTime(), 'jueves de noche → viernes 7:00');
ok(m.siguienteHorario(bog('2026-10-03T16:00')).getTime() === bog('2026-10-05T07:00').getTime(), 'sábado tarde → lunes 7:00');
ok(m.siguienteHorario(bog('2026-10-10T16:00')).getTime() === bog('2026-10-13T07:00').getTime(), 'sábado antes del festivo → martes 7:00');
const ya = bog('2026-10-01T10:00');
ok(m.siguienteHorario(ya).getTime() === ya.getTime(), 'en horario, es ahora mismo');


console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
