// La pantalla y el servidor cuentan los SMS igual: node pruebas/sms-front-igual.mjs
//
// public/app.js tiene su copia de prepararTexto/contarSegmentos (smsPreparar /
// smsSegmentos) porque el contador tiene que responder mientras se escribe. Si
// las dos se separan, el asistente promete «1 SMS por persona» y el servidor
// cobra 2. Esta prueba saca las funciones del front tal cual están escritas y
// las compara con las del servidor sobre textos que tocan cada caso raro.

import { readFileSync } from 'node:fs';
import { prepararTexto, contarSegmentos, MAX_SEGMENTOS, conRemitente, componerSms, TOKEN_EJEMPLO } from '../api/_sms.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const ini = app.indexOf('const SMS_GSM = ');
const fin = app.indexOf('// Debajo del mensaje', ini);
ok(ini > 0 && fin > ini, 'las funciones de SMS están en public/app.js');
const front = new Function(app.slice(ini, fin) + '\nreturn { smsPreparar, smsSegmentos, SMS_MAX_SEGMENTOS, smsConRemitente, smsComponer, SMS_TOKEN_EJEMPLO };')();

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
// La firma «Negocio: mensaje» también ocupa caracteres: la pantalla tiene que
// armarla igual que el servidor o el contador miente.
const firmas = [['Inmobiliaria Sol', 'Hola Ana'], ['  Café Ñandú  ', ' hola '], ['Sol:', 'x'.repeat(150)], ['Marca  con   espacios', 'Hola']];
ok(firmas.every(([r, t]) => prepararTexto(conRemitente(r, t)) === front.smsPreparar(front.smsConRemitente(r, t))),
  'la firma del negocio se arma igual en los dos lados', JSON.stringify(firmas.map(([r, t]) => [conRemitente(r, t), front.smsConRemitente(r, t)])));
// Y el SMS entero, con el enlace de baja al final: el contador de la pantalla
// tiene que contar exactamente lo que el servidor manda.
ok(front.SMS_TOKEN_EJEMPLO === TOKEN_EJEMPLO && firmas.every(([r, t]) => prepararTexto(componerSms(r, t, TOKEN_EJEMPLO)) === front.smsPreparar(front.smsComponer(r, t))),
  'el SMS completo, con el enlace de baja, se arma igual en los dos lados');

console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
