#!/usr/bin/env node
// tools/llaves.mjs
// Caza el `if` de una línea al que le colgaron una segunda instrucción.
//
// Existe por esto, del 21-09-2026:
//
//   if (_tw && _tw.owner_user_id) userId = _tw.owner_user_id; clienteDelMiembro = _tw.client_id || null;
//
// Sin llaves, el `if` solo cubre la PRIMERA asignación. La segunda corre
// siempre — y como `_tw` es `undefined` para quien no es miembro del equipo,
// reventaba. El `try` de alrededor lo convertía en un 503 educado, así que
// desde fuera parecía un problema de red.
//
// La línea se copió tal cual a SEIS ficheros: se cayeron los pipelines, los
// agentes de chat, las propuestas, las respuestas rápidas y la sincronización
// de conocimiento, para TODOS los dueños de cuenta. Nadie lo vio porque el
// fichero es JavaScript perfectamente válido: `node --check` pasa, el guardián
// de exports pasa, y el despliegue también.
//
//   node tools/llaves.mjs
//
// Sale con código 1 si encuentra algo, para poder colgarlo de un hook.
//
// OJO al escribir la comprobación: la primera versión usaba una expresión
// regular y sacó 26 falsos positivos —se tragaba los paréntesis anidados de
// `if (a.has(b))` y los `;` dentro de un texto—. Un guardián que grita por
// nada es peor que no tenerlo: nadie lo vuelve a mirar. Por eso aquí se
// cuentan los paréntesis a mano y se vacían antes los textos.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARPETAS = ['api', 'tools', 'pruebas'];

// Deja la línea con la misma longitud pero sin nada dentro de textos ni
// comentarios, para que un `;` de adorno no cuente como fin de instrucción.
function vaciarTextos(linea) {
  let fuera = '', comilla = null;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comilla) {
      if (c === '\\') { fuera += '  '; i++; continue; }
      if (c === comilla) { comilla = null; fuera += c; continue; }
      fuera += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { comilla = c; fuera += c; continue; }
    if (c === '/' && linea[i + 1] === '/') return fuera + ' '.repeat(linea.length - i);
    fuera += c;
  }
  return fuera;
}

// Lo que sale de un `if` sin llaves y NO puede dejar caer nada detrás.
const CORTAN = /^(return|throw|continue|break)\b/;

function revisar(linea) {
  const l = vaciarTextos(linea);

  // Solo el `if` que ABRE la línea. Un `if` metido dentro de un bloque que se
  // abre en la misma línea —`for (...) { if (!ok) mal++; console.log(...); }`—
  // es otra cosa: ahí lo de después corre siempre y está bien que lo haga.
  const m = /^\s*(?:\}\s*)?(?:else\s+)?if(\s*)\(/.exec(l);
  if (!m) return null;

  // Todo nuestro código escribe `if (`. Un `if(` pegado es código minificado
  // de terceros —el fragmento del pixel de Meta en api/l.js— donde encadenar
  // instrucciones con punto y coma es el estilo, no un descuido.
  if (!m[1]) return null;

  // Paréntesis balanceados: `if (a.has(b))` tiene dos cierres, no uno.
  let i = l.indexOf('(', m.index), prof = 0, fin = -1;
  for (; i < l.length; i++) {
    if (l[i] === '(') prof++;
    else if (l[i] === ')') { prof--; if (prof === 0) { fin = i; break; } }
  }
  if (fin < 0) return null;

  const resto = l.slice(fin + 1).trim();
  if (!resto || resto.startsWith('{')) return null;   // con llaves, correcto
  if (CORTAN.test(resto)) return null;                // sale de la función

  // El primer `;` a nivel cero cierra la instrucción del if. Lo que venga
  // después, si es código, corre siempre.
  let d = 0;
  for (let j = 0; j < resto.length; j++) {
    const c = resto[j];
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) {
      const cola = resto.slice(j + 1).trim();
      if (!cola || cola.startsWith('else') || cola.startsWith('}')) return null;
      return cola;
    }
  }
  return null;
}

let hallazgos = 0, mirados = 0;
for (const carpeta of CARPETAS) {
  const pila = [path.join(RAIZ, carpeta)];
  while (pila.length) {
    const d = pila.pop();
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') pila.push(p); continue; }
      if (!/\.m?js$/.test(e.name)) continue;
      mirados++;
      fs.readFileSync(p, 'utf8').split('\n').forEach((linea, i) => {
        const cola = revisar(linea);
        if (!cola) return;
        hallazgos++;
        console.log(`  ${path.relative(RAIZ, p)}:${i + 1}`);
        console.log(`    ${linea.trim().slice(0, 140)}`);
        console.log(`    ↑ «${cola.slice(0, 60)}» corre SIEMPRE, esté o no el if. ¿Faltan llaves?`);
      });
    }
  }
}

if (hallazgos) {
  console.log(`\n${hallazgos} línea(s) sospechosa(s) en ${mirados} ficheros.`);
  process.exit(1);
}
console.log(`${mirados} ficheros: ningún if de una línea con instrucción colgando.`);
