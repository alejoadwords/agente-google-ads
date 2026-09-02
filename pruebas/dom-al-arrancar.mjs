// Reproduce el error que sufrió el cliente y comprueba que ya no pasa.
//   node pruebas/dom-al-arrancar.mjs
//
// El fallo real: «Cannot read properties of null (reading 'style')» en
// loadMetaAccounts, en la cuenta de direccioncomercial@certainpezzano.com.
// Causa: app.js se carga en la línea 4660 del HTML y los elementos de Ajustes
// no existen hasta la 5300, así que los IIFE que restauran las conexiones
// corrían contra un DOM a medio construir.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const T = []; const chk = (n, ok, d = '') => T.push([n, ok, d]);

// 1. El orden del HTML sigue siendo el que causa el problema (si algún día
//    alguien mueve el <script>, esta prueba deja de tener sentido y hay que saberlo)
const posScript = html.indexOf('<script src="/app.js">');
const posElem   = html.indexOf('id="metaAccountsLoading"');
chk('El HTML sigue cargando app.js ANTES de los elementos de Ajustes',
    posScript > 0 && posElem > posScript);

// 2. Los tres bloques de restauración esperan al DOM
for (const [nombre, fn] of [['Meta','updateMetaUI(true, savedName)'],
                            ['LinkedIn','updateLinkedInUI(true, savedName)'],
                            ['Google Ads','updateAdsUI(true, emailFromStorage)']]) {
  const i = src.indexOf(fn);
  const antes = src.slice(Math.max(0, i - 400), i);
  chk(`${nombre}: su restauración espera al DOM`, /alDOMListo\(\s*\(\)\s*=>/.test(antes));
}

// 3. Las funciones que reventaban ahora se defienden
for (const fn of ['loadMetaAccounts', 'loadAdsAccounts', 'renderMetaActiveAccount']) {
  const i = src.indexOf(`function ${fn}() {`);
  const cuerpo = src.slice(i, i + 700);
  chk(`${fn} comprueba que su contenedor exista`, /if \(!document\.getElementById\(/.test(cuerpo));
  chk(`  …y lo deja registrado en vez de callarse`, /errRegistrar\(/.test(cuerpo));
}

// 4. El fallo original, ejecutado de verdad: DOM sin los elementos
globalThis.document = {
  readyState: 'loading',
  _listeners: [],
  addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') this._listeners.push(fn); },
  getElementById: () => null,
};
const alDOMListo = new Function('document', 'fn', src.slice(
  src.indexOf('function alDOMListo(fn) {'),
  src.indexOf('}', src.indexOf('else fn();')) + 1
) + '\nreturn alDOMListo(fn);');
let corrio = false;
alDOMListo(globalThis.document, () => { corrio = true; });
chk('Con el DOM a medio cargar, NO se ejecuta todavía', corrio === false);
globalThis.document._listeners.forEach(f => f());
chk('  y se ejecuta cuando el DOM termina', corrio === true);

globalThis.document.readyState = 'complete';
let corrio2 = false;
alDOMListo(globalThis.document, () => { corrio2 = true; });
chk('Con el DOM ya listo, se ejecuta en el acto', corrio2 === true);


// 5. La defensa de fondo: las tres funciones de interfaz se reintentan solas si
//    el DOM no está. Es lo que cubre los puntos de llamada que se escapen —
//    envolverlos uno a uno ya falló una vez, en la vuelta de OAuth de Google.
for (const [fn, ancla] of [['updateMetaUI','metaStatusBadge'],
                           ['updateAdsUI','adsStatusBadge'],
                           ['updateLinkedInUI','linkedinStatusBadge']]) {
  const i = src.indexOf(`function ${fn}(`);
  const cabeza = src.slice(i, i + 600);
  chk(`${fn} se reintenta sola si falta el DOM`,
      cabeza.includes(`if (!document.getElementById('${ancla}'))`) && /alDOMListo\(\(\) =>/.test(cabeza));
  chk(`  …y su elemento ancla existe en el HTML`, html.includes(`id="${ancla}"`));
}

let mal = 0;
for (const [n, ok, d] of T) { if (!ok) mal++; console.log((ok ? '  OK  ' : '  FALLA ') + n + (ok ? '' : '   → ' + d)); }
console.log('\n' + (mal ? `${mal} de ${T.length} FALLAN` : `Las ${T.length} comprobaciones pasan`));
process.exit(mal ? 1 : 0);
