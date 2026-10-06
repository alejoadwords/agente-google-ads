// Nombres con apóstrofe en los onclick: node pruebas/handlers-con-apostrofe.mjs
//
// Muchos botones se arman como onclick="f('${esc(nombre)}')". esc() cambia ' por
// &#39;, pero el navegador decodifica la entidad ANTES de correr el handler, así
// que con «D'Angelo» el código queda f('D'Angelo'), revienta con SyntaxError y
// el botón no hace nada — sin aviso, que es lo peor. escJsAttr() arma un literal
// JS de verdad con JSON.stringify y luego lo escapa para el atributo.
//
// Se prueba en un navegador porque el fallo está justo en la decodificación del
// atributo: leyendo el fichero no se ve. Tres partes:
//   1. escJsAttr con nombres feos, en las dos formas en que se arma HTML aquí
//      (concatenación y template literal), más el patrón viejo como control:
//      si el control no falla, la prueba no está midiendo nada.
//   2. Renderizadores reales de app.js con un nombre feo: se pinta, se hace
//      clic y se comprueba que la función recibió el nombre exacto.
//   3. Guardia estática: que no vuelva un esc() con nombre entre comillas
//      simples dentro de un handler.

let chromium;
try {
  ({ chromium } = await import('../node_modules/playwright/index.mjs'));
} catch {
  console.log('OMITIDA: falta playwright (npm i -D playwright && npx playwright install chromium)');
  process.exit(75);
}
import { readFileSync, existsSync } from 'node:fs';

const PUB = new URL('../public', import.meta.url).pathname;
const APP = readFileSync(PUB + '/app.js', 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

const FEOS = [
  "D'Angelo",
  "Pinto's Bar",
  'Dice "hola"',
  'termina en barra\\',
  'dos\nlíneas',
  "todo junto: O'Brien \"VIP\" \\ <b>&amp;</b>\r\n</script>",
];

// index.html carga sus scripts con rutas absolutas (/app.js, /prompts/…), así
// que se sirve public/ desde un dominio de mentira. Todo lo de fuera se corta:
// Clerk y las CDN no hacen falta para pintar un botón.
const nav = await chromium.launch();
const p = await nav.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
await p.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.host !== 'acuarius.test') return r.abort();
  const f = PUB + (u.pathname === '/' ? '/index.html' : u.pathname);
  if (!existsSync(f)) return r.fulfill({ status: 404, body: '' });
  r.fulfill({ body: readFileSync(f), contentType: f.endsWith('.js') ? 'text/javascript' : 'text/html' });
});
await p.goto('http://acuarius.test/', { waitUntil: 'load' });
ok(await p.evaluate(() => typeof escJsAttr === 'function'), 'app.js carga y expone escJsAttr');
const previos = errores.length;

