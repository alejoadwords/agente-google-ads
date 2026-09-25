// Guiones de terceros en el HTML: node pruebas/guiones-externos.mjs
//
// Vercel Web Analytics estuvo pedido en `index.html` sin estar activo en la
// cuenta: devolvía 404 en cada carga de cada usuario, con su error rojo en la
// consola, y no recogió jamás un dato. Nadie lo notó porque un guion que no
// carga no rompe nada — solo no mide, que es justo lo que se le pedía.
//
// Esta prueba vigila que no vuelva a entrar, y que lo que sí medimos siga ahí.

import { readFileSync } from 'node:fs';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const leer = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

console.log('\nNo se pide nada que la cuenta no sirva\n');
for (const f of ['public/index.html', 'index.html']) {
  const s = leer(f);
  // Solo el `src`: el comentario que explica POR QUÉ se quitó nombra la ruta, y
  // chocar con él haría que la prueba pidiera borrar su propia explicación.
  const pide = /<script[^>]+src="\/_vercel\/insights/.test(s);
  chk(f + ' no carga el guion de Vercel Analytics', !pide,
      'está desactivado en la cuenta: 404 en cada carga');
  // Speed Insights sí responde hoy, pero tampoco está enlazado. Si alguien lo
  // añade, que sea a sabiendas de que se factura por evento.
  chk(f + ' tampoco carga Speed Insights sin querer',
      !/<script[^>]+src="\/_vercel\/speed-insights/.test(s));
}

console.log('\nLo que sí mide sigue en su sitio\n');
{
  const s = leer('public/index.html');
  // GTM es el único camino de los pixels y de los eventos de conversión.
  chk('GTM sigue cargado', /GTM-PX26PNPJ/.test(s));
  chk('y con su dataLayer antes del contenedor',
      s.indexOf('dataLayer') < s.indexOf('GTM-PX26PNPJ'));
  // Las dos copias tienen que decir lo mismo o producción sirve otra cosa.
  chk('la copia de la raíz es idéntica', leer('index.html') === s);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
