// Soporte desde el móvil: node pruebas/movil-soporte.mjs
//
// 06-10-2026, revisando VIVA 1A IPS: el admin entró a la cuenta como soporte,
// la cuenta abrió la versión móvil y la franja «Volver a mi cuenta» quedó
// escondida. El botón estaba en el DOM pero medía 0×0: el CSS del enganche
// esconde TODO hijo del <body> que no sea el móvil, y la franja es hija del
// <body>. No había forma de volver a la cuenta propia, ni ensanchando la
// ventana (el modo móvil no se apaga por ancho).
//
// Dos salidas, por si una falla: la franja visible encima del móvil, y una
// fila en la hoja «Tu cuenta».

import { readFileSync } from 'node:fs';

const leer = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const sinCom = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const html = leer('public/index.html');
const app = sinCom(leer('public/app.js'));
const movil = sinCom(leer('public/movil-app.js'));
const css = leer('public/movil-app.css');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nLa franja de soporte sobrevive al modo móvil\n');
{
  const regla = (html.match(/body\.modo-movil > \*[^{]*\{display:none !important\}/) || [''])[0];
  chk('existe la regla que esconde la aplicación de siempre', !!regla);
  chk('y deja fuera a la franja de soporte', regla.includes(':not(#soporte-banner)'), regla);
  chk('el móvil empieza debajo de la franja, no detrás',
      /body\.con-soporte #movil-host\{top:var\(--soporte-alto/.test(html));
  // Sin esto la regla de arriba lee el valor por defecto (0) y la franja tapa
  // la barra del móvil: se vería, pero taparía menú, avisos y perfil.
  chk('soporteBanner() escribe esa altura', /setProperty\('--soporte-alto'/.test(app));
  // La franja (9800) tiene que ir por encima del móvil (9500).
  const zFranja = Number((html.match(/#soporte-banner\{[^}]*z-index:(\d+)/) || [])[1]);
  const zMovil = Number((html.match(/#movil-host\{[^}]*z-index:(\d+)/) || [])[1]);
  chk('y va por encima de él', zFranja > zMovil, zFranja + ' vs ' + zMovil);
}

console.log('\nLa hoja «Tu cuenta» ofrece volver\n');
{
  const i = movil.indexOf('function abrirPerfil');
  const fn = movil.slice(i, movil.indexOf('\n}', i));
  chk('la fila sale solo en soporte', /estoyEnSoporte\(\)/.test(fn));
  chk('dice lo que hace', /Volver a mi cuenta/.test(fn));
  chk('y llama al regreso de la web', /M\.volverDeSoporte\(this\)/.test(fn));
  chk('volverDeSoporte usa soporteVolver de app.js', /soporteVolver\(\)/.test(movil));
  chk('queda expuesta en M', /volverDeSoporte: volverDeSoporte/.test(movil));
  // En el boceto suelto (movil.html) no hay app.js: preguntar sin typeof
  // lanzaría y se llevaría la hoja entera.
  chk('pregunta con typeof, para el boceto suelto', /typeof enSoporte === 'function'/.test(movil));
  chk('la fila tiene su estilo', /\.mfila\.soporte/.test(css));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
