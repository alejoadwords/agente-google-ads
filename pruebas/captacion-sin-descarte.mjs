// A quien viene a ofrecernos un inmueble no se le dice que no:
//   node pruebas/captacion-sin-descarte.mjs
//
// El contexto de un cliente puede decir «NO se manejan estratos 1, 2 y 3», y el
// modelo lo trata como un hecho que debe contarle a la persona. Medido: con la
// regla escrita de tres formas distintas, seguía respondiendo «su apartamento
// no está dentro de nuestro portafolio» a alguien que venía a ofrecérnoslo.
//
// Quien trae un inmueble es una oportunidad, y quien decide si encaja es un
// asesor con el caso delante. Por eso esto no se le pide al modelo: se
// comprueba, igual que los inventos y el tuteo.

import { readFileSync } from 'node:fs';
import { quiereOfrecerInmueble, descartaAlContacto } from '../api/_inbox-engine.js';

const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};
const frase = (t) => JSON.stringify(t.length > 46 ? t.slice(0, 46) + '…' : t);

console.log('\nQuién viene a ofrecernos algo');
for (const t of [
  'quiero que me ayuden a vender mi apartamento',
  'necesito arrendar mi casa en Riomar',
  '¿ustedes administran mi propiedad?',
  'tengo un local para arrendar',
  'tengo una casa en Villa Santos para vender',
  'quisiera que me promocionen el apartamento',
]) ok(quiereOfrecerInmueble([{ role: 'user', content: t }]), frase(t));

console.log('\nY quién viene a buscar, que no es lo mismo');
for (const t of [
  'busco apartamento para comprar en Villa Santos',
  'necesito arrendar un apartamento de 3 habitaciones',
  'busco un local para mi negocio',
  '¿tienen casas en Riomar?',
  'hola, buenas tardes',
]) ok(!quiereOfrecerInmueble([{ role: 'user', content: t }]), frase(t));

console.log('\nQué cuenta como decirle que no');
for (const t of [
  'en Certain & Pezzano trabajamos con vivienda de estratos 4, 5 y 6',
  'no manejamos ese estrato',
  'su apartamento no está dentro de nuestro portafolio',
  'normalmente no están dentro de nuestro portafolio',
  'no trabajamos esa zona',
  'solo manejamos vivienda de estratos 4, 5 y 6',
]) ok(descartaAlContacto(t), frase(t));

console.log('\nY qué no');
for (const t of [
  'Gracias por la información. ¿Me comparte su número de celular?',
  'Voy a pasar su información a un asesor de captación.',
  'La comisión de venta es del 3% más IVA sobre el valor de venta.',
  'Entendido, tomo nota: Villa Carolina, 2 habitaciones.',
  '',
]) ok(!descartaAlContacto(t), frase(t || '(vacío)'));

console.log('\nEl guardián está donde tiene que estar');
{
  const i = eng.indexOf('if (quiereOfrecerInmueble(hist) && descartaAlContacto(');
  ok(i > 0, 'se comprueba antes de enviar');

  // Las dos condiciones juntas: solo cuando la persona ofrece Y se le dice que
  // no. A quien BUSCA sí hay que decirle que no tenemos algo — ahí callarlo
  // sería inventar disponibilidad.
  const bloque = eng.slice(i, i + 1900);
  ok(/quiereOfrecerInmueble\(hist\) && descartaAlContacto/.test(bloque),
     'y solo cuando la persona ofrece un inmueble, no cuando busca uno');
  ok(/if \(sinDescarte && !descartaAlContacto\(cleanForUser\(sinDescarte\)\)\) reply = sinDescarte;/.test(bloque),
     'el reintento solo se acepta si de verdad quitó el descarte');
  ok(/El contacto no vio nada y no te ha corregido: no te disculpes/.test(bloque),
     'y se le avisa de que el contacto no vio nada, para que no pida perdón');
  ok(/donde: 'el agente descartó a quien ofrecía un inmueble'/.test(bloque),
     'queda registrado: si pasa a menudo, hay que verlo');

  // Antes del envío, como los otros dos guardianes. Comprobarlo después no
  // sirve de nada: la persona ya lo leyó.
  const iEnvio = (() => {
    const iFn = eng.indexOf('export async function processIncoming(');
    const iResp = eng.indexOf('await responderViendo(system', iFn);
    return eng.indexOf('await send(connection, contactId,', iResp);
  })();
  ok(i < iEnvio, 'y va antes del envío, que es lo único que lo hace servir de algo');
}

console.log('\nLa regla también está escrita en el prompt');
{
  // El guardián es la red; la instrucción sigue haciendo falta, porque un
  // reintento cuesta un mensaje más y tarda.
  ok(/NO digas que no\. Ni "no manejamos ese estrato"/.test(eng), 'con las palabras exactas que decía de más');
  ok(/aunque en tu contexto figure que no se maneja/i.test(eng), 'y avisando de que el contexto puede decir lo contrario');
}

console.log('');
process.exit(mal ? 1 : 0);
