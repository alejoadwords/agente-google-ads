// Las novedades que ve el cliente: node pruebas/novedades-validas.mjs
//
// `public/novedades.json` se toca en casi todos los commits y lo edita quien
// sea, a veces resolviendo un rebase a mano. Tres formas de romperlo que no se
// ven al publicar:
//
//   1. JSON inválido tras un rebase: la pantalla de novedades deja de abrir.
//   2. Un `id` repetido: la lista se pinta con dos entradas iguales y el
//      «ya lo vi» marca las dos.
//   3. Un destino de botón que novIr() no conoce. Ahora eso al menos avisa,
//      pero el botón sigue sin llevar a ninguna parte — y se publica sin que
//      nadie lo note, porque el que escribe la novedad no le da al botón.

import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../public/novedades.json', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nEl fichero');
let d = null;
try { d = JSON.parse(raw); ok(true, 'es JSON válido'); }
catch (e) { ok(false, 'es JSON válido', e.message); process.exit(1); }

const lista = d.novedades || [];
ok(Array.isArray(lista) && lista.length > 0, 'y trae novedades: ' + lista.length);

// Y la copia de la raíz, que es la que sirve producción.
const rz = readFileSync(new URL('../novedades.json', import.meta.url), 'utf8');
ok(rz === raw, 'la copia de la raíz es idéntica: es la que carga el navegador');

console.log('\nCada entrada');
// Los tipos válidos se leen de la interfaz, que es quien decide. Escritos aquí
// a mano habría dos verdades: cinco novedades usaban «correccion», que el chip
// no conoce, y se pintaban como «Nuevo» — un arreglo anunciado como estreno.
const iChip = app.indexOf('const CHIP = {');
const TIPOS = [...app.slice(iChip, app.indexOf('}', iChip)).matchAll(/(\w+):/g)].map(m => m[1]);
ok(TIPOS.length >= 3, 'los tipos salen de la interfaz: ' + TIPOS.join(', '));
const ids = new Set();
for (const n of lista) {
  const quien = n.id || JSON.stringify(n).slice(0, 40);
  if (!n.id || !n.fecha || !n.tipo || !n.titulo || !n.texto) {
    ok(false, `«${quien}» tiene id, fecha, tipo, título y texto`);
    continue;
  }
  if (ids.has(n.id)) { ok(false, `«${n.id}» está repetido`); continue; }
  ids.add(n.id);
  if (!TIPOS.includes(n.tipo)) ok(false, `«${n.id}» usa un tipo conocido`, n.tipo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.fecha)) ok(false, `«${n.id}» tiene la fecha en aaaa-mm-dd`, n.fecha);
  if (!n.id.startsWith(n.fecha)) ok(false, `«${n.id}» empieza por su fecha, para que ordene`);
}
ok(ids.size === lista.length, `los ${lista.size || lista.length} ids son únicos`);
ok(lista.every(n => TIPOS.includes(n.tipo)), 'todos los tipos son conocidos');
ok(lista.every(n => /^\d{4}-\d{2}-\d{2}$/.test(n.fecha)), 'todas las fechas están bien escritas');

// La primera es la más reciente: es la que se le enseña al cliente al entrar.
const fechas = lista.map(n => n.fecha);
ok(fechas[0] === [...fechas].sort().reverse()[0],
   'la primera de la lista es la más reciente', fechas[0] + ' vs ' + [...fechas].sort().reverse()[0]);

console.log('\nLos botones llevan a alguna parte');
const i = app.indexOf('function novIr(destino)');
ok(i > 0, 'novIr existe en app.js');
const destinos = new Set([...app.slice(i, i + 3000).matchAll(/case '([a-z-]+)'/g)].map(m => m[1]));
ok(destinos.size > 5, 'y declara sus destinos: ' + destinos.size);

for (const n of lista) {
  const ir = n.accion?.ir;
  if (!ir) continue;
  // Una ruta absoluta la abre el `default` de novIr, así que también vale.
  const vale = destinos.has(ir) || ir.startsWith('/');
  ok(vale, `«${n.id}» apunta a un destino que existe`, ir);
  if (n.accion && !n.accion.texto) ok(false, `«${n.id}» tiene texto en su botón`);
}

console.log('');
process.exit(mal ? 1 : 0);
