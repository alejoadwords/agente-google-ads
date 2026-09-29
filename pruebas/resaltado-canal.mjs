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

console.log('\nTodas las llamadas pasan el canal\n');
{
  // Sin esto el arreglo se deshace solo: la función admite el canal, nadie se
  // lo manda, y todo vuelve a WhatsApp por el valor por defecto sin que
  // ninguna prueba de las de arriba se entere.
  //
  // No se fija el NÚMERO de llamadas: al añadir el probador del agente esta
  // prueba se puso roja por contar tres donde esperaba dos, y el canal estaba
  // perfectamente puesto. Contar llamadas protege de nada; lo que hay que
  // exigir es que cada una, sean las que sean, lleve su canal.
  const js = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
  // El `(?<!function )` deja fuera la propia definición, que si no se cuenta
  // como una llamada más y encima sin canal.
  // Se miran las llamadas a `partesDelPrompt`, que es por donde pasan todas
  // desde que el prompt se parte para cachearlo. Le reenvía los argumentos tal
  // cual a `buildSystemPrompt`, así que la posición del canal es la misma.
  const llamadas = [...js.matchAll(/(?<!function )partesDelPrompt\(([\s\S]{0,400}?)\);/g)]
    .filter(m => !m[1].includes('...args'));
  chk('hay al menos dos sitios que la llaman', llamadas.length >= 2, String(llamadas.length));

  // Los argumentos de primer nivel: el canal es el quinto.
  const argumentos = (txt) => {
    const out = []; let prof = 0, act = '';
    for (const ch of txt) {
      if ('([{'.includes(ch)) prof++;
      else if (')]}'.includes(ch)) prof--;
      if (ch === ',' && prof === 0) { out.push(act.trim()); act = ''; continue; }
      act += ch;
    }
    if (act.trim()) out.push(act.trim());
    return out;
  };
  for (const [i, m] of llamadas.entries()) {
    const args = argumentos(m[1]);
    const quinto = args[4] || '';
    chk(`la llamada ${i + 1} le pasa el canal`,
        !!quinto && /canal|channel/i.test(quinto),
        args.length < 5 ? `solo ${args.length} argumentos` : `el 5.º es «${quinto}»`);
  }
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
