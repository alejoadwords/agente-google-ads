// La cabecera en el teléfono: node pruebas/cabecera-telefono.mjs
//
// En cuentas de agencia la cabecera lleva ocho cosas: menú, logo, selector de
// cliente, tema, campana, soporte, avatar y «salir». En un teléfono no caben
// todas a su tamaño natural, y alguien tiene que ceder.
//
// Cedía el que no debía. Los iconos y «salir» son cajas de tamaño fijo con
// texto dentro: al dejarlos encoger, el navegador les quitaba unos píxeles a
// cada uno —el botón del tema se quedaba en 16 de los 30 que mide— y «salir»
// se salía igual por el borde derecho. Quien tiene que ceder es el selector de
// cliente, que para eso corta el nombre con puntos suspensivos.
//
// Se mide en un navegador de verdad a los anchos que existen. Un desbordamiento
// de seis píxeles no se ve leyendo CSS, y en el escritorio no pasa nunca.

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

const INDEX = new URL('../public/index.html', import.meta.url).pathname;
const ANCHOS = [430, 390, 360, 320];   // Pro Max, iPhone normal, Android chico, SE

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

const nav = await chromium.launch();

async function medir(ancho) {
  const p = await nav.newPage({ viewport: { width: ancho, height: 200 } });
  await p.route('**/*.js', (r) => r.abort());
  await p.goto('file://' + INDEX, { waitUntil: 'domcontentloaded' });
  const r = await p.evaluate(() => {
    const g = (id) => document.getElementById(id);
    // Sin JS se quedan visibles los paneles que normalmente se esconden.
    document.querySelectorAll('*').forEach((e) => {
      const c = getComputedStyle(e);
      if (c.position === 'fixed' && parseFloat(c.zIndex || 0) > 100) e.style.display = 'none';
    });
    // Una cuenta de agencia, que es el caso apretado: la que lleva selector de
    // cliente. Con nombre largo, que es lo que lo destapó.
    g('hdr-client-switch').style.display = 'block';
    g('hdr-client-name').textContent = 'Certain & Pezzano';
    g('hdr-avatar').textContent = 'MG';
    g('alerts-btn').style.display = 'flex';
    g('sop-btn').style.display = 'flex';

    const hdr = document.querySelector('.hdr');
    const fuera = [];
    const recorrer = (el) => {
      for (const h of el.children) {
        const s = getComputedStyle(h);
        if (s.display === 'none') continue;
        const b = h.getBoundingClientRect();
        if (b.right > window.innerWidth + 0.5 || b.left < -0.5) {
          fuera.push((h.id || h.className || h.tagName).toString().slice(0, 24) + '@' + Math.round(b.right));
        }
        recorrer(h);
      }
    };
    recorrer(hdr);
    const caja = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    return {
      fuera,
      salir: Math.round(caja('.hdr-signout').right),
      tema: Math.round(caja('#theme-toggle-btn').width),
      menu: Math.round(caja('.mob-menu-btn').width),
      cliente: Math.round(caja('#hdr-client-switch').width),
      ventana: window.innerWidth,
    };
  });
  await p.close();
  return r;
}

for (const w of ANCHOS) {
  console.log(`\nA ${w} px de ancho`);
  const r = await medir(w);
  ok(r.salir <= r.ventana, `«salir» cabe entero`, `acaba en ${r.salir} de ${r.ventana}`);
  ok(r.fuera.length === 0, 'nada de la cabecera se sale por los bordes', r.fuera.join(', '));
  // Si el botón del tema mide menos de lo suyo, es que los iconos están
  // encogiendo: el desbordamiento vuelve en cuanto el nombre sea más largo.
  ok(r.tema >= 28, 'el botón del tema conserva su tamaño, no lo aplastan', r.tema + 'px');
  ok(r.menu >= 32, 'y el botón de menú tampoco se encoge', r.menu + 'px');
  // Y el que cede es el selector, que sabe cortar el nombre.
  ok(r.cliente > 0, 'el selector de cliente sigue existiendo aunque ceda el ancho', r.cliente + 'px');
}

// A 320 px el selector se queda en el icono. Es la degradación correcta —el
// nombre se corta, no se desborda— y conviene que esté escrito para que nadie
// lo «arregle» poniéndole un ancho mínimo, que devolvería el desbordamiento.
console.log('\nEl selector es el que cede');
const ancho = await medir(430), estrecho = await medir(320);
ok(estrecho.cliente < ancho.cliente,
   'cuanto más estrecha la pantalla, más cede el selector de cliente',
   `430→${ancho.cliente}px, 320→${estrecho.cliente}px`);

await nav.close();
console.log('');
process.exit(mal ? 1 : 0);
