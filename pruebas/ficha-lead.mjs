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

console.log('\nUn clic en el lead abre la ficha\n');
{
  // Era el panel, y no es lo que se espera: se hace clic en un lead para
  // trabajarlo, no para asomarse. El panel se queda para donde el lead llega
  // suelto —inbox, ⌘K, voz, un aviso de otro cliente— que es donde de verdad
  // sirve mirar sin salir de lo que estás haciendo.
  chk('la tarjeta del tablero abre la ficha',
      /card\.addEventListener\('click', \(\) => crmAbrirFicha\(card\.dataset\.id\)\)/.test(js));
  chk('y la fila de la lista también',
      /<tr onclick="crmAbrirFicha\(/.test(js));
  // Los botones de la tarjeta —llamar, WhatsApp, email, nota— tienen que
  // seguir parando la propagación: ahora un escape te saca de la vista, no
  // solo te abre un panel.
  chk('los botones de la tarjeta no arrastran a la ficha',
      ['Llamar', 'WhatsApp', 'Email'].every(b =>
        new RegExp('crm-card-act-btn[^>]*onclick="event\\.stopPropagation\\(\\)[^>]*' + b).test(js)));
  chk('el panel sigue existiendo para los leads sueltos',
      /async function crmOpenDetail\(leadId, leadSuelto\)/.test(js) &&
      /crmOpenDetail\(id, lead\)/.test(js));
}

console.log('\nEl panel sigue siendo el sitio para mirar rápido\n');
{
  chk('el panel conserva su botón de abrir la ficha',
      /onclick="crmAbrirFicha\(crmDetailLead && crmDetailLead\.id\)"/.test(html));
  // El cierre pasó ARRIBA del todo a propósito: `crmCloseDetail()` anula
  // `crmDetailLead`, así que tiene que correr antes de apuntarlo al lead. El
  // orden lo vigila pruebas/ficha-acciones.mjs, que lo ejecuta.
  chk('y la ficha cierra el panel al abrirse, en vez de dejar los dos',
      /crmCloseDetail\(\);\s*\n\s*crmDetailLead = lead;/.test(bloque) &&
      /crmSetView\('lead'\);/.test(bloque));
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

console.log('\nQué envíos masivos le tocaron\n');
{
  chk('se consultan sus campañas',
      /fetchAuth\('\/api\/campaigns\?lead_id=' \+ encodeURIComponent\(leadId\)\)/.test(bloque));
  chk('y un fallo de la consulta se ve', /No se pudo consultar qué envíos le tocaron/.test(bloque));
  // Un rebote duro saca la dirección de TODAS las campañas siguientes, y hasta
  // ahora no se decía en ninguna parte.
  chk('una dirección quemada se avisa en rojo',
      /class="lf-quemado"/.test(bloque) && /Ya no recibirá campañas en esta dirección/.test(bloque));
  chk('y se distingue el rebote de la queja de spam',
      /d\.quemado === 'spam'/.test(bloque));
  // «No se le envió» a secas no deja hacer nada; el motivo sí.
  chk('el motivo de un envío que no salió se enseña', /e\.motivo \? ' · ' \+ esc\(e\.motivo\)/.test(bloque));
  chk('la reacción manda sobre el estado', /esc\(e\.reaccion \|\| e\.estado\)/.test(bloque));
  chk('sin envíos ni dirección quemada, la caja no se pinta',
      /if \(!envios\.length && !d\.quemado\) return lfGuardarCaja\(leadId, 'lf-camp', ''\)/.test(bloque));
}

console.log('\nQué contestó en la encuesta\n');
{
  chk('se consulta su encuesta',
      /fetchAuth\('\/api\/nps\?lead_id=' \+ encodeURIComponent\(leadId\)\)/.test(bloque));
  chk('y un fallo de la consulta se ve', /No se pudo consultar la encuesta/.test(bloque));
  // El color es el mensaje: un detractor se ve antes de leerlo, y es lo que
  // cambia cómo se encara la llamada.
  chk('la categoría pinta la caja',
      /class="lf-nota ' \+ esc\(e\.clave\)/.test(bloque) &&
      /\.lf-nota\.detractor\{border-color:var\(--danger\)/.test(css) &&
      /\.lf-nota\.promotor\{border-color:var\(--success\)/.test(css));
  // Un 4 solo no dice qué arreglar; lo que escribió, sí.
  chk('lo que escribió se enseña', /e\.comentario \? '<div class="lf-cita-nps">/.test(bloque));
  // Una encuesta enviada y sin contestar puede ser un detractor callado.
  chk('enviada y sin responder también se dice', /todavía sin responder/.test(bloque));
  chk('sin encuesta ni pendiente, la caja no se pinta',
      /if \(!e && !d\.pendiente\) return lfGuardarCaja\(leadId, 'lf-nps', ''\)/.test(bloque));
}

console.log('\nLas cajas que vienen de la red no se pierden al repintar\n');
{
  // `lfPintar()` corre en cada clic de pestaña o de filtro. Si estas dos cajas
  // volvieran a nacer con un «Cargando…», se quedarían así para siempre:
  // nadie vuelve a pedirlas.
  chk('propuestas y conversaciones se guardan pintadas',
      /_lfPropsHtml \|\| '<div class="lf-vacio">Cargando…/.test(bloque) &&
      /_lfConvsHtml \|\| '<div class="lf-vacio">Cargando…/.test(bloque));
  chk('las automatizaciones, las campañas y la encuesta también',
      /'<div id="lf-autos">' \+ _lfAutosHtml \+ '<\/div>'/.test(bloque) &&
      /'<div id="lf-camp">' \+ _lfCampHtml \+ '<\/div>'/.test(bloque) &&
      /'<div id="lf-nps">' \+ _lfNpsHtml \+ '<\/div>'/.test(bloque));
  chk('al cambiar de lead se vacían las cinco, para no enseñar las del anterior',
      /_lfPropsHtml = '';\s*\n\s*_lfConvsHtml = '';\s*\n\s*_lfAutosHtml = '';\s*\n\s*_lfCampHtml = '';\s*\n\s*_lfNpsHtml = '';/.test(bloque));
  chk('y lo que llega tarde de otro lead se descarta',
      /if \(lfLead && lfLead\.id !== leadId\) return;/.test(bloque));
  // Decir «ninguna» cuando la consulta falló es peor que no decir nada: se
  // vuelve a redactar una propuesta que ya se había mandado.
  // Las cinco cajas que salen a la red: propuestas, conversaciones,
  // automatizaciones, campañas y satisfacción. Ninguna puede tragarse un 500 y
  // pintar un vacío: decir «no hay nada» cuando la consulta falló es peor que
  // callar.
  chk('un fallo de red no se confunde con «no hay nada», en las cinco',
      (bloque.match(/if \(!r\.ok\) throw new Error\('HTTP ' \+ r\.status\)/g) || []).length === 5);
}

console.log('\nEn el móvil no se aprietan tres columnas\n');
{
  chk('hay pestañas', /\.lf-pestanas\{display:none/.test(css) && /max-width:820px\)\{[\s\S]{0,120}\.lf-pestanas\{display:flex\}/.test(css));
  chk('y el código las pinta', /lfPestana/.test(bloque));
  // Con `flex:1` los pasos se comprimían por debajo de su texto y los rótulos
  // se montaban unos sobre otros. Medido en el banco: 0 solapes.
  chk('el embudo se desplaza en vez de encogerse',
      /\.lf-paso\{flex:0 0 auto;min-width:0\}/.test(css));
  // Arrastrar el embudo lo estropea como barra de progreso: deja de verse de
  // un vistazo por dónde va, y las últimas etapas quedan escondidas. Con nueve
  // etapas de nombre largo caben en dos líneas.
  chk('cuando no cabe, el embudo se reparte en líneas, no se arrastra',
      /\.lf-pasos\{[^}]*flex-wrap:wrap\}/.test(css) && !/\.lf-pasos\{[^}]*overflow-x:auto/.test(css));
  // Una URL pegada no tiene dónde partir. Las tareas de una inmobiliaria la
  // traen dentro del texto, y se salían del recuadro: medido en el banco con
  // la tarea real, 0 elementos por fuera.
  chk('un enlace pegado parte en vez de salirse del recuadro',
      /\.lf-tarea,\.lf-auto,\.lf-envio,\.lf-prop,\.lf-log,\.lf-nota,\.lf-cita-nps,\.lf-quemado\{overflow-wrap:anywhere\}/.test(css) &&
      /\.crm-d-tarea-tit\{[^}]*overflow-wrap:anywhere\}/.test(html));
  // Cajas blancas sobre fondo blanco se desdibujan y las tres columnas se leen
  // como una lista larga.
  chk('las cajas se apoyan en un fondo tenue', /#crm-lead-view\{background:var\(--bg-subtle\)\}/.test(css));
  // Y en el escritorio, lo mismo por otra vía: con `min-width:120px` un paso
  // se encogía por debajo de su texto y «Presentación de propuesta» se montaba
  // encima de «Cita de inmueble». Medido en el banco con 11 etapas: se rompía
  // de 1400px para abajo, que es lo que mide la tira con la barra lateral.
  chk('ningún paso se encoge por debajo de su rótulo',
      /\.lf-paso\{display:flex;align-items:center;gap:0;flex:1 1 auto;min-width:max-content\}/.test(css));
  // Los botones de cierre vivían DENTRO de la tira de etapas. Cuando la tira
  // se desplazaba quedaban fuera de la pantalla (x 637→783 en un móvil de
  // 375); ahora que se reparte en líneas, bajarían con las etapas a la
  // segunda. En los dos casos el arreglo es el mismo: están fuera de la tira.
  chk('«Ganado» y «Perdido» quedan fuera de la tira de etapas',
      /'<div class="lf-embudo">' \+\s*\n?\s*'<div class="lf-pasos">'/.test(bloque) &&
      /<\/div>' \+\s*\n\s*'<div class="lf-cierre">'/.test(bloque));
  chk('y en el móvil bajan a su propia línea, para no comerse la tira',
      /\.lf-embudo\{flex-wrap:wrap/.test(css) && /\.lf-pasos\{flex:1 1 100%\}/.test(css));
  // Un ítem flexible sin `min-width:0` no baja de su ancho de contenido. En
  // «Qué ha pasado» la caja del historial salía 44px por fuera de una pantalla
  // de 375 y TODA la página se desplazaba en horizontal.
  chk('las columnas del móvil pueden encogerse',
      /\.lf-col\.visible > \*\{flex:1 1 100%;min-width:0\}/.test(css) &&
      /\.lf-col\.tercera > \*\{flex:1 1 280px;min-width:0\}/.test(css));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
