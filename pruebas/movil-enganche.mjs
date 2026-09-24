// El enganche de la versión móvil: node pruebas/movil-enganche.mjs
//
// Decide si a alguien se le ofrece la versión móvil, si se enciende y si se
// puede volver. Es código que corre en el teléfono de un cliente con su CRM
// delante, así que lo que no puede hacer es dejarlo sin nada.
//
// Se ejecuta el fichero de verdad contra un navegador de mentira.

import { readFileSync } from 'node:fs';

const fuente = readFileSync(new URL('../public/movil-enganche.js', import.meta.url), 'utf8');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

function montar({ ancho = 375, guardado = null, cargaFalla = false } = {}) {
  const almacen = { [ 'acuarius_movil' ]: guardado };
  const creados = [];
  const clases = new Set();
  const el = (tag) => {
    const e = {
      tag, id: '', rel: '', href: '', src: '', hidden: false, innerHTML: '',
      _oyentes: {},
      setAttribute() {}, appendChild() {}, remove() { e._quitado = true; },
      addEventListener(n, f) { e._oyentes[n] = f; },
      // Los hijos de la franja: el fichero los busca dentro de ella.
      querySelector: (sel) => {
        if (!e.innerHTML || e.innerHTML.indexOf(String(sel).slice(1)) < 0) return null;
        const hijo = { id: String(sel).slice(1), _oyentes: {},
          addEventListener(n, f) { hijo._oyentes[n] = f; } };
        e._hijos = e._hijos || {}; e._hijos[hijo.id] = hijo;
        return hijo;
      },
    };
    creados.push(e);
    return e;
  };
  const porId = {};
  const doc = {
    readyState: 'complete',
    body: { classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c) }, appendChild() {} },
    head: { appendChild() {} },
    createElement: el,
    getElementById: (id) => porId[id] || null,
    addEventListener() {},
  };
  const win = {
    matchMedia: (q) => ({ matches: ancho <= Number((q.match(/(\d+)px/) || [])[1] || 0) }),
  };
  const local = {
    getItem: (k) => (almacen[k] === undefined ? null : almacen[k]),
    setItem: (k, v) => { almacen[k] = v; },
  };
  return { doc, win, local, clases, creados, porId, almacen, cargaFalla };
}

function correr(e) {
  const nombres = ['window', 'document', 'localStorage', 'Promise', 'Error', 'setTimeout', 'console'];
  const valores = [e.win, e.doc, e.local, Promise, Error, (f) => f(), { warn() {}, error() {} }];
  // `window` es también el objeto global donde el fichero deja `movilEnganche`.
  new Function(...nombres, fuente)(...valores);
  return e.win.movilEnganche;
}

console.log('\nEn escritorio no se ofrece ni se carga nada\n');
{
  const e = montar({ ancho: 1280 });
  correr(e);
  // 88 kB que un escritorio no tiene por qué bajar nunca.
  chk('no se ofrece', !e.creados.some((c) => c.id === 'movil-oferta'));
  chk('no se carga el móvil', !e.creados.some((c) => c.src && c.src.includes('movil-app')));
  chk('y no se toca el <body>', e.clases.size === 0);
}

console.log('\nEn teléfono se ofrece, y se puede decir que no\n');
{
  const e = montar({ ancho: 375 });
  const api = correr(e);
  const oferta = e.creados.find((c) => c.id === 'movil-oferta');
  chk('aparece la franja', !!oferta);
  chk('dice qué es, no solo «prueba esto»',
      !!oferta && /versi[oó]n de Acuarius hecha para el tel[eé]fono/i.test(oferta.innerHTML));
  // Una oferta que no se puede rechazar es un aviso.
  chk('trae las dos opciones', !!oferta && /movil-si/.test(oferta.innerHTML) && /movil-no/.test(oferta.innerHTML));
  chk('el enganche queda expuesto para poder volver', typeof api === 'object' && typeof api.apagar === 'function');
  // Y los dos botones quedan enganchados de verdad, no solo dibujados.
  chk('los dos botones responden al toque',
      !!oferta && oferta._hijos && !!oferta._hijos['movil-si'] && !!oferta._hijos['movil-no']);
}

console.log('\nLa elección se recuerda\n');
{
  const e = montar({ ancho: 375, guardado: 'no' });
  correr(e);
  // Quien dijo que no no tiene que decirlo cada vez que abre la aplicación.
  chk('a quien dijo que no, no se le insiste', !e.creados.some((c) => c.id === 'movil-oferta'));

  const e2 = montar({ ancho: 375, guardado: 'si' });
  correr(e2);
  chk('a quien dijo que sí se le enciende sin preguntar',
      !e2.creados.some((c) => c.id === 'movil-oferta') && e2.clases.has('modo-movil'));
  chk('y se carga el móvil', e2.creados.some((c) => c.src && c.src.includes('movil-app.js')));
  chk('con sus estilos', e2.creados.some((c) => c.href && c.href.includes('movil-app.css')));
}

console.log('\nApagarlo devuelve la aplicación de siempre\n');
{
  const e = montar({ ancho: 375, guardado: 'si' });
  const api = correr(e);
  chk('encendido marca el body', e.clases.has('modo-movil'));
  api.apagar();
  chk('apagado lo quita', !e.clases.has('modo-movil'));
  chk('y queda recordado', e.almacen['acuarius_movil'] === 'no');
}

console.log('\nSi el fichero no carga, no se queda en blanco\n');
{
  // Quedarse sin pantalla por un fichero que no llegó es dejar a alguien sin
  // CRM en la calle. El responsive de siempre funciona: se vuelve a él.
  const s = fuente;
  chk('hay un onerror para el guion', /js\.onerror\s*=/.test(s));
  chk('que apaga el modo móvil', /onerror[\s\S]{0,200}apagar\(\)/.test(s));
  chk('y lo dice en vez de callar', /onerror[\s\S]{0,320}showToast/.test(s));
}

console.log('\nMientras está encendido, la de escritorio no sigue corriendo\n');
{
  const css = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  // Con las dos vivas a la vez seguirían corriendo por debajo los atajos de
  // teclado, los focos y los temporizadores de la de escritorio.
  chk('el modo móvil esconde el resto de la aplicación',
      /body\.modo-movil > \*:not\(#movil-host\)/.test(css));
  chk('el contenedor existe en el HTML', /<div id="movil-host" hidden><\/div>/.test(css));
  chk('el enganche se carga DESPUÉS de app.js, para reutilizar su sesión',
      css.indexOf('movil-enganche.js') > css.indexOf('src="/app.js"'));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
