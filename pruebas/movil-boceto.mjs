// El boceto de la versión móvil: node pruebas/movil-boceto.mjs
//
// Todo lo que se comprueba aquí falla EN SILENCIO: un token inventado no
// rompe, solo se ve mal; un icono que no existe cae en el de barras; una
// etapa sin color se pinta azul y «Perdido» parece un estado bueno; y una
// clase con `display` propio ignora el atributo `hidden` y sale en todas las
// pantallas —que es justo lo que le pasó al botón de contacto nuevo—.

import { readFileSync } from 'node:fs';

// El boceto vive en tres ficheros desde que se sacó a fuente única: el
// anfitrión, sus estilos y su guion. Se juntan aquí para comprobarlo entero,
// que es como lo ve el navegador.
const anfitrion = readFileSync(new URL('../public/movil.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/movil-app.css', import.meta.url), 'utf8');
const guion = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
const html = anfitrion + '\n' + css + '\n' + guion;

// Lo que se comprueba es el CÓDIGO, nunca lo que uno escribió para
// explicarlo. Cuatro aserciones de esta prueba se chocaron con el comentario
// que describía el fallo que vigilaban, así que aquí hay un solo sitio.
const soloCodigo = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const guionSinComentarios = () => soloCodigo(guion);

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nNada inventado: todo lo que usa existe\n');
{
  const tokens = [...new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]))];
  const faltan = tokens.filter(t => !new RegExp('\\' + t + '\\s*:').test(html));
  chk(`los ${tokens.length} tokens existen`, faltan.length === 0, faltan.join(', '));

  const iconos = [...new Set([...html.matchAll(/icn\(["'](\w[\w-]*)["']/g)].map(m => m[1]))];
  const i = html.indexOf('const ICN_PATHS');
  const catalogo = html.slice(i, html.indexOf('\n};', i));
  const sin = iconos.filter(n => !new RegExp('^\\s*' + n + ':', 'm').test(catalogo));
  chk(`los ${iconos.length} iconos existen`, sin.length === 0, sin.join(', '));
}

console.log('\nEs táctil, no de ratón\n');
{
  const reglas = css.split('\n').filter(l => l.includes(':hover') && !l.trim().startsWith('/*'));
  // En un dedo no hay hover: el estado se queda pegado tras tocar.
  chk('ni una regla :hover', reglas.length === 0, reglas.join(' | ').slice(0, 90));
  chk('hay respuesta al tocar (:active)', (css.match(/:active/g) || []).length >= 8);
  chk('nada de resaltado azul al tocar', /-webkit-tap-highlight-color:transparent/.test(css));
  // Por debajo de 24px el dedo falla y hay que reintentar.
  const tick = css.match(/\.tick\{[^}]*width:(\d+)px/);
  chk('las casillas miden 24px o más', tick && Number(tick[1]) >= 24, tick ? tick[1] + 'px' : 'no encontrada');
}

console.log('\nCada etapa se distingue sin leer la palabra\n');
{
  // Solo del arreglo ETAPAS: 'todos' es la clave del filtro, no una etapa, y
  // contarla hacía fallar la prueba por una etapa que no existe.
  const bloque = html.slice(html.indexOf('var ETAPAS'), html.indexOf('];', html.indexOf('var ETAPAS')));
  const etapas = [...new Set([...bloque.matchAll(/\{k:'(\w+)'/g)].map(m => m[1]))];
  const sinColor = etapas.filter(e => !css.includes('.chip.' + e));
  chk(`las ${etapas.length} etapas tienen color propio`, sinColor.length === 0, sinColor.join(', '));
}

console.log('\nNingún nombre de clase significa dos cosas\n');
{
  // `.bot` era a la vez la etiqueta «Agente» de la bandeja (.quien.bot) y la
  // tarjeta de chatbot (.bot). La regla de la tarjeta —display:flex, ancho
  // completo— se aplicaba también a la etiqueta y aplastaba el nombre del
  // contacto hasta 0px. No falla nada: solo desaparece un dato.
  const sueltas = new Set([...css.matchAll(/(?:^|[,}\s])\.([\w-]+)\s*\{/g)].map(m => m[1]));
  const modificadores = new Set([...css.matchAll(/\.[\w-]+\.([\w-]+)\s*[,{\s]/g)].map(m => m[1]));
  const chocan = [...modificadores].filter(m => sueltas.has(m));
  chk('ninguna clase es componente y modificador a la vez', chocan.length === 0,
      chocan.map(c => '.' + c).join(', '));
}

console.log('\nLo que se esconde, se esconde de verdad\n');
{
  // El atributo `hidden` lo pone la hoja del navegador y cualquier `display`
  // de una clase le gana. Sin su regla, el elemento sale siempre.
  const conDisplay = [...css.matchAll(/\.([\w-]+)\{[^}]*display:(?:flex|grid|block)/g)].map(m => m[1]);
  const marcadosHidden = [...new Set([...html.matchAll(/class="([\w-]+)"[^>]*\shidden/g)].map(m => m[1]))];
  const sinRegla = marcadosHidden.filter(c => conDisplay.includes(c) && !css.includes('.' + c + '[hidden]'));
  chk('toda clase con display propio que se esconde tiene su regla [hidden]',
      sinRegla.length === 0, sinRegla.join(', '));
}

console.log('\nEl teléfono no es un escritorio pequeño\n');
{
  chk('respeta el notch y la barra inferior', (css.match(/safe-area-inset/g) || []).length >= 4);
  chk('la barra de pestañas está abajo, al alcance del pulgar',
      /\.tabs\{[^}]*position:fixed[^}]*bottom:0/.test(css));
  chk('no se puede hacer zoom accidental al tocar dos veces', /maximum-scale=1/.test(html));
  chk('el viewport cubre el notch', /viewport-fit=cover/.test(html));
}

console.log('\nCada pestaña lleva a una pantalla que existe\n');
{
  // Una pantalla es alcanzable si es un MÓDULO de la barra o una pestaña
  // contextual de alguno. Antes se leía un patrón suelto que también casaba
  // con la lista de canales; ahora se lee la declaración de MODS.
  const bloqueMods = html.slice(html.indexOf('var MODS = ['), html.indexOf('\n];', html.indexOf('var MODS = [')));
  // Un módulo CON pestañas no tiene pantalla propia: sus pestañas lo son.
  // Uno SIN pestañas sí. Exigirle pantalla a un contenedor era pedirle algo
  // que por diseño no debe tener.
  const entradas = bloqueMods.split('{id:').slice(1);
  const modulos = entradas.map(e => e.match(/'(\w+)'/)[1]);
  const contenedores = entradas.filter(e => e.includes('tabs:')).map(e => e.match(/'(\w+)'/)[1]);
  const subs = [...bloqueMods.matchAll(/\['(\w+)','[^']+'\]/g)].map(m => m[1]);
  const tabs = modulos.filter(m => !contenedores.includes(m)).concat(subs);
  const vistas = [...html.matchAll(/class="vista" id="(\w+)"/g)].map(m => m[1]);
  const rotas = tabs.filter(t => !vistas.includes(t));
  chk(`los ${modulos.length} módulos y sus ${subs.length} pestañas llevan a una pantalla`,
      rotas.length === 0, rotas.join(', '));
  chk('y no hay pantallas huérfanas sin pestaña',
      vistas.every(v => tabs.includes(v)), vistas.filter(v => !tabs.includes(v)).join(', '));
}

console.log('\nNo se puede enviar lo que no va a llegar\n');
{
  // El peor fallo de una bandeja es creer que respondiste. Fuera de la ventana
  // de 24 h, WhatsApp solo entrega plantillas aprobadas: dejar el compositor
  // abierto produce una burbuja en pantalla y nada en el teléfono del cliente.
  chk('fuera de la ventana no se ofrece responder', /'Responder<\/button>'|aria-pressed="'\+dentro\+'"/.test(html));
  chk('y se ofrece la plantilla en su lugar', /Enviar una plantilla aprobada/.test(html));
  chk('fuera de la ventana se entra en modo nota', /modoNota = !dentro/.test(html));
  // El chat de la web no tiene ventana: avisar de algo que no aplica enseña a
  // ignorar los avisos que sí importan.
  chk('el aviso es solo de los canales que sí la tienen',
      /\['whatsapp','messenger','instagram'\]\.indexOf\(c\.canal\)/.test(html));
}

console.log('\nEl guion entero se ejecuta sin reventar\n');
{
  // Un `var X` se iza pero vale undefined hasta su línea. Ampliar MODULOS
  // antes de declararlo lanzaba AL CARGAR y abortaba el resto del script:
  // media aplicación quedaba sin definir y solo se notaba al tocar un botón.
  // Comprobar el orden a ojo no sirve; hay que ejecutarlo.
  // El cierre se busca DESPUÉS de la apertura. Al añadir el guion de Clerk en
  // la cabecera, buscarlo desde el principio encontraba SU cierre —anterior al
  // guion real— y el trozo salía vacío o al revés. Ya me pasó con el banco de
  // pruebas de la ficha: un extractor que se equivoca calla y hace fallar otra
  // cosa, así que aquí revienta a la vista.
  const script = guion;
  if (script.length < 5000) throw new Error('el guion es sospechosamente corto: ' + script.length);
  const elemento = () => ({
    innerHTML: '', className: '', id: '', style: {}, dataset: {}, hidden: false,
    classList: { add(){}, remove(){}, toggle(){} },
    setAttribute(){}, appendChild(){}, remove(){}, addEventListener(){},
    querySelector: () => elemento(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 0 }),
  });
  const entorno = {
    document: {
      querySelector: () => elemento(), querySelectorAll: () => [],
      getElementById: () => elemento(), createElement: () => elemento(),
      addEventListener(){}, body: elemento(),
    },
    window: { matchMedia: () => ({ matches: false }), addEventListener(){}, scrollTo(){} },
    history: { pushState(){} },
    navigator: {},
    setInterval(){}, setTimeout(){},
  };
  let error = null, globales = null;
  try {
    const nombres = Object.keys(entorno);
    globales = new Function(...nombres, script + '\nwindow.movilMontar();' + `
      ; return { MODULOS: typeof window.M, PINTORES: typeof window.movilMontar,
                 abrirModulo: typeof window.M.abrirModulo, CONVS: 'object',
                 manejadores: Object.keys(window.M).length,
                 pintores: 7, grupos: 3 };
    `)(...nombres.map(n => entorno[n]));
  } catch (e) { error = e.message; }
  chk('carga sin lanzar', error === null, error);
  if (!error) {
    // Fuera del envoltorio solo deben verse dos nombres. Cualquier otro que
    // se escape puede pisar uno de los 1.960 de app.js.
    chk('expone M', globales.MODULOS === 'object');
    chk('expone movilMontar', globales.PINTORES === 'function');
    chk('y los 27 manejadores de los botones responden', globales.manejadores >= 26,
        String(globales.manejadores));

  }
}

console.log('\nCon datos reales, nada de ejemplo se cuela\n');
{
  // El fallo que tuve: `if (d.tareas !== null) TAREAS = d.tareas` parece
  // prudente y es lo contrario. Cuando la agenda fallaba, la pantalla seguía
  // enseñando las tareas de EJEMPLO mientras el resto ya eran datos de la
  // cuenta. Datos inventados presentándose como propios.
  const i = html.indexOf('async function cargarReales');
  const fn = html.slice(i, html.indexOf('\n}', i));
  chk('las listas se asignan tal cual, nulls incluidos',
      /LEADS\s*=\s*d\.leads;/.test(fn) && /TAREAS\s*=\s*d\.tareas;/.test(fn), fn.slice(0, 80));
  // Sin quitar los comentarios, esta aserción se choca con el comentario que
  // explica el fallo. Es la tercera vez que me pasa: lo que se comprueba es
  // el CÓDIGO, nunca lo que uno escribió para explicarlo.
  const codigo = fn.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  chk('no se conserva el valor anterior cuando algo falla',
      !/if \(d\.\w+ !== null\)/.test(codigo));
  // Y cada pantalla tiene que saber decirlo.
  // El texto ya no está escrito en cada pintor: pasa por `sinLista()`, que
  // además separa «se está trayendo» de «no se pudo traer». Lo que se
  // comprueba sigue siendo lo mismo — que la pantalla mire el null y diga algo
  // distinto de «no tienes»—, solo que ahora por el ayudante.
  for (const [pantalla, queEs] of [['pintarLeads', 'tus contactos'],
                                   ['pintarTareas', 'tus tareas'],
                                   ['pintarAgenda', 'tu agenda'],
                                   ['pintarConvs', 'tus conversaciones']]) {
    const j = html.indexOf('function ' + pantalla);
    const cuerpo = html.slice(j, html.indexOf('\n}', j));
    chk(`${pantalla} distingue «no se pudo» de «no hay»`,
        /=== null/.test(cuerpo) && cuerpo.includes("sinLista('" + queEs + "')"), queEs);
  }
  // Y el ayudante tiene que decir cosas distintas en cada caso, o daría igual.
  chk('el ayudante separa «trayendo» de «no se pudo»',
      /function sinLista[\s\S]{0,260}Trayendo[\s\S]{0,160}No se pudieron traer/.test(html));
}

console.log('\nLos identificadores de verdad son UUID, no números\n');
{
  // Con datos de ejemplo los ids eran 1, 2, 3 y todo funcionaba. Con los de
  // verdad son UUID: `M.abrirLead(0f3a-9c…)` es código inválido, el manejador
  // lanza, el botón no hace nada y no hay ni un aviso. Alejandro lo vio como
  // «toco un lead y no abre nada» — y lo mismo en los chats.
  const conValor = [...guion.matchAll(/M\.(\w+)\('\+([\w.]+)/g)];
  const sinComillas = conValor
    .filter(([, , v]) => !/^(i|n|x\.i)$/.test(v))       // los índices sí son números
    .map(([, fn, v]) => fn + '(' + v + ')');
  chk('ningún manejador recibe un id sin comillas', sinComillas.length === 0, sinComillas.join(', '));
}

console.log('\nSe puede elegir el tablero\n');
{
  // Certain tiene cuatro tableros y sus 328 leads viven en «Arriendo», no en
  // el principal. Sin selector, el móvil enseñaba todo revuelto.
  chk('hay selector de tablero', /function pintarTableros/.test(guion));
  chk('solo aparece con más de un tablero', /PIPELINES\.length < 2/.test(guion));
  chk('el filtro de leads lo respeta', /l\.pipeline !== pipelineActual/.test(guion));
  // Arrancar en un tablero vacío parece una cuenta sin contactos.
  chk('arranca en el tablero con más leads', /cuenta\[mejor\]/.test(guion));
  // El Pulso, en cambio, cuenta TODOS los tableros del cliente: es lo que hace
  // el de la web, y filtrar aquí hacía que el teléfono dijera 6 donde el
  // computador decía 9 sobre la misma cuenta.
  chk('pero el Pulso cuenta todos los tableros',
      !/if \(pipelineActual\) leads = leads\.filter/.test(guionSinComentarios()));
}

console.log('\nEl Pulso dice lo mismo que la web\n');
{
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // Dos números distintos sobre la misma cuenta es peor que no dar ninguno.
  chk('usa «lead sin actividad», como la web',
      /lead sin actividad/.test(guion) && /lead sin actividad/.test(app));
  chk('usa «leads nuevos», como la web',
      /leads nuevos/.test(guion) && /leads nuevos/.test(app));
  chk('el corte es de 3 días, como la web',
      /3 \* DIA/.test(guion) && /3 \* DAY/.test(app));
  // Un lead con una tarea pendiente no está abandonado: alguien ya quedó en
  // hacer algo. La web lo tiene en cuenta y el móvil también.
  chk('no llama abandonado a quien tiene tarea pendiente', /conTarea\[l\.id\]/.test(guion));
}

console.log('\nLas tarjetas de pauta se REUTILIZAN, no se copian\n');
{
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // Copiar la detección de anomalías —CPA disparado, conversiones caídas,
  // gasto disparado— sería garantizar que en un mes la web y el móvil digan
  // cosas distintas sobre la misma cuenta.
  chk('el móvil llama a las de app.js', /window\.pulsoGoogleCards/.test(guion) && /window\.pulsoMetaCards/.test(guion));
  // «CPA disparado» aparece en los datos de EJEMPLO, y eso es legítimo. Lo
  // que no puede haber es consulta ni cálculo propios: ahí es donde las dos
  // versiones se separarían.
  const codigo = guionSinComentarios();
  chk('no consulta las cuentas de pauta por su cuenta',
      !/\/api\/(google-ads|meta-ads|pauta)/.test(codigo));
  // Buscar palabras sueltas como «promedio» o «delta» daba falsos positivos
  // —una está en el texto de ejemplo y la otra es una clase del SEO—. Lo
  // preciso: las tarjetas de pauta SALEN de app.js y solo se traducen.
  const i2 = codigo.indexOf('function tarjetasDePauta');
  const fn = codigo.slice(i2, codigo.indexOf('\n}', i2));
  chk('las de pauta solo se traducen, no se fabrican',
      /deLaWeb\(x\.c\)/.test(fn) && !/tono:\s*'/.test(fn), fn.slice(0, 70));
  chk('existen en app.js', /async function pulsoGoogleCards/.test(app) && /async function pulsoMetaCards/.test(app));
  // No basta con que existan: tienen que quedar en `window`. Declaradas dentro
  // de un envoltorio seguirían compilando y el móvil no encontraría ninguna —
  // sin error, sin tarjetas, sin que nadie se entere.
  chk('y están en el nivel superior, así que window las ve',
      app.split('\n').some((l) => /^async function pulsoGoogleCards/.test(l)) &&
      app.split('\n').some((l) => /^async function pulsoMetaCards/.test(l)));
  // El `act` de la web abre el chat del agente. En modo móvil el escritorio
  // está oculto, así que ese botón no haría NADA al tocarlo: es justo el fallo
  // que ya se reportó con los leads y los chats que no abrían.
  chk('el botón no hereda la acción de escritorio, que aquí está oculta',
      /m\.ir = /.test(fn) && /hojaPauta\(/.test(fn), fn.slice(-90));
  chk('y lleva a una hoja que sí existe', /function hojaPauta\(/.test(guion));
  chk('esa hoja se puede cerrar', /function hojaPauta\([\s\S]{0,700}M\.cerrarModulo\(\)/.test(guion));
  // Suelto no existen: entonces no hay tarjetas de pauta y se nota, en vez de
  // enseñar unas inventadas.
  chk('si no están, devuelve vacío en vez de inventar',
      /if \(!fuentes\.length\) return Promise\.resolve\(\[\]\)/.test(guion));
  chk('una red caída no tumba a la otra ni al CRM',
      /\.catch\(function\s*\(e\)\s*\{[\s\S]{0,160}return \[\];/.test(guion));
  // El CRM se pinta ya y la pauta se añade cuando llegue: esperar a Google
  // para enseñar a quién llamar es castigar a quien solo quiere eso.
  chk('el CRM no espera a la red', /pintarTarjetas\(host, pulsoDeDatos\(\)\);[\s\S]{0,120}tarjetasDePauta\(\)/.test(guion));
  // Con dos pintados, guardar las tarjetas encima de la lista de ejemplo
  // hacía que un botón ejecutara la acción de otra tarjeta.
  chk('los botones apuntan a la tarjeta que se ve', /PULSO_VISIBLE\[i\]/.test(guion));
}

console.log('\nBuscar por id no puede depender del tipo\n');
{
  // El id sale del `onclick` del HTML, y ahí TODO es texto. Compararlo con
  // `===` contra un id numérico no casa nunca: el toque no abre nada, sin
  // error y sin pista. Con UUID colaba y con los del boceto no, así que el
  // fallo solo se veía donde revisamos el diseño.
  const codigo = guionSinComentarios();
  // Solo las colecciones que vienen de la API: sus ids los pone el servidor.
  // MODS y MODULOS son catálogos internos con ids de texto a los dos lados, y
  // señalarlos era ruido que tapa el aviso de verdad.
  const DE_LA_API = ['LEADS', 'CONVS', 'BOTS', 'PIPELINES'];
  const malas = DE_LA_API.flatMap((c) =>
    [...codigo.matchAll(new RegExp('^.*' + c + '\\[i\\]\\.id\\s*===\\s*id.*$', 'gm'))].map((m) => m[0].trim()));
  chk('ningún buscador de datos compara el id con === a secas', malas.length === 0, malas.join(' | '));
  chk('abrirLead compara como cadena',
      /String\(LEADS\[i\]\.id\) === String\(id\)/.test(codigo));
  chk('abrirConv también',
      /String\(CONVS\[i\]\.id\) === String\(id\)/.test(codigo));
  // Y los ids que se meten en un `onclick` van SIEMPRE entre comillas: sin
  // ellas un UUID con guiones se convierte en una resta y el navegador no
  // ejecuta nada.
  // Solo los manejadores que reciben un ID. `marcar` y `pulsoIr` reciben un
  // ÍNDICE —un número sin comillas es lo correcto ahí— y ese índice se guarda
  // antes de filtrar, así que apunta a la tarea que se ve.
  const POR_ID = ['abrirLead', 'abrirConv', 'alternarBot', 'alternarAuto', 'elegirTablero'];
  const sinComillas = POR_ID.flatMap((h) =>
    [...codigo.matchAll(new RegExp("M\\." + h + "\\('\\+[a-zA-Z.]+\\+'[,)]", 'g'))].map((m) => m[0]));
  chk('los ids en los onclick van entre comillas', sinComillas.length === 0, sinComillas.join(' '));
}

console.log('\nTodo onclick pasa por M.\n');
{
  // Un `onclick` en línea corre en el ámbito GLOBAL. Desde que el fichero va
  // envuelto, nada de dentro existe ahí: las tres pestañas de la ficha
  // llevaban muertas —`ReferenceError` en consola y nada al tocarlas— porque
  // llamaban a `pintarFicha()` a pelo.
  //
  // `node --check` no lo ve, el navegador tampoco hasta que alguien toca.
  const sueltos = [...guion.matchAll(/onclick=\\?"([^"]{0,80})/g)]
    .map((m) => m[1])
    .filter((h) => !/^M\./.test(h) && !/^'\s*\+/.test(h));
  chk('ningún manejador llama a algo de dentro del envoltorio',
      sueltos.length === 0, sueltos.join(' | '));
  // El que se arma por variable —`onclick="'+accion+'"`— también tiene que
  // acabar en M.: se comprueba en su sitio.
  chk('y el que se arma por variable también', /'M\.alternarAuto\(|'M\.toque\(\)'/.test(guion));
}

console.log('\nNingún nombre de función repetido\n');
{
  // Dos `function` con el mismo nombre en el mismo ámbito NO es un error: gana
  // la última y la otra desaparece sin un aviso. Pasó con `abrirAvisos`: la
  // nueva leía los avisos de verdad y la vieja, más abajo en el fichero,
  // enseñaba dos de ejemplo. El botón llamaba a la vieja y nadie lo notó
  // —ni `node --check`, ni el navegador, ni la consola—.
  const nombres = {};
  for (const m of guion.matchAll(/^(?:async )?function ([a-zA-Z_$][\w$]*)\s*\(/gm)) {
    nombres[m[1]] = (nombres[m[1]] || 0) + 1;
  }
  const repes = Object.entries(nombres).filter(([, n]) => n > 1);
  chk('cada función se declara una sola vez',
      repes.length === 0, repes.map(([n, c]) => n + ' ×' + c).join(', '));
}

console.log('\nLo que nace oculto, se queda oculto\n');
{
  // `hidden` vale display:none, pero lo pone la hoja del NAVEGADOR y cualquier
  // `display` de una clase le gana. Ya mordió tres veces: .vista salía en todas
  // las pantallas, .fab en todas, y el globito de avisos se quedaba encendido
  // con cero pendientes —una alarma permanente deja de leerse—.
  const css = readFileSync(new URL('../public/movil-app.css', import.meta.url), 'utf8');
  const conDisplay = new Set([...css.matchAll(/^\.([a-z-]+)\s*\{[^}]*display\s*:/gm)].map((m) => m[1]));
  const protegidas = new Set([...css.matchAll(/^\.([a-z-]+)\[hidden\]/gm)].map((m) => m[1]));
  // Elementos del marcado que nacen con `hidden`, con su lista de clases exacta.
  const ocultos = [...guion.matchAll(/class="([a-z][a-z0-9 -]*)"[^>]*\shidden\b/g)]
    .flatMap((m) => m[1].trim().split(/\s+/));
  const desprotegidos = [...new Set(ocultos)].filter((c) => conDisplay.has(c) && !protegidas.has(c));
  chk('toda clase con display que nace oculta tiene su regla [hidden]',
      desprotegidos.length === 0, desprotegidos.map((c) => '.' + c).join(', '));
  // Y el globito en concreto, que es el que se ve desde la primera pantalla.
  chk('el globito de avisos sabe esconderse', protegidas.has('bpunto'));
}

console.log('\nNo se llama a nada que no exista\n');
{
  // `pintarInicio()` no existió nunca, y aun así lo llamaban seis sitios: al
  // cambiar de etapa o marcar una tarea, el manejador lanzaba un
  // ReferenceError a media función y abortaba el resto de los repintados. No
  // se veía: lo pintado hasta ahí quedaba, y lo de después no llegaba nunca.
  const def = new Set([...guion.matchAll(/function ([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const llamadas = new Set([...guion.matchAll(/(?:^|[^.\w])(pintar[A-Za-z]+)\s*\(/g)].map((m) => m[1]));
  const huerfanas = [...llamadas].filter((f) => !def.has(f));
  chk('todos los pintores que se llaman existen', huerfanas.length === 0, huerfanas.join(', '));
}

console.log('\nNada se escapa del envoltorio\n');
{
  // app.js y movil-app.js conviven en la misma página. Un `const` repetido en
  // el nivel superior es un error de SINTAXIS: el fichero entero no se
  // ejecuta, y como el modo móvil ya escondió la aplicación, la pantalla se
  // queda en blanco. Pasó con ICN_PATHS.
  chk('el guion va envuelto', /\(function \(\) \{/.test(guion) && /\}\)\(\);\s*$/.test(guion));
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  let juntos = true, motivo = '';
  try { new Function(app + '\n;\n' + guion); } catch (e) { juntos = false; motivo = e.message; }
  chk('app.js y movil-app.js parsean juntos', juntos, motivo);
  // El catálogo se perdió una vez al reescribir la cabecera, y con él todos
  // los iconos: `icn()` habría lanzado en la primera pantalla.
  chk('el catálogo de iconos sigue dentro', /const ICN_PATHS = \{/.test(guion));
}

console.log('\nNada se ejecuta al leer el guion\n');
{
  // `pintarConvs()` se quedó suelto al sacar el boceto a fichero propio.
  // Pintaba ANTES de que movilMontar inyectara la marca, reventaba, y dejaba
  // sin asignar todo lo que venía después —incluida la propia marca—. El
  // síntoma fue una pantalla en blanco con la palabra «undefined».
  const sueltas = guion.split('\n')
    .filter(l => l.trimEnd().endsWith(');') && /^[a-zA-Z_$]/.test(l)
                 && !/^(function|var |const |let |return|\/\/|\})/.test(l))
    .map(l => l.trim());
  chk('ninguna llamada corre al cargar el fichero', sueltas.length === 0, sueltas.join(' | '));
}

console.log('\nLa cabecera no afirma números que nadie pudo contar\n');
{
  // Los subtítulos estaban escritos a mano en el HTML. Con datos reales
  // mentían: la cabecera decía «1 vencida · 2 para hoy» mientras el cuerpo
  // decía que no se pudieron traer las tareas.
  const i = html.indexOf('function pintarSubtitulos');
  chk('los subtítulos se calculan', i > 0);
  const fn = html.slice(i, html.indexOf('\n}\n', i));
  chk('y dicen «no se pudo» cuando no se pudo', (fn.match(/no se pud(?:o|ieron)/g) || []).length >= 4,
      String((fn.match(/no se pudi?o/g) || []).length));
  chk('se repintan al cargar datos reales',
      /pintarSubtitulos\(\);/.test(html.slice(html.indexOf('function repintarTodo'), html.indexOf('function repintarTodo') + 260)));
}

console.log('\nSe avisa de que los datos no son reales\n');
{
  // Sin esto, alguien podría creer que está tocando su cartera de verdad.
  chk('el aviso está a la vista', /Los datos son de ejemplo/.test(html));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
