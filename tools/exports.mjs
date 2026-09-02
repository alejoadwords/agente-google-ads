#!/usr/bin/env node
// tools/exports.mjs
// Comprueba que todo lo que api/*.js importa de un api/_*.js existe de verdad.
//
// Existe por un fallo de seis días: al insertar una función nueva justo debajo
// de un `export`, el `export` se quedó pegado a la función nueva y la vieja
// dejó de exportarse. `node --check` no ve nada raro —el fichero es JavaScript
// válido— y el `await import()` del que la usaba devolvía undefined, así que el
// aviso por correo a los comerciales no salió ni una sola vez sin que se cayera
// nada. Un import que no resuelve tiene que doler antes de desplegar.
//
//   node tools/exports.mjs
//
// Sale con código 1 si algo no resuelve, para poder colgarlo de un hook.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(RAIZ, 'api');

const ficheros = fs.readdirSync(API).filter(f => f.endsWith('.js'));
const compartidos = ficheros.filter(f => f.startsWith('_'));

// Qué exporta cada módulo compartido. Se importa de verdad: leer los `export`
// con una expresión regular es justo lo que dejó pasar el fallo original.
const exporta = {};
for (const f of compartidos) {
  try {
    exporta['./' + f] = Object.keys(await import(pathToFileURL(path.join(API, f)).href));
  } catch (e) {
    exporta['./' + f] = null;
    console.log(`ROTO   ${f}: no se pudo cargar — ${e?.message}`);
  }
}

// Los nombres de un destructuring, con `origen: alias` resuelto al origen.
function nombres(lista) {
  return lista
    .split(',')
    .map(s => s.split(':')[0].split(' as ')[0].trim())
    .filter(s => s && s !== '...' && !s.startsWith('...'));
}

let malos = 0;
for (const f of ficheros) {
  const src = fs.readFileSync(path.join(API, f), 'utf8');
  const patrones = [
    /import\s*\{([^{}]*)\}\s*from\s*['"](\.\/_[\w.-]+\.js)['"]/g,                              // estático
    /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*await\s+import\(\s*['"](\.\/_[\w.-]+\.js)['"]/g,   // dinámico
  ];
  for (const re of patrones) {
    let m;
    while ((m = re.exec(src))) {
      const mod = m[2];
      if (!(mod in exporta)) { console.log(`FALTA  ${f} importa ${mod}, que no existe`); malos++; continue; }
      if (exporta[mod] === null) { malos++; continue; }   // ya se avisó arriba
      for (const n of nombres(m[1])) {
        if (!exporta[mod].includes(n)) {
          console.log(`FALTA  ${f} → ${mod} no exporta '${n}'  (exporta: ${exporta[mod].join(', ') || 'nada'})`);
          malos++;
        }
      }
    }
  }
}

if (malos) { console.log(`\n${malos} import(s) que no resuelven.`); process.exit(1); }
console.log(`${ficheros.length} funciones y ${compartidos.length} módulos: todos los imports resuelven.`);
