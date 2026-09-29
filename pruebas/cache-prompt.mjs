// Cachear la parte del prompt que no cambia: node pruebas/cache-prompt.mjs
//
// El prompt de un agente bien entrenado son ~7.400 tokens, de los cuales 5.682
// NO cambian entre mensajes: quién es, el contexto del negocio, sus 31
// preguntas frecuentes y las reglas. Se reprocesaban enteros en cada respuesta.
//
// El código decía «aquí NO se cachea: su parte estable son ~500 tokens y
// Anthropic no cachea por debajo de 1.024». Era verdad cuando un agente tenía
// cuatro líneas. Dejó de serlo el día que se empezaron a entrenar de verdad.
//
// Lo que hay que proteger, y es lo único que importa:
//   EL TEXTO NO PUEDE CAMBIAR. Partirlo mal cambiaría el prompt, y cambiar el
//   prompt sin querer cambia el agente de un cliente sin que nadie lo pida.

import { readFileSync } from 'node:fs';
import { buildSystemPrompt, partesDelPrompt } from '../api/_inbox-engine.js';

const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

const AGENTE = (ctx) => ({
  name: 'Aura', tone: 'formal', persona: 'Asesora comercial.'.repeat(20),
  business_ctx: ctx, faqs: [{ q: '¿Cuánto cobran?', a: 'El 3% más IVA.' }],
  capture_fields: ['nombre', 'celular'], escalate_phrase: 'Le paso con un asesor.',
});
const GRANDE = AGENTE('Inmobiliaria en Barranquilla. '.repeat(300));
const CHICO = AGENTE('Vendemos apartamentos.');

console.log('\nEl texto que lee el modelo es el mismo de siempre');
for (const [etq, ag, inv, cap] of [
  ['con inventario', GRANDE, { lineas: ['CP-1 · 3 hab · $1.800.000'], total: 1 }, {}],
  ['sin inventario', GRANDE, { lineas: [], total: 0 }, { nombre: 'Ana' }],
  ['sin búsqueda', GRANDE, null, {}],
  ['agente pequeño', CHICO, { lineas: ['X'], total: 1 }, {}],
]) {
  const p = partesDelPrompt(ag, cap, null, inv, 'whatsapp', null);
  ok(p.estable + p.variable === buildSystemPrompt(ag, cap, null, inv, 'whatsapp', null),
     `${etq}: unir las dos partes da EXACTAMENTE el prompt de antes`);
}

console.log('\nY la parte cacheada no cambia entre mensajes');
// Si cambiara, cada respuesta pagaría una escritura de caché que nadie lee:
// más caro que no cachear.
const a = partesDelPrompt(GRANDE, {}, null, { lineas: ['A'], total: 1 }, 'whatsapp', null);
const b = partesDelPrompt(GRANDE, { nombre: 'Ana', celular: '300' }, null, { lineas: ['B', 'C'], total: 2 }, 'whatsapp', null);
const c = partesDelPrompt(GRANDE, {}, null, { lineas: [], total: 0 }, 'whatsapp', null);
ok(a.estable === b.estable && b.estable === c.estable,
   'cambie el inventario o los datos capturados, la parte estable es idéntica');
ok(a.variable !== b.variable, 'y la variable sí cambia, que es lo suyo');
ok(a.estable.includes('preguntas frecuentes') || a.estable.includes('PREGUNTAS FRECUENTES')
   || a.estable.includes('LO QUE NO PUEDES INVENTAR'),
   'lo estable llega hasta las reglas de no inventar');
ok(!a.estable.includes('LO QUE HAY DISPONIBLE'), 'y NO incluye el inventario, que cambia');
ok(a.variable.includes('DATOS CAPTURADOS'), 'los datos capturados van en la parte variable');

console.log('\nUn agente sin entrenar no paga caché que no sirve');
ok(/const MINIMO_CACHE = \d+/.test(eng), 'hay un mínimo de tamaño');
const chico = partesDelPrompt(CHICO, {}, null, null, 'whatsapp', null);
ok(chico.estable.length < 4500,
   'el prompt de un agente de cuatro líneas se queda por debajo', String(chico.estable.length));
const fn = eng.slice(eng.indexOf('function systemParaLaApi'), eng.indexOf('async function callClaude'));
ok(/if \(estable\.length < MINIMO_CACHE\) return estable \+ variable;/.test(fn),
   'y por debajo del mínimo se manda como siempre, sin marcar nada');
ok(/if \(typeof system === 'string'\) return system;/.test(fn),
   'y quien todavía mande un texto suelto sigue funcionando igual');

console.log('\nLa marca va donde tiene que ir');
ok(/cache_control: \{ type: 'ephemeral' \}/.test(fn), 'se marca para cachear');
ok(fn.indexOf('cache_control') < fn.indexOf('...(variable'),
   'en el bloque ESTABLE, que va primero: la caché es un prefijo');
ok(/system: systemParaLaApi\(systemPrompt\)/.test(eng), 'y la llamada lo usa');

console.log('\nY los tres sitios que hablan con el modelo lo aprovechan');
ok((eng.match(/partesDelPrompt\(/g) || []).length >= 4,
   'la conversación real, la respuesta sugerida y el probador',
   String((eng.match(/partesDelPrompt\(/g) || []).length));
ok(!/const system = buildSystemPrompt\(/.test(eng),
   'ninguno se quedó con el prompt entero sin partir');

console.log('');
process.exit(mal ? 1 : 0);
