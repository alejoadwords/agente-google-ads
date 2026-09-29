// «Escribiendo…» antes de responder: node pruebas/escribiendo.mjs
//
// El agente contestaba en medio segundo. Eso delata al bot más que cualquier
// error de redacción: una persona tarda en leer y en teclear, y quien escribe
// por WhatsApp nota la diferencia sin saber explicarla.
//
// Dos piezas: el indicador de «escribiendo» de WhatsApp —que de paso marca el
// mensaje como leído, así que el contacto ve el doble check azul— y un suelo de
// tres segundos antes de soltar la respuesta.
//
// Suelo, no pausa: si pensar ya costó cuatro segundos no se añade nada. Sumar
// tres a todo habría hecho lento al agente en las respuestas largas, que son
// justo las que ya tardan.

import { readFileSync } from 'node:fs';

const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
const wh = readFileSync(new URL('../api/webhooks/meta.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const pag = readFileSync(new URL('../public/probar.html', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nEl indicador de WhatsApp');
const fn = wh.slice(wh.indexOf('async function marcarEscribiendo'), wh.indexOf('// El evento de Meta trae el id'));
ok(fn.length > 100, 'existe marcarEscribiendo');
ok(/typing_indicator: \{ type: 'text' \}/.test(fn), 'manda el indicador con el formato de Meta');
ok(/status: 'read'/.test(fn) && /message_id: messageId/.test(fn),
   'y de paso marca el mensaje como leído: es la misma llamada');
ok(/if \(channel !== 'whatsapp'/.test(fn),
   'solo en WhatsApp: Messenger e Instagram no tienen este endpoint');
ok(/!messageId/.test(fn), 'sin id de mensaje no se intenta');
ok(/catch \(e\) \{ \/\* que no se vea el «escribiendo» no puede costar la respuesta/.test(fn),
   'y si falla, la respuesta sale igual');
ok(/escribiendo: \(connection, messageId\) => marcarEscribiendo/.test(wh),
   'el webhook se lo pasa al motor');

console.log('\nCuándo se manda');
ok(/const empezoAPensar = Date\.now\(\);/.test(eng), 'el reloj arranca al recibir el mensaje');
ok(eng.indexOf('await escribiendo(connection, providerMessageId)') < eng.indexOf('let reply = await responderViendo'),
   'el indicador sale ANTES de pensar la respuesta, no después');
ok(/typeof escribiendo === 'function'/.test(eng),
   'y si quien llama no lo trae —el simulador, por ejemplo— no revienta');

console.log('\nEl suelo de tres segundos');
ok(/const ESCRIBIENDO_MIN_MS = 3000;/.test(eng), 'son tres segundos');
ok(/const faltan = ESCRIBIENDO_MIN_MS - \(Date\.now\(\) - empezoAPensar\);/.test(eng),
   'y es un SUELO: se descuenta lo que ya tardó el modelo');
ok(/if \(faltan > 0\) await new Promise/.test(eng), 'si ya pasaron, no se espera nada');
// La espera va antes del envío, no antes de guardar: el lead, la calificación y
// el reparto no tienen por qué esperar a que el contacto vea el mensaje.
ok(eng.indexOf('const faltan = ESCRIBIENDO_MIN_MS') > eng.indexOf('aplicarVeredicto({'),
   'y solo retrasa el envío, no el guardado del lead ni el reparto');

console.log('\nY en las dos pantallas de prueba');
for (const [nombre, src] of [['el probador', app], ['el enlace público', pag]]) {
  ok(/const empezo = Date\.now\(\);/.test(src), `${nombre} cuenta desde que se envía`);
  ok(/3000 - \(Date\.now\(\) - empezo\)/.test(src), `y ${nombre} aplica el mismo suelo`);
  ok((src.match(/await esperarSuelo\(\);/g) || []).length >= 2,
     `${nombre} espera también cuando falla, o el error saldría de golpe`);
}

console.log('');
process.exit(mal ? 1 : 0);
