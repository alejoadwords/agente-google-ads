// El resaltado según el canal: node pruebas/resaltado-canal.mjs
//
// Un mismo agente entrenado atiende los cinco canales. La instrucción de poner
// negrita con UN asterisco solo vale en WhatsApp: Instagram, Messenger, TikTok
// y el chat web no tienen formato, así que ese asterisco se le veía al cliente.
//
// Se ejecuta la función de verdad, no se lee el fichero: lo que importa es el
// texto que acaba delante del modelo.

import { readFileSync } from 'node:fs';
import { buildSystemPrompt } from '../api/_inbox-engine.js';

const AGENTE = { name: 'Ana', persona: 'Asesora.', business_ctx: 'Vendemos X.', faqs: [], tone: 'informal' };
const ASTERISCO = /UN solo asterisco/;
const PLANO = /texto plano/;

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const prompt = (canal) => buildSystemPrompt(AGENTE, {}, null, null, canal);

console.log('\nSolo WhatsApp entiende el asterisco\n');
{
  const p = prompt('whatsapp');
  chk('en WhatsApp se le pide el asterisco', ASTERISCO.test(p));
  chk('y NO se le pide texto plano', !PLANO.test(p));
}
for (const canal of ['instagram', 'messenger', 'tiktok', 'webchat']) {
  const p = prompt(canal);
  chk(`en ${canal} se le pide texto plano`, PLANO.test(p));
  chk(`en ${canal} NO se le pide el asterisco`, !ASTERISCO.test(p));
}

console.log('\nSi alguien olvida el canal, se comporta como antes\n');
{
  // Un canal sin formato es la opción destructiva: pedir texto plano en
  // WhatsApp solo quita negritas, pero pedir asteriscos donde no hay formato
  // se los enseña al cliente. Por eso el defecto es WhatsApp.
  const p = buildSystemPrompt(AGENTE, {}, null, null);
  chk('sin canal, se asume WhatsApp', ASTERISCO.test(p));
}

console.log('\nLos dos sitios que la llaman pasan el canal\n');
{
  // Sin esto el arreglo se deshace solo: la función admite el canal, nadie se
  // lo manda, y todo vuelve a WhatsApp por el valor por defecto sin que
  // ninguna prueba de las de arriba se entere.
  const js = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
  // El `(?<!function )` deja fuera la propia definición, que si no se cuenta
  // como una llamada más y encima sin canal.
  const llamadas = [...js.matchAll(/(?<!function )buildSystemPrompt\(([\s\S]{0,400}?)\);/g)];
  chk('sigue habiendo dos llamadas', llamadas.length === 2, String(llamadas.length));
  for (const [i, m] of llamadas.entries()) {
    chk(`la llamada ${i + 1} le pasa el canal`, /conv\.channel/.test(m[1]),
        m[1].replace(/\s+/g, ' ').slice(0, 70));
  }
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
