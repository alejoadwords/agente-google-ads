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
    globales = new Function(...nombres, script + '\nmovilMontar();' + `
      ; return { MODULOS: typeof MODULOS, PINTORES: typeof PINTORES,
                 abrirModulo: typeof abrirModulo, CONVS: typeof CONVS,
                 modulos: MODULOS.length, pintores: Object.keys(PINTORES).length,
                 grupos: new Set(MODULOS.map(function(m){return m.grupo;})).size };
    `)(...nombres.map(n => entorno[n]));
  } catch (e) { error = e.message; }
  chk('carga sin lanzar', error === null, error);
  if (!error) {
    chk('MODULOS quedó definido', globales.MODULOS === 'object');
    chk('PINTORES quedó definido', globales.PINTORES === 'object');
    // Si el push falló, MODULOS se queda solo en los de marketing. Se
    // comprueba que haya de los TRES grupos, no un número fijo que hay que
    // subir cada vez que se añade un módulo.
    chk('hay módulos de los tres grupos', globales.grupos === 3, String(globales.grupos));
    chk('cada informe tiene su pintor', globales.pintores === 7, String(globales.pintores));
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
  for (const [pantalla, frase] of [['pintarLeads', 'traer tus contactos'],
                                   ['pintarTareas', 'traer tus tareas'],
                                   ['pintarAgenda', 'traer tu agenda'],
                                   ['pintarConvs', 'traer tus conversaciones']]) {
    const j = html.indexOf('function ' + pantalla);
    const cuerpo = html.slice(j, html.indexOf('\n}', j));
    chk(`${pantalla} distingue «no se pudo» de «no hay»`,
        /=== null/.test(cuerpo) && cuerpo.includes(frase), frase);
  }
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
