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
   interes:'Apartamento 2 hab · Alto Prado', valor:'$ 320.000.000', resp:'Karen Acosta', tags:['arriendo','alto-prado'],
   email:'hellen.marun@example.com', empresa:'', campana:'Search - general 2026', pagina:'Arriendos Envigado', cierre:'30 sep'},
  {id:2,nom:'Rubén Corro',      etapa:'contactado', hace:'ayer',     origen:'Fincaraíz',      tel:'+57 311 220 4417',
   interes:'Local comercial · Centro', valor:'$ 180.000.000', resp:'Maira Ballesteros', tags:['venta']},
  {id:3,nom:'Sandra Caro',      etapa:'contactado', hace:'ayer',     origen:'Google Ads',     tel:'+57 315 887 1120',
   interes:'Casa 3 hab · Villa Campestre', valor:'$ 540.000.000', resp:'Karen Acosta', tags:['venta','urgente']},
  {id:4,nom:'Giancarlo Armella',etapa:'ganado',     hace:'hace 3 d', origen:'Referido',       tel:'+57 320 559 3301',
   interes:'Oficina 80 m²', valor:'$ 260.000.000', resp:'Maira Ballesteros', tags:['venta']},
  {id:5,nom:'Walter Peralta',   etapa:'nuevo',      hace:'hace 5 h', origen:'Metrocuadrado',  tel:'+57 301 778 2245',
   interes:'Apartaestudio · Riomar', valor:'$ 145.000.000', resp:'Sin asignar', tags:['arriendo']},
  {id:6,nom:'Paula Restrepo',   etapa:'propuesta',  hace:'hace 1 d', origen:'Instagram',      tel:'+57 318 004 9912',
   interes:'Penthouse · Buenavista', valor:'$ 890.000.000', resp:'Karen Acosta', tags:['venta','premium']}
];
var HITOS = [['10:24','Llamada · no contestó'],['ayer','Le envié la ficha por WhatsApp'],['ayer','Entró por el formulario de la web']];
var TAREAS = [
  {t:'Llamar a Sandra Caro',        s:'Venció ayer · 16:00', cuando:'vencida', hecha:false},
  {t:'Llamar a Hellen Marún',       s:'Hoy · 11:00',         cuando:'hoy',     hecha:false},
  {t:'Enviar propuesta a Rubén',    s:'Hoy · 15:00',         cuando:'hoy',     hecha:false},
  {t:'Confirmar visita con Paula',  s:'Mañana · 09:30',      cuando:'proxima', hecha:false},
  {t:'Llamar a Walter',             s:'Hoy · 08:10',         cuando:'hoy',     hecha:true}
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
    $('#leads .lista').innerHTML = '<div class="vacio">No se pudieron traer tus contactos.</div>';
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
    $('#tareas .lista').innerHTML = '<div class="vacio">No se pudieron traer tus tareas.</div>';
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
    $('#agenda .lista').innerHTML = '<div class="vacio">No se pudo traer tu agenda.</div>';
    return;
  }
  var html = '';
  for (var i=0;i<CITAS.length;i++){
    var c = CITAS[i];
    // La línea de «ahora» va justo antes de la primera cita que no ha pasado:
    // es lo que hace que se lea de un vistazo qué queda por delante.
    if (!c.pasada && (i===0 || CITAS[i-1].pasada)) html += '<div class="ahora">AHORA</div>';
    html += '<button class="cita" onclick="M.toque()">'
      + '<span class="hora">'+esc(c.h)+'<span class="dur">'+esc(c.dur)+'</span></span>'
      + '<span><span class="qt">'+esc(c.t)+'</span><span class="qs">'+esc(c.s)+'</span></span></button>';
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
  for (var i=0;i<LEADS.length;i++) if (LEADS[i].id===id) l = LEADS[i];
  if (!l) return;
  leadAbierto = l;
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-lead';
  h.innerHTML =
    '<div class="cab"><button class="volver" onclick="M.cerrarLead()">'+icn('arrow',24)+'</button>'
    + '<div><h1>'+esc(l.nom)+'</h1><div class="sub">'+esc(l.origen)+' · '+esc(l.hace)+'</div></div></div>'
    + '<div class="acciones">'
    + '<button class="acc pri" onclick="M.toque()">'+icn('chat',22)+'Llamar</button>'
    + '<button class="acc" onclick="M.toque()">'+icn('chat',22)+'WhatsApp</button>'
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
    $('#bandeja .lista').innerHTML = '<div class="vacio">No se pudieron traer tus conversaciones.</div>';
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
  for (var i=0;i<CONVS.length;i++) if (CONVS[i].id===id) c = CONVS[i];
  if (!c) return;
  convAbierta = c; c.nolei = 0;
  var ms = MENSAJES[id] || [{de:'ellos', t:c.prev, h:c.cuando}];
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
      + ms.map(function(m){
          if (m.de==='nota') return '<div class="nota-int"><b>Nota interna · solo la ve el equipo</b>'+esc(m.t)+'</div>';
          return '<div class="burbuja '+(m.de==='nos'?'mia':'suya')+'">'+esc(m.t)
               + '<span class="h">'+esc(m.h)+'</span></div>';
        }).join('')
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

// ── Chatbots ────────────────────────────────────────────────────────────────
function pintarBots(){
  $('#chatbots .lista').innerHTML = BOTS.map(function(b){
    return '<div class="chatbot'+(b.on?' on':'')+'" onclick="M.alternarBot(\''+b.id+'\',this)">'
      + '<div style="flex:1;min-width:0"><div class="tt">'+esc(b.nom)+'</div>'
        + '<div class="tsub">'+esc(b.canal)+'</div>'
        + '<div class="tsub" style="margin-top:4px">'+esc(b.convs)+'</div></div>'
      + '<div class="interruptor"></div></div>';
  }).join('');
}
function alternarBot(id,el){
  for (var i=0;i<BOTS.length;i++) if (BOTS[i].id===id) BOTS[i].on = !BOTS[i].on;
  el.classList.toggle('on');
  toque();
}
function abrirBots_viejo(){
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-conv';
  h.innerHTML =
    '<div class="cab"><button class="volver" onclick="M.cerrarConv()">'+icn('arrow',24)+'</button>'
    + '<div><h1>Chatbots</h1><div class="sub">Quién contesta en cada canal</div></div></div>'
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
  return '<button class="item'+(x.on?' on':'')+'" onclick="M.toque()">'
    + '<span class="cuerpo"><span class="it">'+esc(x.nom)+'</span>'
      + '<span class="is">'+esc(x.sub)+'</span>'
      + (x.est ? '<span class="estado-chip '+x.est+'">'+esc(x.est)+'</span>' : '')
      + res + '</span>'
    + (x.n !== undefined ? '<span class="num"><b>'+x.n+'</b><span>contactos</span></span>' : '')
    + (x.on !== undefined ? '<span class="interruptor"></span>' : '')
    + '</button>';
}
function abrirModulo(id){
  var M = {
    campanas:{t:'Campañas', s:'3 este mes', datos:CAMPANAS, escritorio:
      'Armar una campaña es elegir plantilla, audiencia y fecha: son muchas decisiones seguidas y se hacen mejor en el computador. Desde aquí ves cómo van las que ya salieron.'},
    listas:  {t:'Listas',   s:'3 listas',   datos:LISTAS},
    autos:   {t:'Automatizaciones', s:'2 activas', datos:AUTOS, escritorio:
      'El constructor encadena pasos y condiciones, y eso necesita espacio para verse entero. Aquí puedes encender y apagar las que ya tienes, y ver cuántas veces corrió cada una.'},
    fuentes: {t:'Fuentes',  s:'4 conectadas', datos:FUENTES, escritorio:
      'Conectar una fuente nueva implica copiar un código a tu web o a otra herramienta, que es cosa del computador. Aquí ves cuántos leads trae cada una y cuándo entró el último.'},
    props:   {t:'Propuestas', s:'3 abiertas', datos:PROPS},
    reservas:{t:'Reservas', s:'2 servicios activos', datos:RESERVAS, escritorio:
      'Los servicios, los horarios y la disponibilidad se configuran en el computador. Aquí ves las reservas que van entrando.'},
    plant:   {t:'Plantillas', s:'Diseños de correo', escritorio:
      'Los diseños se arman arrastrando bloques, y eso necesita una pantalla grande para que salga algo usable. Desde el teléfono puedes ver cuáles tienes, duplicarlas y usarlas en una campaña.',
      datos:[{nom:'Bienvenida', sub:'Usada en 2 campañas'},{nom:'Novedades del mes', sub:'Usada en 1 campaña'}]},
    paginas: {t:'Páginas', s:'Páginas de aterrizaje', escritorio:
      'El constructor de páginas funciona arrastrando secciones, que en un teléfono no se maneja bien. Aquí puedes ver las que tienes, copiar su enlace y consultar sus visitas.',
      datos:[{nom:'Arriendos Envigado', sub:'412 visitas · 31 formularios'},{nom:'Proyecto Altos', sub:'96 visitas · 7 formularios'}]},
    ajustes: {t:'Configuración', s:'Cuenta, equipo y plan', escritorio:
      'Los ajustes de la cuenta —equipo, permisos, plan, integraciones y catálogos— se hacen desde el computador. Son cambios que afectan a todos y conviene hacerlos con calma y la pantalla completa.',
      datos:[{nom:'Equipo', sub:'9 personas activas'},{nom:'Plan', sub:'Agency · renueva el 11 de septiembre'},{nom:'Integraciones', sub:'Google Ads, Google Calendar'}]}
  }[id];
  // Los informes y los módulos de cuenta tienen pintor propio: forzarlos a la
  // lista genérica los convertiría en tablas encogidas.
  if (!M && PINTORES[id]) {
    var t = TITULOS[id] || [id, ''];
    var hp = document.createElement('div');
    hp.className = 'hoja'; hp.id = 'hoja-mod';
    hp.innerHTML = '<div class="cab"><button class="volver" onclick="M.cerrarModulo()">'+icn('arrow',24)+'</button>'
      + '<div><h1>'+esc(t[0])+'</h1><div class="sub">'+esc(t[1])+'</div></div></div>'
      + PINTORES[id]();
    movilRaiz().appendChild(hp);
    history.pushState({hoja:1},'');
    return;
  }
  if (!M) return;
  var h = document.createElement('div');
  h.className = 'hoja'; h.id = 'hoja-mod';
  h.innerHTML = '<div class="cab"><button class="volver" onclick="M.cerrarModulo()">'+icn('arrow',24)+'</button>'
    + '<div><h1>'+esc(M.t)+'</h1><div class="sub">'+esc(M.s)+'</div></div></div>'
    // Se dice POR QUÉ no se edita aquí, no solo que no se puede: un «no
    // disponible» a secas se lee como que falta, no como que no tiene sentido.
    + (M.escritorio ? '<div class="solo-escritorio"><b>Se edita desde el computador</b>'+esc(M.escritorio)+'</div>' : '')
    + '<div class="lista">' + M.datos.map(filaItem).join('') + '</div>';
  movilRaiz().appendChild(h);
  history.pushState({hoja:1},'');
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

var EMBUDO = [
  {e:'Nuevo',       n:190, clase:''},
  {e:'Contactado',  n:74,  clase:''},
  {e:'Calificado',  n:61,  clase:''},
  {e:'Propuesta',   n:22,  clase:''},
  {e:'Ganado',      n:17,  clase:'ganada'},
  {e:'Perdido',     n:209, clase:'perdida'}
];
var NPS_DATOS = {valor:42, promotores:11, neutros:5, detractores:3, respuestas:19};
var APERTURAS = [
  {nom:'Arriendos Envigado · septiembre', ab:41, sub:'1.240 enviados · 508 abiertos'},
  {nom:'Recordatorio de visitas',         ab:64, sub:'86 enviados · 55 abiertos'},
  {nom:'Novedades de agosto',             ab:28, sub:'1.190 enviados · 333 abiertos'}
];
var CARTERA = [
  {nom:'Certain & Pezzano', sub:'Inmobiliaria · 328 leads · 9 del equipo', est:'activa'},
  {nom:'Forest Living',     sub:'Inmobiliaria · sin actividad 30 días',    est:'pausada'},
  {nom:'Iluminata',         sub:'Retail · 12 leads este mes',              est:'activa'}
];
var PARRILLA = [
  {t:'3 razones para arrendar en Envigado antes de fin de año', s:'Instagram · jueves 24, 18:00 · programado'},
  {t:'Recorrido por Altos del Esmeraldal',                      s:'Instagram · viernes 25, 12:00 · falta la imagen'},
  {t:'¿Cuánto necesitas ganar para arrendar en Laureles?',      s:'Facebook · lunes 28, 09:00 · borrador'}
];
var SEO = [
  {kw:'arriendo apartamentos envigado', pos:3,  d:+2, vol:'1.300 búsquedas/mes'},
  {kw:'apartamentos zúñiga envigado',   pos:7,  d:-1, vol:'480 búsquedas/mes'},
  {kw:'inmobiliaria envigado',          pos:12, d:0,  vol:'2.100 búsquedas/mes'},
  {kw:'proyectos vis sabaneta',         pos:18, d:+5, vol:'890 búsquedas/mes'}
];
var ACADEMIA = [
  {t:'Cómo armar tu proceso de venta', s:'4 videos · 18 min'},
  {t:'Campañas que sí se leen',        s:'3 videos · 12 min'},
  {t:'Automatiza el seguimiento',      s:'5 videos · 22 min'}
];

// Cada informe se pinta a su manera: forzarlos a la lista genérica los
// convertiría en tablas encogidas, que es justo lo que no queremos.
var PINTORES = {
  analisis: function(){
    var tope = Math.max.apply(null, EMBUDO.map(function(x){ return x.n; }));
    return '<div class="cifras" style="padding-top:14px">'
      + '<div class="cifra"><b>573</b><span>leads en total</span></div>'
      + '<div class="cifra"><b>3%</b><span>se ganan</span></div>'
      + '<div class="cifra urge"><b>190</b><span>sin contactar</span></div></div>'
      + '<div class="secc"><h2>Embudo</h2></div><div class="embudo">'
      + EMBUDO.map(function(x){
          return '<div class="etapa-f '+x.clase+'"><div class="ef"><b>'+esc(x.e)+'</b>'
            + '<span>'+x.n+'</span></div>'
            + '<div class="eb"><i style="width:'+Math.round(x.n/tope*100)+'%"></i></div></div>';
        }).join('')
      + '</div>'
      // El dato incómodo se dice, no se esconde: es la única razón de mirar
      // un informe.
      + '<div class="aviso" style="background:#FFF3E0;color:#B26A00">Se pierden más leads de los que se ganan, '
      + 'y el cuello está en el primer contacto: 190 esperan a que alguien los llame.</div>';
  },
  nps: function(){
    var d = NPS_DATOS, tot = d.promotores + d.neutros + d.detractores;
    var clase = d.valor >= 50 ? '' : d.valor >= 0 ? 'tibio' : 'malo';
    return '<div class="nps"><div class="val '+clase+'">'+d.valor+'</div>'
      + '<div class="et">de -100 a 100 &middot; '+d.respuestas+' respuestas</div></div>'
      + '<div class="nps-barras">'
        + '<i class="p" style="width:'+(d.promotores/tot*100)+'%"></i>'
        + '<i class="n" style="width:'+(d.neutros/tot*100)+'%"></i>'
        + '<i class="d" style="width:'+(d.detractores/tot*100)+'%"></i></div>'
      + '<div class="nps-ley"><span><b>'+d.promotores+'</b> promotores</span>'
        + '<span><b>'+d.neutros+'</b> neutros</span>'
        + '<span><b>'+d.detractores+'</b> detractores</span></div>'
      + '<div class="secc"><h2>Lo último que dijeron</h2><div class="caja">'
        + '<div class="hito"><span class="cuando">9</span><span>«Muy atentos, respondieron rápido.»</span></div>'
        + '<div class="hito"><span class="cuando">6</span><span>«La visita se movió dos veces.»</span></div>'
      + '</div></div>';
  },
  aperturas: function(){
    return '<div class="lista">' + APERTURAS.map(function(x){
      return '<div class="item"><span class="cuerpo"><span class="it">'+esc(x.nom)+'</span>'
        + '<span class="is">'+esc(x.sub)+'</span>'
        + '<span class="barras"><span class="barra"><span class="bt">Abiertos</span>'
          + '<span class="bv">'+x.ab+'%</span>'
          + '<span class="bl"><i style="width:'+x.ab+'%"></i></span></span></span></span></div>';
    }).join('') + '</div>';
  },
  clientes: function(){
    return '<div class="lista">' + CARTERA.map(function(x){
      return '<button class="item" onclick="M.toque()"><span class="cuerpo">'
        + '<span class="it">'+esc(x.nom)+'</span><span class="is">'+esc(x.sub)+'</span>'
        + '<span class="estado-chip '+x.est+'">'+esc(x.est)+'</span></span></button>';
    }).join('') + '</div>';
  },
  studio: function(){
    return '<div class="solo-escritorio"><b>Se arma desde el computador</b>'
      + 'Escribir los textos, generar las imágenes y ordenar la parrilla se hace mejor con pantalla grande. '
      + 'Aquí ves qué sale y cuándo, y qué le falta a cada publicación.</div>'
      + '<div class="lista">' + PARRILLA.map(function(x){
      return '<div class="post"><span class="lam">'+icn('sparkles',22)+'</span>'
        + '<span class="txt"><span class="pt">'+esc(x.t)+'</span>'
        + '<span class="ps">'+esc(x.s)+'</span></span></div>';
    }).join('') + '</div>';
  },
  seo: function(){
    return '<div class="lista">' + SEO.map(function(x){
      var cl = x.d > 0 ? 'sube' : x.d < 0 ? 'baja' : 'igual';
      // El signo va explícito: «+2» y «−1» se leen sin pensar; un «2» suelto
      // no dice si subió o bajó.
      var txt = x.d > 0 ? '+'+x.d : x.d < 0 ? '−'+Math.abs(x.d) : '=';
      return '<div class="kw"><span class="txt"><span class="kt">'+esc(x.kw)+'</span>'
        + '<span class="ks">'+esc(x.vol)+'</span></span>'
        + '<span class="pos"><b>'+x.pos+'</b><span class="delta '+cl+'">'+txt+'</span></span></div>';
    }).join('') + '</div>';
  },
  academia: function(){
    return '<div class="lista">' + ACADEMIA.map(function(x){
      return '<button class="video" onclick="M.toque()"><span class="play">'+icn('arrow',20)+'</span>'
        + '<span class="txt"><span class="vt">'+esc(x.t)+'</span>'
        + '<span class="vs">'+esc(x.s)+'</span></span></button>';
    }).join('') + '</div>';
  }
};
var TITULOS = {
  analisis:['Análisis','Últimos 30 días'], nps:['Satisfacción','19 respuestas'],
  aperturas:['Aperturas','3 campañas'], clientes:['Panel de clientes','3 clientes'],
  studio:['Social Studio','3 publicaciones esta semana'], seo:['Proyecto SEO','4 palabras vigiladas'],
  academia:['Academia','3 cursos']
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
  {id:'chats',      t:'Chats',     icono:'chat',   tabs:[['bandeja','Bandeja'],['chatbots','Chatbots']]},
  {id:'marketing',  t:'Marketing', icono:'sparkles'},
  {id:'mas',        t:'Más',       icono:'split'}
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
function pintarMas(){
  var html = '<div class="mgrupo">Análisis</div><div id="mas-analisis"></div>'
           + '<div class="mgrupo">Cuenta</div><div id="mas-cuenta"></div>';
  movilRaiz().querySelector('#lista-mas').innerHTML = html;
  pintarMenu('mas-analisis', ['analisis','nps','aperturas']);
  pintarMenu('mas-cuenta',   ['clientes','academia','ajustes']);
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
               + 'onclick="fichaPestana=\''+p[0]+'\';pintarFicha()">'+esc(p[1])+'</button>';
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
        return '<div class="fcampo" onclick="M.editarCampo(\''+esc(c[0])+'\')">'
          + '<span class="k">'+esc(c[0])+'</span>'
          + '<span class="v'+(vacio?' sindato':'')+'">'+esc(vacio ? 'Sin dato' : c[1])+'</span>'
          + '<span class="lapiz">'+icn('edit',14)+'</span></div>';
      }).join('')
    + '</div>'
    + '<h2>Etiquetas</h2><div class="caja"><div class="tags">'
      + (l.tags || []).map(function(t){ return '<span class="tag">'+esc(t)+'</span>'; }).join('')
      + '<button class="tag" onclick="M.toque()" style="border-style:dashed;color:var(--blue)">+ etiqueta</button>'
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
function fichaPasado(l){
  return '<div class="secc"><h2>Todo lo que ha pasado</h2><div class="caja">'
    + HITOS.concat([['12 sep','Se creó el contacto desde el formulario web']])
        .map(function(x){
          return '<div class="hito"><span class="cuando">'+esc(x[0])+'</span><span>'+esc(x[1])+'</span></div>';
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
  return '<div class="secc">'
    + caja('Tareas',          [['hoy','Llamar a '+l.nom+' · 11:00']], 'Ninguna tarea pendiente.')
    + caja('Citas',           [['jue 24','Visita AP-2231 · 09:00']],  'Ninguna cita agendada.')
    + caja('Automatizaciones',[['en curso','Seguimiento a las 2 horas · paso 2 de 3']], 'Ninguna en curso.')
    + caja('Campañas',        [['3 sep','Arriendos Envigado · abierta 2 veces']], 'No ha recibido campañas.')
    + caja('Satisfacción',    [], 'Todavía no se le ha encuestado.')
    + caja('Propuestas',      [], 'Ninguna propuesta enviada.')
    + caja('Conversaciones',  [['whatsapp','Última hace 2 h · la atiendes tú']], 'Sin conversaciones.')
    + '</div>';
}

// La campana: los mensajes que otra persona te dejó. En la web es un panel que
// cuelga del icono; aquí es una hoja, que es donde el pulgar la espera.
var AVISOS = [
  {de:'Marilia González', lead:'Sandra Caro', hace:'hace 1 h',
   txt:'Ojo con este, ya preguntó dos veces por el canon. Llámala hoy.'},
  {de:'Pierluigi Pezzano', lead:'Paula Restrepo', hace:'ayer',
   txt:'Confirmá si sigue interesada en el penthouse antes de mandar la propuesta.'}
];
function abrirAvisos(){
  abrirSheet('<div style="font-weight:700;font-size:var(--fs-md);margin-bottom:10px">Mensajes para ti</div>'
    + AVISOS.map(function(a){
        return '<div class="nota-int" style="margin-bottom:8px">'
          + '<b>' + esc(a.de) + ' · sobre ' + esc(a.lead) + ' · ' + esc(a.hace) + '</b>'
          + esc(a.txt) + '</div>';
      }).join('')
    // Marcarlos leídos es una decisión, no un efecto de haber abierto la hoja:
    // quien la abre de paso no quiere perder el aviso.
    + '<button class="bbtn" onclick="M.leerAvisos()">Marcar como leídos</button>');
}
function leerAvisos(){
  PULSO = PULSO.filter(function(c){ return c.t.indexOf('sin leer') < 0; });
  toque(12); cerrarSheet(); pintarPulso();
}

// El Pulso calculado de los datos de verdad. Las mismas reglas que la web:
// leads sin tocar hace más de 3 días, y los que entraron hoy.
function pulsoDeDatos(){
  // Las MISMAS dos reglas que `pulsoCrmCards` en app.js. Antes el móvil
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

async function cargarReales(){
  if (typeof fetchAuth !== 'function') { MODO = 'ejemplo'; pintarModo(); return; }
  MODO = 'cargando'; pintarModo();
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
    d = await mod.cargarTodo(fetchAuth);
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
  pintarModo();
  repintarTodo();
}

function repintarTodo(){
  pintarTableros(); pintarFiltros(); pintarLeads(); pintarTareas(); pintarAgenda();
  pintarConvs(); pintarBots(); pintarPulso(); pintarSubtitulos();
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
var MOVIL_MARCA = `<div class="vista" id="inicio">
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

<div class="vista" id="mas" hidden>
  <div class="cab"><div><h1>M&aacute;s</h1><div class="sub">Informes y cuenta</div></div></div>
  <div id="lista-mas"></div>
</div>

<button class="fab" onclick="M.nuevoLead()" aria-label="Contacto nuevo" hidden></button>
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
  pintarTabs(); pintarFiltros(); pintarLeads(); pintarTareas(); pintarAgenda();
  pintarConvs(); pintarBots(); pintarPulso(); pintarMarketing(); pintarMas();
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
    toque: toque,
    verMod: verMod,
    verSub: verSub,
  };
})();
