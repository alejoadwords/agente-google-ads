// Mensaje de bienvenida fijo del agente: node pruebas/bienvenida-agente.mjs
//
// Sale tal cual solo cuando la persona abre la conversación sin decir qué
// busca. Si ya lo dijo, hacerle elegir en un menú es pedirle que se repita.

import { esSoloSaludo, bienvenidaQueToca } from '../api/_inbox-engine.js';

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); if (!c) mal++; };

const MENU = '¡Hola! 👋 Bienvenido a Certain & Pezzano.\n¿Qué te gustaría hacer? 🏡\n\n🛒 Comprar un inmueble';
const agente = { bienvenida: MENU };
const u = t => ({ role: 'user', content: t });

console.log('\n¿Es solo un saludo?');
for (const t of ['hola', 'Hola!!', 'Buenas tardes', 'buenos días 🙂', 'Hola, buenas noches', 'hola quisiera información',
                 'Buen día, me pueden ayudar por favor', 'Hola, tengo una consulta', 'info']) {
  ok(esSoloSaludo(t), '«' + t + '» → saludo');
}
for (const t of ['hola, busco apartamento en arriendo', 'quiero vender mi casa', 'Buenas, cuánto cuesta el AP-1042',
                 'hola, tengo un local para arrendar', 'apartamento en el norte de 3 habitaciones', '']) {
  ok(!esSoloSaludo(t), '«' + t + '» → NO es solo saludo');
}

console.log('\n¿Toca mandar la bienvenida?');
ok(bienvenidaQueToca(agente, [u('hola')]) === MENU, 'primer mensaje «hola» → sale tal cual');
ok(bienvenidaQueToca(agente, [u('Hola'), u('buenas tardes')]) === MENU, 'dos saludos seguidos sin respuesta aún → sale');
ok(bienvenidaQueToca(agente, [u('hola, busco arriendo en el norte')]) === null, 'si ya dijo qué busca → responde el modelo');
ok(bienvenidaQueToca(agente, [u('hola'), { role: 'assistant', content: MENU }, u('hola')]) === null, 'solo la primera vez: con una respuesta del agente ya no');
ok(bienvenidaQueToca({ bienvenida: '' }, [u('hola')]) === null, 'sin bienvenida configurada → responde el modelo');
ok(bienvenidaQueToca({ bienvenida: '   ' }, [u('hola')]) === null, 'solo espacios cuenta como vacía');
ok(bienvenidaQueToca(agente, [u('hola')], { referral: { source_id: 'ad1' } }) === null, 'si viene de un anuncio → responde el modelo, que sabe de qué anuncio');
ok(bienvenidaQueToca(agente, [u('hola')], { adjunto: true }) === null, 'si mandó foto o audio → responde el modelo');
ok(bienvenidaQueToca(null, [u('hola')]) === null && bienvenidaQueToca(agente, null) === null, 'tolera datos vacíos');

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
