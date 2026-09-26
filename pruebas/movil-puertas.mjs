// Las puertas del móvil: node pruebas/movil-puertas.mjs
//
// Dos veces seguidas el mismo tipo de fallo, y las dos las encontró el cliente
// mirando la pantalla, no una prueba:
//
//   · `/api/agenda?proximos=1` — un parámetro que el servidor no lee. La
//     petición caía en otra rama, devolvía 200 y datos, y el Pulso del
//     teléfono contaba otra cosa que el del computador.
//   · `/api/leads?limit=200` sobre una cuenta de 392 contactos.
//
// Y un tercero que salió auditando esto: crear un contacto sin `client_id`.
// La fila nace fuera del cliente y desaparece de las dos pantallas — guardada
// pero invisible, que es peor que no guardarse: nadie la vuelve a crear.
//
// Las tres son la misma clase: el móvil entrando por una puerta distinta a la
// de la web. Esta prueba vigila las puertas, no las reglas.

import { readFileSync, readdirSync, existsSync } from 'node:fs';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const leer = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const sinCom = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const datos = sinCom(leer('public/movil-datos.js'));
const movapp = sinCom(leer('public/movil-app.js'));
const mov = datos + '\n' + movapp;
const app = sinCom(leer('public/app.js'));

console.log('\nCada ruta que pide el móvil existe\n');
{
  const rutas = [...new Set([...mov.matchAll(/['"`](\/api\/([a-z-]+))/g)].map((m) => m[2]))].sort();
  chk('el móvil habla con al menos una docena de endpoints', rutas.length >= 12, String(rutas.length));
  const faltan = rutas.filter((r) => !existsSync(new URL('../api/' + r + '.js', import.meta.url)));
  chk('todas tienen su fichero en api/', faltan.length === 0, faltan.join(', '));
  // Y la web usa las mismas: dos puertas distintas para el mismo dato acaban
  // dando dos números distintos, que es lo que pasó con el Pulso.
  const soloMovil = rutas.filter((r) => !app.includes('/api/' + r));
  chk('y la web usa esas mismas puertas', soloMovil.length === 0, soloMovil.join(', '));
}

console.log('\nTodo parámetro que manda, el servidor lo lee\n');
{
  // `?proximos=1` no lo leía nadie. No falló: cayó en otra rama y devolvió
  // datos de otra cosa. Un parámetro ignorado no da error, da otra respuesta.
  const porFichero = new Map();
  for (const m of mov.matchAll(/['"`]\/api\/([a-z-]+)\?([a-z_]+)=/g)) {
    if (!porFichero.has(m[1])) porFichero.set(m[1], new Set());
    porFichero.get(m[1]).add(m[2]);
  }
  chk('hay parámetros que comprobar', porFichero.size > 0, '0');
  for (const [fich, pars] of [...porFichero].sort()) {
    const api = leer('api/' + fich + '.js');
    for (const p of pars) {
      chk(`api/${fich}.js lee «${p}»`,
          new RegExp("searchParams\\.get\\(['\"]" + p + "['\"]\\)").test(api),
          'el servidor lo ignora y la petición cae en otra rama');
    }
  }
}

console.log('\nLo que se CREA nace dentro del cliente\n');
{
  // El POST hereda el client_id de la petición. Sin él la fila nace con null y
  // las dos pantallas —que filtran por cliente— dejan de verla.
  chk('existe el ayudante que pega el alcance', /function conAlcance\(ruta\)/.test(movapp));
  // Los endpoints que ESCRIBEN client_id de la consulta. Si el móvil crea ahí
  // sin alcance, la fila se pierde de vista.
  const escribenAlcance = readdirSync(new URL('../api/', import.meta.url))
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .filter((f) => /client_id: clientId\b/.test(leer('api/' + f)))
    .map((f) => f.replace('.js', ''));
  chk('hay endpoints que escriben el cliente de la consulta', escribenAlcance.length > 0,
      String(escribenAlcance.length));

  // Cada creación del móvil contra uno de esos tiene que llevar `conAlcance`.
  const creaciones = [...movapp.matchAll(/guardar\(([^,]+), [\s\S]{0,220}?'POST'\)/g)].map((m) => m[1].trim());
  chk('el móvil crea cosas', creaciones.length > 0, String(creaciones.length));
  for (const c of creaciones) {
    const fich = (c.match(/\/api\/([a-z-]+)/) || [, ''])[1];
    if (!escribenAlcance.includes(fich)) continue;   // no hereda el cliente: no aplica
    chk(`crear en ${fich} lleva el alcance de cliente`,
        /conAlcance\(/.test(c), c.slice(0, 70));
  }
}

console.log('\nNi recortes que la web no tiene\n');
{
  // `?limit=200` sobre 392 contactos: el móvil veía 200 y contaba sobre esos.
  const recortes = [...mov.matchAll(/\/api\/[a-z-]+\?[^'"`]*limit=\d+/g)].map((m) => m[0]);
  chk('el móvil no recorta ninguna lista', recortes.length === 0, recortes.join(', '));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
