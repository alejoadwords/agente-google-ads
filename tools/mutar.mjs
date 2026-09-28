#!/usr/bin/env node
// tools/mutar.mjs — comprobar que una prueba de verdad protege algo
//
//   node tools/mutar.mjs <fichero-de-mutaciones.mjs>
//
// Una prueba en verde no dice nada por sí sola: dice que hoy pasa. Lo que
// dice si PROTEGE es romper el código a propósito y ver si la prueba se
// entera. Eso es lo que hace esto.
//
// Nace de un fallo del guion que hacía esto a mano el 28-09-2026: la suite
// reventaba por un error de ámbito en la última línea y el guion cantó «todos
// los mutantes mueren» — porque una suite que revienta sale con código
// distinto de cero, exactamente igual que una que falla. Todos los mutantes
// parecían muertos y ninguno lo estaba: el verificador estaba roto y decía
// que todo iba bien, que es la peor forma de fallar que existe.
//
// Por eso aquí lo PRIMERO es comprobar que la suite pasa SIN tocar nada, y
// que cada mutación cambia de verdad el fichero.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const fichero = process.argv[2];
if (!fichero) {
  console.error('\n  Uso: node tools/mutar.mjs <fichero-de-mutaciones.mjs>\n');
  process.exit(2);
}
const { SUITE, ARCHIVOS, MUTACIONES } = await import(resolve(fichero));

const corre = () => {
  try { execSync('node ' + SUITE, { stdio: 'pipe' }); return true; }
  catch { return false; }
};

const original = {};
for (const [k, ruta] of Object.entries(ARCHIVOS)) original[k] = readFileSync(ruta, 'utf8');
const restaurar = () => { for (const [k, ruta] of Object.entries(ARCHIVOS)) writeFileSync(ruta, original[k]); };

// 1. La línea base. Sin esto, una suite rota da verde a todo.
if (!corre()) {
  console.error('\n  ✗ ' + SUITE + ' NO pasa sin tocar nada.\n'
    + '    Arregla la prueba antes de mutar: con ella rota, todos los mutantes\n'
    + '    parecen muertos y el resultado no significa nada.\n');
  process.exit(1);
}
console.log('\n  base: ' + SUITE + ' en verde\n');

const vivos = [], inertes = [];
try {
  for (const m of MUTACIONES) {
    const ruta = ARCHIVOS[m.archivo];
    const despues = m.romper(original[m.archivo]);
    // 2. Una mutación que no cambia nada no es un mutante: es una errata en
    //    la mutación, y contarla como muerta es engañarse.
    if (despues === original[m.archivo]) { inertes.push(m.nombre); console.log('  INERTE     ' + m.nombre); continue; }
    writeFileSync(ruta, despues);
    const sobrevive = corre();
    restaurar();
    if (sobrevive) vivos.push(m.nombre);
    console.log('  ' + (sobrevive ? 'SOBREVIVE  ' : 'muere      ') + m.nombre);
  }
} finally { restaurar(); }

const total = MUTACIONES.length;
console.log('\n  ' + (total - vivos.length - inertes.length) + '/' + total + ' mutantes muertos'
  + (vivos.length ? ' · ' + vivos.length + ' VIVOS: ' + vivos.join(' | ') : '')
  + (inertes.length ? ' · ' + inertes.length + ' inertes (mutación mal escrita): ' + inertes.join(' | ') : '')
  + '\n');
process.exit(vivos.length || inertes.length ? 1 : 0);
