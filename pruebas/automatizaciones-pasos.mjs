// Los pasos de una automatización viven en tres sitios: node pruebas/automatizaciones-pasos.mjs
//
// El constructor los ofrece (public/app.js), el validador los acepta
// (api/automations.js) y el motor los ejecuta (api/cron-automations.js). Las
// tres listas tienen que decir lo mismo.
//
// Esto no es teórico: «Pedir reseña» estaba en la paleta y el motor sabía
// ejecutarlo, pero el validador no lo conocía. Quien lo arrastraba armaba su
// flujo entero y al guardar recibía «Paso inválido: pedir_resena», sin más
// explicación. Nadie lo vio porque los tres ficheros se tocan por separado.
//
// Y `compileSteps` está copiado en api/automations.js porque el cron es una
// función Node y un api/_*.js solo se importa desde funciones edge. Una copia
// que se desvía es peor que no tenerla: `step_index` señalaría otro paso.

import { readFileSync } from 'node:fs';

const leer = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const app = leer('public/app.js');
const api = leer('api/automations.js');
const cron = leer('api/cron-automations.js');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nLas tres listas de pasos dicen lo mismo\n');

// 1. Lo que acepta el validador.
const valida = new Set(
  JSON.parse((api.match(/const VALID_STEPS = (\[[^\]]*\])/) || [, '[]'])[1].replace(/'/g, '"')));

// 2. Lo que ofrece la paleta del constructor.
const paleta = new Set(
  JSON.parse((app.match(/\n    \[('send_email'[^\]]*)\]\.map\(paletteBlock\)/) || [, "'x'"])[1]
    .replace(/'/g, '"').replace(/^/, '[').replace(/$/, ']')));

// 3. Lo que el motor sabe ejecutar. Sale de los `step.type === '...'` del
//    bucle, no de una lista aparte: una lista aparte se queda vieja igual.
//    Los que empiezan por `_` no se guardan nunca: los inventa compileSteps al
//    aplanar las ramas.
const ejecuta = new Set([...cron.matchAll(/step\.type === '([a-z_]+)'/g)]
  .map(m => m[1]).filter(t => t[0] !== '_'));

chk('el validador conoce algún paso', valida.size >= 10, String(valida.size));
chk('la paleta se leyó', paleta.size >= 8, String(paleta.size));
chk('el motor se leyó', ejecuta.size >= 8, String(ejecuta.size));

{
  const huerfanos = [...paleta].filter(t => !valida.has(t));
  chk(`los ${paleta.size} pasos de la paleta se pueden guardar`, !huerfanos.length,
      'el validador rechaza: ' + huerfanos.join(', '));
}
{
  const huerfanos = [...ejecuta].filter(t => !valida.has(t) && t !== 'branch');
  chk(`los ${ejecuta.size} pasos que el motor ejecuta se pueden guardar`, !huerfanos.length,
      'el validador rechaza: ' + huerfanos.join(', '));
}
{
  // Al revés también: aceptar un paso que nadie ejecuta lo deja guardado y
  // quieto para siempre, sin decir nada.
  const muertos = [...valida].filter(t => !ejecuta.has(t) && t !== 'branch' && t !== 'wait');
  chk('el validador no acepta pasos que el motor ignoraría', !muertos.length, muertos.join(', '));
}

console.log('\nLa copia de compileSteps no se ha desviado\n');
{
  const sacar = (js) => {
    const i = js.indexOf('function compileSteps(steps) {');
    return i < 0 ? '' : js.slice(i, js.indexOf('\n}\n', i) + 3).replace(/\s+/g, ' ').trim();
  };
  const a = sacar(api), b = sacar(cron);
  chk('las dos copias existen', !!a && !!b);
  chk('y son la misma función', a === b, 'se separaron');
  // Si el motor dejara de aplanar las ramas, la copia sobraría — y habría que
  // borrarla, no mantenerla.
  chk('sigue aplanando las ramas, que es para lo que está', /_branch/.test(b) && /_goto/.test(b));
}

console.log('\nLo que la ficha del lead enseña de cada paso\n');
{
  const desc = api.slice(api.indexOf('function describirPaso'), api.indexOf('const ACCION_TEXTO'));
  const descritos = new Set([...desc.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]));
  const sinTexto = [...valida].filter(t => t !== 'branch' && !descritos.has(t));
  chk('cada paso guardable tiene su frase en español', !sinTexto.length, sinTexto.join(', '));
  // Sin `default` un paso nuevo saldría vacío: la caja diría que no va a pasar
  // nada cuando sí va a pasar.
  chk('y uno que no esté previsto se nombra igual, no desaparece', /default: return 'Paso «'/.test(desc));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
