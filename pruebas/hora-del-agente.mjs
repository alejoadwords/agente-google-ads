// Que el agente sepa qué hora es y si se está en horario: node pruebas/hora-del-agente.mjs
//
// El 30-09-2026, a las 9:55 a. m. en Barranquilla, el agente de Certain le dijo
// a una clienta «a esta hora ya no estamos en la oficina». Tenía el horario en
// su contexto, pero nadie le decía la hora. Y con la hora delante, Haiku seguía
// comparando mal («estamos atendiendo» a las 7:00 p. m.), así que el veredicto
// dentro/fuera lo calcula el código (bloqueDeAhora) y al modelo le llega hecho.
const m = await import('../api/_inbox-engine.js');
let mal = 0; const ok = (c, t, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + t + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };

const CERTAIN = 'Atención de lunes a viernes, de 8:00 a. m. a 12:00 m. y de 2:00 p. m. a 5:00 p. m. Por chat se recibe a cualquier hora.';
const linea = (t, ctx = CERTAIN, zona = null) => m.bloqueDeAhora(zona, new Date(t), ctx);

console.log('La hora, en la zona del negocio');
ok(/miércoles, 30 de septiembre de 2026, 9:55 a\. m\./.test(linea('2026-09-30T14:55:00Z')), 'Colombia por defecto (UTC-5)');
ok(/hora de México/.test(linea('2026-09-30T14:55:00Z', '', 'America/Mexico_City')), 'y otra zona si el negocio la tiene');
ok(linea('2026-09-30T14:55:00Z', '', 'Zona/Inventada') === '', 'una zona inválida no rompe: sin bloque');

console.log('El veredicto con el horario de Certain');
const casos = [
  ['2026-09-30T14:55:00Z', /DENTRO.*hasta las 12:00 m\./, 'miércoles 9:55 a. m. → dentro (el caso que falló)'],
  ['2026-09-30T18:30:00Z', /FUERA.*hoy a las 2:00 p\. m\./, 'la pausa del almuerzo → fuera, hoy a las 2'],
  ['2026-09-30T21:59:00Z', /DENTRO.*hasta las 5:00 p\. m\./, '4:59 p. m. → dentro'],
  ['2026-09-30T22:00:00Z', /FUERA.*mañana a las 8:00 a\. m\./, '5:00 p. m. en punto → fuera, mañana'],
  ['2026-09-30T12:30:00Z', /FUERA.*hoy a las 8:00 a\. m\./, '7:30 a. m. → fuera, hoy a las 8'],
  ['2026-10-02T23:00:00Z', /FUERA.*el lunes 5 de octubre a las 8:00 a\. m\./, 'viernes 6:00 p. m. → el lunes, con fecha'],
  ['2026-10-03T15:00:00Z', /FUERA.*el lunes 5 de octubre a las 8:00 a\. m\./, 'sábado → el lunes, con fecha'],
];
for (const [t, re, txt] of casos) { const b = linea(t); ok(re.test(b), txt, b.split('\n')[3]); }

console.log('Festivos de Colombia');
const f26 = [...m.festivosColombia(2026).keys()];
ok(f26.length === 18, '18 festivos al año');
ok(['2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
    '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16'].every(d => f26.includes(d)),
   '2026 coincide con el calendario oficial (Ley Emiliani y Semana Santa)');
ok(m.festivoDeColombia('2027-03-25') === 'Jueves Santo' && m.festivoDeColombia('2027-07-05') === 'San Pedro y San Pablo',
   'y se calcula para cualquier año: 2027 sin tocar nada');
for (const [t, re, txt] of [
  ['2026-10-12T15:00:00Z', /HOY ES FESTIVO EN COLOMBIA \(Día de la Raza\)[\s\S]*FUERA.*mañana a las 8:00/, 'lunes festivo a las 10 a. m. → fuera; mañana a las 8'],
  ['2026-10-09T23:00:00Z', /el martes 13 de octubre a las 8:00/, 'viernes antes del puente → el martes 13, no el lunes'],
  ['2026-10-11T15:00:00Z', /MAÑANA ES FESTIVO EN COLOMBIA \(Día de la Raza\)/, 'la víspera avisa de que mañana no hay llamadas'],
  ['2026-04-01T23:00:00Z', /el lunes 6 de abril a las 8:00/, 'Semana Santa → el lunes 6 de abril'],
  ['2026-12-31T23:00:00Z', /el lunes 4 de enero a las 8:00/, 'cambio de año: el 1 de enero también es festivo'],
]) { const b = linea(t); ok(re.test(b), txt, b.split('\n').slice(3, 5).join(' | ').slice(0, 160)); }
ok(!/FESTIVO/.test(linea('2026-10-12T16:00:00Z', CERTAIN, 'America/Mexico_City')), 'otro país no hereda los festivos de Colombia');

console.log('Otros horarios escritos a mano');
const h = t => JSON.stringify((m.horarioDelTexto(t) || []).map(f => [[...f.dias], f.desde / 60, f.hasta / 60]));
ok(h('Horario: lunes a viernes de 9 a 6 y sábados de 9:00 a. m. a 1:00 p. m.') === '[[[1,2,3,4,5],9,18],[[6],9,13]]', 'semana + sábados, con y sin a. m./p. m.');
ok(m.horarioDelTexto('Somos una inmobiliaria en Medellín.') === null, 'sin horario escrito no se inventa uno');
ok(!/DENTRO|FUERA/.test(linea('2026-09-30T14:55:00Z', 'Somos una inmobiliaria.')), 'y entonces el bloque solo da la hora');

console.log('Dónde va en el prompt');
const p = m.partesDelPrompt({ name: 'X', faqs: [], business_ctx: CERTAIN }, {}, null, null, 'whatsapp', null);
ok(!p.estable.includes('AHORA MISMO') && p.variable.includes('AHORA MISMO'), 'en la parte VARIABLE: cambia cada minuto y no puede romper la caché');
process.exit(mal ? 1 : 0);