// ── 1. El helper, en las dos formas ───────────────────────────────────────
console.log('\n1. escJsAttr');
for (const nombre of FEOS) {
  const r = await p.evaluate((nombre) => {
    const caja = document.createElement('div');
    document.body.appendChild(caja);
    const recibido = [];
    // b2 lleva el nombre de segundo argumento, como etBorrar(id, nombre, n).
    window.__espia = (...a) => recibido.push(a.length > 1 ? a[1] : a[0]);
    caja.innerHTML =
      '<button id="b1" onclick="__espia(' + escJsAttr(nombre) + ')">a</button>' +
      `<button id="b2" onclick="__espia('x',${escJsAttr(nombre)},3)">b</button>` +
      // El patrón de antes, como control.
      '<button id="b3" onclick="__espia(\'' + esc(nombre) + '\')">c</button>';
    let errViejo = null;
    window.onerror = (m) => { errViejo = String(m); return true; };
    caja.querySelector('#b1').click();
    caja.querySelector('#b2').click();
    caja.querySelector('#b3').click();
    window.onerror = null;
    caja.remove();
    return { recibido, errViejo };
  }, nombre);
  const vis = JSON.stringify(nombre);
  ok(r.recibido[0] === nombre, 'concatenación entrega ' + vis, JSON.stringify(r.recibido[0]));
  ok(r.recibido[1] === nombre, 'template literal entrega ' + vis, JSON.stringify(r.recibido[1]));
  // Solo los que llevan ', \ o salto de línea rompen el patrón viejo; las
  // comillas dobles sí sobrevivían porque esc() las deja como &quot;.
  if (/['\\\n]/.test(nombre)) {
    ok(r.errViejo !== null || r.recibido[2] !== nombre, 'control: el patrón viejo falla con ' + vis);
  }
}

// ── 2. Renderizadores reales ──────────────────────────────────────────────
console.log('\n2. Botones reales de app.js');
const NOMBRE = "O'Brien \"VIP\" \\ fin\nlínea";

// Cada caso pinta con la función de verdad, cambia la función de destino por
// un espía, hace clic y devuelve lo que llegó.
async function caso(titulo, cuerpo) {
  const r = await p.evaluate(({ cuerpo, NOMBRE }) => {
    const llegado = [];
    let errClic = null;
    window.onerror = (m) => { errClic = String(m); return true; };
    try {
      new Function('NOMBRE', 'llegado', cuerpo)(NOMBRE, llegado);
    } catch (e) { errClic = 'preparación: ' + e.message; }
    window.onerror = null;
    return { llegado, errClic };
  }, { cuerpo, NOMBRE });
  ok(!r.errClic && r.llegado.includes(NOMBRE), titulo, r.errClic || JSON.stringify(r.llegado));
}

await caso('Filtro de etiquetas del pipeline (crmToggleTagFilter)', `
  crmTags = [{ name: NOMBRE }]; crmLeads = []; crmFilterTags = [];
  window.crmToggleTagFilter = (n) => llegado.push(n);
  crmRenderTagFilter();
  document.querySelector('#crm-tag-filter .tag-filter-chip').click();
`);
await caso('Dato manual del dashboard (dashRemoveManual)', `
  dashManualData = { [NOMBRE]: '1' };
  window.dashRemoveManual = (k) => llegado.push(k);
  dashRenderManualTags();
  document.querySelector('#dash-manual-tags .dash-manual-tag button').click();
`);
await caso('Sugerencias del agente (qSend)', `
  if (!document.getElementById('chat-area')) {
    const a = document.createElement('div'); a.id = 'chat-area'; document.body.appendChild(a);
  }
  window.qSend = (t) => llegado.push(t);
  renderSugerencias([NOMBRE]);
  document.querySelector('#sugerencias-wrap button').click();
`);
await caso('Etiqueta excluida de una campaña (cmpWExcluirQuitar)', `
  const c = document.createElement('div'); c.id = 'cmpw-excluir'; document.body.appendChild(c);
  _cmpW = { exclude_list_ids: [], exclude_tags: [NOMBRE] }; _cmpLists = [];
  window.cmpWExcluirQuitar = (tipo, v) => llegado.push(v);
  cmpWExcluirPintar();
  c.querySelector('span[onclick]').click();
`);
// La edición en línea de la ficha. Su onkeydown llevaba JSON.stringify a secas:
// las comillas dobles cortaban el atributo en «this.value=» y CADA tecla lanzaba
// «Unexpected token '}'» (error_log, 28-09). Enter y Escape no hacían nada.
await caso('Escape en un campo de la ficha deja el valor como estaba (lfEditarCampo)', `
  // Un <input> de una línea descarta los saltos de línea por sí solo: el
  // valor de prueba va sin ellos para medir el handler y no al navegador.
  const valor = NOMBRE.split(String.fromCharCode(10)).join(' ');
  lfLead = { id: 'x', email: valor };
  window.lfGuardarCampo = () => {};
  const celda = document.createElement('div'); document.body.appendChild(celda);
  lfEditarCampo('email', { currentTarget: celda });
  const inp = celda.querySelector('input');
  inp.value = 'otra cosa';
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  if (inp.value === valor) llegado.push(NOMBRE);
  else llegado.push(inp.value);
  celda.remove();
`);

ok(errores.length === previos, 'ningún error de página durante la prueba', errores.slice(previos).join(' | '));
await nav.close();

// ── 3. Guardia estática ───────────────────────────────────────────────────
// Un nombre o texto libre entre comillas simples dentro de un handler. Los ids
// y las claves fijas no importan: no llevan apóstrofes.
console.log('\n3. Sin esc() de texto libre entre comillas en handlers');
const LIBRE = /(name|nombre|title|titulo|label|client_name|q\.q)\b/;
const sospechosos = [];
APP.split('\n').forEach((linea, i) => {
  if (!/\son[a-z]+=/.test(linea)) return;
  const usos = [
    ...linea.matchAll(/\\'' ?\+ ?esc\(([^)]*)\)/g),
    ...linea.matchAll(/'\$\{esc\(([^)]*)\)/g),
  ];
  for (const m of usos) if (LIBRE.test(m[1])) sospechosos.push((i + 1) + ': esc(' + m[1] + ')');
});
ok(!sospechosos.length, 'ningún handler mete un nombre con esc() entre comillas simples',
  '\n      ' + sospechosos.join('\n      '));

// JSON.stringify a secas dentro de on…="…": sus comillas dobles cierran el
// atributo y el handler queda a medias, con CUALQUIER valor, no solo con los
// raros. Pasó en el copiloto, en la ficha y en seis botones de Pauta. Se mira
// también la línea anterior, porque la concatenación suele partirse en dos.
console.log('\n4. Sin JSON.stringify crudo dentro de un handler');
const crudos = [];
for (const f of ['app.js', 'movil-app.js']) {
  const L = readFileSync(PUB + '/' + f, 'utf8').split('\n');
  L.forEach((l, i) => {
    if (!l.includes('JSON.stringify(')) return;
    const ctx = (i ? L[i - 1] : '') + '\n' + l;
    if (/on[a-z]+=\\?"/.test(ctx) && !/esc\(JSON\.stringify|&quot;/.test(l)) crudos.push(f + ':' + (i + 1));
  });
}
ok(!crudos.length, 'ningún handler lleva JSON.stringify sin escapar (usar escJsAttr)', crudos.join(', '));

console.log(mal ? `\n${mal} fallo(s)` : '\nTodo bien');
process.exit(mal ? 1 : 0);
