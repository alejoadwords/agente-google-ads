// El degradado agua del marco: node pruebas/degradado-agua.mjs
//
// La cabecera y la columna del menú llevan el «Blanco sobre el degradado agua»
// del manual. Lo que hay que proteger:
//
//   1. Que el modo OSCURO no lo herede. Se decidió dejarlo como estaba, y una
//      regla sin acotar se lo lleva por delante sin que nadie lo mire: el
//      oscuro se usa poco y el fallo viviría meses.
//   2. Que lo que va ENCIMA se lea. Media docena de controles llevan el color
//      en el atributo style del HTML, que gana a la hoja de estilos: sin un
//      «important» la campana y el soporte se quedan grises sobre el azul y el
//      selector de cliente, blanco. Eso ya pasó una vez y solo se vio en una
//      captura; leyendo el CSS no se nota.
//
// Se miden los estilos CALCULADOS en un navegador. Comprobar esto buscando
// texto en el fichero diría que la regla está escrita, no que gana.

// Playwright no viene con el repositorio —`package.json` no tiene ni una
// dependencia, a propósito—, así que esta suite no siempre se puede correr.
// Antes el `import` reventaba y la batería salía con un rojo permanente que no
// era un fallo: un rojo que siempre está enseña a ignorar el rojo. Ahora se
// omite diciéndolo, y el lanzador la cuenta aparte — ni verde ni rota, porque
// no comprobó nada.
let chromium;
try {
  ({ chromium } = await import('../node_modules/playwright/index.mjs'));
} catch {
  console.log('OMITIDA: falta playwright (npm i -D playwright && npx playwright install chromium)');
  process.exit(75);
}
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const INDEX = new URL('../public/index.html', import.meta.url).pathname;

// El tema se hornea en el HTML antes de cargar, no se pone con setAttribute
// después. Puesto en vivo, el navegador no reevaluaba del todo y devolvía una
// mezcla de claro y oscuro: el token ya era el oscuro pero el color seguía
// siendo el claro. Una medición así acusa de una regresión que no existe, y
// costó media hora creerle. El fichero temporal vive al lado del original para
// que sus rutas relativas resuelvan igual, y se borra pase lo que pase.
const OSCURO = INDEX.replace(/index\.html$/, '_tema-oscuro-prueba.html');
writeFileSync(OSCURO, readFileSync(INDEX, 'utf8')
  .replace('<html lang="es">', '<html lang="es" data-theme="dark">'));
// Se borra pase lo que pase: si una comprobación revienta, el temporal se
// quedaría dentro de public/ y acabaría desplegado.
process.on('exit', () => { try { unlinkSync(OSCURO); } catch {} });

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

const nav = await chromium.launch();

async function mirar(oscuro, ancho = 1440) {
  const p = await nav.newPage({ viewport: { width: ancho, height: 820 } });
  await p.route('**/*.js', (r) => r.abort());       // sin JS: solo interesa el CSS
  await p.goto('file://' + (oscuro ? OSCURO : INDEX), { waitUntil: 'domcontentloaded' });
  const r = await p.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { fondo: s.backgroundColor, imagen: s.backgroundImage, color: s.color, ver: s.display };
    };
    // La pestaña activa se comprueba sobre una de verdad, marcada al vuelo.
    const m = document.querySelector('.sb-mod');
    if (m) m.classList.add('active');
    // El submenú lo construye el JS, que aquí no corre: se monta con sus
    // clases reales para poder medirlo.
    const sub = document.createElement('div');
    sub.className = 'sb-sub open';
    sub.innerHTML = '<div class="sb-sub-title">Marketing</div>' +
      '<div class="sb-sub-item">Campañas</div>' +
      '<div class="sb-sub-item active">Plantillas</div>';
    document.body.appendChild(sub);
    return {
      hdr: cs('.hdr'), sidebar: cs('.sidebar'),
      logoClaro: cs('.hdr-logo-light'), logoBlanco: cs('.hdr-logo-dark'),
      campana: cs('#alerts-btn'), soporte: cs('#sop-btn'),
      academia: cs('.hdr-academia-btn'), cliente: cs('#hdr-client-btn'),
      salir: cs('.hdr-signout'), activa: cs('.sb-mod.active'),
      sub: cs('.sb-sub'), subTitulo: cs('.sb-sub-title'),
      subItem: cs('.sb-sub-item'), subActivo: cs('.sb-sub-item.active'),
    };
  });
  await p.close();
  return r;
}

