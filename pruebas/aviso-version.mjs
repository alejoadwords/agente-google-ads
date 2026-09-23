// El aviso de versión nueva: node pruebas/aviso-version.mjs
//
// Quien deja la pestaña abierta sigue ejecutando el app.js del día que la
// abrió. No es la caché —el servidor manda must-revalidate con ETag—, es que
// nadie recarga. La barra lo detecta y ofrece el botón.
//
// Se comprueban dos cosas que fallan en silencio: que cada var(--x) y cada
// clase que usa el aviso EXISTAN —un token inventado no rompe nada, solo se
// ve mal— y que la lógica no moleste a quien no lo necesita.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const bloqueJs = js.slice(js.indexOf('// ── Versión nueva publicada'));
const bloqueCss = html.slice(html.indexOf('.nueva-version{'), html.indexOf('</style>', html.indexOf('.nueva-version{')));

console.log('\nTodo lo que usa el aviso existe de verdad\n');
{
  const tokens = [...new Set([...bloqueCss.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]))];
  const faltan = tokens.filter(t => !new RegExp('\\' + t + '\\s*:').test(html));
  chk(`los ${tokens.length} tokens existen`, faltan.length === 0, faltan.join(', '));

  const clases = [...new Set([...bloqueJs.matchAll(/class="([^"]+)"/g)]
    .flatMap(m => m[1].split(/\s+/)).filter(Boolean))];
  const sinCss = clases.filter(c => !html.includes('.' + c) && !bloqueCss.includes('.' + c));
  chk(`las ${clases.length} clases existen`, sinCss.length === 0, sinCss.join(', '));

  const iconos = [...new Set([...bloqueJs.matchAll(/icn\('([\w-]+)'/g)].map(m => m[1]))];
  const i = js.indexOf('const ICN_PATHS = {');
  const catalogo = js.slice(i, js.indexOf('\n};', i));
  const sinIcono = iconos.filter(n => !new RegExp('^\\s*' + n + ':', 'm').test(catalogo));
  // Un icono inventado NO falla: `icn()` cae en el de barras y sale un gráfico
  // donde debería haber una flecha de recargar.
  chk(`los iconos existen (${iconos.join(', ')})`, sinIcono.length === 0, sinIcono.join(', '));
}

console.log('\nNo molesta a quien no lo necesita\n');
{
  chk('no baja el app.js entero para mirar: usa HEAD', /method: 'HEAD'/.test(bloqueJs));
  chk('sin huella no avisa', /if \(!_huellaAlArrancar\) return;/.test(bloqueJs));
  chk('con la pestaña de fondo no consulta', /document\.hidden/.test(bloqueJs));
  chk('solo avisa si la huella CAMBIÓ', /ahora !== _huellaAlArrancar/.test(bloqueJs));
  chk('no se pinta dos veces', /_barraVersionPuesta/.test(bloqueJs) && /getElementById\('nueva-version'\)/.test(bloqueJs));
  chk('un fallo de red se traga sin avisar', /catch\s*\{\s*\n?\s*return null;/.test(bloqueJs));
}

console.log('\nEl usuario puede actuar y puede irse\n');
{
  chk('el botón recarga', /location\.reload\(\)/.test(bloqueJs));
  chk('se puede cerrar', /\.nv-no'\)\.addEventListener/.test(bloqueJs));
  chk('se anuncia a los lectores de pantalla', /role', 'status'/.test(bloqueJs));
  chk('el texto va en español y dice qué pasa', /versión nueva de Acuarius/.test(bloqueJs));
}

console.log('\nArranca cuando el DOM está listo\n');
{
  // app.js se carga a media página: tocar document.body al leer el fichero es
  // el fallo clásico de este proyecto.
  chk('usa alDOMListo en vez de tocar el DOM al arrancar', /alDOMListo\(async \(\) =>/.test(bloqueJs));
  // Lo que importa no es dónde APARECE `document.body` —está dentro de una
  // función que corre después— sino que al LEER el fichero no se ejecute nada
  // más que la llamada que sí espera al DOM.
  const sueltas = bloqueJs.split('\n')
    .filter(l => /^[a-zA-Z_$]/.test(l) && !/^(function|const|let|var|async|\/\/)/.test(l))
    .map(l => l.trim());
  chk('la única sentencia suelta es vigilarVersion()',
      sueltas.length === 1 && sueltas[0] === 'vigilarVersion();', JSON.stringify(sueltas));
}

console.log('\nEl móvil no queda apretado\n');
{
  chk('hay una regla para pantalla estrecha', /@media \(max-width:520px\)/.test(bloqueCss));
  chk('la barra no se sale del ancho', /max-width:calc\(100vw - 32px\)/.test(bloqueCss));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
