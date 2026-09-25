// La sección se llama «Agentes IA»: node pruebas/agentes-ia-nombre.mjs
//
// Se llamaba «Chatbots» en el menú, pero el resto de la aplicación ya la
// nombraba «Agentes IA»: el vacío de canales decía «Conecta WhatsApp… en
// <b>Agentes IA</b>» y mandaba a una pestaña rotulada «Chatbots». Un nombre a
// medias es peor que cualquiera de los dos: el usuario busca algo que no
// encuentra y no sabe si es la misma pantalla.
//
// Esto vigila las tres cosas que se pueden romper al renombrar:
//
//   1. Que no quede ningún TEXTO visible con el nombre viejo, ni en la web ni
//      en el móvil. Lo interno —ids, clases, claves de API— se queda: cambiarlo
//      no se ve y sí rompe.
//   2. Que la dirección vieja siga funcionando. Hay enlaces guardados.
//   3. Que el buscador ⌘K siga encontrándola por el nombre viejo. Quien lleva
//      meses diciendo «chatbots» lo va a escribir así.

import { readFileSync } from 'node:fs';

const leer = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const app = leer('app.js');
const html = leer('index.html');
const movil = leer('movil-app.js');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// ── 1. El nombre nuevo, donde se ve ────────────────────────────────────────
console.log('\nEl nombre que ve el usuario');
ok(/inbox: 'Inbox', agents: 'Agentes IA'/.test(app),
   'el submenú del sidebar dice «Agentes IA»');
ok(/agents: 'Agentes IA'/.test(app.slice(app.indexOf('const CRM_TITLES'), app.indexOf('const CRM_TITLES') + 260)),
   'y el título de la pestaña del navegador también');
ok(/Agentes IA\s*\n\s*<\/button>/.test(html), 'la píldora de la vista, igual');
ok(/<h1>Agentes IA<\/h1>/.test(movil), 'y la cabecera en el teléfono');

// ── 2. Nada visible se quedó con el nombre viejo ───────────────────────────
//
// Se mira SOLO lo que va entrecomillado y llega a pantalla. Los identificadores
// (id="chatbots", class="chatbot", la clave del módulo) no se tocan: no se ven
// y renombrarlos rompe el enganche con la API.
console.log('\nNada visible se quedó atrás');
// La primera versión iba al revés: listaba los identificadores para dejarlos
// pasar, y se le escapaban tres. Ir tapando excepciones de una en una es
// frágil, y una lista blanca que crece acaba dejando pasar lo que sí importa.
//
// La regla al derecho es más corta y más segura: lo que se le enseña al usuario
// lleva MAYÚSCULA («Chatbots») o va en una frase («el chatbot «X»»). Un
// identificador es una palabra suelta en minúscula: 'chatbots', id="chatbots",
// class="chatbot". Así no hay que saber de antemano dónde está cada uno.
const VISIBLE = [
  /Chatbot/,                        // rotulado: el nombre propio de la pantalla
  /chatbots? [a-záéíóúñ]/,          // en prosa: «el chatbot que…», «chatbots con IA»
];
// Única excepción, y a propósito: las palabras con que el ⌘K busca la pantalla.
// «chatbots» se queda ahí para que quien escriba el nombre viejo la encuentre.
const ES_BUSQUEDA = (l) => /kw: '[^']*'/.test(l);

for (const [nombre, texto] of [['app.js', app], ['index.html', html], ['movil-app.js', movil]]) {
  const sobra = texto.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => !l.trim().startsWith('//') && !l.trim().startsWith('/*') && !l.trim().startsWith('*'))
    .filter(([, l]) => !ES_BUSQUEDA(l))
    .filter(([, l]) => VISIBLE.some((r) => r.test(l)));
  ok(sobra.length === 0, `${nombre} no enseña «chatbot» en ningún texto`,
     sobra.map(([n, l]) => n + ': ' + l.trim().slice(0, 70)).join(' | '));
}

// ── 3. Lo que NO se puede romper al renombrar ──────────────────────────────
console.log('\nLo que el cambio de nombre no puede llevarse por delante');
// La dirección se renombró con la pantalla, pero la vieja sigue viva como
// alias. El detalle de a dónde lleva y qué deja en la barra de direcciones lo
// comprueba `pruebas/ruta-agentes-ia.mjs`, ejecutando el enrutador.
ok(/CRM_RENOMBRADAS = \{ '\/conversaciones\/chatbots': 'agents' \}/.test(app),
   'la dirección vieja sigue viva como alias: hay enlaces guardados que la usan');
ok(/kw: '[^']*chatbots/.test(app),
   'el ⌘K todavía encuentra la pantalla escribiendo «chatbots», el nombre de toda la vida');
ok(/label: 'Conversaciones · Agentes IA'/.test(app),
   'aunque lo que muestre sea el nombre nuevo');
ok(/ruta: '\/api\/chat-agents'/.test(leer('movil-datos.js')),
   'y el endpoint que alimenta la pantalla no se tocó');

// ── 4. Coherencia: la misma entidad, en singular ───────────────────────────
console.log('\nEn singular, la misma palabra');
ok(/'¿Eliminar el agente «'/.test(app), 'al borrar se pregunta por «el agente»');
ok(/showToast\('Agente eliminado'/.test(app), 'y se confirma «Agente eliminado»');
ok(/showToast\('No se pudo eliminar el agente'/.test(app),
   'incluido el aviso de cuando falla, que es el que más fácil se olvida');

// ── 5. Lo que destapó el cambio ────────────────────────────────────────────
console.log('\nLo que ya decía el resto de la aplicación');
ok(/Conecta WhatsApp, Messenger o Instagram en <b>Agentes IA<\/b>/.test(app),
   'el vacío de canales manda a «Agentes IA» — y ahora la pestaña se llama así');

console.log('');
process.exit(mal ? 1 : 0);
