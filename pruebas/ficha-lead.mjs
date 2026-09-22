// La ficha del lead a página completa: node pruebas/ficha-lead.mjs
//
// El panel lateral se queda para mirar rápido y esta página es para trabajar el
// lead. Lo que se vigila aquí es lo que no se ve al mirarla funcionando: que no
// haya un token inventado, que la ruta exista de verdad, y que las acciones
// reutilicen las que ya había en vez de nacer duplicadas.
//
// Lo visual se mira en pruebas/banco-ficha-real.html, con el CSS y las
// funciones reales.

import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const bloque = js.slice(js.indexOf('// ══ FICHA DEL LEAD A PÁGINA COMPLETA ═'));
const css = (html.match(/\/\* ══ FICHA DEL LEAD A PÁGINA COMPLETA ═[\s\S]*?\n\/\* ── RESERVAS ──/) || [''])[0];

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nLas piezas están\n');
chk('hay CSS de la ficha', css.length > 1500, String(css.length));
chk('hay código de la ficha', bloque.length > 6000, String(bloque.length));
chk('y su contenedor', html.includes('id="crm-lead-view"'));

console.log('\nCada var(--x) y cada clase existen\n');
{
  const raiz = (html.match(/:root\{[\s\S]*?\n\}/) || [''])[0];
  const definidos = new Set([...raiz.matchAll(/--([a-z0-9-]+)\s*:/gi)].map(m => m[1]));
  const usados = [...new Set([...css.matchAll(/var\(--([a-z0-9-]+)/gi)].map(m => m[1]))];
  const huerfanos = usados.filter(v => !definidos.has(v));
  chk(`se usan ${usados.length} tokens y todos están definidos`, !huerfanos.length, huerfanos.join(', '));

  const definidas = new Set([...css.matchAll(/\.(lf-[a-z0-9-]+)/gi)].map(m => m[1]));
  const usadas = [...new Set([...bloque.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => m[1].split(/[\s'+]+/)).filter(c => c.startsWith('lf-')))];
  const huerfanas = usadas.filter(c => !definidas.has(c));
  chk(`se pintan ${usadas.length} clases lf- y todas tienen estilo`, !huerfanas.length, huerfanas.join(', '));

  const paths = js.slice(js.indexOf('const ICN_PATHS'), js.indexOf('const ICN_PATHS') + 8000);
  const hay = new Set([...paths.matchAll(/^\s{2}([a-zA-Z0-9_]+):\s*'/gm)].map(m => m[1]));
  // Los iconos del historial se piden por nombre; uno inventado se cae al de
  // por defecto —un gráfico de barras— sin avisar, y una llamada saldría con
  // cara de informe.
  const pedidos = [...new Set([...bloque.matchAll(/'([a-z]+)'\]/g)].map(m => m[1]))]
    .filter(k => /^(edit|chat|file|users|check|trend|sparkles|chart)$/.test(k));
  chk('los iconos del historial existen', pedidos.every(i => hay.has(i)),
      pedidos.filter(i => !hay.has(i)).join(', '));
}

console.log('\nEl panel sigue siendo el sitio para mirar rápido\n');
{
  chk('el panel conserva su botón de abrir la ficha',
      /onclick="crmAbrirFicha\(crmDetailLead && crmDetailLead\.id\)"/.test(html));
  chk('y la ficha cierra el panel al abrirse, en vez de dejar los dos',
      /crmCloseDetail\(\);\s*\n\s*crmSetView\('lead'\)/.test(bloque));
}

console.log('\nLa ficha tiene su dirección\n');
{
  // Sin ruta propia la ficha es un callejón: no se puede pegar en un chat ni
  // funciona el botón atrás del navegador.
  chk('la URL lleva el id del lead', /return .*'\/crm\/lead\/' \+ lfLead\.id/.test(js));
  chk('y el router reconoce esa forma', /\^\\\/crm\\\/lead\\\/\[0-9a-f-\]\{8,\}\$/.test(js));
  // Un enlace directo llega antes que los leads: sin esperar, la ficha se
  // abriría vacía y parecería que el lead no existe.
  chk('un enlace directo espera a que los leads carguen',
      /crmLeadsLoaded[\s\S]{0,200}crmAbrirFicha\(idLead\)/.test(js));
  chk('y se rinde en vez de girar para siempre', /vueltas > 60/.test(js));
  chk('«volver» regresa de donde vino, no siempre al tablero',
      /lfVistaAnterior/.test(bloque) && /if \(crmView !== 'lead'\) lfVistaAnterior = crmView;/.test(bloque));
}

console.log('\nNo se duplica lo que ya existía\n');
{
  // Escribir una segunda versión de «agendar» o «propuesta» garantiza que un
  // día arreglen una y se olviden de la otra.
  for (const fn of ['agnScheduleForLead', 'prpOpenForLead', 'crmSendLeadToConsultor',
                    'crmMoverProcesoAbrir', 'crmTareaHecha', 'crmChangeStage', 'crmSuggestNextAction']) {
    chk(`reutiliza ${fn}`, new RegExp(fn + '\\(').test(bloque) &&
        (js.match(new RegExp('function ' + fn + '\\(', 'g')) || []).length === 1);
  }
  chk('y les deja `crmDetailLead` apuntando al mismo lead',
      /crmDetailLead = lead;/.test(bloque));
  chk('el historial se trae una vez y lo pintan dos sitios distintos',
      /async function crmTraerActividades/.test(js) &&
      /const acts = await crmTraerActividades\(leadId\)/.test(js));
}

console.log('\nLo que no puede fallar callado\n');
{
  chk('un lead que no está en la vista lo dice, no abre una ficha vacía',
      /no está en la vista actual/.test(bloque));
  chk('sin actividad se dice, no se queda en blanco', /Sin actividad registrada/.test(bloque));
  chk('sin tareas también', /Ninguna tarea pendiente/.test(bloque));
  chk('y si fallan las conversaciones no se queda en «Cargando…» para siempre',
      /No se pudieron cargar/.test(bloque));
  // Los filtros salen de lo que HAY: una pestaña «Llamadas» siempre vacía
  // enseña a no usar las pestañas.
  chk('los filtros del historial salen de lo que hay',
      /const hay = new Set\(\(_crmActividadesLead \|\| \[\]\)\.map\(a => a\.type\)\)/.test(bloque));
  chk('un lead cerrado enseña por cuál de las dos puertas salió',
      /\.lf-cierre \.gana\.puesto/.test(css) && /puesta \? ' puesto' : ''/.test(bloque));
  chk('mover de proceso sigue contemplando al dueño',
      /!crmSoyMiembro \|\|[\s\S]{0,120}gestiona_equipo/.test(bloque));
}

console.log('\nCitas y propuestas en la tercera columna\n');
{
  // `/api/agenda?lead_id=` devuelve TODAS las actividades del lead, citas
  // incluidas. Antes caían en «Tareas» con casilla: una reserva que hizo el
  // cliente parecía un pendiente que uno se apuntó.
  chk('las citas se separan de las tareas por tipo', /a\.type === 'meeting'/.test(js));
  chk('y no cuentan como tareas pendientes',
      /filter\(t => !t\.done && !lfEsCita\(t\)\)/.test(bloque));
  chk('la cita no lleva casilla: no se «marca», se atiende',
      /class="lf-tarea cita[\s\S]{0,400}<\/div>/.test(bloque) &&
      !/class="lf-tarea cita[\s\S]{0,300}type="checkbox"/.test(bloque));
  chk('una cita que ya pasó y nadie cerró se ve como pendiente', /sin cerrar/.test(bloque));
  chk('se dice cuándo la reservó el propio cliente', /booking_token \? ' · la reservó el cliente'/.test(bloque));
  chk('las propuestas reutilizan los estados que ya existían',
      /PRP_STATUS_META\[p\.status\]/.test(bloque));
  chk('un borrador sin token no enlaza a una página que daría 404',
      /p\.public_token\s*\n?\s*\? '<a class="lf-prop"/.test(bloque));
  chk('y al crear una propuesta la ficha se entera', /lfCargarPropuestas\(lfLead\.id\)/.test(js.slice(js.indexOf('async function prpLoad'), js.indexOf('function prpRenderModal'))));
}

console.log('\nLo que va a pasar solo\n');
{
  // Es lo único de la ficha que no depende de que alguien lo escriba. Si se
  // pinta mal, se pinta creíble: nadie sospecha de una frase razonable.
  chk('se consulta qué tiene programado el lead',
      /fetchAuth\('\/api\/automations\?lead_id=' \+ encodeURIComponent\(leadId\)\)/.test(bloque));
  chk('y un fallo de la consulta se ve', /No se pudo consultar qué tiene programado/.test(bloque));
  // Apagar una automatización NO cancela sus trabajos en marcha: el motor los
  // cancela al tocarlos. Decir solo «apagada» haría creer lo contrario.
  chk('una automatización apagada avisa de que el paso sigue en cola',
      /apagada, pero este paso sigue en cola/.test(bloque));
  chk('el detalle del fallo se enseña entero, que es la causa',
      /h\.fallo && h\.detalle \?/.test(bloque));
  chk('lo que falló sale primero', /\(b\.fallo \? 1 : 0\) - \(a\.fallo \? 1 : 0\)/.test(bloque));
  // El servidor exige Marketing para parar. Ofrecer el botón para que lo
  // rechace después es peor que no ofrecerlo.
  chk('el botón de parar solo sale a quien el servidor dejará',
      /const puedeParar = lfPuedeMarketing\(\);/.test(bloque) &&
      /puedeParar\s*\n?\s*\? '<button class="lf-parar"/.test(bloque));
  chk('y el dueño, que no tiene _miPerfil, lo ve',
      /!crmSoyMiembro \|\|[\s\S]{0,180}modulos\.includes\('marketing'\)/.test(bloque));
  // El motor va cada 10 min: entre pintar y pulsar, el paso pudo salir ya.
  chk('tras intentar pararlo se recarga aunque haya fallado',
      /\} catch \(e\) \{[\s\S]{0,140}\}\s*\n\s*\/\/[\s\S]{0,200}lfCargarAutomatizaciones\(lfLead\.id\);\s*\n\}/.test(bloque));
  chk('sin nada programado ni hecho, la caja no se pinta',
      /if \(!pend\.length && !hechas\.length\) return lfGuardarCaja\(leadId, 'lf-autos', ''\)/.test(bloque));
}

console.log('\nLas cajas que vienen de la red no se pierden al repintar\n');
{
  // `lfPintar()` corre en cada clic de pestaña o de filtro. Si estas dos cajas
  // volvieran a nacer con un «Cargando…», se quedarían así para siempre:
  // nadie vuelve a pedirlas.
  chk('propuestas y conversaciones se guardan pintadas',
      /_lfPropsHtml \|\| '<div class="lf-vacio">Cargando…/.test(bloque) &&
      /_lfConvsHtml \|\| '<div class="lf-vacio">Cargando…/.test(bloque));
  chk('y las automatizaciones también', /'<div id="lf-autos">' \+ _lfAutosHtml \+ '<\/div>'/.test(bloque));
  chk('al cambiar de lead se vacían las tres, para no enseñar las del anterior',
      /_lfPropsHtml = '';\s*\n\s*_lfConvsHtml = '';\s*\n\s*_lfAutosHtml = '';/.test(bloque));
  chk('y lo que llega tarde de otro lead se descarta',
      /if \(lfLead && lfLead\.id !== leadId\) return;/.test(bloque));
  // Decir «ninguna» cuando la consulta falló es peor que no decir nada: se
  // vuelve a redactar una propuesta que ya se había mandado.
  // Las tres cajas que salen a la red: propuestas, conversaciones y
  // automatizaciones. Ninguna puede tragarse un 500 y pintar un vacío.
  chk('un fallo de red no se confunde con «no hay nada», en las tres',
      (bloque.match(/if \(!r\.ok\) throw new Error\('HTTP ' \+ r\.status\)/g) || []).length === 3);
}

console.log('\nEn el móvil no se aprietan tres columnas\n');
{
  chk('hay pestañas', /\.lf-pestanas\{display:none/.test(css) && /max-width:820px\)\{[\s\S]{0,120}\.lf-pestanas\{display:flex\}/.test(css));
  chk('y el código las pinta', /lfPestana/.test(bloque));
  // Con `flex:1` los pasos se comprimían por debajo de su texto y los rótulos
  // se montaban unos sobre otros. Medido en el banco: 0 solapes.
  chk('el embudo se desplaza en vez de encogerse',
      /\.lf-paso\{flex:0 0 auto;min-width:0\}/.test(css));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