const BLANCO = (c) => /rgba?\(255,\s*255,\s*255/.test(c || '');
const DEGRADADO = (i) => /gradient/.test(i || '');

// ── Modo claro: el degradado y lo que va encima ────────────────────────────
console.log('\nModo claro — el degradado agua');
const claro = await mirar(false);
ok(DEGRADADO(claro.hdr.imagen), 'la cabecera lleva degradado', claro.hdr.imagen);
ok(DEGRADADO(claro.sidebar.imagen), 'la columna lleva degradado', claro.sidebar.imagen);
ok(claro.hdr.imagen !== claro.sidebar.imagen,
   'y son DOS degradados distintos: con uno solo la columna se queda toda azul');

console.log('\nModo claro — el logo');
ok(claro.logoClaro.ver === 'none' && claro.logoBlanco.ver !== 'none',
   'se enseña el logo blanco, no el azul: azul sobre azul no se ve',
   `azul=${claro.logoClaro.ver} blanco=${claro.logoBlanco.ver}`);

console.log('\nModo claro — lo que va encima se lee');
// Estos cuatro llevan el color en el atributo style del HTML. Son los que se
// quedaron grises la primera vez.
for (const [nombre, v] of [
  ['la campana', claro.campana], ['el soporte', claro.soporte],
  ['Academia', claro.academia], ['el selector de cliente', claro.cliente],
  ['«salir»', claro.salir], ['la pestaña activa', claro.activa],
]) {
  ok(BLANCO(v.color), `${nombre} se pinta en blanco`, v.color);
}
ok(BLANCO(claro.cliente.fondo),
   'y el selector de cliente tiene fondo translúcido, no blanco opaco', claro.cliente.fondo);

// ── El submenú flotante ────────────────────────────────────────────────────
// Se quedaba blanco mientras el menú del que sale ya era azul.
console.log('\nModo claro — el submenú que sale del menú');
ok(DEGRADADO(claro.sub.imagen), 'el panel lleva degradado, no el blanco de antes', claro.sub.fondo);
ok(BLANCO(claro.subTitulo.color), 'su título se lee', claro.subTitulo.color);
ok(BLANCO(claro.subItem.color), 'y sus opciones también', claro.subItem.color);
ok(BLANCO(claro.subActivo.color) && BLANCO(claro.subActivo.fondo),
   'la opción en la que estás se distingue en blanco',
   claro.subActivo.color + ' sobre ' + claro.subActivo.fondo);

// En el teléfono no flota: se despliega DENTRO de la columna, que ya lleva el
// degradado. Ahí el panel no debe pintar nada o sería un recuadro dentro de
// otro. Esto se rompió al poner el degradado y no se vio hasta medirlo.
console.log('\nEn el teléfono el submenú va dentro del menú');
const movil = await mirar(false, 390);
ok(!DEGRADADO(movil.sub.imagen) && !/rgb\(255, 255, 255\)/.test(movil.sub.fondo),
   'no pinta fondo propio: se apoya en el de la columna',
   'imagen=' + movil.sub.imagen + ' fondo=' + movil.sub.fondo);
ok(BLANCO(movil.subItem.color), 'y sus opciones se leen sobre el degradado', movil.subItem.color);

// ── Modo oscuro: no se tocó ────────────────────────────────────────────────
console.log('\nModo oscuro — se quedó como estaba');
const oscuro = await mirar(true);
ok(!DEGRADADO(oscuro.hdr.imagen), 'la cabecera NO hereda el degradado', oscuro.hdr.imagen);
ok(!DEGRADADO(oscuro.sidebar.imagen), 'la columna tampoco', oscuro.sidebar.imagen);
ok(!BLANCO(oscuro.activa.color),
   'la pestaña activa conserva su color de siempre, no el blanco del degradado', oscuro.activa.color);
ok(!BLANCO(oscuro.cliente.fondo),
   'y el selector de cliente, su fondo de siempre', oscuro.cliente.fondo);
ok(!DEGRADADO(oscuro.sub.imagen), 'el submenú tampoco hereda el degradado', oscuro.sub.imagen);
ok(!BLANCO(oscuro.subItem.color), 'y sus opciones conservan su color', oscuro.subItem.color);

await nav.close();
console.log('');
process.exit(mal ? 1 : 0);
