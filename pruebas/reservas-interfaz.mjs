// La interfaz de Reservas: node pruebas/reservas-interfaz.mjs
//
// Un token inventado NO falla: el navegador se encoge de hombros y el elemento
// sale sin color. Una clase inventada tampoco. Por eso se comprueban aquí, una
// por una, contra el CSS de verdad.

import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

// El bloque de Reservas, tal cual quedó en index.html.
const css = (html.match(/\/\* ── RESERVAS ─[\s\S]*?\n\.agency-agent-btn\{/) || [''])[0];
// Y el de app.js, desde la cabecera del módulo hasta el final del archivo.
const bloque = js.slice(js.indexOf('// ══ RESERVAS ═'));

console.log('\nEl bloque existe\n');
chk('hay CSS de reservas en index.html', css.length > 500, String(css.length));
chk('hay código de reservas en app.js', bloque.length > 5000, String(bloque.length));
chk('la vista tiene su contenedor', html.includes('id="crm-reservas-view"'));

console.log('\nCada var(--x) existe\n');
{
  const raiz = (html.match(/:root\{[\s\S]*?\n\}/) || [''])[0];
  const definidos = new Set([...raiz.matchAll(/--([a-z0-9-]+)\s*:/gi)].map(m => m[1]));
  const usados = [...new Set([...css.matchAll(/var\(--([a-z0-9-]+)/gi)].map(m => m[1]))];
  const huerfanos = usados.filter(v => !definidos.has(v));
  chk(`se usan ${usados.length} tokens y todos están definidos`,
      huerfanos.length === 0, huerfanos.join(', '));
  // `color:#fff` sobre el degradado de marca es la convención de la casa (la
  // usa `.auto-ico`, idéntica): el blanco ahí NO debe seguir al tema, porque el
  // fondo es un azul fijo. Cualquier OTRO hex sí sería un color inventado.
  const hexSueltos = [...css.replace(/rgba\([^)]*\)/g, '').matchAll(/:\s*(#[0-9a-f]{3,8})\b/gi)]
    .map(m => m[1].toLowerCase())
    .filter(h => h !== '#fff' && h !== '#ffffff');
  chk('no hay ningún color inventado en el CSS del módulo',
      hexSueltos.length === 0, hexSueltos.join(', '));
}

console.log('\nCada clase que pinta el código existe en el CSS\n');
{
  // Las clases propias del módulo llevan el prefijo rsv-.
  const definidas = new Set([...css.matchAll(/\.(rsv-[a-z0-9-]+)/gi)].map(m => m[1]));
  const usadas = [...new Set([...bloque.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => m[1].split(/[\s']+/))
    .filter(c => c.startsWith('rsv-')))];
  const huerfanas = usadas.filter(c => !definidas.has(c));
  chk(`se pintan ${usadas.length} clases rsv- y todas tienen estilo`,
      huerfanas.length === 0, huerfanas.join(', '));
}

console.log('\nLas piezas prestadas del sistema de diseño existen\n');
{
  for (const clase of ['btn-pri', 'btn-ghost', 'toggle', 'auto-input',
                       'auto-modal-overlay', 'auto-modal', 'auto-modal-head', 'empty-agua']) {
    chk(`.${clase}`, new RegExp('\\.' + clase + '[\\s,{.:]').test(html));
  }
  // Se usan por función, no por clase: si cambian de nombre, esto avisa.
  for (const fn of ['emptyAgua(', 'icn(', 'showToast(', 'fetchAuth(', 'esc(', 'crmAmbitoCliente(']) {
    chk(`${fn}…) sigue existiendo`, js.includes('function ' + fn) || js.includes('async function ' + fn));
  }
  // Los iconos se piden por nombre y uno inventado se cae al de por defecto
  // (un gráfico de barras) sin avisar: quedaría una barbería con un gráfico.
  const paths = js.slice(js.indexOf('const ICN_PATHS'), js.indexOf('const ICN_PATHS') + 8000);
  const disponibles = new Set([...paths.matchAll(/^\s{2}([a-zA-Z0-9_]+):\s*'/gm)].map(m => m[1]));
  const pedidos = [...new Set([...bloque.matchAll(/icn\('([a-z0-9_]+)'/gi)].map(m => m[1]))];
  const inventados = pedidos.filter(i => !disponibles.has(i));
  chk(`los ${pedidos.length} iconos que se piden existen`, inventados.length === 0, inventados.join(', '));
}

console.log('\nLo que no se puede perder de vista\n');
{
  chk('la carga que falla se ve, con su motivo y su reintento',
      /rsvError/.test(bloque) && /Reintentar/.test(bloque) && /rsv-fallo/.test(bloque));
  chk('un servicio sin nadie que lo preste se señala',
      /Sin nadie asignado/.test(bloque));
  chk('una página encendida donde no se puede reservar nada se señala',
      /no se puede reservar nada/.test(bloque) && /ninguno tiene a nadie que lo preste/.test(bloque));
  chk('quien no puede configurar ve por qué, no un botón que no hace nada',
      /solo el administrador de la cuenta la cambia/i.test(bloque));
  chk('el horario se guarda a propósito, no en cada tecla',
      /rsvGuardarHorario/.test(bloque) && /rsvHorarioBorrador/.test(bloque));
  chk('y se avisa antes de mandar un tramo que el servidor descartaría',
      /la hora de cierre tiene que ir después/.test(bloque));
  chk('la vista se cuelga envolviendo crmSetView, sin tocarlo',
      /const _prev = crmSetView;/.test(bloque));
  // En MARKETING: la página de reservas es un canal de captación, como los
  // formularios. Registrarla solo en NAV_TABS no basta — sin ruta propia la
  // URL se queda en /crm y un enlace directo no lleva a ninguna parte.
  chk('la pestaña queda registrada en el menú de Marketing',
      /NAV_TABS\.marketing\.push\('reservas'\)/.test(bloque) && /NAV_TAB_LABELS\.reservas/.test(bloque));
  chk('y no en el de CRM', !/NAV_TABS\.crm\.push\('reservas'\)/.test(bloque));
  chk('tiene su propia URL', /reservas: '\/marketing\/reservas'/.test(js));
  chk('y su título de pestaña del navegador', /reservas: 'Reservas' \}/.test(js));
  chk('todas las llamadas del módulo van con sesión',
      !/[^h]fetch\(\s*['"`]\/api\//.test(bloque), 'hay un fetch() sin fetchAuth');
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
