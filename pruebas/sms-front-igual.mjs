// La pantalla y el servidor cuentan los SMS igual: node pruebas/sms-front-igual.mjs
//
// public/app.js tiene su copia de prepararTexto/contarSegmentos (smsPreparar /
// smsSegmentos) porque el contador tiene que responder mientras se escribe. Si
// las dos se separan, el asistente promete «1 SMS por persona» y el servidor
// cobra 2. Esta prueba saca las funciones del front tal cual están escritas y
// las compara con las del servidor sobre textos que tocan cada caso raro.

import { readFileSync } from 'node:fs';
import { prepararTexto, contarSegmentos, MAX_SEGMENTOS } from '../api/_sms.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const ini = app.indexOf('const SMS_GSM = ');
const fin = app.indexOf('// Debajo del mensaje', ini);
ok(ini > 0 && fin > ini, 'las funciones de SMS están en public/app.js');
const front = new Function(app.slice(ini, fin) + '\nreturn { smsPreparar, smsSegmentos, SMS_MAX_SEGMENTOS };')();

const textos = [
  '', 'Hola', 'Hola María, ¿cómo estás? Él está aquí.', 'Año nuevo “feliz” – ¡ya!… • ok',
  'a'.repeat(160), 'a'.repeat(161), 'a'.repeat(306), 'a'.repeat(307), '€'.repeat(80), '€'.repeat(81),
  '{llaves} [corchetes] ~ ^ | \\ ', 'Hola 😀', '😀'.repeat(35), '😀'.repeat(36), 'a' + '😀'.repeat(67),
  'Ç ç ã õ â ê î ô û ë ï À È Ì Ò Ù', 'tab\taquí y espacio duro', 'línea\nnueva\r\nfin', '中文', 'Ñandú ÜBER ß',
];
let iguales = 0;
for (const t of textos) {
  const a = prepararTexto(t), b = front.smsPreparar(t);
  const ca = contarSegmentos(a), cb = front.smsSegmentos(b);
  if (a === b && JSON.stringify(ca) === JSON.stringify(cb)) iguales++;
  else ok(false, 'distinto para ' + JSON.stringify(t.slice(0, 30)), JSON.stringify({ servidor: [a, ca], pantalla: [b, cb] }));
}
ok(iguales === textos.length, `los ${textos.length} textos dan el mismo texto y los mismos créditos en los dos lados`);
ok(front.SMS_MAX_SEGMENTOS === MAX_SEGMENTOS, 'y el mismo máximo de SMS por persona');

console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
