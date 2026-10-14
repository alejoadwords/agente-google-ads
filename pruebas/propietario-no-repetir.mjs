// El agente no vuelve a preguntar «¿vender o arrendar?» a un propietario que
// ya lo dijo, ni le atribuye etiquetas internas: node pruebas/propietario-no-repetir.mjs
//
// Sale de la revisión del agente de Certain (14-10-2026): «quiero dejar un
// inmueble en arriendo» y, cinco mensajes después, «¿quieres venderla o
// ponerla en arriendo?» dos veces, y «veo que mencionaste que es para captación».

import { readFileSync } from 'fs';
import { operacionDelPropietario, preguntaVenderOArrendar, etiquetaInterna } from '../api/_inbox-engine.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };
const u = t => ({ role: 'user', content: t });

console.log('\n¿Qué quiere hacer con su inmueble?');
const conversacion = [u('hola'), u('quiero dejar unn inmueble en arriendo'), u('barranquilla'), u('olaya'), u('es una casa'), u('desocupada'), u('maria dominguez')];
ok(operacionDelPropietario(conversacion) === 'arrendar', 'la conversación de Certain → arrendar, aunque lo dijo hace cinco mensajes');
for (const [t, e] of [
  ['quiero dar mi apartamento en arriendo', 'arrendar'],
  ['Necesito poner la casa en arriendo', 'arrendar'],
  ['quiero arrendar mi local', 'arrendar'],
  ['tengo una bodega para arrendar', 'arrendar'],
  ['quiero vender mi casa', 'vender'],
  ['quiero ponerla en venta', 'vender'],
  ['tengo un apartamento para vender', 'vender'],
  ['quiero venderla', 'vender'],
  ['no sé si venderla o dar mi casa en arriendo', 'ambas'],
  ['busco apartamento en arriendo en el norte', null],
  ['quiero arrendar el apartamento AP-1042', null],
  ['quiero comprar una casa', null],
]) ok(operacionDelPropietario([u(t)]) === e, '«' + t + '» → ' + e, operacionDelPropietario([u(t)]));
ok(operacionDelPropietario([{ role: 'assistant', content: '¿Quieres vender o poner en arriendo tu casa?' }]) === null, 'lo que dice el agente no cuenta: solo lo que escribió la persona');

console.log('\n¿Le pregunta si vender o arrendar?');
ok(preguntaVenderOArrendar('Perfecto, María. Y cuéntame, ¿quieres vender la casa o ponerla en arriendo?'), 'la pregunta de la captura');
ok(preguntaVenderOArrendar('Lo que necesito saber es si tú quieres **vender** o **arrendar** tu casa, ¿cuál es?'), 'con negritas y la pregunta al final');
ok(!preguntaVenderOArrendar('Perfecto, la casa en Olaya para arriendo. ¿Cuál es tu correo?'), 'mencionar arriendo sin preguntar → no');
ok(!preguntaVenderOArrendar('Nos encargamos de venderla o arrendarla. Un asesor te llama hoy.'), 'sin signo de pregunta → no');

console.log('\nEtiquetas internas');
const regla = { enrutado: { rutas: [{ clave: 'arriendo', etiqueta: 'arriendo' }, { clave: 'venta', etiqueta: 'venta' }, { clave: 'captacion', etiqueta: 'captacion' }] } };
ok(etiquetaInterna('Veo que mencionaste que es para captación, pero necesito confirmar', regla, ['quiero dejar un inmueble en arriendo']) === 'captacion', '«captación» que la persona no escribió → señalada');
ok(etiquetaInterna('Perfecto, es para captación', regla, ['busco a alguien para la captación de mi casa']) === null, 'si la persona la usó, no');
ok(etiquetaInterna('Te ayudo con el arriendo de tu casa', regla, ['hola']) === null, 'arriendo y venta son palabras de todos los días');
ok(etiquetaInterna('lo que sea', null, []) === null, 'sin enrutado no hay nada que señalar');

console.log('\nEstá cableado en la conversación real y en el probador');
const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
ok((eng.match(/preguntaVenderOArrendar\((cleanForUser\()?(reply|texto)/g) || []).length >= 2, 'el guardián de «vender o arrendar» está en los dos');
ok((eng.match(/etiquetaInterna\(cleanForUser\(reply\)|etiquetaInterna\(texto/g) || []).length >= 2, 'el de etiquetas internas, también');
ok((eng.match(/_propietario: propietario/g) || []).length === 2, 'el dato sabido entra al prompt en los dos');
ok(/filter\(\(\[k, v\]\) => v && !k\.startsWith\('_'\)\)/.test(eng), 'las claves internas (_propietario) no salen en «datos capturados»');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
