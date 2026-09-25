// public/movil-app.js — la versión móvil de Acuarius.
//
// Una sola fuente: `movil.html` la usa para revisarla suelta y `index.html` la
// carga cuando alguien enciende el interruptor.
//
// TODO va dentro de una función. Cuando los dos guiones conviven en la misma
// página, cualquier nombre repetido es un problema, y `const` repetido es
// LETAL: el navegador lanza un error de sintaxis, el fichero entero no se
// ejecuta y —como el modo móvil ya escondió la aplicación— la pantalla se
// queda en blanco. Pasó con `ICN_PATHS`, que existe en los dos.
//
// Hacia fuera solo salen `movilMontar` y `M`, el objeto por el que pasan los
// manejadores de los botones. Un solo nombre no puede chocar con los 1.960
// globales de app.js.
(function () {
// El catálogo de iconos, DENTRO de la función: en el nivel superior
// chocaba con el `const ICN_PATHS` de app.js y reventaba la página.
const ICN_PATHS = {
  alert:    '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  check:    '<path d="M22 11.1V12a10 10 0 11-5.9-9.1"/><path d="M22 4L12 14l-3-3"/>',
  chart:    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  trend:    '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  search:   '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  refresh:  '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
  sparkles: '<path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9z"/><path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/>',
  edit:     '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/>',
  chat:     '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  gear:     '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  file:     '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  bot:      '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="8.5" cy="13.5" r=".5" fill="currentColor"/><circle cx="15.5" cy="13.5" r=".5" fill="currentColor"/><path d="M9 17h6"/>',
  users:    '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
  arrow:    '<path d="M5 12h14M12 5l7 7-7 7"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  bell:     '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
  split:    '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/>',
  star:     '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  tag:      '<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  // El mismo trazo que ya usaba el botón de enlace del panel, ahora con nombre
  // para que la ficha no tenga que repetir el SVG.
  menu:     '<path d="M3 12h18"/><path d="M3 6h18"/><path d="M3 18h18"/>',
  salir:    '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  monitor:  '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  phone:    '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/>',
  link:     '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',
};

function icn(n,s){
  var p = ICN_PATHS[n] || ICN_PATHS.chart;
  return '<svg width="'+(s||20)+'" height="'+(s||20)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
}
// Se busca DENTRO del móvil, no en todo el documento: dentro de la aplicación
// hay un `.lista` y un `.cab` del escritorio que casarían primero.
var $ = function(s,r){ return (r||movilRaiz()).querySelector(s); };
var esc = function(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
function toque(ms){ if (navigator.vibrate) navigator.vibrate(ms||8); }

// Qué se pinta cuando no hay lista. Mientras carga, que se está trayendo; si
// falló, que no se pudo. Decir «no tienes» en cualquiera de los dos casos es
// mentir, y decir «no se pudo» mientras carga es asustar sin motivo.
function sinLista(queEs){
  return MODO === 'cargando'
    ? '<div class="vacio">Trayendo ' + esc(queEs) + '…</div>'
    : '<div class="vacio">No se pudieron traer ' + esc(queEs) + '.</div>';
}

// Con sesión abierta NO puede quedar ni un dato de ejemplo en pantalla.
// Se pintaban al montar y se sustituían al llegar los de verdad, así que quien
// entraba veía durante unos segundos contactos, mensajes y cifras de Google
// Ads de otra persona, con SU propia sesión abierta. Es la peor mentira que
// ha tenido esta pantalla: no parece un fallo, parece su cuenta.
function vaciarEjemplos(){
  LEADS = null; TAREAS = null; CITAS = null; CONVS = null;
  BOTS = null; PIPELINES = null; PULSO = [];
  MODULO_CACHE = {};
}

// ── Guardar de verdad ───────────────────────────────────────────────────────
// Las acciones que cambian algo pasan TODAS por aquí.
//
// Antes cada una repintaba la pantalla y no llamaba a nadie: mover un lead a
// Ganado se veía exactamente igual que si se hubiera guardado, y la base no se
// enteraba. En un CRM eso es lo peor que puede pasar, porque no se descubre
// hasta que el negocio ya se enfrió.
//
// El contrato de `guardar`:
//  · en modo muestra lo dice, en vez de fingir que guardó;
//  · si el servidor falla, DESHACE lo que se pintó y explica por qué;
//  · nunca se queda callado.
var _chichaTmr = null;
function chicharra(txt, tipo){
  var r = movilRaiz(); if (!r) return;
  var c = r.querySelector('.chicharra');
  if (!c) { c = document.createElement('div'); c.className = 'chicharra'; r.appendChild(c); }
  c.className = 'chicharra ' + (tipo || 'ok');
  c.textContent = txt;
  clearTimeout(_chichaTmr);
  // El fallo se queda más tiempo: es el que hay que leer.
  _chichaTmr = setTimeout(function(){ if (c.parentNode) c.remove(); }, tipo === 'mal' ? 6000 : 2600);
}

async function guardar(ruta, cuerpo, metodo, alDeshacer){
  if (MODO !== 'real' || typeof fetchAuth !== 'function') {
    if (alDeshacer) alDeshacer();
    chicharra('Esto es una muestra. Entra con tu cuenta para guardar de verdad.', 'mal');
    return null;
  }
  chicharra('Guardando…', 'esperando');
  try {
    var r = await fetchAuth(ruta, {
      method: metodo || 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    // `fetchAuth` NO lanza con un 4xx o un 5xx: hay que mirar `ok` a mano. Dar
    // por bueno lo que devuelve sin mirarlo es volver al fallo de partida.
    var d = {};
    try { d = await r.json(); } catch (e) {}
    if (!r.ok) {
      if (alDeshacer) alDeshacer();
      chicharra('No se guardó: ' + (d.error || 'el servidor respondió ' + r.status), 'mal');
      return null;
    }
    chicharra('Guardado', 'ok');
    return d;
  } catch (e) {
    if (alDeshacer) alDeshacer();
    chicharra('No se guardó: no hay conexión.', 'mal');
    console.warn('[movil] guardar', ruta, e);
    return null;
  }
}

// ── Datos de ejemplo ────────────────────────────────────────────────────────
// Inventados a propósito: aquí se decide la FORMA. Conectar los de verdad es
// trabajo aparte y va después de aprobar el diseño — cambiar una pantalla es
// barato, recablear veinte ya conectadas no.
var ETAPAS = [
  {k:'nuevo',       t:'Nuevo'},
  {k:'contactado',  t:'Contactado'},
  {k:'calificado',  t:'Calificado'},
  {k:'propuesta',   t:'Propuesta'},
  {k:'ganado',      t:'Ganado'},
  {k:'perdido',     t:'Perdido'}
];
// Los tres estados de una conversación. 'resolved' dejó de colapsarse en
// 'human' cuando la hoja de estado empezó a ofrecerlo: si no está aquí, se
// pinta la palabra cruda en el chip.
var ETIQ_QUIEN = { bot:'Agente', human:'Tú', resolved:'Resuelta' };
var DICE_QUIEN = { bot:'lo atiende el agente', human:'lo atiendes tú', resolved:'resuelta' };
var LEADS = [
  {id:1,nom:'Hellen Marún',     etapa:'nuevo',      hace:'hace 2 h', origen:'Formulario web', tel:'+57 300 412 8890',
   interes:'Apartamento 2 hab · Alto Prado', valor:'$ 320.000.000', valorNum:320000000, resp:'Karen Acosta', tags:['arriendo','alto-prado'],
   email:'hellen.marun@example.com', empresa:'', campana:'Search - general 2026', pagina:'Arriendos Envigado', cierre:'30 sep'},
  {id:2,nom:'Rubén Corro',      etapa:'contactado', hace:'ayer',     origen:'Fincaraíz',      tel:'+57 311 220 4417',
   interes:'Local comercial · Centro', valor:'$ 180.000.000', valorNum:180000000, resp:'Maira Ballesteros', tags:['venta']},
  {id:3,nom:'Sandra Caro',      etapa:'contactado', hace:'ayer',     origen:'Google Ads',     tel:'+57 315 887 1120',
   interes:'Casa 3 hab · Villa Campestre', valor:'$ 540.000.000', valorNum:540000000, resp:'Karen Acosta', tags:['venta','urgente']},
  {id:4,nom:'Giancarlo Armella',etapa:'ganado',     hace:'hace 3 d', origen:'Referido',       tel:'+57 320 559 3301',
   interes:'Oficina 80 m²', valor:'$ 260.000.000', valorNum:260000000, resp:'Maira Ballesteros', tags:['venta']},
  {id:5,nom:'Walter Peralta',   etapa:'nuevo',      hace:'hace 5 h', origen:'Metrocuadrado',  tel:'+57 301 778 2245',
   interes:'Apartaestudio · Riomar', valor:'$ 145.000.000', valorNum:145000000, resp:'Sin asignar', tags:['arriendo']},
  {id:6,nom:'Paula Restrepo',   etapa:'propuesta',  hace:'hace 1 d', origen:'Instagram',      tel:'+57 318 004 9912',
   interes:'Penthouse · Buenavista', valor:'$ 890.000.000', valorNum:890000000, resp:'Karen Acosta', tags:['venta','premium']}
];
var TAREAS = [
  {t:'Llamar a Sandra Caro',        cuando:'vencida', hecha:false},
  {t:'Llamar a Hellen Marún',               cuando:'hoy',     hecha:false},
  {t:'Enviar propuesta a Rubén',            cuando:'hoy',     hecha:false},
  {t:'Confirmar visita con Paula',       cuando:'proxima', hecha:false},
  {t:'Llamar a Walter',                     cuando:'hoy',     hecha:true}
];
var CITAS = [
  {h:'09:30', dur:'45 min', t:'Visita · Alto Prado',        s:'Hellen Marún',      pasada:true},
  {h:'11:00', dur:'30 min', t:'Llamada de seguimiento',     s:'Rubén Corro',       pasada:false},
  {h:'15:00', dur:'1 h',    t:'Presentación de propuesta',  s:'Paula Restrepo',    pasada:false}
];

var PIPELINES = null;
var pipelineActual = null;   // null = todos los tableros
var filtroEtapa = 'todos';
var textoBusqueda = '';

// ── Pintado ─────────────────────────────────────────────────────────────────
function etiquetaEtapa(k){
  for (var i=0;i<ETAPAS.length;i++) if (ETAPAS[i].k===k) return ETAPAS[i].t;
  return k;
}
function leadsVisibles(){
  return LEADS.filter(function(l){
    if (pipelineActual && l.pipeline !== pipelineActual) return false;
    if (filtroEtapa !== 'todos' && l.etapa !== filtroEtapa) return false;
    if (!textoBusqueda) return true;
    var q = textoBusqueda.toLowerCase();
    return (l.nom+' '+l.origen+' '+l.interes).toLowerCase().indexOf(q) >= 0;
  });
}
function pintarFiltros(){
  if (LEADS === null) { $('#leads .filtros').innerHTML = ''; return; }
  var f = [{k:'todos',t:'Todos'}].concat(ETAPAS);
  $('#leads .filtros').innerHTML = f.map(function(x){
    var n = x.k==='todos' ? LEADS.length : LEADS.filter(function(l){return l.etapa===x.k;}).length;
    if (x.k!=='todos' && n===0) return '';
    return '<button class="filtro" aria-pressed="'+(filtroEtapa===x.k)+'" onclick="M.filtrar(\''+x.k+'\')">'+esc(x.t)+' '+n+'</button>';
  }).join('');
}
function filtrar(k){ filtroEtapa = k; toque(); pintarFiltros(); pintarLeads(); }
function elegirTablero(id){
  pipelineActual = id || null;
  toque(); cerrarSheet(); pintarTableros(); pintarFiltros(); pintarLeads(); pintarSubtitulos();
}
function nombreTablero(){
  if (!pipelineActual || !PIPELINES) return 'Todos los tableros';
  for (var i=0;i<PIPELINES.length;i++) if (PIPELINES[i].id === pipelineActual) return PIPELINES[i].nom;
  return 'Todos los tableros';
}
function pintarTableros(){
  var c = $('#leads .tableros');
  if (!c) return;
  // Con un solo tablero el selector no decide nada y solo ocupa sitio.
  if (!PIPELINES || PIPELINES.length < 2) { c.innerHTML = ''; c.hidden = true; return; }
  c.hidden = false;
  c.innerHTML = '<button class="tablero" onclick="M.abrirTableros()">'
    + icn('split',15) + '<span>' + esc(nombreTablero()) + '</span>' + icn('arrow',14) + '</button>';
}
function abrirTableros(){
  if (!PIPELINES) return;
  abrirSheet('<div style="font-weight:700;font-size:var(--fs-md);margin-bottom:8px">Tablero</div>'
    + '<button class="opcion" aria-current="' + (!pipelineActual) + '" onclick="M.elegirTablero(\'\')">'
      + 'Todos los tableros<span class="marca">' + icn('check',18) + '</span></button>'
    + PIPELINES.map(function(p){
        var n = LEADS ? LEADS.filter(function(l){ return l.pipeline === p.id; }).length : 0;
        return '<button class="opcion" aria-current="' + (pipelineActual === p.id) + '" '
          + 'onclick="M.elegirTablero(\'' + p.id + '\')">'
          + esc(p.nom) + ' <span style="color:var(--muted);font-size:var(--fs-xs)">· ' + n + '</span>'
          + '<span class="marca">' + icn('check',18) + '</span></button>';
      }).join(''));
}
function buscar(v){ textoBusqueda = v; pintarLeads(); }

function pintarLeads(){
  // null = no se pudo mirar. Pintar «ningún contacto» sería afirmar que la
  // cartera está vacía cuando lo que pasó fue que se cayó la consulta.
  if (LEADS === null) {
    $('#leads .lista').innerHTML = sinLista('tus contactos');
    return;
  }
  var ls = leadsVisibles();
  $('#leads .lista').innerHTML = ls.length ? ls.map(function(l){
    return '<button class="lead" onclick="M.abrirLead(\''+l.id+'\')">'
      + '<span class="ini">'+esc(l.nom[0])+'</span>'
      + '<span class="cuerpo"><span class="nom">'+esc(l.nom)+'</span>'
      + '<span class="meta">'+esc(l.origen)+' · '+esc(l.hace)+'</span></span>'
      + '<span class="chip '+l.etapa+'">'+esc(etiquetaEtapa(l.etapa))+'</span></button>';
  }).join('') : '<div class="vacio">Ningún contacto con ese filtro.</div>';
}
function pintarTareas(){
  if (TAREAS === null) {
    $('#tareas .lista').innerHTML = sinLista('tus tareas');
    return;
  }
  if (!TAREAS.length) {
    $('#tareas .lista').innerHTML = '<div class="vacio">Ninguna tarea pendiente.</div>';
    return;
  }
  var grupos = [['vencida','Vencidas'],['hoy','Hoy'],['proxima','Próximas']];
  $('#tareas .lista').innerHTML = grupos.map(function(g){
    var ts = TAREAS.map(function(t,i){ return {t:t,i:i}; }).filter(function(x){ return x.t.cuando===g[0]; });
    if (!ts.length) return '';
    return '<div class="grupo'+(g[0]==='vencida'?' vence':'')+'">'+g[1]+' · '+ts.length+'</div>'
      + ts.map(function(x){
          return '<div class="tarea'+(x.t.hecha?' hecha':'')+'" onclick="M.marcar('+x.i+',this)">'
            + '<button class="tick" aria-label="Marcar">'+icn('check',16)+'</button>'
            + '<div><div class="tt">'+esc(x.t.t)+'</div><div class="tsub">'+esc(x.t.s)+'</div></div></div>';
        }).join('');
  }).join('');
}
function pintarAgenda(){
  if (CITAS === null) {
    $('#agenda .lista').innerHTML = sinLista('tu agenda');
    return;
  }
  var html = '';
  for (var i=0;i<CITAS.length;i++){
    var c = CITAS[i];
    // La línea de «ahora» va justo antes de la primera cita que no ha pasado:
    // es lo que hace que se lea de un vistazo qué queda por delante.
    if (!c.pasada && (i===0 || CITAS[i-1].pasada)) html += '<div class="ahora">AHORA</div>';
    html += (c.lead
      ? '<button class="cita" onclick="M.abrirLead(\''+esc(String(c.lead))+'\')">'
      // Sin contacto asociado no hay adónde ir: se pinta como fila, no como
      // botón. Un botón que no lleva a ninguna parte se toca dos veces y se
      // da por roto.
      : '<div class="cita">')
      + '<span class="hora">'+esc(c.h)+'<span class="dur">'+esc(c.dur)+'</span></span>'
      + '<span><span class="qt">'+esc(c.t)+'</span><span class="qs">'+esc(c.s)+'</span></span>'
      + (c.lead ? '</button>' : '</div>');
  }
  $('#agenda .lista').innerHTML = html || '<div class="vacio">Nada agendado para hoy.</div>';
}

function verLeads(etapa){ filtrar(etapa||'todos'); ver('leads'); }

function marcar(i,el){
  var t = TAREAS && TAREAS[i]; if (!t) return;
  var antes = t.hecha;
  t.hecha = !antes;
  el.classList.toggle('hecha');
  toque();
  pintarPulso(); pintarSubtitulos();
  // La agenda es el sistema real de tareas; `lead_activities` solo guarda el
  // historial. Marcar ahí no cerraría el pendiente.
  guardar('/api/agenda', { id: t.id, done: t.hecha }, 'PUT', function(){
    t.hecha = antes;
    el.classList.toggle('hecha');
    pintarTareas(); pintarPulso(); pintarSubtitulos();
  });
}

// ── Ficha ───────────────────────────────────────────────────────────────────
var leadAbierto = null;
function abrirLead(id){
  var l = null;
  // Comparado como CADENA: el id llega del `onclick` y ahí todo es texto, así
  // que un `===` contra un id numérico no casa NUNCA y el toque no abre nada,
  // sin error y sin pista. Con leads de verdad los ids son UUID y colaba; con
  // los del boceto —1, 2, 3— la ficha no abría. Es el mismo fallo que tuvo el
  // interruptor de los agentes.
  for (var i=0;i<LEADS.length;i++) if (String(LEADS[i].id) === String(id)) l = LEADS[i];
  if (!l) return;
  leadAbierto = l;
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-lead';
  h.innerHTML =
    '<div class="cab"><button class="volver" onclick="M.cerrarLead()">'+icn('arrow',24)+'</button>'
    + '<div><h1>'+esc(l.nom)+'</h1><div class="sub">'+esc(l.origen)+' · '+esc(l.hace)+'</div></div></div>'
    + '<div class="acciones">'
    // Estos dos vibraban y nada más. Un botón de llamar que no marca es la
    // razón por la que uno saca el teléfono: es LA acción del módulo.
    + '<button class="acc pri" onclick="M.llamar()">'+icn('phone',22)+'Llamar</button>'
    + '<button class="acc" onclick="M.whatsapp()">'+icn('chat',22)+'WhatsApp</button>'
    + '<button class="acc" onclick="M.abrirNota()">'+icn('edit',22)+'Anotar</button></div>'
    + '<div class="secc" id="ficha-cuerpo"></div>';
  movilRaiz().appendChild(h);
  pintarFicha();
  history.pushState({hoja:1},'');   // el botón atrás del sistema la cierra
}

function cerrarLead(){
  var h = $('#hoja-lead'); if (!h) return;
  h.classList.add('saliendo');
  setTimeout(function(){ if (h.parentNode) h.remove(); }, 200);
  leadAbierto = null;
}
// Se cierra de la más reciente a la más antigua: si no, el botón atrás del
// sistema salta dos pantallas de golpe y el usuario se pierde.
window.addEventListener('popstate', function(){
  if ($('#sheet')) { cerrarSheet(); return; }
  // Las hojas de la barra son hojas como las demás: el botón atrás del sistema
  // tiene que cerrarlas, o se queda uno encerrado dentro del menú.
  var deLaBarra = ['hoja-menu','hoja-avisos','hoja-perfil'];
  for (var b = 0; b < deLaBarra.length; b++) {
    if ($('#' + deLaBarra[b])) { cerrarBarra(deLaBarra[b]); return; }
  }
  if ($('#hoja-mod')) { cerrarModulo(); return; }
  if ($('#hoja-conv')) { cerrarConv(); return; }
  if ($('#hoja-lead')) cerrarLead();
});

// ── Hojas desde abajo ───────────────────────────────────────────────────────
function abrirSheet(html){
  var f = document.createElement('div'); f.className='fondo'; f.id='fondo'; f.onclick = cerrarSheet;
  var s = document.createElement('div'); s.className='sheet'; s.id='sheet';
  s.innerHTML = '<div class="asa"></div>' + html;
  movilRaiz().appendChild(f); movilRaiz().appendChild(s);
}
function cerrarSheet(){
  var f = $('#fondo'); if (f) f.remove();
  var s = $('#sheet'); if (s) s.remove();
}
function abrirNota(){
  abrirSheet('<textarea id="sh-nota" placeholder="¿Qué pasó en la llamada?"></textarea>'
    + '<button class="bbtn" onclick="M.guardarNota()">Guardar nota</button>');
}
// Llamar y escribir por WhatsApp. Sin número no se abre nada roto: se dice.
function telLimpio(){
  var l = leadAbierto;
  return l ? String(l.tel || '').replace(/[^\d+]/g, '') : '';
}
function llamar(){
  var t = telLimpio();
  if (!t) { chicharra('Este contacto no tiene teléfono guardado.', 'mal'); return; }
  toque();
  location.href = 'tel:' + t;
}
function whatsapp(){
  var t = telLimpio().replace(/^\+/, '');
  if (!t) { chicharra('Este contacto no tiene teléfono guardado.', 'mal'); return; }
  toque();
  // wa.me quiere el número sin el «+» y sin espacios. Abre la aplicación si
  // está instalada y la web si no, así que sirve en los dos casos.
  window.open('https://wa.me/' + t, '_blank');
}

// Las etiquetas de la cuenta, para ponerle una al contacto. El catálogo lo
// gestiona quien administra —desde el computador—; aquí solo se aplican.
var CATALOGO_TAGS = null;
async function abrirEtiquetas(){
  var l = leadAbierto; if (!l) return;
  abrirSheet('<div style="font-weight:700;font-size:var(--fs-md);margin-bottom:10px">Etiquetas</div>'
    + '<div id="sh-tags"><div class="vacio" style="padding:20px">Trayendo las etiquetas…</div></div>');
  if (CATALOGO_TAGS === null && MODO === 'real' && typeof fetchAuth === 'function') {
    try {
      var r = await fetchAuth('/api/lead-tags');
      var d = r && r.ok ? await r.json() : null;
      CATALOGO_TAGS = d && Array.isArray(d.tags) ? d.tags.map(function(t){ return t.name || t; }) : null;
    } catch (e) { CATALOGO_TAGS = null; }
  }
  var caja = $('#sh-tags'); if (!caja) return;   // la hoja pudo cerrarse
  if (MODO !== 'real') {
    caja.innerHTML = '<div class="vacio" style="padding:20px">Entra con tu cuenta para ver tus etiquetas.</div>';
    return;
  }
  if (CATALOGO_TAGS === null) {
    caja.innerHTML = '<div class="vacio" style="padding:20px">No se pudieron traer tus etiquetas.</div>';
    return;
  }
  var puestas = l.tags || [];
  var libres = CATALOGO_TAGS.filter(function(t){ return puestas.indexOf(t) < 0; });
  caja.innerHTML = libres.length
    ? '<div class="tags">' + libres.map(function(t){
        return '<button class="tag" onclick="M.ponerEtiqueta(\''+esc(t)+'\')">'+esc(t)+'</button>';
      }).join('') + '</div>'
    : '<div class="vacio" style="padding:20px">Ya tiene todas tus etiquetas. El catálogo se edita desde el computador.</div>';
}
async function ponerEtiqueta(t){
  var l = leadAbierto; if (!l) return;
  var antes = (l.tags || []).slice();
  if (antes.indexOf(t) >= 0) { cerrarSheet(); return; }
  var nuevas = antes.concat([t]);
  l.tags = nuevas;
  cerrarSheet(); pintarFicha();
  var d = await guardar('/api/leads', { id: l.id, tags: nuevas }, 'PUT', function(){
    l.tags = antes;
    pintarFicha();
  });
  if (d) { l.hace = 'ahora'; l.tocado = Date.now(); pintarLeads(); }
}

async function guardarNota(){
  var ta = $('#sh-nota'), l = leadAbierto;
  var texto = ta ? ta.value.trim() : '';
  // Cerrar la hoja con la nota escrita y sin guardarla la pierde sin avisar.
  if (!texto) { chicharra('Escribe la nota antes de guardar.', 'mal'); return; }
  if (!l) { chicharra('No hay ningún contacto abierto.', 'mal'); return; }
  var d = await guardar('/api/lead-activities',
    { lead_id: l.id, type: 'nota', content: texto }, 'POST');
  if (!d) return;   // el texto se queda en la hoja para reintentar
  cerrarSheet();
  // Tocar el lead: toda la inactividad del CRM cuelga de `updated_at`, y una
  // nota que no lo mueve deja al contacto marcado como abandonado.
  l.hace = 'ahora'; l.tocado = Date.now();
  pintarFicha(); pintarLeads(); pintarPulso(); pintarSubtitulos();
}
function abrirEtapas(){
  var l = leadAbierto; if (!l) return;
  abrirSheet(ETAPAS.map(function(e){
    return '<button class="opcion" aria-current="'+(l.etapa===e.k)+'" onclick="M.ponerEtapa(\''+e.k+'\')">'
      + '<span class="chip '+e.k+'">'+esc(e.t)+'</span>'
      + '<span class="marca">'+icn('check',18)+'</span></button>';
  }).join(''));
}
function ponerEtapa(k){
  if (!leadAbierto) return;
  var l = leadAbierto, antes = l.etapa;
  if (antes === k) { cerrarSheet(); return; }
  // Se pinta ya y se deshace si falla: en un teléfono la red tarda, y esperar
  // con la pantalla quieta se siente roto. Lo que no se hace es dar por bueno
  // el cambio pase lo que pase.
  l.etapa = k;
  toque(12);
  cerrarSheet(); pintarFicha(); pintarFiltros(); pintarLeads(); pintarPulso(); pintarSubtitulos();
  guardar('/api/leads', { id: l.id, stage: k }, 'PUT', function(){
    l.etapa = antes;
    pintarFicha(); pintarFiltros(); pintarLeads(); pintarPulso(); pintarSubtitulos();
  });
}
function nuevoLead(){
  // Nombre y teléfono en campos SEPARADOS. Un solo cuadro con «Nombre y
  // teléfono» obliga a adivinar dónde acaba uno y empieza el otro, y lo que se
  // adivina mal se guarda mal.
  abrirSheet('<div style="font-weight:700;font-size:var(--fs-md);margin-bottom:10px">Contacto nuevo</div>'
    + '<input id="sh-nom" type="text" placeholder="Nombre">'
    + '<input id="sh-tel" type="tel" placeholder="Teléfono" style="margin-top:8px">'
    + '<input id="sh-mail" type="email" placeholder="Email (opcional)" style="margin-top:8px">'
    + '<button class="bbtn" onclick="M.crearLead()">Crear contacto</button>');
}
async function crearLead(){
  var nom = ($('#sh-nom') || {}).value, tel = ($('#sh-tel') || {}).value, mail = ($('#sh-mail') || {}).value;
  nom = String(nom || '').trim(); tel = String(tel || '').trim(); mail = String(mail || '').trim();
  if (!nom) { chicharra('Ponle un nombre al contacto.', 'mal'); return; }
  if (!tel && !mail) { chicharra('Hace falta un teléfono o un email para poder contactarlo.', 'mal'); return; }
  var cuerpo = { name: nom, phone: tel, email: mail, source: 'Móvil' };
  // Al tablero que se está mirando: crearlo en el principal lo mandaría a un
  // tablero que quizá ni se usa —Certain trabaja en «Arriendo»— y parecería
  // que no se guardó.
  if (pipelineActual) cuerpo.pipeline_id = pipelineActual;
  var d = await guardar('/api/leads', cuerpo, 'POST');
  if (!d) return;
  cerrarSheet();
  if (d.lead && TRADUCTOR) {
    if (LEADS === null) LEADS = [];
    LEADS.unshift(TRADUCTOR.aLead(d.lead));
    pintarLeads(); pintarFiltros(); pintarPulso(); pintarSubtitulos();
  } else {
    // Se guardó pero no sabemos con qué forma volvió: se recarga en vez de
    // inventar la fila. Una fila a medias en la lista es un lead que luego
    // no abre.
    cargarReales();
  }
}



// ── Conversaciones ──────────────────────────────────────────────────────────
// La ventana de 24 h es real: fuera de ella WhatsApp solo entrega plantillas
// aprobadas. Decirlo ANTES de que alguien escriba evita el mensaje que nunca
// llega y que el asesor da por enviado.
var CONVS = [
  {id:1, nom:'Hellen Marún', canal:'whatsapp', quien:'human', nolei:2, cuando:'10:24',
   prev:'Perfecto, ¿el jueves a las 9 te sirve para la visita?', horas:1},
  {id:2, nom:'Andrés Ramírez', canal:'whatsapp', quien:'bot', nolei:0, cuando:'09:12',
   prev:'Listo, quedaste agendado para el jueves 24 a las 9:00 a. m.', horas:3},
  {id:3, nom:'paula.rstrp', canal:'instagram', quien:'bot', nolei:1, cuando:'ayer',
   prev:'¿Tienen algo en Buenavista con parqueadero?', horas:20},
  {id:4, nom:'Visitante web', canal:'webchat', quien:'human', nolei:0, cuando:'ayer',
   prev:'Gracias, quedo atento al correo con la ficha.', horas:26},
  {id:5, nom:'Rubén Corro', canal:'messenger', quien:'bot', nolei:0, cuando:'lun',
   prev:'El local del centro mide 120 m² y está en $3.200.000 mensuales.', horas:72}
];
var MENSAJES = {
  1:[
    {de:'ellos', t:'Hola, vi el apartamento AP-2231 en la página', h:'10:02'},
    {de:'nos',   t:'¡Hola Hellen! Con gusto te ayudo. ¿Buscas para arriendo o compra?', h:'10:03'},
    {de:'ellos', t:'Arriendo, somos dos personas y tenemos un perro', h:'10:15'},
    {de:'nota',  t:'Ya le pasé la ficha por correo. Atiende Karen.', h:'10:18'},
    {de:'nos',   t:'Perfecto, el AP-2231 acepta mascotas.', h:'10:20'},
    {de:'ellos', t:'¿Se puede visitar esta semana?', h:'10:24'}
  ]
};
var RAPIDAS = ['¡Hola! ¿En qué te ayudo?','Te comparto la ficha','¿Te sirve mañana?','Quedo atento'];
var ICONO_CANAL = {whatsapp:'chat', instagram:'star', messenger:'chat', webchat:'bot'};
var BOTS = [
  {id:1, nom:'Asesor de arriendos', canal:'WhatsApp · Sede Envigado', on:true,  convs:'42 conversaciones este mes'},
  {id:2, nom:'Atención Instagram',  canal:'Instagram Direct',         on:true,  convs:'11 conversaciones este mes'},
  {id:3, nom:'Chat de la web',      canal:'certainpezzano.com',       on:false, convs:'Apagado desde el 12 de septiembre'}
];
var convAbierta = null;
var modoNota = false;

function pintarConvs(){
  if (CONVS === null) {
    $('#bandeja .lista').innerHTML = sinLista('tus conversaciones');
    return;
  }
  if (!CONVS.length) {
    $('#bandeja .lista').innerHTML = '<div class="vacio">Ninguna conversación todavía.</div>';
    return;
  }
  $('#bandeja .lista').innerHTML = CONVS.map(function(c){
    return '<button class="conv'+(c.nolei?' nolei':'')+'" onclick="M.abrirConv(\''+c.id+'\')">'
      + '<span class="ini">'+esc(c.nom[0])
        + '<span class="canal '+c.canal+'">'+icn(ICONO_CANAL[c.canal]||'chat',10)+'</span></span>'
      + '<span class="cuerpo">'
        + '<span class="arriba"><span class="nom">'+esc(c.nom)+'</span>'
          + '<span class="quien '+c.quien+'">'+ETIQ_QUIEN[c.quien]+'</span>'
          + '<span class="cuando">'+esc(c.cuando)+'</span></span>'
        + '<span class="prev">'+esc(c.prev)+'</span></span>'
      + (c.nolei ? '<span class="bolita">'+c.nolei+'</span>' : '')
      + '</button>';
  }).join('');
}
function abrirConv(id){
  var c = null;
  for (var i=0;i<CONVS.length;i++) if (String(CONVS[i].id) === String(id)) c = CONVS[i];
  if (!c) return;
  convAbierta = c; c.nolei = 0;
  // Con sesión, el hilo se pide; sin ella se usa el de ejemplo para poder
  // revisar el diseño. Antes se buscaba SIEMPRE en la lista de ejemplo, y con
  // un id de verdad no casaba nunca: se veía un solo mensaje —el último— y se
  // respondía a ciegas.
  var ms = (MODO === 'real') ? null : (MENSAJES[id] || [{de:'ellos', t:c.prev, h:c.cuando}]);
  // La ventana de 24 h es de WhatsApp, Messenger e Instagram. El chat de la
  // web no la tiene: avisar ahí de algo que no aplica enseña a ignorar avisos.
  var tieneVentana = ['whatsapp','messenger','instagram'].indexOf(c.canal) >= 0;
  var dentro = !tieneVentana || c.horas < 24;
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-conv';
  h.innerHTML =
    '<div class="cab"><button class="volver" onclick="M.cerrarConv()">'+icn('arrow',24)+'</button>'
    + '<div style="flex:1;min-width:0"><h1 style="font-size:var(--fs-md)">'+esc(c.nom)+'</h1>'
      + '<div class="sub">'+esc(c.canal)+' · '+DICE_QUIEN[c.quien]+'</div></div>'
    + '<button class="volver" style="transform:none" onclick="M.abrirEstado()">'+icn('gear',22)+'</button></div>'
    + (tieneVentana
       ? '<div class="ventana'+(dentro?' ok':'')+'">'
         + (dentro
            ? 'Dentro de la ventana de 24 horas: puedes escribirle con normalidad.'
            : 'Pasaron más de 24 horas desde su último mensaje. Solo le llegará una plantilla aprobada.')
         + '</div>'
       : '')
    + '<div class="hilo" style="padding-bottom:150px">'
      + (ms === null ? '<div class="vacio">Trayendo la conversación…</div>' : burbujas(ms))
    + '</div>'
    + '<div class="compositor">'
      + '<div class="modo">'
        + '<button aria-pressed="'+dentro+'" onclick="M.ponerModo(false)"'+(dentro?'':' disabled')+'>Responder</button>'
        + '<button class="es-nota" aria-pressed="'+(!dentro)+'" onclick="M.ponerModo(true)">Nota interna</button></div>'
      + (dentro
         ? '<div class="rapidas">'+RAPIDAS.map(function(r){
             return '<button class="rapida" onclick="M.meter(this.textContent)">'+esc(r)+'</button>';
           }).join('')+'</div>'
         : '<button class="bbtn" style="margin:0 0 8px" onclick="M.abrirPlantillas()">Enviar una plantilla aprobada</button>')
      + '<div class="escribir"><textarea id="redactar" rows="1" placeholder="'
        + (dentro ? 'Escribe un mensaje' : 'Nota interna: el cliente no la ve') + '"></textarea>'
        + '<button class="enviar" onclick="M.enviarMsg()" aria-label="Enviar">'+icn('arrow',20)+'</button></div>'
    + '</div>';
  modoNota = !dentro;
  movilRaiz().appendChild(h);
  history.pushState({hoja:1},'');
  pintarConvs();
  var hilo = h.querySelector('.hilo');
  if (hilo) h.scrollTop = h.scrollHeight;
  pedirHilo(c);
}
// Las burbujas del hilo, en un sitio: las pinta el primer dibujado y también
// el repintado cuando llegan los mensajes de verdad.
function burbujas(ms){
  if (!ms.length) return '<div class="vacio">Todavía no hay mensajes en esta conversación.</div>';
  return ms.map(function(m){
    if (m.de === 'nota') {
      return '<div class="nota-int"><b>Nota interna · '+esc(m.autor || 'tu equipo')+'</b>'+esc(m.t)+'</div>';
    }
    return '<div class="burbuja '+(m.de==='nos'?'mia':'suya')+'">'+esc(m.t)
         + '<span class="h">'+esc(m.h)+'</span></div>';
  }).join('');
}

// Se pide al abrir. Si la conversación se cierra —o se abre otra— mientras los
// mensajes viajan, no se pintan encima de la que esté delante.
function pedirHilo(conv){
  if (MODO !== 'real' || typeof fetchAuth !== 'function') return;
  var quien = conv.id;
  (async function(){
    var ms = null;
    try {
      var mod = TRADUCTOR || await import('./movil-datos.js');
      TRADUCTOR = mod;
      ms = await mod.cargarHilo(fetchAuth, quien);
    } catch (e) { console.warn('[movil] hilo', e); }
    var hilo = $('#hoja-conv .hilo');
    if (!hilo || !convAbierta || String(convAbierta.id) !== String(quien)) return;
    hilo.innerHTML = ms === null
      ? '<div class="vacio">No se pudo traer la conversación.</div>'
      : burbujas(ms);
    var h = $('#hoja-conv'); if (h) h.scrollTop = h.scrollHeight;
  })();
}

function cerrarConv(){
  var h = $('#hoja-conv'); if (!h) return;
  h.classList.add('saliendo');
  setTimeout(function(){ if (h.parentNode) h.remove(); }, 200);
  convAbierta = null;
}
function ponerModo(esNota){
  modoNota = esNota;
  var bs = movilRaiz().querySelectorAll('.modo button');
  bs[0].setAttribute('aria-pressed', String(!esNota));
  bs[1].setAttribute('aria-pressed', String(esNota));
  var ta = $('#redactar');
  if (ta) ta.placeholder = esNota ? 'Nota interna: el cliente no la ve' : 'Escribe un mensaje';
  toque();
}
function meter(t){ var ta = $('#redactar'); if (ta){ ta.value = t; ta.focus(); } toque(); }
async function enviarMsg(){
  var ta = $('#redactar'); if (!ta || !ta.value.trim()) return;
  var hilo = $('#hoja-conv .hilo'); if (!hilo) return;
  var c = convAbierta;
  if (!c) { chicharra('No hay ninguna conversación abierta.', 'mal'); return; }
  var texto = ta.value.trim(), era = modoNota;
  var btn = $('#hoja-conv .enviar'); if (btn) btn.disabled = true;

  // El texto NO se borra hasta saber que salió. Si WhatsApp lo rechaza, quien
  // escribió lo pierde y encima cree que se envió.
  var d = era
    ? await guardar('/api/chat-conversations?action=nota', { conversation_id: c.id, texto: texto }, 'POST')
    : await guardar('/api/chat-conversations', { conversation_id: c.id, content: texto }, 'POST');
  if (btn) btn.disabled = false;
  if (!d) return;

  var hora = new Date().toTimeString().slice(0,5);
  var b = document.createElement('div');
  if (era){
    b.className = 'nota-int';
    b.innerHTML = '<b>Nota interna · solo la ve el equipo</b>' + esc(texto);
  } else {
    b.className = 'burbuja mia';
    b.innerHTML = esc(texto) + '<span class="h">'+hora+'</span>';
  }
  hilo.appendChild(b);
  ta.value = '';
  toque();
  var h = $('#hoja-conv'); if (h) h.scrollTop = h.scrollHeight;
  // Y se vuelve a pedir: lo que se acaba de pintar es una copia optimista, y
  // el servidor puede haberle puesto otra hora o haber metido algo en medio.
  pedirHilo(c);
}
function abrirPlantillas(){
  abrirSheet('<div style="font-weight:700;font-size:var(--fs-md);margin-bottom:4px">Plantillas aprobadas</div>'
    + '<div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:10px;line-height:1.5">'
    + 'Fuera de las 24 horas, es lo único que WhatsApp entrega.</div>'
    + ['Seguimiento de visita','Recordatorio de cita','Reactivación'].map(function(t){
        return '<button class="opcion" onclick="M.cerrarSheet()">'+esc(t)+'</button>';
      }).join(''));
}
function abrirEstado(){
  var c = convAbierta; if (!c) return;
  var ops = [['bot','Lo atiende el agente'],['human','Lo atiendo yo'],['resolved','Resuelta']];
  abrirSheet(ops.map(function(o){
    return '<button class="opcion" aria-current="'+(c.quien===o[0])+'" onclick="M.ponerQuien(\''+o[0]+'\')">'
      + esc(o[1]) + '<span class="marca">'+icn('check',18)+'</span></button>';
  }).join('')
  + '<div style="color:var(--muted);font-size:var(--fs-xs);padding:12px 4px 0;line-height:1.5">'
  + 'Mientras la atiendas tú, el agente no responde en esta conversación.</div>');
}
async function ponerQuien(q){
  var c = convAbierta; if (!c) return;
  var antes = c.quien;
  if (antes === q) { cerrarSheet(); return; }
  // Esta es la que menos puede fallar en silencio: la hoja promete que el
  // agente deja de responder. Si no se guarda, el agente sigue contestando por
  // encima del comercial y los dos le escriben al cliente a la vez.
  //
  // Por eso aquí NO se pinta antes de tiempo: primero se guarda.
  var d = await guardar('/api/chat-conversations', { id: c.id, status: q }, 'PUT');
  if (!d) return;
  c.quien = q;
  toque(12); cerrarSheet(); cerrarConv(); pintarConvs();
}

// ── Agentes IA ────────────────────────────────────────────────────────────────
function pintarBots(){
  var host = $('#chatbots .lista'); if (!host) return;
  // null es «no se pudieron traer», que no es lo mismo que no tener ninguno.
  if (BOTS === null) {
    host.innerHTML = MODO === 'cargando' ? sinLista('tus agentes')
      : '<div class="vacio">No se pudieron traer tus agentes.<br>'
      + '<button class="rapida" style="margin-top:10px" onclick="M.reintentarModulo(\'chatbots\')">Reintentar</button></div>';
    return;
  }
  if (!BOTS.length) {
    host.innerHTML = '<div class="vacio">Todavía no tienes agentes de conversación.</div>';
    return;
  }
  host.innerHTML = BOTS.map(function(b){
    return '<div class="chatbot'+(b.on?' on':'')+'" onclick="M.alternarBot(\''+esc(b.id)+'\',this)">'
      + '<div style="flex:1;min-width:0"><div class="tt">'+esc(b.nom)+'</div>'
        + '<div class="tsub">'+esc(b.canal)+'</div>'
        + '<div class="tsub" style="margin-top:4px">'+esc(b.convs)+'</div></div>'
      + '<div class="interruptor"></div></div>';
  }).join('');
}
function alternarBot(id,el){
  var b = null;
  // Los ids de la API son cadenas; el `===` contra un número del ejemplo no
  // casaba nunca y el interruptor movía la clase sin tocar el dato.
  for (var i=0;i<(BOTS||[]).length;i++) if (String(BOTS[i].id) === String(id)) b = BOTS[i];
  if (!b) return;
  var antes = b.on;
  b.on = !antes;
  el.classList.toggle('on');
  toque();
  // Apagar un agente que sigue encendido es peor que no poder apagarlo: quien
  // lo apagó deja de vigilar la conversación creyendo que nadie responde.
  guardar('/api/chat-agents', { id: b.id, is_active: b.on }, 'PUT', function(){
    b.on = antes;
    el.classList.toggle('on');
    pintarBots();
  });
}
function abrirBots_viejo(){
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-conv';
  h.innerHTML =
    '<div class="cab"><button class="volver" onclick="M.cerrarConv()">'+icn('arrow',24)+'</button>'
    + '<div><h1>Agentes IA</h1><div class="sub">Quién contesta en cada canal</div></div></div>'
    + '<div class="lista" id="bots-lista"></div>';
  movilRaiz().appendChild(h);
  $('#bots-lista').innerHTML = BOTS.map(function(b){
    return '<div class="chatbot'+(b.on?' on':'')+'" onclick="M.alternarBot(\''+b.id+'\',this)">'
      + '<div style="flex:1;min-width:0"><div class="tt">'+esc(b.nom)+'</div>'
        + '<div class="tsub">'+esc(b.canal)+'</div>'
        + '<div class="tsub" style="margin-top:4px">'+esc(b.convs)+'</div></div>'
      + '<div class="interruptor"></div></div>';
  }).join('');
  history.pushState({hoja:1},'');
}

// ── Menú «Más» y módulos de marketing ───────────────────────────────────────
// La barra inferior es del ASESOR: ocho de cada diez personas con leads
// asignados no son dueños de cuenta. Marketing y Análisis son trabajo del
// dueño, de escritorio y de una vez por semana, así que entran por aquí en
// vez de robarle un sitio al pulgar.
var MODULOS = [
  {id:'campanas', nom:'Campañas',        sub:'Correo y WhatsApp masivos', icono:'chat',     grupo:'Marketing'},
  {id:'listas',   nom:'Listas',          sub:'A quién le escribes',       icono:'users',    grupo:'Marketing'},
  {id:'autos',    nom:'Automatizaciones',sub:'Lo que pasa solo',          icono:'sparkles', grupo:'Marketing'},
  {id:'fuentes',  nom:'Fuentes',         sub:'De dónde entran los leads', icono:'link',     grupo:'Marketing'},
  {id:'props',    nom:'Propuestas',      sub:'Lo que enviaste a cerrar',  icono:'file',     grupo:'Marketing'},
  {id:'reservas', nom:'Reservas',        sub:'Citas que piden solos',     icono:'calendar', grupo:'Marketing'},
  {id:'plant',    nom:'Plantillas',      sub:'Diseños de correo',         icono:'edit',     grupo:'Marketing'},
  {id:'paginas',  nom:'Páginas',         sub:'Páginas de aterrizaje',     icono:'file',     grupo:'Marketing'}
];
var CAMPANAS = [
  {nom:'Arriendos Envigado · septiembre', est:'enviada', sub:'Correo · 1.240 contactos · hace 3 d',
   res:{Entregados:98, Abiertos:41, Clics:12}},
  {nom:'Recordatorio de visitas',         est:'activa',  sub:'WhatsApp · 86 contactos · en curso',
   res:{Entregados:72, Abiertos:64, Clics:21}},
  {nom:'Proyectos nuevos · octubre',      est:'borrador',sub:'Correo · sin programar', res:null}
];
var LISTAS = [
  {nom:'Interesados en arriendo', n:412, sub:'Etiqueta «arriendo» · se actualiza sola'},
  {nom:'Visitaron y no cerraron', n:87,  sub:'Etapa «propuesta» hace más de 15 días'},
  {nom:'No escribir',             n:23,  sub:'Exclusión · nunca reciben campañas'}
];
var AUTOS = [
  {nom:'Encuesta NPS al ganar',        on:true,  sub:'Cambio de etapa → ganado · 4 veces este mes'},
  {nom:'Seguimiento a las 2 horas',    on:true,  sub:'Lead nuevo sin contactar · 31 veces este mes'},
  {nom:'Reactivar leads dormidos',     on:false, sub:'Sin actividad 30 días · apagada'}
];
var FUENTES = [
  {nom:'Formulario certainpezzano.com', n:31, sub:'Web · último hace 2 h'},
  {nom:'Fincaraíz',                     n:59, sub:'Portal · entrada manual'},
  {nom:'Google Ads',                    n:12, sub:'Pauta · con campaña identificada'},
  {nom:'Webhook de entrada',            n:8,  sub:'Integración · último ayer'}
];
var PROPS = [
  {nom:'Paula Restrepo · Penthouse',  est:'enviada',  sub:'$ 890.000.000 · vista hace 2 h'},
  {nom:'Rubén Corro · Local centro',  est:'enviada',  sub:'$ 180.000.000 · sin abrir'},
  {nom:'Sandra Caro · Villa Campestre',est:'borrador',sub:'$ 540.000.000 · sin enviar'}
];
var RESERVAS = [
  {nom:'Visita AP-2231',     est:'activa', sub:'Jueves 24 · 09:00 · Hellen Marún'},
  {nom:'Visita Buenavista',  est:'activa', sub:'Viernes 25 · 15:00 · Paula Restrepo'},
  {nom:'Asesoría virtual',   est:'pausada',sub:'Servicio pausado · no se puede reservar'}
];

function abrirMas(){
  var grupos = {};
  MODULOS.forEach(function(m){ (grupos[m.grupo] = grupos[m.grupo] || []).push(m); });
  var html = '<div class="cab"><button class="volver" onclick="M.cerrarConv()">'+icn('arrow',24)+'</button>'
    + '<div><h1>Más</h1><div class="sub">Marketing y configuración</div></div></div>';
  Object.keys(grupos).forEach(function(g){
    html += '<div class="mgrupo">'+esc(g)+'</div>';
    html += grupos[g].map(function(m){
      return '<button class="mfila" onclick="M.abrirModulo(\''+m.id+'\')">'
        + '<span class="micono">'+icn(m.icono,18)+'</span>'
        + '<span class="cuerpo"><span class="mt">'+esc(m.nom)+'</span><span class="ms">'+esc(m.sub)+'</span></span>'
        + '<span class="chev">'+icn('arrow',18)+'</span></button>';
    }).join('');
  });
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-conv';
  h.innerHTML = html;
  movilRaiz().appendChild(h);
  history.pushState({hoja:1},'');
}

// Una sola función para los seis módulos de lista: cambian los datos, no la
// forma. Seis pantallas a medida serían seis sitios donde arreglar lo mismo.
function filaItem(x){
  var res = '';
  if (x.res) {
    res = '<div class="barras">' + Object.keys(x.res).map(function(k){
      return '<div class="barra"><div class="bt">'+esc(k)+'</div><div class="bv">'+x.res[k]+'%</div>'
           + '<div class="bl"><i style="width:'+x.res[k]+'%"></i></div></div>';
    }).join('') + '</div>';
  }
  // El interruptor era decorativo: `M.toque()` vibraba y ya. Y el texto de la
  // pantalla promete «aquí puedes encender y apagar las que ya tienes». Cuando
  // la fila trae id y estado, el toque guarda de verdad.
  var accion = (x.id && x.on !== undefined)
    ? 'M.alternarAuto(\''+esc(String(x.id))+'\',this)'
    : 'M.toque()';
  return '<button class="item'+(x.on?' on':'')+'" onclick="'+accion+'">'
    + '<span class="cuerpo"><span class="it">'+esc(x.nom)+'</span>'
      + '<span class="is">'+esc(x.sub)+'</span>'
      + (x.est ? '<span class="estado-chip '+x.est+'">'+esc(x.est)+'</span>' : '')
      + res + '</span>'
    // La unidad viene con el dato. Estaba escrita a mano —«contactos»— y en la
    // pantalla de Aperturas eso convertía un 42% en «42 contactos».
    + (x.n !== undefined ? '<span class="num"><b>'+x.n+'</b><span>'+esc(x.nu || 'contactos')+'</span></span>' : '')
    + (x.on !== undefined ? '<span class="interruptor"></span>' : '')
    + '</button>';
}
// La ficha de cada módulo: título, texto de «esto se hace en el computador» y
// los datos de EJEMPLO, que solo se usan cuando no hay sesión. Vive fuera de
// `abrirModulo` porque el repintado y el reintento también la necesitan.
function FICHA_MODULO(id){
  return {
    campanas:{t:'Campañas', datos:CAMPANAS, escritorio:
      'Armar una campaña es elegir plantilla, audiencia y fecha: son muchas decisiones seguidas y se hacen mejor en el computador. Desde aquí ves cómo van las que ya salieron.'},
    listas:  {t:'Listas',     datos:LISTAS},
    autos:   {t:'Automatizaciones', datos:AUTOS, escritorio:
      'El constructor encadena pasos y condiciones, y eso necesita espacio para verse entero. Aquí puedes encender y apagar las que ya tienes, y ver cuántas veces corrió cada una.'},
    fuentes: {t:'Fuentes',  datos:FUENTES, escritorio:
      'Conectar una fuente nueva implica copiar un código a tu web o a otra herramienta, que es cosa del computador. Aquí ves cuántos leads trae cada una y cuándo entró el último.'},
    props:   {t:'Propuestas', datos:PROPS},
    aperturas:{t:'Aperturas', datos:[], escritorio:
      'Aquí ves qué tanto se abre cada correo que ya salió. El detalle de quién abrió y cuándo se revisa en el computador.'},
    studio:  {t:'Social Studio', datos:[], escritorio:
      'Armar una parrilla es escribir, elegir imágenes y fechas: eso pide pantalla. Aquí ves las que ya tienes y cuántas publicaciones lleva cada una.'},
    reservas:{t:'Reservas', datos:RESERVAS, escritorio:
      'Los servicios, los horarios y la disponibilidad se configuran en el computador. Aquí ves las reservas que van entrando.'},
    plant:   {t:'Plantillas', escritorio:
      'Los diseños se arman arrastrando bloques, y eso necesita una pantalla grande para que salga algo usable. Desde el teléfono puedes ver cuáles tienes, duplicarlas y usarlas en una campaña.',
      datos:[{nom:'Bienvenida', sub:'Usada en 2 campañas'},{nom:'Novedades del mes', sub:'Usada en 1 campaña'}]},
    paginas: {t:'Páginas', escritorio:
      'El constructor de páginas funciona arrastrando secciones, que en un teléfono no se maneja bien. Aquí puedes ver las que tienes, copiar su enlace y consultar sus visitas.',
      datos:[{nom:'Arriendos Envigado', sub:'412 visitas · 31 formularios'},{nom:'Proyecto Altos', sub:'96 visitas · 7 formularios'}]},
    ajustes: {t:'Configuración', escritorio:
      'Los ajustes de la cuenta —equipo, permisos, plan, integraciones y catálogos— se hacen desde el computador. Son cambios que afectan a todos y conviene hacerlos con calma y la pantalla completa.',
      datos:[{nom:'Equipo', sub:'9 personas activas'},{nom:'Plan', sub:'Agency · renueva el 11 de septiembre'},{nom:'Integraciones', sub:'Google Ads, Google Calendar'}]}
  }[id];
}

// Los ids que tienen fuente propia en la API. Los que no están aquí lo dicen,
// en vez de enseñar los ejemplos como si fueran de la cuenta.
var MODULOS_API_IDS = { chatbots:1, campanas:1, listas:1, autos:1, fuentes:1, props:1, reservas:1,
  plant:1, paginas:1, aperturas:1, studio:1, ajustes:1 };
// Pintores propios que SÍ trabajan con datos reales: los sacan de lo que ya
// está en memoria, sin pedir nada. Los que no estén aquí lo dicen en vez de
// enseñar ejemplos.
var PINTORES_REALES = { analisis:1, clientes:1, academia:1, nps:1, seo:1 };
// De esos, los que además tienen que PEDIR sus datos. `analisis` y `clientes`
// salen de lo que ya está en memoria; la academia no.
var MODULOS_API_IDS_PROPIOS = { academia:1, nps:1 };

// «No hay nada» dicho con las palabras de cada módulo: un «sin resultados»
// genérico no distingue una cuenta nueva de una pantalla rota.
var VACIO_MODULO = {
  campanas: 'Todavía no has enviado ninguna campaña.',
  listas:   'Todavía no tienes listas. Se arman desde el computador.',
  autos:    'Todavía no tienes automatizaciones.',
  fuentes:  'Todavía no hay fuentes conectadas.',
  props:    'Todavía no has enviado ninguna propuesta.',
  reservas: 'Todavía no tienes servicios para reservar.',
  chatbots: 'Todavía no tienes agentes de conversación.',
  plant:    'Todavía no tienes plantillas de correo.',
  paginas:  'Todavía no tienes páginas de aterrizaje.',
  aperturas:'Todavía no ha salido ninguna campaña de correo.',
  studio:   'Todavía no tienes parrillas de contenido.',
  ajustes:  'Trabajas solo: todavía no hay nadie más en el equipo.',
};

function abrirModulo(id){
  var M = FICHA_MODULO(id);
  // Los informes y los módulos de cuenta tienen pintor propio: forzarlos a la
  // lista genérica los convertiría en tablas encogidas.
  if (!M && PINTORES[id]) {
    var t = TITULOS[id] || [id, ''];
    var hp = document.createElement('div');
    hp.className = 'hoja'; hp.id = 'hoja-mod';
    // Esta rama se me escapó al enchufar los otros módulos: pintaba los
    // EJEMPLOS sin mirar el modo, así que a una cuenta real le enseñaba
    // embudos, notas de NPS y posiciones de SEO inventadas. Mientras no
    // tengan su fuente, se dice — que es lo que hay que hacer siempre que
    // no se puede enseñar lo de verdad.
    var cuerpo = (MODO !== 'real' || PINTORES_REALES[id])
      ? PINTORES[id]()
      : '<div class="vacio">Esta pantalla todavía no trae tus datos.<br>'
        + 'Por ahora se consulta desde el computador.</div>';
    hp.innerHTML = '<div class="cab"><button class="volver" onclick="M.cerrarModulo()">'+icn('arrow',24)+'</button>'
      + '<div><h1>'+esc(t[0])+'</h1><div class="sub" id="mod-sub">'
      + esc(subtituloModulo(id, t[1])) + '</div></div></div>'
      + '<div id="mod-propio">' + cuerpo + '</div>';
    movilRaiz().appendChild(hp);
    history.pushState({hoja:1},'');
    // Los que además necesitan pedir sus datos —la academia— los piden al
    // abrirse y se repintan cuando llegan. Sin esto el pintor se quedaba
    // enseñando «Trayendo…» para siempre, que es peor que un error.
    if (MODO === 'real' && PINTORES_REALES[id] && MODULOS_API_IDS_PROPIOS[id]
        && MODULO_CACHE[id] === undefined) {
      var caja = $('#mod-propio');
      cargarModuloReal(id).then(function(datos){
        if (datos !== null) MODULO_CACHE[id] = datos; else MODULO_CACHE[id] = null;
        // La hoja pudo cerrarse o abrirse otra mientras tanto: pintar sin
        // comprobarlo metería los videos en la cabecera de otra pantalla.
        if ($('#mod-propio') !== caja) return;
        caja.innerHTML = PINTORES[id]();
        var sub = $('#mod-sub');
        if (sub) sub.textContent = subtituloModulo(id, t[1]);
      });
    }
    return;
  }
  if (!M) return;
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-mod';
  // El subtítulo de la cabecera venía escrito a mano —«3 este mes»— y mentía en
  // cuanto la cuenta no tenía tres. Se deja vacío hasta saber el número.
  h.innerHTML = '<div class="cab"><button class="volver" onclick="M.cerrarModulo()">'+icn('arrow',24)+'</button>'
    + '<div><h1>'+esc(M.t)+'</h1><div class="sub" id="mod-sub"></div></div></div>'
    // Se dice POR QUÉ no se edita aquí, no solo que no se puede: un «no
    // disponible» a secas se lee como que falta, no como que no tiene sentido.
    + (M.escritorio ? '<div class="solo-escritorio"><b>Se edita desde el computador</b>'+esc(M.escritorio)+'</div>' : '')
    + '<div class="lista" id="mod-lista"></div>';
  movilRaiz().appendChild(h);
  history.pushState({hoja:1},'');
  pintarModulo(id, M);
}

// Lo que hay dentro de un módulo, ya traído. Se guarda por módulo para no
// volver a pedirlo cada vez que se abre y se cierra la hoja.
var MODULO_CACHE = {};

function pintarModulo(id, M){
  var lista = $('#mod-lista'), sub = $('#mod-sub');
  if (!lista) return;
  // En modo muestra se siguen enseñando los ejemplos —sirven para revisar el
  // diseño— pero se dice que lo son. Lo que no puede pasar es que una cuenta
  // real los lea como suyos, que es lo que pasaba.
  if (MODO !== 'real') {
    lista.innerHTML = (M.datos || []).map(filaItem).join('');
    if (sub) sub.textContent = 'Datos de ejemplo';
    return;
  }
  var guardado = MODULO_CACHE[id];
  if (guardado !== undefined) { volcarModulo(id, guardado, M); return; }
  if (!MODULOS_API_IDS[id]) {
    // Módulos sin fuente propia todavía. Se dice, en vez de enseñar ejemplos.
    lista.innerHTML = '<div class="vacio">Esta pantalla todavía no trae tus datos. '
      + 'Por ahora se consulta desde el computador.</div>';
    if (sub) sub.textContent = '';
    return;
  }
  lista.innerHTML = '<div class="vacio">Trayendo tus datos…</div>';
  if (sub) sub.textContent = '';
  cargarModuloReal(id).then(function(datos){
    // Un fallo NO se guarda: si se cachea, un corte de red de un segundo deja
    // la pantalla diciendo «no se pudieron traer» cada vez que se abre, hasta
    // que alguien dé al botón de reintentar. Cerrar y volver a entrar es lo
    // primero que hace cualquiera, y tiene que bastar.
    if (datos !== null) MODULO_CACHE[id] = datos;
    // La hoja puede haberse cerrado —o haberse abierto otra— mientras tanto.
    // Pintar sin comprobarlo metería los datos de un módulo en la cabecera de
    // otro, que es peor que no pintarlos.
    if ($('#mod-lista') !== lista) return;
    volcarModulo(id, datos, M);
  });
}

function volcarModulo(id, datos, M){
  var lista = $('#mod-lista'), sub = $('#mod-sub');
  if (!lista) return;
  if (datos === null) {
    // Ni ejemplos ni una lista vacía: «no se pudo mirar» y se puede reintentar.
    lista.innerHTML = '<div class="vacio">No se pudieron traer estos datos.<br>'
      + '<button class="rapida" style="margin-top:10px" onclick="M.reintentarModulo(\''+esc(id)+'\')">Reintentar</button></div>';
    if (sub) sub.textContent = 'no se pudieron traer';
    return;
  }
  lista.innerHTML = datos.length
    ? datos.map(filaItem).join('')
    : '<div class="vacio">' + esc(VACIO_MODULO[id] || 'Todavía no hay nada aquí.') + '</div>';
  if (sub) sub.textContent = datos.length === 1 ? '1 en total' : datos.length + ' en total';
}

// El interruptor de una automatización, desde la lista del módulo.
function alternarAuto(id, el){
  var lista = MODULO_CACHE.autos;
  var a = null;
  for (var i=0;i<(lista||[]).length;i++) if (String(lista[i].id) === String(id)) a = lista[i];
  if (!a) return;
  var antes = a.on;
  a.on = !antes;
  el.classList.toggle('on');
  toque();
  // Una automatización que se cree apagada y siga corriendo manda correos que
  // nadie espera. En plan gratuito el servidor responde 403 con su motivo, y
  // `guardar` ya lo dice y lo deshace.
  guardar('/api/automations', { id: a.id, active: a.on }, 'PUT', function(){
    a.on = antes;
    el.classList.toggle('on');
  });
}

// ── La barra de arriba ───────────────────────────────────────────────────────
// Tres puertas, como en las aplicaciones que la gente ya sabe usar: el menú a
// la izquierda, los avisos y la cuenta a la derecha. Lo de cada día vive abajo
// al alcance del pulgar; lo de vez en cuando, aquí, sin gastar una pestaña.

function hojaConCab(id, titulo, sub, cuerpo){
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = id;
  h.innerHTML = '<div class="cab"><button class="volver" onclick="M.cerrarBarra(\''+id+'\')">'+icn('arrow',24)+'</button>'
    + '<div><h1>'+esc(titulo)+'</h1>'+(sub ? '<div class="sub">'+esc(sub)+'</div>' : '')+'</div></div>'
    + cuerpo;
  movilRaiz().appendChild(h);
  history.pushState({hoja:1},'');
  return h;
}
function cerrarBarra(id){
  var h = $('#'+id); if (!h) return;
  h.classList.add('saliendo');
  setTimeout(function(){ if (h.parentNode) h.remove(); }, 200);
}

// El menú. Lo que antes era la pestaña «Más» —una etiqueta que no dice nada—
// más lo de marketing que no cabe abajo.
function abrirMenu(){
  toque();
  var grupos = [
    ['Analizar',   ['analisis','nps','aperturas','seo']],
    ['Contenido',  ['studio','plant','paginas']],
    ['Tu cuenta',  ['clientes','academia','ajustes']],
  ];
  var cuerpo = grupos.map(function(g){
    var filas = g[1].map(function(id){
      var m = null;
      for (var i=0;i<MODULOS.length;i++) if (MODULOS[i].id === id) m = MODULOS[i];
      if (!m) return '';
      return '<button class="mfila" onclick="M.abrirModulo(\''+esc(id)+'\')">'
        + '<span class="micono">'+icn(m.icono,18)+'</span>'
        + '<span class="cuerpo"><span class="mt">'+esc(m.nom)+'</span><span class="ms">'+esc(m.sub)+'</span></span>'
        + '<span class="chev">'+icn('arrow',18)+'</span></button>';
    }).join('');
    return filas ? '<div class="mgrupo">'+esc(g[0])+'</div><div>'+filas+'</div>' : '';
  }).join('');
  hojaConCab('hoja-menu', 'Menú', '', cuerpo);
}

// Los avisos sin leer: las notas que la dirección le deja a quien atiende. Son
// las MISMAS que la campana de la web —`crmAvisos`, que carga app.js— para que
// el número de aquí y el de allá no puedan decir cosas distintas.
function avisosDeLaWeb(){
  try {
    return (typeof crmAvisos !== 'undefined' && Array.isArray(crmAvisos)) ? crmAvisos : null;
  } catch (e) { return null; }
}
async function abrirAvisos(){
  toque();
  var h = hojaConCab('hoja-avisos', 'Avisos', '',
    '<div class="lista" id="avisos-lista"><div class="vacio">Trayendo tus avisos…</div></div>');
  if (typeof crmAvisosCargar === 'function') {
    try { await crmAvisosCargar(); } catch (e) { console.warn('[movil] avisos', e); }
  }
  var caja = $('#avisos-lista'); if (!caja || !h.parentNode) return;
  var av = avisosDeLaWeb();
  if (av === null) {
    // Sin sesión no es que fallara: es que no hay de dónde traerlos. Decir «no
    // se pudo» ahí asusta por algo que no está roto.
    caja.innerHTML = MODO === 'ejemplo'
      ? '<div class="vacio">Entra con tu cuenta para ver tus avisos.</div>'
      : '<div class="vacio">No se pudieron traer tus avisos.</div>';
    return;
  }
  caja.innerHTML = av.length ? (av.map(function(a){
      var t = String(a.texto || '');
      return '<div class="aviso-fila">'
        + '<div class="at">'+esc(a.autor || 'Alguien')+(a.lead ? ' · '+esc(a.lead) : '')+'</div>'
        + '<div class="ab">'+esc(t)+'</div>'
        + (a.cuando ? '<div class="ac">'+esc(a.cuando)+'</div>' : '')
        + '</div>';
    }).join('')
    // Marcarlos leídos es una DECISIÓN, no un efecto de haber abierto la hoja:
    // quien la abre de paso, en la calle, no quiere perder el aviso.
    + '<button class="bbtn" onclick="M.leerAvisos()">Marcar como leídos</button>')
    : '<div class="vacio">No tienes avisos sin leer.</div>';
  pintarPunto();
}

async function leerAvisos(){
  // El mismo camino que la campana de la web: así el número de aquí y el de
  // allá no pueden quedarse diciendo cosas distintas.
  if (typeof crmAvisosMarcarLeidos !== 'function') {
    chicharra('No se pudo marcar como leídos.', 'mal');
    return;
  }
  toque(12);
  try { await crmAvisosMarcarLeidos(); }
  catch (e) { chicharra('No se pudo marcar como leídos.', 'mal'); return; }
  cerrarBarra('hoja-avisos');
  pintarPunto();
  pintarPulso();
}

// El número del globito. Se recalcula cada vez que algo puede haberlo movido.
function pintarPunto(){
  var p = $('#barra-punto'); if (!p) return;
  var av = avisosDeLaWeb();
  var n = (av && av.length) || 0;
  p.textContent = n > 9 ? '9+' : String(n);
  p.hidden = !n;
}

// Quién eres y cómo sales. Esta pantalla existe sobre todo por una cosa: la
// franja que ofrece el móvil promete «si no te convence, vuelves con un toque»
// y ese toque NO existía en ninguna parte. Una salida que se promete y no está
// es peor que no ofrecerla.
function quienSoy(){
  var u = null;
  try { u = (typeof clerkInstance !== 'undefined' && clerkInstance) ? clerkInstance.user : null; } catch (e) {}
  var plan = '';
  try { plan = (typeof userPlan !== 'undefined' && userPlan) ? String(userPlan) : ''; } catch (e) {}
  return {
    nom: (u && (u.fullName || u.firstName)) || '',
    correo: (u && u.primaryEmailAddress && u.primaryEmailAddress.emailAddress) || '',
    plan: plan,
  };
}
var PLAN_NOM = { free:'Gratis', trial:'Prueba de Pro', pro:'Pro', agency:'Agencia' };

function abrirPerfil(){
  toque();
  var y = quienSoy();
  var ini = (y.nom || y.correo || '?').trim().charAt(0).toUpperCase();
  var cuerpo = '<div class="perfil-cab">'
      + '<div class="perfil-ini">'+esc(ini)+'</div>'
      + '<div class="perfil-quien"><b>'+esc(y.nom || 'Tu cuenta')+'</b>'
      + (y.correo ? '<span>'+esc(y.correo)+'</span>' : '')
      + (y.plan ? '<span class="perfil-plan">'+esc(PLAN_NOM[y.plan] || y.plan)+'</span>' : '')
      + '</div></div>'
    + '<div class="lista">'
      + '<button class="mfila" onclick="M.abrirModulo(\'academia\')">'
        + '<span class="micono">'+icn('star',18)+'</span>'
        + '<span class="cuerpo"><span class="mt">Academia</span><span class="ms">Aprende a sacarle partido</span></span>'
        + '<span class="chev">'+icn('arrow',18)+'</span></button>'
      + '<button class="mfila" onclick="M.abrirModulo(\'ajustes\')">'
        + '<span class="micono">'+icn('gear',18)+'</span>'
        + '<span class="cuerpo"><span class="mt">Configuración</span><span class="ms">Equipo, plan e integraciones</span></span>'
        + '<span class="chev">'+icn('arrow',18)+'</span></button>'
      + '<button class="mfila" onclick="M.volverEscritorio()">'
        + '<span class="micono">'+icn('monitor',18)+'</span>'
        + '<span class="cuerpo"><span class="mt">Volver a la versión de siempre</span>'
        + '<span class="ms">La de escritorio, con todo lo que aquí no cabe</span></span>'
        + '<span class="chev">'+icn('arrow',18)+'</span></button>'
    + '</div>'
    + '<div class="lista"><button class="mfila salir" onclick="M.cerrarSesion()">'
      + '<span class="micono">'+icn('salir',18)+'</span>'
      + '<span class="cuerpo"><span class="mt">Cerrar sesión</span></span></button></div>';
  hojaConCab('hoja-perfil', 'Tu cuenta', '', cuerpo);
}

// Abre el video en YouTube. Sin enlace se dice: un botón que no lleva a
// ninguna parte se toca dos veces y se da por roto.
function verPestana(p){
  fichaPestana = p;
  toque();
  pintarFicha();
}

function verVideo(id){
  var vs = MODULO_CACHE.academia || [];
  var v = null;
  for (var i=0;i<vs.length;i++) if (String(vs[i].id) === String(id)) v = vs[i];
  if (!v || !v.url) { chicharra('Ese video todavía no tiene enlace.', 'mal'); return; }
  toque();
  window.open(v.url, '_blank');
}

function volverEscritorio(){
  try {
    if (window.movilEnganche && typeof window.movilEnganche.apagar === 'function') {
      window.movilEnganche.apagar();
      return;
    }
  } catch (e) { console.warn('[movil] volver', e); }
  // Sin el enganche —el boceto suelto— no hay a dónde volver, y decirlo es
  // mejor que un botón que no responde.
  chicharra('Esta es la vista de prueba: no hay versión de escritorio detrás.', 'mal');
}

function cerrarSesion(){
  if (typeof logout === 'function') { logout(); return; }
  chicharra('No se pudo cerrar la sesión desde aquí.', 'mal');
}

// ── Cliente activo (cuentas de agencia) ─────────────────────────────────────
// Una agencia trabaja la cuenta de UN cliente a la vez, y de esa elección
// cuelga todo lo que se ve debajo: leads, tableros, campañas. Sin poder
// cambiarlo desde el móvil, se trabajaba la ficha del cliente equivocado.
function clientesDeLaWeb(){
  try {
    return (typeof agencyClients !== 'undefined' && Array.isArray(agencyClients)) ? agencyClients : [];
  } catch (e) { return []; }
}
function nombreCliente(id){
  var cs = clientesDeLaWeb();
  for (var i=0;i<cs.length;i++) if (String(cs[i].id) === String(id)) {
    return cs[i].client_name || cs[i].name || 'Sin nombre';
  }
  return '';
}
// Solo se enseña cuando hay de dónde elegir. Con un cliente el selector no
// decide nada y solo quita sitio, igual que el de tableros.
function pintarBarraCliente(){
  var medio = $('#barra-medio'); if (!medio) return;
  var cs = clientesDeLaWeb();
  // La clase NO se toca: `bhueco` es la que lleva el `flex:1` que empuja los
  // iconos a los lados. Quitándola, el nombre del cliente se pegaba al menú y
  // los tres iconos se amontonaban a la izquierda.
  //
  // Se enseña con UNO también: es el contexto de todo lo que hay debajo, y sin
  // verlo no se sabe de quién son los contactos que se están mirando. Con uno
  // solo no se puede cambiar, pero se lee.
  if (!cs.length) { medio.innerHTML = ''; return; }
  var nom = esc(nombreCliente(alcanceCliente()) || 'Elegir cliente');
  // Con un solo cliente no hay nada que elegir: se pinta como etiqueta, no
  // como botón. Un botón que abre una lista de una opción ya elegida es otro
  // botón que no hace nada.
  medio.innerHTML = cs.length < 2
    ? '<div class="bcliente"><span>'+nom+'</span></div>'
    : '<button class="bcliente" onclick="M.abrirClientes()"><span>'+nom+'</span>'+icn('arrow',14)+'</button>';
}
function abrirClientes(){
  toque();
  var cs = clientesDeLaWeb(), act = alcanceCliente();
  abrirSheet('<div style="font-weight:700;font-size:var(--fs-md);margin-bottom:10px">Cliente</div>'
    + cs.map(function(c){
        var n = c.client_name || c.name || 'Sin nombre';
        return '<button class="opcion" aria-current="'+(String(c.id) === String(act))+'" '
          + 'onclick="M.elegirCliente(\''+esc(String(c.id))+'\')">'
          + esc(n) + '<span class="marca">'+icn('check',18)+'</span></button>';
      }).join('')
    + '<div style="color:var(--muted);font-size:var(--fs-xs);padding:12px 4px 0;line-height:1.5">'
    + 'Todo lo que ves —contactos, tableros y campañas— es del cliente elegido.</div>');
}
async function elegirCliente(id){
  if (String(id) === String(alcanceCliente())) { cerrarSheet(); return; }
  cerrarSheet();
  toque(12);
  // Se cambia POR LA APLICACIÓN, no a mano: así la web y el móvil quedan en el
  // mismo cliente y no hace falta una segunda copia de esa lógica.
  if (typeof window.agencyOpenClient === 'function') {
    try { await window.agencyOpenClient(id); }
    catch (e) { console.warn('[movil] cambiar de cliente', e); }
  }
  if (String(alcanceCliente()) !== String(id)) {
    chicharra('No se pudo cambiar de cliente.', 'mal');
    return;
  }
  pintarBarraCliente();
  // Y se recarga TODO: dejar los leads del cliente anterior en pantalla bajo el
  // nombre del nuevo es la peor forma de equivocarse en una agencia.
  pipelineActual = null;
  MODULO_CACHE = {};
  cargarReales();
}

// El subtítulo de estas pantallas venía escrito a mano y AFIRMABA cosas:
// «Últimos 30 días» en un embudo que no filtra por fecha, «3 clientes» en una
// cartera de cualquier tamaño. Una cabecera que afirma un número tiene que
// contarlo, y si no puede contarlo se calla.
function subtituloModulo(id, deEjemplo){
  if (MODO !== 'real') return deEjemplo || '';
  if (id === 'analisis') {
    return pipelineActual ? nombreTablero() : 'Todos los tableros';
  }
  if (id === 'clientes') {
    var n = clientesDeLaWeb().length;
    return n === 1 ? '1 cliente' : n + ' clientes';
  }
  if (id === 'ajustes') {
    var q = MODULO_CACHE.ajustes;
    if (!Array.isArray(q)) return '';
    return q.length === 1 ? '1 persona en el equipo' : q.length + ' personas en el equipo';
  }
  if (id === 'academia') {
    var vs = MODULO_CACHE.academia;
    if (!Array.isArray(vs)) return '';   // aún no llegan: no se afirma nada
    return vs.length === 1 ? '1 video' : vs.length + ' videos';
  }
  return '';
}

function reintentarModulo(id){
  delete MODULO_CACHE[id];
  var M = FICHA_MODULO(id);
  if (M) pintarModulo(id, M);
}

async function cargarModuloReal(id){
  if (typeof fetchAuth !== 'function') return null;
  try {
    var mod = TRADUCTOR || await import('./movil-datos.js');
    TRADUCTOR = mod;
    // El NPS no es una lista: viene agregado. Pasarlo por el cargador de
    // listas devolvería null —«no se pudo mirar»— sobre una respuesta buena.
    if (id === 'nps') {
      var c = alcanceCliente();
      var r = await fetchAuth('/api/nps' + (c ? '?client_id=' + encodeURIComponent(c) : ''));
      if (!r || !r.ok) return null;
      var d = await r.json();
      return (d && !d.error && typeof d.sent === 'number') ? d : null;
    }
    return await mod.cargarModulo(fetchAuth, id, { clientId: alcanceCliente() });
  } catch (e) {
    console.warn('[movil] módulo ' + id, e);
    return null;
  }
}
function cerrarModulo(){
  var h = $('#hoja-mod'); if (!h) return;
  h.classList.add('saliendo');
  setTimeout(function(){ if (h.parentNode) h.remove(); }, 200);
}

// ── Las siete restantes ─────────────────────────────────────────────────────
// Un informe en un teléfono no es una tabla encogida: es lo que se lee de un
// vistazo, de pie y con una mano. Por eso van cifras grandes y barras en vez
// de filas y columnas.
MODULOS.push(
  {id:'analisis', nom:'Análisis',   sub:'Cómo va el embudo',         icono:'chart',    grupo:'Análisis'},
  {id:'nps',      nom:'Satisfacción',sub:'Qué opinan tus clientes',  icono:'star',     grupo:'Análisis'},
  {id:'aperturas',nom:'Aperturas',  sub:'Qué correos se leen',       icono:'chat',     grupo:'Análisis'},
  {id:'clientes', nom:'Panel de clientes', sub:'Tu cartera',         icono:'users',    grupo:'Cuenta'},
  {id:'studio',   nom:'Social Studio',sub:'Tu parrilla de contenido',icono:'sparkles', grupo:'Marketing'},
  {id:'seo',      nom:'Proyecto SEO',sub:'Tus posiciones en Google', icono:'trend',    grupo:'Marketing'},
  {id:'academia', nom:'Academia',   sub:'Aprende a usar Acuarius',   icono:'file',     grupo:'Cuenta'},
  {id:'ajustes',  nom:'Configuración',sub:'Cuenta, equipo y plan',    icono:'gear',     grupo:'Cuenta'}
);

var SEO = [
  {kw:'arriendo apartamentos envigado', pos:3,  d:+2, vol:'1.300 búsquedas/mes'},
  {kw:'apartamentos zúñiga envigado',   pos:7,  d:-1, vol:'480 búsquedas/mes'},
  {kw:'inmobiliaria envigado',          pos:12, d:0,  vol:'2.100 búsquedas/mes'},
  {kw:'proyectos vis sabaneta',         pos:18, d:+5, vol:'890 búsquedas/mes'}
];

// Cada informe se pinta a su manera: forzarlos a la lista genérica los
// convertiría en tablas encogidas, que es justo lo que no queremos.
var PINTORES = {
  analisis: function(){
    // Los MISMOS informes que `crmRenderAnalytics` en la web, calculados de los
    // leads que ya están en memoria. Antes el móvil solo traía el embudo, y a
    // quien abría «Análisis» le faltaba todo lo demás.
    //
    // El alcance también es el mismo que el del CRM de al lado: si dijera otro
    // número, no se podría creer a ninguno de los dos.
    if (LEADS === null) return '<div class="vacio">No se pudieron traer tus contactos.</div>';
    var ls = LEADS.filter(function(l){ return !pipelineActual || l.pipeline === pipelineActual; });
    if (!ls.length) return '<div class="vacio">Todavía no hay contactos en este tablero.</div>';

    var ganados = [], activos = [], plataAct = 0, plataGan = 0;
    var cuenta = {}, valEtapa = {}, fuentes = {}, etiquetas = {};
    ls.forEach(function(l){
      cuenta[l.etapa] = (cuenta[l.etapa] || 0) + 1;
      valEtapa[l.etapa] = (valEtapa[l.etapa] || 0) + (l.valorNum || 0);
      var f = l.origen || 'manual';
      fuentes[f] = (fuentes[f] || 0) + 1;
      (l.tags || []).forEach(function(t){ etiquetas[t] = (etiquetas[t] || 0) + 1; });
      if (l.etapa === 'ganado') { ganados.push(l); plataGan += (l.valorNum || 0); }
      else if (!l.cerrado) { activos.push(l); plataAct += (l.valorNum || 0); }
    });
    // `ganados / total`, igual que la web. Medirlo sobre lo cerrado daba un
    // número distinto con el mismo nombre en las dos pantallas, que es peor
    // que un número imperfecto.
    var tasa = ls.length ? Math.round(ganados.length / ls.length * 100) : 0;
    var prom = activos.length ? Math.round(plataAct / activos.length) : 0;
    var pes = function(n){ return '$ ' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 }); };

    var orden = ETAPAS.map(function(e){ return e.k; });
    var claves = Object.keys(cuenta).sort(function(a, b){
      var ia = orden.indexOf(a), ib = orden.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var tope = Math.max.apply(null, claves.map(function(k){ return cuenta[k]; }));

    var barras = function(obj, tit, etiqueta){
      var ks = Object.keys(obj).sort(function(a, b){ return obj[b] - obj[a]; });
      if (!ks.length) return '';
      var max = obj[ks[0]] || 1;
      return '<div class="secc"><h2>' + esc(tit) + '</h2></div><div class="secc"><div class="caja">'
        + ks.slice(0, 12).map(function(k){
            return '<div class="barra-fila"><span class="bf">' + esc(etiqueta ? etiqueta(k) : k) + '</span>'
              + '<span class="bl"><i style="width:' + Math.round(obj[k] / max * 100) + '%"></i></span>'
              + '<b>' + obj[k] + '</b></div>';
          }).join('') + '</div></div>';
    };

    // Sin tocar en 7 días o más, ni cerrados ni con tarea pendiente: la misma
    // regla de la web. Contar uno que ya tiene su llamada agendada lo pondría
    // en rojo por un trabajo que alguien ya hizo.
    var conTarea = {};
    (TAREAS || []).forEach(function(t){ if (t.lead && !t.hecha) conTarea[t.lead] = 1; });
    var ahora = Date.now();
    var dormidos = ls.filter(function(l){
      if (l.cerrado || conTarea[l.id]) return false;
      return Math.floor((ahora - (l.tocado || 0)) / 86400000) >= 7;
    }).sort(function(a, b){ return (a.tocado || 0) - (b.tocado || 0); }).slice(0, 8);

    return '<div class="cifras" style="padding-top:14px">'
      + '<div class="cifra"><b>' + ls.length + '</b><span>' + activos.length + ' activos · ' + ganados.length + ' ganados</span></div>'
      + '<div class="cifra"><b class="chico">' + pes(plataAct) + '</b><span>en proceso</span></div>'
      + '</div><div class="cifras">'
      + '<div class="cifra"><b class="chico">' + pes(plataGan) + '</b><span>ganado · ' + tasa + '% de cierre</span></div>'
      + '<div class="cifra"><b class="chico">' + pes(prom) + '</b><span>promedio por negocio</span></div>'
      + '</div>'
      + '<div class="secc"><h2>Embudo</h2></div><div class="embudo">'
      + claves.map(function(k){
          var t = etiquetaEtapa(k);
          var cl = k === 'ganado' ? 'ganada' : k === 'perdido' ? 'perdida' : '';
          return '<div class="etapa-f ' + cl + '"><div class="ef"><b>' + esc(t) + '</b>'
            + '<span>' + cuenta[k] + (valEtapa[k] ? ' · ' + pes(valEtapa[k]) : '') + '</span></div>'
            + '<div class="eb"><i style="width:' + Math.round(cuenta[k] / tope * 100) + '%"></i></div></div>';
        }).join('')
      + '</div>'
      + barras(fuentes, 'Fuentes de leads')
      + barras(etiquetas, 'Leads por etiqueta')
      + (dormidos.length
          ? '<div class="secc"><h2>Requieren atención</h2></div><div class="lista">'
            + dormidos.map(function(l){
                var d = Math.floor((ahora - (l.tocado || 0)) / 86400000);
                return '<button class="lead" onclick="M.abrirLead(\'' + esc(String(l.id)) + '\')">'
                  + '<span class="ini urge">' + d + 'd</span>'
                  + '<span class="cuerpo"><span class="nom">' + esc(l.nom) + '</span>'
                  + '<span class="meta">' + esc(l.empresa || l.origen) + '</span></span>'
                  + '<span class="chip ' + esc(l.etapa) + '">' + esc(etiquetaEtapa(l.etapa)) + '</span></button>';
              }).join('') + '</div>'
          : '');
  },
  nps: function(){
    // El NPS de la cuenta, no una nota fija. Viene AGREGADO —no es una lista—
    // así que lo trae su propio cargador.
    // Sin sesión no hay nada que pedir: quedarse en «Trayendo…» para siempre
    // no miente, pero tampoco resuelve, y se lee como que se colgó.
    if (MODO !== 'real') return '<div class="vacio">Entra con tu cuenta para ver tu satisfacción.</div>';
    var d = MODULO_CACHE.nps;
    if (d === undefined) return '<div class="vacio">Trayendo tus respuestas…</div>';
    if (d === null) return '<div class="vacio">No se pudo traer tu satisfacción.<br>'
      + '<button class="rapida" style="margin-top:10px" onclick="M.reintentarModulo(\'nps\')">Reintentar</button></div>';
    if (!d.sent) return '<div class="vacio">Todavía no has enviado ninguna encuesta.</div>';
    if (!d.answered) return '<div class="vacio">Enviaste ' + d.sent
      + (d.sent === 1 ? ' encuesta' : ' encuestas') + ', pero nadie ha respondido todavía.</div>';

    // El NPS va de -100 a 100. Sin respuestas NO es cero: es que no se sabe, y
    // un cero ahí se lee como «te califican regular».
    var v = (d.nps === null || d.nps === undefined) ? null : d.nps;
    var clase = v === null ? '' : v >= 50 ? '' : v >= 0 ? 'tibio' : 'malo';
    var seg = function(n, c, t){
      return '<div class="nps-seg '+c+'" style="flex:'+Math.max(n, 0.001)+'" title="'+esc(t)+'"></div>';
    };
    return '<div class="nps-cab"><div class="nps-num '+clase+'">'+(v === null ? '—' : v)+'</div>'
      + '<div class="nps-sub">NPS · '+d.answered+' de '+d.sent+' respondieron</div></div>'
      + '<div class="nps-barra">'
        + seg(d.promoters, 'prom', 'Promotores')
        + seg(d.passives, 'neu', 'Neutros')
        + seg(d.detractors, 'det', 'Detractores')
      + '</div>'
      + '<div class="secc"><div class="caja">'
        + '<div class="nps-fila"><span>Promotores</span><b>'+d.promoters+'</b></div>'
        + '<div class="nps-fila"><span>Neutros</span><b>'+d.passives+'</b></div>'
        + '<div class="nps-fila"><span>Detractores</span><b>'+d.detractors+'</b></div>'
      + '</div></div>'
      + ((d.comments && d.comments.length)
          ? '<div class="secc"><h2>Lo que escribieron</h2></div><div class="lista">'
            + d.comments.slice(0, 10).map(function(c){
                return '<div class="aviso-fila"><div class="at">'+esc(c.name || 'Anónimo')
                  + ' · '+c.score+'/10</div><div class="ab">'+esc(c.comment || '')+'</div></div>';
              }).join('') + '</div>'
          : '');
  },

  clientes: function(){
    // La cartera que ya cargó la aplicación. NO se inventan contadores por
    // cliente: los leads en memoria son solo los del cliente activo, así que
    // cualquier número al lado de los demás sería un número sacado del aire.
    var cs = clientesDeLaWeb();
    if (!cs.length) return '<div class="vacio">Todavía no tienes clientes en tu cartera.<br>'
      + 'Se agregan desde el computador.</div>';
    var act = alcanceCliente();
    return '<div class="lista">' + cs.map(function(c){
      var nom = c.client_name || c.name || 'Sin nombre';
      var sub = c.client_industry || c.industria || c.business || 'Sin industria';
      var activo = String(c.id) === String(act);
      return '<button class="item" onclick="M.elegirCliente(\''+esc(String(c.id))+'\')">'
        + '<span class="cuerpo"><span class="it">'+esc(nom)+'</span>'
        + '<span class="is">'+esc(sub)+'</span>'
        + (activo ? '<span class="estado-chip activa">viendo ahora</span>' : '')
        + '</span></button>';
    }).join('') + '</div>';
  },

  seo: function(){
    // La única que NO se puede traer sola: `/api/seo-rank` es solo POST, y leer
    // una posición dispara una consulta que se paga. Abrir esta pantalla en el
    // bolsillo gastaría dinero sin que nadie lo pidiera.
    //
    // Se dice el motivo. Un «no disponible» a secas se lee como que algo está
    // roto; con el porqué, se entiende que es a propósito.
    return '<div class="vacio">Consultar tus posiciones en Google cuesta una consulta cada vez, '
      + 'así que no se hace sola al abrir esta pantalla.<br><br>'
      + 'El reporte se pide desde el computador, y ahí queda guardado.</div>';
  },
  academia: function(){
    // Los videos del catálogo, no una lista fija. Y cada fila ABRE el video:
    // antes había un botón de reproducir que solo vibraba.
    if (MODO !== 'real') return '<div class="vacio">Entra con tu cuenta para ver los videos.</div>';
    var vs = MODULO_CACHE.academia;
    if (vs === undefined) return '<div class="vacio">Trayendo los videos…</div>';
    if (vs === null) return '<div class="vacio">No se pudieron traer los videos.<br>'
      + '<button class="rapida" style="margin-top:10px" onclick="M.reintentarModulo(\'academia\')">Reintentar</button></div>';
    if (!vs.length) return '<div class="vacio">Todavía no hay videos publicados.</div>';
    return '<div class="lista">' + vs.map(function(v){
      return '<button class="video" onclick="M.verVideo(\''+esc(String(v.id))+'\')">'
        + '<span class="play">'+icn('arrow',20)+'</span>'
        + '<span class="cuerpo"><span class="it">'+esc(v.nom)+'</span>'
        + '<span class="is">'+esc(v.sub)+'</span></span></button>';
    }).join('') + '</div>'
  }
};
var TITULOS = {
  analisis:['Análisis','Todos los tableros'], nps:['Satisfacción',''],
  aperturas:['Aperturas',''], clientes:['Panel de clientes',''],
  studio:['Social Studio',''], seo:['Proyecto SEO',''],
  academia:['Academia','']
};

// ── Navegación: los mismos módulos que la web ───────────────────────────────
//
// La primera versión inventaba un modelo propio —Hoy, Leads, Tareas, Agenda,
// Chats— y escondía Marketing tras un icono sin nombre en una esquina. Quien
// conoce la web no lo encontraba, y con razón: la web se organiza en cuatro
// módulos (NAV_MOD_LABELS en app.js) y aquí estaban desarmados.
//
// Ahora es la misma lógica que arriba: abajo los MÓDULOS, dentro de cada uno
// sus PESTAÑAS. Quien sabe usar Acuarius en el computador sabe usarlo aquí.
var MODS = [
  {id:'inicio',     t:'Pulso',     icono:'sparkles'},
  {id:'crm',        t:'CRM',       icono:'users',  tabs:[['leads','Contactos'],['tareas','Tareas'],['agenda','Agenda']]},
  {id:'chats',      t:'Chats',     icono:'chat',   tabs:[['bandeja','Bandeja'],['chatbots','Agentes IA']]},
  {id:'marketing',  t:'Marketing', icono:'trend'}   // no 'sparkles': lo lleva el Pulso y dos pestañas con el mismo icono no se distinguen de reojo
  // «Más» ya no es una pestaña: era una etiqueta que no dice nada y ocupaba un
  // quinto del sitio de abajo. Su contenido vive en el menú de la barra, que
  // es donde se busca lo que no se usa cada día.
];
var subActual = {crm:'leads', chats:'bandeja'};

function pintarTabs(){
  $('.tabs').innerHTML = MODS.map(function(m){
    return '<button class="tab" data-v="'+m.id+'" onclick="M.verMod(\''+m.id+'\')">'
         + icn(m.icono,22) + m.t + '</button>';
  }).join('');
}
function modDe(id){
  for (var i=0;i<MODS.length;i++){
    if (MODS[i].id === id) return MODS[i];
    if (MODS[i].tabs) for (var j=0;j<MODS[i].tabs.length;j++)
      if (MODS[i].tabs[j][0] === id) return MODS[i];
  }
  return null;
}
function verMod(id){
  var m = modDe(id);
  if (m && m.tabs) { verSub(m.id, subActual[m.id] || m.tabs[0][0]); return; }
  ver(id);
}
function verSub(mod, sub){
  subActual[mod] = sub;
  ver(sub);
  pintarSubTabs(mod, sub);
}
// Las pestañas contextuales se pintan DENTRO de la pantalla activa, debajo de
// su cabecera: es donde están en la web y donde el ojo las busca.
function pintarSubTabs(mod, sub){
  var m = modDe(mod); if (!m || !m.tabs) return;
  var cont = movilRaiz().querySelector('#sub-' + sub);
  if (!cont) return;
  cont.innerHTML = m.tabs.map(function(t){
    return '<button class="subtab" aria-selected="'+(t[0]===sub)+'" onclick="M.verSub(\''+mod+'\',\''+t[0]+'\')">'
         + esc(t[1]) + '</button>';
  }).join('');
}
function ver(id){
  var vs = movilRaiz().querySelectorAll('.vista');
  for (var i=0;i<vs.length;i++) vs[i].hidden = vs[i].id !== id;
  var m = modDe(id);
  var ts = movilRaiz().querySelectorAll('.tab');
  for (var j=0;j<ts.length;j++)
    ts[j].setAttribute('aria-selected', String(m ? ts[j].dataset.v === m.id : false));
  if (m && m.tabs) pintarSubTabs(m.id, id);
  var fab = $('.fab'); if (fab) fab.hidden = (id !== 'leads');
  window.scrollTo(0,0);
}

// ── Marketing y Más, como pantallas de verdad ───────────────────────────────
// Antes Marketing vivía tras un icono sin etiqueta. Ahora tiene su sitio en la
// barra, con los mismos nueve de la web (NAV_TABS.marketing).
function pintarMenu(cont, ids){
  movilRaiz().querySelector('#'+cont).innerHTML = ids.map(function(id){
    var m = null;
    for (var i=0;i<MODULOS.length;i++) if (MODULOS[i].id === id) m = MODULOS[i];
    if (!m) return '';
    return '<button class="mfila" onclick="M.abrirModulo(\''+m.id+'\')">'
      + '<span class="micono">'+icn(m.icono,18)+'</span>'
      + '<span class="cuerpo"><span class="mt">'+esc(m.nom)+'</span><span class="ms">'+esc(m.sub)+'</span></span>'
      + '<span class="chev">'+icn('arrow',18)+'</span></button>';
  }).join('');
}
function pintarMarketing(){
  pintarMenu('lista-marketing',
    ['campanas','plant','paginas','listas','autos','fuentes','props','reservas','studio','seo']);
}

// ── Pulso ───────────────────────────────────────────────────────────────────
// La web no enseña contadores en el inicio: enseña TARJETAS accionables. Cada
// una dice qué pasó, por qué importa y qué hacer, con su tono —warn, info,
// good— y su botón. Un contador te dice «2»; una tarjeta te dice a quién
// llamar. Esto imita `pulsoBuild` de app.js.
var PULSO = [
  {tono:'warn', t:'2 mensajes sin leer',
   b:'Marilia González te escribió sobre Sandra Caro: «Ojo con este, ya preguntó dos veces por el canon. Llámala hoy.»',
   cta:'Leer', ir:function(){ abrirAvisos(); }},
  {tono:'warn', t:'CRM · 1 lead sin actividad',
   b:'Sin contacto hace más de 3 días. Incluye a «Sandra Caro» (etapa contactado).',
   cta:'Ver esos leads', ir:function(){ verMod('crm'); filtrar('contactado'); }},
  {tono:'info', t:'CRM · 2 leads nuevos hoy',
   b:'Hellen Marún, Walter Peralta. Contáctalos mientras están calientes.',
   cta:'Llamar al primero', ir:function(){ abrirLead(1); }},
  {tono:'warn', t:'Google Ads · CPA disparado',
   b:'Ayer el CPA subió un 68% frente al promedio de los 7 días previos: $84.200 contra $50.100.',
   cta:'Preguntarle al agente', ir:function(){ toque(12); }},
  {tono:'good', t:'Google Ads · últimos 7 días',
   b:'Inversión $2.951.720 · 164 conversiones · CPA $18.000',
   cta:'Ver campañas', ir:function(){ verMod('marketing'); }},
  {tono:'warn', t:'Meta Ads · conexión expirada',
   b:'El permiso de esta cuenta caducó. Hasta que se reconecte, sus cifras no entran en los informes.',
   cta:'Reconectar', ir:function(){ toque(12); }}
];
function pintarPulso(){
  var host = movilRaiz().querySelector('#pulso-lista');
  if (!host) return;
  // Con datos reales el Pulso se calcula de ellos. Con ejemplos, se usa la
  // lista fija: así se puede revisar el diseño sin cuenta.
  if (typeof MODO !== 'undefined' && MODO === 'real') {
    // Primero lo del CRM, que ya está en memoria y se pinta al instante. Las
    // de pauta llegan por red y se añaden cuando lleguen: hacer esperar el
    // Pulso entero por una consulta a Google es castigar a quien solo quiere
    // ver a quién llamar.
    pintarTarjetas(host, pulsoDeDatos());
    tarjetasDePauta().then(function(mas){
      if (mas.length) pintarTarjetas(host, pulsoDeDatos().concat(mas));
    });
    return;
  }
  // Los ejemplos, SOLO cuando no hay ninguna sesión —revisar el diseño suelto—.
  // Antes bastaba con que el modo no fuera 'real', así que durante la carga y
  // también cuando la carga FALLABA se pintaban las tarjetas inventadas a una
  // cuenta de verdad.
  if (MODO !== 'ejemplo') {
    PULSO_VISIBLE = [];
    host.innerHTML = MODO === 'cargando'
      ? '<div class="pulso-vacio">Trayendo lo tuyo…</div>'
      : '<div class="pulso-vacio">No se pudo traer tu Pulso.</div>';
    return;
  }
  // Un Pulso vacío es una buena noticia y hay que decirlo así, no dejar un
  // hueco en blanco que parece que no cargó.
  PULSO_VISIBLE = PULSO.slice();
  host.innerHTML = PULSO.length ? PULSO.map(function(c,i){
    return '<div class="pcard '+c.tono+'">'
      + '<div class="pt">'+esc(c.t)+'</div>'
      + '<div class="pb">'+esc(c.b)+'</div>'
      + '<button class="pa" onclick="M.pulsoIr('+i+')">'+esc(c.cta)+icn('arrow',14)+'</button>'
      + '</div>';
  }).join('') : '<div class="pulso-vacio">Todo en orden por ahora.<br>Nada pide tu atención hoy.</div>';
}
function pulsoIr(i){
  toque();
  // De lo que hay en pantalla, no de la lista de ejemplo.
  var c = PULSO_VISIBLE[i] || PULSO[i];
  if (c && c.ir) c.ir();
}

// ── Ficha: embudo y tres pestañas, como la web ──────────────────────────────
// La ficha web tiene el embudo arriba y tres pestañas —«Quién es», «Qué ha
// pasado», «Qué falta»—. La versión móvil era una lista plana, y es la
// pantalla que más se abre: merece la misma estructura.
var fichaPestana = 'quien';
function pintarFicha(){
  var l = leadAbierto; if (!l || !$('#ficha-cuerpo')) return;
  $('#ficha-cuerpo').innerHTML =
      pintarEmbudoFicha(l)
    + '<div class="ftabs">'
      + [['quien','Quién es'],['pasado','Qué ha pasado'],['falta','Qué falta']].map(function(p){
          return '<button class="ftab" aria-selected="'+(fichaPestana===p[0])+'" '
               // Por `M.`, como todo lo demás. Un `onclick` en línea corre en el
               // ámbito GLOBAL, y desde que el fichero va envuelto ni
               // `fichaPestana` ni `pintarFicha` existen ahí: las tres
               // pestañas de la ficha llevaban muertas desde entonces —
               // `ReferenceError` en consola y nada al tocarlas—.
               + 'onclick="M.verPestana(\''+p[0]+'\')">'+esc(p[1])+'</button>';
        }).join('')
    + '</div>'
    + (fichaPestana === 'quien' ? fichaQuien(l)
     : fichaPestana === 'pasado' ? fichaPasado(l) : fichaFalta(l));
}
function pintarEmbudoFicha(l){
  var iActual = 0;
  for (var i=0;i<ETAPAS.length;i++) if (ETAPAS[i].k === l.etapa) iActual = i;
  return '<div class="fem">' + ETAPAS.map(function(e,i){
    var cl = e.k === l.etapa ? 'actual' : (i < iActual ? 'hecho' : '');
    return '<button class="fpaso '+cl+'" onclick="M.ponerEtapa(\''+e.k+'\')">'+esc(e.t)+'</button>';
  }).join('') + '</div>';
}
// Los mismos campos que «Quién es» en la web, y editables de un toque: en el
// teléfono un campo que no se puede corregir obliga a abrir el computador
// justo cuando el dato está fresco.
function fichaQuien(l){
  var campos = [
    ['Empresa',        l.empresa],
    ['Email',          l.email],
    ['Teléfono',       l.tel],
    ['Valor',          l.valor],
    ['Fuente',         l.origen],
    ['Campaña',        l.campana],
    ['Página',         l.pagina],
    ['Cierre esperado',l.cierre],
    ['Responsable',    l.resp]
  ];
  return '<div class="secc"><h2>Quién es</h2><div class="caja">'
    + campos.map(function(c){
        var vacio = !c[1];
        // El lápiz solo en lo que de verdad se edita aquí. Ponerlo en la
        // fuente o en el responsable prometía algo que al tocarlo se niega:
        // un adorno que dice «puedes» y responde «no».
        var editable = !!CAMPOS_FICHA[c[0]];
        return '<div class="fcampo" onclick="M.editarCampo(\''+esc(c[0])+'\')">'
          + '<span class="k">'+esc(c[0])+'</span>'
          + '<span class="v'+(vacio?' sindato':'')+'">'+esc(vacio ? 'Sin dato' : c[1])+'</span>'
          + (editable ? '<span class="lapiz">'+icn('edit',14)+'</span>' : '')+'</div>';
      }).join('')
    + '</div>'
    + '<h2>Etiquetas</h2><div class="caja"><div class="tags">'
      + (l.tags || []).map(function(t){ return '<span class="tag">'+esc(t)+'</span>'; }).join('')
      + '<button class="tag" onclick="M.abrirEtiquetas()" style="border-style:dashed;color:var(--blue)">+ etiqueta</button>'
    + '</div></div>'
    + '<h2>Qué busca</h2><div class="caja">'+esc(l.interes)+'</div></div>';
}
// Qué campo de la ficha es qué columna, y de qué tipo. Los que NO están aquí
// no se editan a mano a propósito: la fuente y el responsable son catálogos o
// personas —un cuadro de texto libre los rompería— y la campaña y la página
// las pone la atribución de pauta. Ofrecer un campo que no se puede guardar es
// el mismo engaño que arreglamos, solo que más tarde.
var CAMPOS_FICHA = {
  'Empresa':         { api: 'company',              movil: 'empresa', tipo: 'texto' },
  'Email':           { api: 'email',                movil: 'email',   tipo: 'email' },
  'Teléfono':        { api: 'phone',                movil: 'tel',     tipo: 'tel'   },
  'Valor':           { api: 'value',                movil: 'valor',   tipo: 'plata' },
  'Cierre esperado': { api: 'expected_close_date',  movil: 'cierre',  tipo: 'dia'   },
};
var PORQUE_NO = {
  'Fuente':      'La fuente sale del catálogo de la cuenta y la edita quien la administra, desde el computador.',
  'Campaña':     'La campaña y la página las pone la atribución de pauta cuando entra el lead. Cambiarlas a mano partiría el reporte en dos.',
  'Página':      'La campaña y la página las pone la atribución de pauta cuando entra el lead. Cambiarlas a mano partiría el reporte en dos.',
  'Responsable': 'Reasignar es elegir a alguien del equipo, y esa lista se maneja desde el computador.',
};
function editarCampo(campo){
  var def = CAMPOS_FICHA[campo];
  if (!def) {
    abrirSheet('<div style="font-weight:700;font-size:var(--fs-md);margin-bottom:10px">'+esc(campo)+'</div>'
      + '<div class="solo-escritorio" style="margin:0"><b>Aquí no se edita</b>'
      + esc(PORQUE_NO[campo] || 'Este dato se cambia desde el computador.') + '</div>'
      + '<button class="bbtn" onclick="M.cerrarSheet()">Entendido</button>');
    return;
  }
  var l = leadAbierto;
  var actual = l ? (l[def.movil] || '') : '';
  var entrada = def.tipo === 'dia'
    ? '<input id="sh-campo" type="date">'
    : '<input id="sh-campo" type="' + (def.tipo === 'plata' ? 'number' : def.tipo === 'email' ? 'email' : def.tipo === 'tel' ? 'tel' : 'text')
      + '" value="' + esc(def.tipo === 'plata' ? '' : actual) + '" placeholder="Escribe el nuevo valor">';
  abrirSheet('<div style="font-weight:700;font-size:var(--fs-md);margin-bottom:10px">'+esc(campo)+'</div>'
    + entrada
    + '<button class="bbtn" onclick="M.guardarCampo(\''+esc(campo)+'\')">Guardar</button>');
}
async function guardarCampo(campo){
  var def = CAMPOS_FICHA[campo], l = leadAbierto, e = $('#sh-campo');
  if (!def || !l || !e) return;
  var crudo = String(e.value || '').trim();
  if (!crudo) { chicharra('Escribe un valor antes de guardar.', 'mal'); return; }
  var valor = crudo;
  if (def.tipo === 'plata') {
    var n = Number(crudo.replace(/[^\d.-]/g, ''));
    if (!isFinite(n)) { chicharra('El valor tiene que ser un número.', 'mal'); return; }
    valor = n;
  }
  var cuerpo = { id: l.id };
  cuerpo[def.api] = valor;
  var d = await guardar('/api/leads', cuerpo, 'PUT');
  if (!d) return;
  cerrarSheet();
  // Se repinta con lo que devolvió el SERVIDOR, no con lo que se escribió: si
  // normalizó el teléfono o redondeó el importe, la ficha tiene que enseñar lo
  // que quedó guardado y no lo que uno creyó guardar.
  var guardado = d.lead ? d.lead[def.api] : valor;
  var T = TRADUCTOR;
  l[def.movil] = (def.tipo === 'plata' && T) ? T.plata(guardado)
    : (def.tipo === 'dia' && T) ? T.diaSuelto(guardado)
    : (guardado == null ? '' : String(guardado));
  pintarFicha(); pintarLeads();
}
// Lo que cuelga del contacto abierto. Se pide al abrir una de estas dos
// pestañas y se guarda por lead: volver de «Quién es» no lo vuelve a pedir.
var FICHA_CACHE = {};
var _fichaPidiendo = null;

// «hace 2 h» sin duplicar la función: la de `movil-datos.js` ya está cargada
// cuando esto se pinta. Una segunda copia diría otra cosa con el tiempo.
function cuandoFue(iso){
  try { return (TRADUCTOR && iso) ? (TRADUCTOR.hace(iso) || '') : ''; }
  catch (e) { return ''; }
}

function fichaDatos(){
  var l = leadAbierto;
  return (l && FICHA_CACHE[l.id]) || null;
}

function pedirFicha(){
  var l = leadAbierto;
  if (!l || MODO !== 'real' || typeof fetchAuth !== 'function') return;
  if (FICHA_CACHE[l.id] !== undefined || _fichaPidiendo === l.id) return;
  _fichaPidiendo = l.id;
  var quien = l.id;
  (async function(){
    var d = null;
    try {
      var mod = TRADUCTOR || await import('./movil-datos.js');
      TRADUCTOR = mod;
      d = await mod.cargarFicha(fetchAuth, quien, { clientId: alcanceCliente() });
    } catch (e) { console.warn('[movil] ficha', e); }
    _fichaPidiendo = null;
    // Todo null es que no se pudo mirar nada; se guarda igual para no pedirlo
    // en bucle, y cada caja dirá lo suyo.
    FICHA_CACHE[quien] = d || {};
    // La ficha pudo cerrarse o abrirse otra mientras viajaba.
    if (leadAbierto && leadAbierto.id === quien) pintarFicha();
  })();
}

function fichaPasado(l){
  if (MODO !== 'real') return '<div class="secc"><div class="vacio">Entra con tu cuenta para ver su historial.</div></div>';
  var d = fichaDatos();
  if (!d) { pedirFicha(); return '<div class="secc"><div class="vacio">Trayendo su historial…</div></div>'; }
  if (d.hitos === null) return '<div class="secc"><div class="vacio">No se pudo traer su historial.</div></div>';
  if (!d.hitos.length) return '<div class="secc"><div class="vacio">Todavía no hay nada registrado de este contacto.</div></div>';
  return '<div class="secc"><h2>Todo lo que ha pasado</h2><div class="caja">'
    + d.hitos.map(function(x){
        return '<div class="hito"><span class="cuando">'+esc(x.cuando)+'</span><span>'+esc(x.que)+'</span></div>';
      }).join('')
    + '</div></div>';
}
// Las mismas cajas que la tercera columna de la web.
function fichaFalta(l){
  var caja = function(tit, filas, vacio){
    return '<h2>'+esc(tit)+'</h2><div class="caja">'
      + (filas.length ? filas.map(function(f){
          return '<div class="hito"><span class="cuando">'+esc(f[0])+'</span><span>'+esc(f[1])+'</span></div>';
        }).join('') : '<div style="color:var(--muted);font-size:var(--fs-sm)">'+esc(vacio)+'</div>')
      + '</div>';
  };
  if (MODO !== 'real') return '<div class="secc"><div class="vacio">Entra con tu cuenta para ver lo suyo.</div></div>';
  var d = fichaDatos();
  if (!d) { pedirFicha(); return '<div class="secc"><div class="vacio">Trayendo lo suyo…</div></div>'; }

  // Cada caja dice lo suyo: null es «no se pudo traer» y [] es «no hay». Antes
  // las siete estaban escritas a mano, y la de tareas metía el nombre REAL del
  // contacto en una tarea que no existía.
  var de = function(tit, lista, pinta, vacio){
    if (lista === null || lista === undefined) {
      return '<h2>'+esc(tit)+'</h2><div class="caja"><div style="color:var(--muted);font-size:var(--fs-sm)">'
        + 'No se pudo traer.</div></div>';
    }
    return caja(tit, lista.map(pinta), vacio);
  };

  var autos = d.autos;
  var filasAutos = autos ? (autos.pendientes || []).map(function(a){
      return ['en curso', (a.nombre || a.name || 'Automatización')];
    }).concat((autos.hechas || []).slice(0, 3).map(function(a){
      return [a.fallo ? 'falló' : 'hecha', (a.nombre || a.name || 'Automatización')];
    })) : null;

  return '<div class="secc">'
    + de('Tareas', d.tareas, function(t){ return [t.cuando === 'vencida' ? 'vencida' : t.s, t.t]; },
         'Ninguna tarea pendiente.')
    + de('Citas', d.citas, function(c){ return [c.h, c.t]; }, 'Ninguna cita agendada.')
    + (filasAutos === null
        ? de('Automatizaciones', null, null, '')
        : caja('Automatizaciones', filasAutos, 'Ninguna en curso.'))
    + de('Campañas', d.campanas, function(e){
        return [cuandoFue(e.sent_at || e.created_at), (e.name || e.campaign_name || 'Campaña')
          + (e.opened_at ? ' · abierta' : '')];
      }, 'No ha recibido campañas.')
    + (d.nps === null || d.nps === undefined
        ? caja('Satisfacción', [], 'Todavía no se le ha encuestado.')
        : caja('Satisfacción', [[String(d.nps.nota) + '/10', d.nps.comentario || d.nps.categoria || 'Sin comentario']], ''))
    + de('Propuestas', d.props, function(x){
        return [cuandoFue(x.created_at), (x.title || 'Propuesta') + (x.status ? ' · ' + x.status : '')];
      }, 'Ninguna propuesta enviada.')
    + de('Conversaciones', d.convs, function(c){
        return [c.canal, c.cuando + ' · ' + (c.quien === 'bot' ? 'la atiende el agente' : 'la atiendes tú')];
      }, 'Sin conversaciones.')
    + '</div>';
}

// El Pulso calculado de los datos de verdad. Las mismas reglas que la web:
// tareas vencidas, leads sin tocar hace más de 3 días, y los que entraron hoy.
function pulsoDeDatos(){
  // Las MISMAS tres reglas que `pulsoCrmCards` en app.js. Antes el móvil
  // inventaba las suyas —tareas vencidas, leads en etapa «nuevo»— y por eso
  // no decía lo mismo que la web sobre la misma cuenta, que es peor que no
  // decir nada: dos números distintos y ninguno de fiar.
  var cards = [];
  var DIA = 864e5, ahora = Date.now();
  var leads = (typeof LEADS !== 'undefined' && LEADS) ? LEADS : [];
  // El tablero elegido manda: anunciar «6 sin actividad» de toda la cuenta y
  // mandar a un tablero donde hay dos es lo mismo que mentir.
  if (pipelineActual) leads = leads.filter(function(l){ return l.pipeline === pipelineActual; });

  // Un lead con una tarea pendiente NO está abandonado: alguien ya quedó en
  // hacer algo. Es la misma salvedad que hace la web.
  var conTarea = {};
  if (typeof TAREAS !== 'undefined' && TAREAS) {
    TAREAS.forEach(function(t){ if (t.lead && !t.hecha) conTarea[t.lead] = true; });
  }

  // Tareas vencidas, lo primero. Misma regla que la web, y el mismo montón que
  // enseña la pantalla de Tareas a la que lleva el botón: si el aviso dijera un
  // número y la lista otro, no se podría creer a ninguno de los dos.
  //
  // `TAREAS === null` es «no se pudieron traer», que no es «ninguna». Decir
  // cero aquí sería dejar al asesor creyendo que está al día.
  if (typeof TAREAS !== 'undefined' && TAREAS === null) {
    cards.push({tono:'warn',
      t: 'CRM · No se pudieron cargar las tareas',
      b: 'No podemos decirte si tienes pendientes vencidos.',
      cta:'Abrir Tareas', ir:function(){ verMod('crm'); verSub('crm','tareas'); }});
  } else {
    var venc = (typeof TAREAS !== 'undefined' && TAREAS)
      ? TAREAS.filter(function(t){ return t.cuando === 'vencida' && !t.hecha; }) : [];
    if (venc.length) {
      // Llegan ordenadas por fecha de la API, así que la primera es la peor.
      var peor = venc[0];
      var deQuien = null;
      if (peor.lead && typeof LEADS !== 'undefined' && LEADS) {
        var dl = LEADS.filter(function(l){ return l.id === peor.lead; })[0];
        if (dl) deQuien = dl.nom;
      }
      cards.push({tono:'warn',
        t: 'CRM · ' + venc.length + (venc.length === 1 ? ' tarea vencida' : ' tareas vencidas'),
        b: 'La más atrasada: «' + peor.t + '»' + (deQuien ? ' — ' + deQuien : '')
           + (peor.s && peor.s !== 'Sin fecha' ? ' (' + peor.s + ')' : '') + '.',
        cta:'Ver cuáles', ir:function(){ verMod('crm'); verSub('crm','tareas'); }});
    }
  }

  var stale = leads.filter(function(l){
    return !l.cerrado && !conTarea[l.id] && (ahora - (l.tocado || 0)) > 3 * DIA;
  });
  if (stale.length) {
    cards.push({tono:'warn',
      t: 'CRM · ' + stale.length + (stale.length === 1 ? ' lead sin actividad' : ' leads sin actividad'),
      b: 'Sin contacto hace más de 3 días. Incluye a «' + stale[0].nom + '»'
         + (stale[0].etapa ? ' (etapa ' + etiquetaEtapa(stale[0].etapa) + ')' : '') + '.',
      cta:'Ver cuáles', ir:function(){ verMod('crm'); verSub('crm','leads'); }});
  }

  var fresh = leads.filter(function(l){ return (ahora - (l.creado || 0)) < DIA; });
  if (fresh.length) {
    cards.push({tono:'good',
      t: 'CRM · ' + fresh.length + (fresh.length === 1 ? ' lead nuevo' : ' leads nuevos') + ' hoy',
      b: fresh.slice(0,2).map(function(l){ return l.nom; }).join(', ')
         + (fresh.length > 2 ? ' y más' : '') + '. Contáctalos mientras están calientes.',
      cta:'Verlos', ir:function(){ verMod('crm'); verSub('crm','leads'); }});
  }

  // Esta no está en la web porque allí la bandeja se ve de un vistazo en el
  // menú. En el teléfono está a dos toques, así que se anuncia.
  var sinLeer = (typeof CONVS !== 'undefined' && CONVS)
    ? CONVS.filter(function(c){ return c.nolei > 0; }) : [];
  if (sinLeer.length) {
    cards.push({tono:'warn',
      t: sinLeer.length === 1 ? '1 conversación sin leer' : sinLeer.length + ' conversaciones sin leer',
      b: 'La más reciente, de ' + sinLeer[0].nom + '.',
      cta:'Abrir la bandeja', ir:function(){ verMod('chats'); }});
  }
  return cards;
}

// Las tarjetas de Google Ads y Meta.
//
// NO se reimplementan sus reglas. Dentro de la aplicación, app.js ya trae
// `pulsoGoogleCards` y `pulsoMetaCards` con su detección de anomalías —CPA
// disparado, conversiones caídas, gasto disparado— y sus avisos de conexión
// caducada. Copiar todo eso aquí sería garantizar que dentro de un mes la web
// y el móvil digan cosas distintas sobre la misma cuenta.
//
// Suelto, en movil.html, esas funciones no existen: entonces no hay tarjetas
// de pauta, y se nota porque no aparecen. Mejor que enseñar unas inventadas.
function tarjetasDePauta(){
  var fuentes = [];
  if (typeof window.pulsoGoogleCards === 'function') fuentes.push({ p: 'Google Ads', f: window.pulsoGoogleCards });
  if (typeof window.pulsoMetaCards === 'function') fuentes.push({ p: 'Meta Ads', f: window.pulsoMetaCards });
  if (!fuentes.length) return Promise.resolve([]);
  return Promise.all(fuentes.map(function(s){
    // Que una red falle no puede dejar sin Pulso a la otra ni al CRM.
    return Promise.resolve().then(s.f).then(function(l){
      return (l || []).map(function(c){ return { c: c, p: s.p }; });
    }).catch(function(e){
      console.warn('[movil] tarjetas de pauta:', e);
      return [];
    });
  })).then(function(listas){
    var fuera = [];
    listas.forEach(function(l){ l.forEach(function(x){
      var m = deLaWeb(x.c);
      // El `act` de la web abre el chat del agente, que en modo móvil está
      // oculto: el botón no haría NADA. Un botón que no hace nada es peor que
      // no tenerlo, así que aquí lleva a donde sí hay algo que ver.
      m.cta = 'Ver detalle';
      m.ir = (function(c, p){ return function(){ hojaPauta(c, p); }; })(x.c, x.p);
      fuera.push(m);
    }); });
    return fuera;
  });
}

// El dato completo y dónde se sigue. No se promete lo que aquí no se puede
// hacer: revisar la cuenta con el agente necesita la pantalla del computador.
function hojaPauta(c, plataforma){
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-mod';
  h.innerHTML = '<div class="cab"><button class="volver" onclick="M.cerrarModulo()">'+icn('arrow',24)+'</button>'
    + '<div><h1>'+esc(c.title || 'Tu pauta')+'</h1><div class="sub">'+esc(plataforma || '')+'</div></div></div>'
    + '<div class="lista"><div class="pcard warn"><div class="pb">'+esc(c.body || '')+'</div></div></div>'
    + '<div class="solo-escritorio"><b>Se revisa desde el computador</b>'
    + 'Para entrar a la cuenta y decirte qué campaña lo explica, el agente necesita la pantalla completa. '
    + 'Aquí tienes el dato a tiempo; el ajuste se hace allá.</div>';
  movilRaiz().appendChild(h);
  history.pushState({hoja:1},'');
}

// De la forma que usa la web a la del móvil. Una sola traducción, aquí.
function deLaWeb(c){
  return {
    tono: c.tone === 'good' ? 'good' : c.tone === 'info' ? 'info' : 'warn',
    t: c.title || '',
    b: c.body || '',
    // «Investigar con el agente →» ya trae su flecha; aquí la pone el icono.
    cta: String(c.actLabel || 'Ver').replace(/\s*→\s*$/, ''),
    ir: typeof c.act === 'function' ? c.act : function(){},
  };
}

// Las que están AHORA en pantalla. Antes se guardaban encima de la lista de
// ejemplo, y con el pintado en dos fases —primero el CRM, luego la pauta— los
// índices se pisaban: el botón de una tarjeta acababa ejecutando la acción de
// otra. Un botón que hace lo que no dice es peor que uno que no hace nada.
var PULSO_VISIBLE = [];

function pintarTarjetas(host, cards){
  // Un Pulso vacío con datos REALES es una buena noticia. Con datos que no se
  // pudieron traer sería una mentira, y por eso ese caso lo dice el aviso de
  // arriba y no esta función.
  PULSO_VISIBLE = cards.slice();
  host.innerHTML = cards.length ? cards.map(function(c,i){
    return '<div class="pcard '+c.tono+'">'
      + '<div class="pt">'+esc(c.t)+'</div><div class="pb">'+esc(c.b)+'</div>'
      + '<button class="pa" onclick="M.pulsoIr('+i+')">'+esc(c.cta)+icn('arrow',14)+'</button></div>';
  }).join('') : '<div class="pulso-vacio">Todo en orden por ahora.<br>Nada pide tu atención hoy.</div>';
}

// ── Datos reales ────────────────────────────────────────────────────────────
//
// Hasta aquí el boceto dibujaba con ejemplos. Esto lo enchufa a la cuenta de
// quien entra, usando `movil-datos.js` para traducir.
//
// La regla que manda sobre todo lo demás: NUNCA se hace pasar un dato de
// ejemplo por uno real. Si no hay sesión, se dice y se sigue con los ejemplos
// para poder revisar el diseño. Si hay sesión pero la consulta falla, NO se
// cae de vuelta a los ejemplos: se dice que no se pudo mirar. Rellenar un
// hueco con datos inventados es la peor forma posible de fallar en un CRM.

var MODO = 'ejemplo';   // 'ejemplo' | 'cargando' | 'real' | 'fallo'
var DATOS = null;
var TRADUCTOR = null;   // el módulo movil-datos.js, una vez cargado

function pintarModo(){
  var av = movilRaiz().querySelector('#inicio .aviso');
  if (!av) return;
  if (MODO === 'ejemplo') {
    av.className = 'aviso';
    av.innerHTML = 'Boceto con datos de ejemplo. Entra con tu cuenta para ver los tuyos.';
  } else if (MODO === 'cargando') {
    av.className = 'aviso';
    av.innerHTML = 'Trayendo tus datos…';
  } else if (MODO === 'fallo') {
    // Ni ejemplos ni ceros: se dice lo que pasó y se ofrece reintentar.
    av.className = 'aviso';
    av.style.background = '#FFF3E0'; av.style.color = '#B26A00';
    av.innerHTML = 'No se pudieron traer tus datos. Lo que ves abajo puede estar incompleto. '
      + '<button class="rapida" style="margin-top:6px" onclick="M.cargarReales()">Reintentar</button>';
  } else {
    av.remove();   // con datos reales el aviso sobra
  }
}

// Una pantalla sin datos tiene que distinguir «no tienes» de «no se pudo
// mirar». La capa de datos ya devuelve null para lo segundo; aquí se pinta.
function vacioODuda(lista, hayTexto, noSePudo){
  return lista === null
    ? '<div class="vacio">' + esc(noSePudo) + '</div>'
    : '<div class="vacio">' + esc(hayTexto) + '</div>';
}

// El alcance de cliente con el que trabaja la aplicación de escritorio.
//
// De él cuelgan los TABLEROS: pedirlos sin alcance devuelve solo los que no
// tienen cliente —en Certain, uno de cuatro—, mientras que /api/leads sin
// alcance devuelve TODA la cuenta. Por eso el móvil enseñaba 369 contactos de
// cuatro tableros revueltos y ningún selector: los leads de un mundo y los
// tableros de otro.
//
// Se lee a pelo y NO por `window`: en app.js es un `let` de nivel superior, y
// esos no quedan en el objeto global —solo los `function` y los `var`—.
function alcanceCliente(){
  try {
    return (typeof agencyActiveClientId !== 'undefined' && agencyActiveClientId) || '';
  } catch (e) { return ''; }
}

// app.js lo resuelve de forma asíncrona al arrancar. Si el móvil se monta
// antes, cargaría con un alcance y la web con otro, y las dos enseñarían
// cuentas distintas. Se espera a que haya alcance O a que llegue la cartera.
//
// Esperar SOLO el alcance no bastaba: en una cuenta de agencia nunca llega
// solo. La aplicación lo activa automáticamente únicamente en las cuentas Pro;
// en las de agencia lo restaura del localStorage, que es del NAVEGADOR — así
// que en el teléfono está vacío la primera vez, por muy elegido que esté en el
// computador.
function esperarAlcance(tope){
  return new Promise(function(listo){
    var t0 = Date.now();
    (function mirar(){
      if (alcanceCliente() || clientesDeLaWeb().length || Date.now() - t0 > tope) { listo(); return; }
      setTimeout(mirar, 120);
    })();
  });
}

// Con qué cliente entra el móvil. Sin esto una cuenta de agencia entraba SIN
// alcance, y entonces los tableros se piden con alcance nulo —donde solo está
// el Principal, vacío— mientras los leads vienen de toda la cuenta. Eso es lo
// que enseñaba 377 contactos revueltos y ningún selector.
async function alcanceInicial(){
  await esperarAlcance(4000);
  var act = alcanceCliente();
  if (act) return act;
  var cs = clientesDeLaWeb();
  if (!cs.length) return '';         // cuenta sin cartera: no hay nada que elegir
  // La misma regla que usa la aplicación en una cuenta Pro: el principal si
  // está, y si no el primero. Con un solo cliente no hay nada que preguntar, y
  // con varios el selector de la barra deja cambiarlo en un toque.
  var elegido = null;
  for (var i=0;i<cs.length;i++) if (String(cs[i].id) === 'pro_main') elegido = cs[i];
  if (!elegido) elegido = cs[0];
  // Se activa POR LA APLICACIÓN, para que la web quede en el mismo cliente.
  if (typeof window.agencyOpenClient === 'function') {
    try { await window.agencyOpenClient(elegido.id); }
    catch (e) { console.warn('[movil] alcance inicial', e); }
  }
  return alcanceCliente();
}

var _alcanceUsado = null;   // con cuál se cargó, para saber si cambió

async function cargarReales(){
  if (typeof fetchAuth !== 'function') { MODO = 'ejemplo'; pintarModo(); return; }
  MODO = 'cargando';
  // También aquí: al móvil suelto se le resuelve la sesión más tarde, y desde
  // ese instante los ejemplos dejan de poder enseñarse.
  vaciarEjemplos();
  pintarModo(); repintarTodo();
  var d;
  try {
    // Relativo, no absoluto: con '/movil-datos.js' la ruta apunta a la raíz
    // del sitio, que es correcto al servirlo pero imposible de abrir desde un
    // fichero local. Y probar el boceto en local es medio trabajo.
    var mod = await import('./movil-datos.js');
    // Se guarda para poder REUSAR sus formateadores al guardar un campo. Un
    // segundo formateador aquí haría que el mismo importe se viera distinto
    // según si acabas de escribirlo o lo trajo la carga.
    TRADUCTOR = mod;
    var cliente = await alcanceInicial();
    _alcanceUsado = cliente;
    d = await mod.cargarTodo(fetchAuth, { clientId: cliente });
  } catch (e) {
    console.warn('movil: no se pudo cargar', e);
    MODO = 'fallo'; pintarModo(); return;
  }
  DATOS = d;
  // Si TODO vino null, la cuenta no respondió: no es que esté vacía.
  if (d.leads === null && d.tareas === null && d.convs === null) {
    MODO = 'fallo'; pintarModo(); return;
  }
  // Se asignan TAL CUAL, nulls incluidos.
  //
  // La primera versión hacía `if (d.tareas !== null) TAREAS = d.tareas`, que
  // parece prudente y es lo contrario: cuando la consulta de la agenda fallaba,
  // la pantalla seguía enseñando las tareas de EJEMPLO mientras el resto ya
  // eran datos reales de la cuenta. Datos inventados presentándose como
  // propios, que es la peor forma de fallar que tiene un CRM.
  //
  // Cada pantalla ya sabe pintar el null: «No se pudieron traer tus tareas».
  PIPELINES = d.pipelines;
  LEADS  = d.leads;
  TAREAS = d.tareas;
  if (PIPELINES && PIPELINES.length > 1 && LEADS && LEADS.length && !pipelineActual) {
    // El que más leads tiene. Certain trabaja en «Arriendo» y su principal
    // está vacío: arrancar ahí parecería una cuenta sin contactos.
    var cuenta = {};
    LEADS.forEach(function(l){ if (l.pipeline) cuenta[l.pipeline] = (cuenta[l.pipeline]||0)+1; });
    var mejor = null;
    PIPELINES.forEach(function(p){ if (!mejor || (cuenta[p.id]||0) > (cuenta[mejor]||0)) mejor = p.id; });
    if (mejor && cuenta[mejor]) pipelineActual = mejor;
  }
  CITAS  = d.citas;
  CONVS  = d.convs;
  MODO = 'real';
  // Los agentes salían de la lista de EJEMPLO aunque la cuenta fuera real:
  // «Asesor de arriendos · 42 conversaciones este mes» se lo leía como suyo
  // cualquiera. Hasta que lleguen los de verdad, null —«no se pudo mirar»—,
  // nunca los inventados.
  BOTS = null;
  pintarModo();
  repintarTodo();
  cargarModuloReal('chatbots').then(function(ags){
    BOTS = ags;
    pintarBots();
  });
  // El globito de la campana: si no se piden, el número sale a cero y parece
  // que no hay nada pendiente cuando sí lo hay.
  if (typeof crmAvisosCargar === 'function') {
    Promise.resolve().then(crmAvisosCargar).then(pintarPunto).catch(function(e){
      console.warn('[movil] avisos', e);
    });
  }
  // Si el alcance llegó tarde —app.js lo resuelve por su cuenta— se recarga una
  // vez con el bueno. Quedarse con el equivocado enseñaría otra cuenta que la
  // web, que es justo lo que se está arreglando.
  if (!_alcanceUsado) {
    setTimeout(function(){
      if (alcanceCliente() && alcanceCliente() !== _alcanceUsado) cargarReales();
    }, 4000);
  }
}

function repintarTodo(){
  pintarTableros(); pintarFiltros(); pintarLeads(); pintarTareas(); pintarAgenda();
  pintarConvs(); pintarBots(); pintarPulso(); pintarSubtitulos();
  pintarBarraCliente(); pintarPunto();
}

// ── La sesión ───────────────────────────────────────────────────────────────
// El boceto es una página suelta: no tiene el Clerk de la aplicación. Se carga
// aquí con la MISMA clave publicable, para que la sesión sea la misma y no
// haya que entrar dos veces.
var clerkMovil = null;
async function abrirSesion(){
  try {
    if (!window.Clerk) return false;
    await window.Clerk.load();
    clerkMovil = window.Clerk;
    return !!clerkMovil.session;
  } catch (e) { console.warn('movil: clerk', e); return false; }
}

// El mismo contrato que `fetchAuth` de app.js: devuelve la Response, no lanza
// en 4xx. Quien llama decide, igual que en el resto del proyecto.
async function fetchAuth(url, opts){
  opts = opts || {};
  var token = null;
  try { token = clerkMovil && clerkMovil.session ? await clerkMovil.session.getToken() : null; } catch (e) {}
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  for (var k in (opts.headers || {})) headers[k] = opts.headers[k];
  return fetch(url, Object.assign({}, opts, { headers: headers }));
}

async function arrancar(){
  var hay = await abrirSesion();
  if (!hay) { MODO = 'ejemplo'; pintarModo(); return; }
  await cargarReales();
}

// Los subtítulos de cada cabecera, calculados.
//
// Estaban escritos a mano en el HTML, y con datos reales mentían: la cabecera
// decía «1 vencida · 2 para hoy» mientras el cuerpo decía que no se pudieron
// traer las tareas. Una cabecera que afirma un número que nadie pudo contar es
// la misma mentira que una lista vacía haciéndose pasar por «no hay».
function pintarSubtitulos(){
  var s = function(id, txt){
    var v = movilRaiz().querySelector('#'+id);
    if (!v) return;
    var sub = v.querySelector('.cab .sub');
    if (sub) sub.textContent = txt;
  };
  var cuenta = function(lista, uno, varios, noSePudo){
    if (lista === null) return noSePudo;
    if (!lista.length) return varios.replace('{n}', '0');
    return (lista.length === 1 ? uno : varios).replace('{n}', lista.length);
  };
  var visibles = (LEADS === null) ? null : leadsVisibles();
  s('leads', (LEADS === null) ? 'no se pudieron traer'
    : cuenta(visibles, '1 contacto', '{n} contactos', 'no se pudieron traer')
      + (pipelineActual ? ' · ' + nombreTablero() : ''));
  s('tareas', TAREAS === null ? 'no se pudieron traer' : (function(){
    var v = TAREAS.filter(function(t){ return t.cuando === 'vencida' && !t.hecha; }).length;
    var h = TAREAS.filter(function(t){ return t.cuando === 'hoy' && !t.hecha; }).length;
    if (!v && !h) return 'nada pendiente hoy';
    return (v ? v + (v === 1 ? ' vencida' : ' vencidas') : '') + (v && h ? ' · ' : '')
         + (h ? h + ' para hoy' : '');
  })());
  s('agenda', cuenta(CITAS, '1 cita', '{n} citas', 'no se pudo traer'));
  s('bandeja', CONVS === null ? 'no se pudieron traer' : (function(){
    var n = CONVS.filter(function(c){ return c.nolei > 0; }).length;
    return n ? n + (n === 1 ? ' sin leer' : ' sin leer') : 'todo leído';
  })());
}

// Lo pone en marcha quien lo carga. `traeSesion` dice si hay que esperar a
// Clerk (página suelta) o si ya lo trae la aplicación.
var MOVIL_MARCA = `<div class="barra">
  <button class="bicono" onclick="M.abrirMenu()" aria-label="Men&uacute;">${icn('menu',21)}</button>
  <div class="bhueco" id="barra-medio"></div>
  <button class="bicono" onclick="M.abrirAvisos()" aria-label="Avisos">${icn('bell',21)}<span class="bpunto" id="barra-punto" hidden></span></button>
  <button class="bicono" onclick="M.abrirPerfil()" aria-label="Tu cuenta">${icn('users',21)}</button>
</div>

<div class="vista" id="inicio">
  <div class="pulso-cab"><h1>Pulso</h1><span class="cuando">jueves 24, 9:12</span></div>
  <div class="aviso">Boceto de la versi&oacute;n m&oacute;vil. Los datos son de ejemplo: nada de lo que toques aqu&iacute; es real.</div>
  <div id="pulso-lista"></div>
</div>

<div class="vista" id="leads" hidden>
  <div class="cab"><div><h1>CRM</h1><div class="sub">6 contactos activos</div></div></div>
  <div class="subtabs" id="sub-leads"></div>
  <div class="tableros" hidden></div>
  <div class="buscar"><input type="search" placeholder="Buscar contacto" oninput="M.buscar(this.value)" enterkeyhint="search"></div>
  <div class="filtros"></div>
  <div class="lista"></div>
</div>

<div class="vista" id="tareas" hidden>
  <div class="cab"><div><h1>CRM</h1><div class="sub">1 vencida &middot; 2 para hoy</div></div></div>
  <div class="subtabs" id="sub-tareas"></div>
  <div class="lista"></div>
</div>

<div class="vista" id="agenda" hidden>
  <div class="cab"><div><h1>CRM</h1><div class="sub">jueves 24 &middot; 3 citas</div></div></div>
  <div class="subtabs" id="sub-agenda"></div>
  <div class="lista"></div>
</div>

<div class="vista" id="bandeja" hidden>
  <div class="cab"><div><h1>Conversaciones</h1><div class="sub">3 sin leer</div></div></div>
  <div class="subtabs" id="sub-bandeja"></div>
  <div class="lista"></div>
</div>

<div class="vista" id="chatbots" hidden>
  <div class="cab"><div><h1>Conversaciones</h1><div class="sub">Qui&eacute;n contesta en cada canal</div></div></div>
  <div class="subtabs" id="sub-chatbots"></div>
  <div class="lista"></div>
</div>

<div class="vista" id="marketing" hidden>
  <div class="cab"><div><h1>Marketing</h1><div class="sub">Campa&ntilde;as, contenido y captaci&oacute;n</div></div></div>
  <div id="lista-marketing"></div>
</div>

<button class="fab" onclick="M.nuevoLead()" hidden>${icn('plus',22)}<span>Contacto</span></button>
<nav class="tabs"></nav>`;

// Dónde vive el móvil. Suelto es el <body>; dentro de la aplicación, su
// contenedor. Las hojas se cuelgan de aquí y no del body, o se saldrían del
// recuadro y taparían la aplicación de escritorio que sigue debajo.
var _raiz = null;
function movilRaiz(){ return _raiz || document.body; }

function movilMontar(opciones){
  opciones = opciones || {};
  _raiz = opciones.host || document.getElementById('movil-host') || document.body;
  if (!_raiz.querySelector('.tabs')) _raiz.innerHTML = MOVIL_MARCA;
  // El orden importa y esto enseñó datos de otra persona: ANTES se pintaba
  // todo con los ejemplos y DESPUÉS se miraba si había sesión. Quien entraba
  // veía un Pulso ajeno hasta que llegaban sus datos.
  if (opciones.fetchAuth) { MODO = 'cargando'; vaciarEjemplos(); }
  pintarTabs(); pintarFiltros(); pintarLeads(); pintarTareas(); pintarAgenda();
  pintarConvs(); pintarBots(); pintarPulso(); pintarMarketing();
  verMod('inicio');
  if (opciones.fetchAuth) {
    // Dentro de la aplicación la sesión ya está resuelta: se reutiliza su
    // fetchAuth en vez de abrir una segunda con Clerk, que obligaría a entrar
    // dos veces y podría desincronizar los dos tokens.
    fetchAuth = opciones.fetchAuth;
    clerkMovil = { session: true };
    cargarReales();
    return;
  }
  (function esperarClerk(intentos){
    if (window.Clerk) { arrancar(); return; }
    if (intentos > 40) { MODO = 'ejemplo'; pintarModo(); return; }
    setTimeout(function(){ esperarClerk(intentos + 1); }, 150);
  })(0);
}

  // Lo único que sale al espacio global.
  window.movilMontar = movilMontar;
  window.M = {
    abrirTableros: abrirTableros,
    elegirTablero: elegirTablero,
    abrirConv: abrirConv,
    abrirEstado: abrirEstado,
    abrirLead: abrirLead,
    abrirModulo: abrirModulo,
    abrirNota: abrirNota,
    abrirPlantillas: abrirPlantillas,
    alternarBot: alternarBot,
    buscar: buscar,
    cargarReales: cargarReales,
    cerrarConv: cerrarConv,
    cerrarLead: cerrarLead,
    cerrarModulo: cerrarModulo,
    cerrarSheet: cerrarSheet,
    editarCampo: editarCampo,
    enviarMsg: enviarMsg,
    filtrar: filtrar,
    leerAvisos: leerAvisos,
    marcar: marcar,
    meter: meter,
    nuevoLead: nuevoLead,
    ponerEtapa: ponerEtapa,
    ponerModo: ponerModo,
    ponerQuien: ponerQuien,
    pulsoIr: pulsoIr,
    guardarNota: guardarNota, guardarCampo: guardarCampo, crearLead: crearLead,
    reintentarModulo: reintentarModulo,
    llamar: llamar, whatsapp: whatsapp,
    abrirMenu: abrirMenu, abrirAvisos: abrirAvisos, abrirPerfil: abrirPerfil,
    cerrarBarra: cerrarBarra, volverEscritorio: volverEscritorio, cerrarSesion: cerrarSesion,
    abrirClientes: abrirClientes, elegirCliente: elegirCliente,
    verVideo: verVideo, verPestana: verPestana,
    abrirEtiquetas: abrirEtiquetas, ponerEtiqueta: ponerEtiqueta,
    alternarAuto: alternarAuto,
    toque: toque,
    verMod: verMod,
    verSub: verSub,
  };
})();
