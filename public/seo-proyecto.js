// public/seo-proyecto.js — Proyecto SEO completo: la pantalla de la agencia.
//
// Reemplaza el módulo viejo de app.js (un blob por persona): ahora hay
// varios proyectos por cliente, guardados en tablas propias
// (api/seo-proyectos.js), que se miden solos (api/cron-seo.js) y se comparten
// con el cliente por un enlace vivo /seo/<código>. Lo que ve el cliente lo
// dibuja public/seo-panel.js —el mismo módulo de la página pública—, así que
// la pestaña «Lo que ve tu cliente» es exactamente eso.
//
// Se carga después de app.js: openSeoProject, seoImportKeywords y
// seoImportGeoQueries de aquí reemplazan a las de allí.

const SEO = { lista: null, cupo: null, motores: [], datos: null, enlaces: [], tab: 'cliente', seccion: 'resumen', alcance: undefined, panel: null, ocupado: false, pieza: null, piezaCliente: null };
const SEO_TABS = [['cliente', 'Lo que ve tu cliente'], ['keywords', 'Clústeres y keywords'], ['geo', 'Preguntas para las IAs'], ['contenido', 'Contenido'], ['cronograma', 'Cronograma'], ['ajustes', 'Ajustes y enlace']];
const SEO_TIPOS = [['articulo', 'Artículo'], ['pagina', 'Página'], ['landing', 'Landing'], ['post', 'Post'], ['video', 'Video'], ['otro', 'Otro']];
const SEO_PAISES = [['co', 'Colombia'], ['mx', 'México'], ['ar', 'Argentina'], ['cl', 'Chile'], ['pe', 'Perú'], ['ec', 'Ecuador'], ['es', 'España'], ['us', 'Estados Unidos']];
const SEO_CATEGORIAS = [['onpage', 'On-page'], ['tecnico', 'Técnico'], ['contenido', 'Contenido'], ['enlaces', 'Enlaces'], ['local', 'SEO local'], ['geo', 'IAs (GEO)'], ['analitica', 'Analítica'], ['otro', 'Otro']];
const SEO_ESTADOS = [['pendiente', 'Pendiente'], ['en_curso', 'En curso'], ['hecha', 'Hecha']];

const seoAlcance = () => (typeof agencyActiveClientId !== 'undefined' && agencyActiveClientId) || '';
const seoMain = () => document.getElementById('seop-main');

async function seoPanel() {
  if (!SEO.panel) SEO.panel = await import('/seo-panel.js');
  return SEO.panel;
}

async function seoGet(qs) {
  const r = await fetchAuth('/api/seo-proyectos?' + qs);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || 'No se pudo cargar el proyecto SEO');
  return d;
}
async function seoPost(body) {
  const r = await fetchAuth('/api/seo-proyectos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || 'No se pudo guardar');
  return d;
}

// ── Entrada ─────────────────────────────────────────────────────────────────
function openSeoProject() {
  showView('seo-project');
}

// La llama showView('seo-project'): todas las rutas (menú, ⌘K, /proyecto-seo)
// pasan por aquí.
async function seoAbrir() {
  const setup = document.getElementById('seop-setup');
  if (setup) setup.style.display = 'none';
  const main = seoMain();
  if (!main) return;
  main.style.display = '';
  if (SEO.alcance !== seoAlcance()) { SEO.alcance = seoAlcance(); SEO.lista = null; SEO.datos = null; }
  if (SEO.datos) return seoPintarProyecto();
  await seoCargarLista();
}

async function seoCargarLista() {
  const main = seoMain();
  main.innerHTML = '<div class="seo-adm"><p class="seo-adm-cargando">Cargando proyectos SEO…</p></div>';
  try {
    const d = await seoGet('client_id=' + encodeURIComponent(seoAlcance()));
    SEO.lista = d.proyectos; SEO.cupo = d.cupo; SEO.motores = d.motores || [];
    seoPintarLista();
  } catch (e) {
    main.innerHTML = '<div class="seo-adm">' + emptyAgua('alert', 'No se pudieron cargar los proyectos', esc(e.message),
      '<button class="btn-pri" onclick="seoCargarLista()">' + icn('refresh', 13) + ' Reintentar</button>') + '</div>';
  }
}

function seoLineaCupo() {
  const c = SEO.cupo || {};
  const parte = (x, nombre) => !x ? '' : x.error ? nombre + ': no se pudo consultar' : nombre + ': ' + x.usados + ' de ' + x.cupo;
  const t = [parte(c.posiciones, 'Mediciones de posiciones'), parte(c.geo, 'Preguntas a las IAs')].filter(Boolean).join(' · ');
  return t ? '<div class="seo-adm-cupo">Este mes — ' + t + '</div>' : '';
}

function seoPintarLista() {
  const main = seoMain();
  const lista = SEO.lista || [];
  let h = '<div class="seo-adm"><div class="seo-adm-cab"><div><h2>Proyectos SEO</h2>' +
    '<p class="seo-adm-sub">Seguimiento de posiciones, presencia en IAs y cronograma de trabajo, con un enlace en vivo para tu cliente.</p></div>' +
    '<button class="btn-pri" onclick="seoFormProyecto()">' + icn('plus', 13) + ' Nuevo proyecto</button></div>' + seoLineaCupo();
  if (!lista.length) {
    h += emptyAgua('search', 'Tu primer proyecto SEO', 'Crea un proyecto por sitio web: defines sus clústeres y keywords, las preguntas para las IAs, y el sistema mide solo cada semana.',
      '<button class="btn-pri" onclick="seoFormProyecto()">' + icn('plus', 13) + ' Crear proyecto</button>');
  } else {
    h += '<div class="seo-adm-lista">' + lista.map(p => '<button class="seo-adm-proy" onclick="seoAbrirProyecto(\'' + esc(p.id) + '\')">' +
      '<div class="seo-adm-proy-t">' + esc(p.nombre) + '</div><div class="seo-adm-proy-d">' + esc(p.dominio) + '</div>' +
      '<div class="seo-adm-proy-f">Desde ' + esc(String(p.inicio || '').slice(0, 7)) + '</div></button>').join('') + '</div>';
  }
  main.innerHTML = h + '</div>';
}

// ── Crear / editar ──────────────────────────────────────────────────────────
let _seoForm = { pais: 'co' };
function seoFormProyecto(editar) {
  const p = editar ? SEO.datos.proyecto : null;
  _seoForm = { pais: p?.pais || 'co' };
  const main = seoMain();
  main.innerHTML = '<div class="seo-adm"><div class="seo-adm-cab"><h2>' + (p ? 'Editar proyecto' : 'Nuevo proyecto SEO') + '</h2>' +
    '<button class="btn-ghost" onclick="' + (p ? 'seoPintarProyecto()' : 'seoPintarLista()') + '">Cancelar</button></div>' +
    '<div class="seo-adm-form">' +
    '<label>Nombre del proyecto<input class="auto-input" id="seo-f-nombre" value="' + esc(p?.nombre || '') + '" placeholder="Ej: Certain & Pezzano — SEO"></label>' +
    '<label>Dominio del sitio<input class="auto-input" id="seo-f-dominio" value="' + esc(p?.dominio || '') + '" placeholder="miempresa.com"></label>' +
    '<label>Marca (como la nombraría una IA)<input class="auto-input" id="seo-f-marca" value="' + esc(p?.marca || '') + '" placeholder="Ej: Certain & Pezzano"></label>' +
    '<label>País de las búsquedas<button type="button" class="dd-btn" id="seo-f-pais" onclick="seoElegirPais(this)">' + esc((SEO_PAISES.find(x => x[0] === _seoForm.pais) || [])[1] || 'Colombia') + '</button></label>' +
    '<label>Inicio del trabajo<input class="auto-input" type="date" id="seo-f-inicio" value="' + esc(p?.inicio || new Date().toISOString().slice(0, 10)) + '"></label>' +
    '<label>Nombre de tu cliente (opcional)<input class="auto-input" id="seo-f-ncli" value="' + esc(p?.nombre_cliente || '') + '" placeholder="Ej: Marilia"></label>' +
    '<label>Correo para avisarle que hay algo para revisar<input class="auto-input" id="seo-f-ccli" type="email" value="' + esc(p?.correo_cliente || '') + '" placeholder="cliente@empresa.com"></label>' +
    '<label class="seo-adm-ancho">Competidores (un dominio por línea)<textarea class="auto-input" id="seo-f-comp" rows="3" placeholder="competidor1.com&#10;competidor2.com">' + esc((p?.competidores || []).join('\n')) + '</textarea></label>' +
    (p ? '' : '<label class="seo-adm-check seo-adm-ancho"><input type="checkbox" id="seo-f-plantilla" checked> Agregar al cronograma la configuración on-page inicial (14 tareas)</label>') +
    '</div><div class="seo-adm-botones"><button class="btn-pri" id="seo-f-guardar" onclick="seoGuardarProyecto(' + (p ? 'true' : 'false') + ')">' + (p ? 'Guardar cambios' : 'Crear proyecto') + '</button></div></div>';
  setTimeout(() => document.getElementById('seo-f-nombre')?.focus(), 50);
}

function seoElegirPais(btn) {
  ddAbrir(btn, SEO_PAISES.map(([id, name]) => ({ id, name })), _seoForm.pais, (id) => {
    _seoForm.pais = id;
    btn.textContent = (SEO_PAISES.find(x => x[0] === id) || [])[1] || id;
  });
}

async function seoGuardarProyecto(editar) {
  const v = (id) => (document.getElementById(id)?.value || '').trim();
  const cuerpo = {
    nombre: v('seo-f-nombre'), dominio: v('seo-f-dominio'), marca: v('seo-f-marca'), pais: _seoForm.pais,
    inicio: v('seo-f-inicio'), competidores: v('seo-f-comp').split(/\n+/).map(x => x.trim()).filter(Boolean),
    nombre_cliente: v('seo-f-ncli'), correo_cliente: v('seo-f-ccli'),
  };
  if (!cuerpo.dominio) { showToast('Escribe el dominio del sitio', 'error'); return; }
  const btn = document.getElementById('seo-f-guardar');
  btn.disabled = true;
  try {
    if (editar) {
      await seoPost({ accion: 'editar', id: SEO.datos.proyecto.id, ...cuerpo });
      showToast('Proyecto actualizado');
      await seoAbrirProyecto(SEO.datos.proyecto.id);
    } else {
      const d = await seoPost({ accion: 'crear', client_id: seoAlcance(), ...cuerpo, plantilla: !!document.getElementById('seo-f-plantilla')?.checked });
      if (cuerpo.nombre_cliente || cuerpo.correo_cliente) await seoPost({ accion: 'editar', id: d.proyecto.id, nombre_cliente: cuerpo.nombre_cliente, correo_cliente: cuerpo.correo_cliente });
      showToast('Proyecto creado');
      SEO.lista = null;
      SEO.tab = 'keywords';
      await seoAbrirProyecto(d.proyecto.id);
    }
  } catch (e) {
    btn.disabled = false;
    showToast(e.message, 'error');
  }
}

// ── Un proyecto ─────────────────────────────────────────────────────────────
async function seoAbrirProyecto(id) {
  const main = seoMain();
  if (!SEO.datos || SEO.datos.proyecto.id !== id) main.innerHTML = '<div class="seo-adm"><p class="seo-adm-cargando">Cargando el proyecto…</p></div>';
  try {
    const [d] = await Promise.all([seoGet('id=' + encodeURIComponent(id)), seoPanel()]);
    SEO.datos = d; SEO.enlaces = d.enlaces || []; SEO.motores = d.motores || SEO.motores;
    seoPintarProyecto();
  } catch (e) {
    main.innerHTML = '<div class="seo-adm">' + emptyAgua('alert', 'No se pudo abrir el proyecto', esc(e.message),
      '<button class="btn-pri" onclick="seoAbrirProyecto(\'' + esc(id) + '\')">' + icn('refresh', 13) + ' Reintentar</button> <button class="btn-ghost" onclick="seoVolverALista()">Volver</button>') + '</div>';
  }
}
const seoRecargar = () => seoAbrirProyecto(SEO.datos.proyecto.id);

function seoVolverALista() {
  SEO.datos = null;
  if (SEO.lista) seoPintarLista(); else seoCargarLista();
}

function seoPintarProyecto() {
  const d = SEO.datos, p = d.proyecto;
  const main = seoMain();
  let h = '<div class="seo-adm"><div class="seo-adm-cab"><div><button class="seo-adm-volver" onclick="seoVolverALista()">← Proyectos</button>' +
    '<h2>' + esc(p.nombre) + '</h2><p class="seo-adm-sub">' + esc(p.dominio) + (d.ultimaMedicion ? ' · posiciones medidas el ' + esc(d.ultimaMedicion) : ' · aún sin medir') + '</p></div>' +
    '<div class="seo-adm-acciones">' +
    '<button class="btn-ghost sm" onclick="seoMedir(\'posiciones\', this)">' + icn('trend', 13) + ' Medir posiciones</button>' +
    '<button class="btn-ghost sm" onclick="seoMedir(\'geo\', this)">' + icn('sparkles', 13) + ' Medir en IAs</button>' +
    '<button class="btn-pri sm" onclick="seoEnlace(this)">' + icn('link', 13) + ' Enlace del cliente</button></div></div>' +
    '<nav class="seo-adm-tabs">' + SEO_TABS.map(([k, t]) => '<button class="' + (SEO.tab === k ? 'act' : '') + '" onclick="seoTabAdm(\'' + k + '\')">' + t + '</button>').join('') + '</nav>' +
    '<div id="seo-adm-cuerpo"></div></div>';
  main.innerHTML = h;
  seoPintarTab();
}

function seoTabAdm(k) { SEO.tab = k; SEO.pieza = null; SEO.piezaCliente = null; seoPintarProyecto(); }

function seoPintarTab() {
  const c = document.getElementById('seo-adm-cuerpo');
  if (!c) return;
  const t = SEO.tab;
  if (t === 'cliente') {
    c.innerHTML = '<p class="seo-adm-nota">' + icn('eye', 12) + ' Esto es exactamente lo que ve tu cliente en su enlace (las acciones marcadas como internas no le aparecen).</p>' +
      SEO.panel.panelSeo(SEO.datos, { seccion: SEO.seccion, contenido: SEO.piezaCliente, vistaCliente: true });
    c.querySelectorAll('[data-seccion]').forEach(b => b.addEventListener('click', () => { SEO.seccion = b.dataset.seccion; SEO.piezaCliente = null; seoPintarTab(); }));
    c.querySelectorAll('[data-contenido]').forEach(b => b.addEventListener('click', () => { SEO.piezaCliente = b.dataset.contenido; seoPintarTab(); }));
    return;
  }
  if (t === 'contenido') return SEO.pieza ? seoPintarPieza(c) : seoPintarContenido(c);
  if (t === 'keywords') return seoPintarKeywords(c);
  if (t === 'geo') return seoPintarPreguntas(c);
  if (t === 'cronograma') return seoPintarCronograma(c);
  return seoPintarAjustes(c);
}

// ── Clústeres y keywords ────────────────────────────────────────────────────
function seoPintarKeywords(c) {
  const d = SEO.datos;
  const series = SEO.panel.seriesDeKeywords(d);
  const grupos = SEO.panel.porCluster(d, series);
  const total = d.keywords.length;
  let h = '<p class="seo-adm-nota">Los clústeres temáticos agrupan las keywords principales de cada tema, con su página pilar. Se mide la posición de cada keyword cada semana. ' + total + ' de 200 keywords.</p>' +
    '<div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoFormCluster()">' + icn('plus', 12) + ' Nuevo clúster</button>' +
    '<button class="btn-ghost sm" onclick="seoFormKeywords(null)">' + icn('plus', 12) + ' Agregar keywords sin clúster</button></div><div id="seo-adm-form"></div>';
  if (!grupos.length) h += emptyAgua('tag', 'Sin clústeres ni keywords', 'Empieza por los clústeres temáticos que trabajan con el cliente y agrega en cada uno sus keywords principales.');
  for (const g of grupos) {
    h += '<section class="seo-adm-cluster"><div class="seo-adm-cluster-cab"><div><strong>' + esc(g.nombre) + '</strong>' +
      (g.pagina_pilar ? '<div class="seo-adm-sub">Pilar: ' + esc(g.pagina_pilar) + '</div>' : '') + '</div>' +
      '<div class="seo-adm-acciones"><button class="btn-ghost sm" onclick="seoFormKeywords(' + (g.id ? '\'' + esc(g.id) + '\'' : 'null') + ')">' + icn('plus', 12) + ' Keywords</button>' +
      (g.id ? '<button class="btn-ghost sm" onclick="seoFormCluster(\'' + esc(g.id) + '\')">' + icn('edit', 12) + '</button><button class="btn-ghost sm" onclick="seoBorrarCluster(\'' + esc(g.id) + '\')">Quitar</button>' : '') +
      '</div></div>' +
      (g.keywords.length ? '<div class="seo-adm-kws">' + g.keywords.map(k => '<span class="seo-adm-kw">' + esc(k.kw) +
        ' <span class="seo-adm-kw-pos">' + (k.fecha ? (k.pos == null ? '+100' : '#' + k.pos) : 'sin medir') + '</span>' +
        '<button title="Mover a otro clúster" onclick="seoMoverKeyword(\'' + esc(k.id) + '\', this)">' + icn('arrow', 11) + '</button>' +
        '<button title="Dejar de seguir" onclick="seoBorrarKeyword(\'' + esc(k.id) + '\')">×</button></span>').join('') + '</div>'
        : '<p class="seo-adm-sub">Sin keywords todavía.</p>') + '</section>';
  }
  c.innerHTML = h;
}

function seoFormCluster(id) {
  const g = id ? SEO.datos.clusters.find(x => x.id === id) : null;
  document.getElementById('seo-adm-form').innerHTML = '<div class="seo-adm-caja"><div class="seo-adm-form">' +
    '<label>Nombre del clúster<input class="auto-input" id="seo-c-nombre" value="' + esc(g?.nombre || '') + '" placeholder="Ej: Arriendo de apartamentos"></label>' +
    '<label>Página pilar (URL)<input class="auto-input" id="seo-c-pilar" value="' + esc(g?.pagina_pilar || '') + '" placeholder="https://…/arriendo"></label>' +
    (g ? '' : '<label class="seo-adm-ancho">Keywords principales (una por línea, opcional)<textarea class="auto-input" id="seo-c-kws" rows="4"></textarea></label>') +
    '</div><div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoGuardarCluster(' + (g ? '\'' + esc(g.id) + '\'' : 'null') + ', this)">Guardar</button>' +
    '<button class="btn-ghost sm" onclick="document.getElementById(\'seo-adm-form\').innerHTML=\'\'">Cancelar</button></div></div>';
  document.getElementById('seo-c-nombre')?.focus();
}

async function seoGuardarCluster(id, btn) {
  const nombre = document.getElementById('seo-c-nombre').value.trim();
  if (!nombre) { showToast('Ponle nombre al clúster', 'error'); return; }
  btn.disabled = true;
  try {
    const r = await seoPost({ accion: 'cluster_guardar', proyecto_id: SEO.datos.proyecto.id, id, nombre, pagina_pilar: document.getElementById('seo-c-pilar').value.trim() });
    const kws = (document.getElementById('seo-c-kws')?.value || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    if (kws.length) await seoPost({ accion: 'keywords_agregar', proyecto_id: SEO.datos.proyecto.id, cluster_id: r.id, kws });
    showToast(id ? 'Clúster actualizado' : 'Clúster creado');
    await seoRecargar();
  } catch (e) { btn.disabled = false; showToast(e.message, 'error'); }
}

async function seoBorrarCluster(id) {
  const g = SEO.datos.clusters.find(x => x.id === id);
  if (!(await confirmarAguaP({ titulo: 'Quitar el clúster', texto: '«' + (g?.nombre || '') + '»\n\nSus keywords no se borran: quedan sin clúster, con todo su historial.', confirmar: 'Quitar', peligro: true }))) return;
  try { await seoPost({ accion: 'cluster_borrar', id }); await seoRecargar(); } catch (e) { showToast(e.message, 'error'); }
}

function seoFormKeywords(clusterId) {
  const g = clusterId ? SEO.datos.clusters.find(x => x.id === clusterId) : null;
  document.getElementById('seo-adm-form').innerHTML = '<div class="seo-adm-caja"><div class="seo-adm-form">' +
    '<label class="seo-adm-ancho">Keywords para ' + (g ? '«' + esc(g.nombre) + '»' : 'seguir sin clúster') + ' (una por línea)<textarea class="auto-input" id="seo-k-kws" rows="5"></textarea></label></div>' +
    '<div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoAgregarKeywords(' + (clusterId ? '\'' + esc(clusterId) + '\'' : 'null') + ', this)">Agregar</button>' +
    '<button class="btn-ghost sm" onclick="document.getElementById(\'seo-adm-form\').innerHTML=\'\'">Cancelar</button></div></div>';
  document.getElementById('seo-k-kws')?.focus();
  document.getElementById('seo-adm-form').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function seoAgregarKeywords(clusterId, btn, lista) {
  const kws = lista || (document.getElementById('seo-k-kws')?.value || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  if (!kws.length) { showToast('Escribe al menos una keyword', 'error'); return; }
  if (btn) btn.disabled = true;
  try {
    const r = await seoPost({ accion: 'keywords_agregar', proyecto_id: SEO.datos.proyecto.id, cluster_id: clusterId, kws });
    showToast(r.agregadas + (r.agregadas === 1 ? ' keyword agregada' : ' keywords agregadas') +
      (r.repetidas ? ' · ' + r.repetidas + ' ya estaban' : '') + (r.sinEspacio ? ' · ' + r.sinEspacio + ' no cupieron (máximo ' + r.maximo + ')' : ''), r.sinEspacio ? 'error' : undefined);
    await seoRecargar();
  } catch (e) { if (btn) btn.disabled = false; showToast(e.message, 'error'); }
}

function seoMoverKeyword(id, btn) {
  const opciones = [{ id: '', name: 'Sin clúster' }, ...SEO.datos.clusters.map(c => ({ id: c.id, name: c.nombre }))];
  const k = SEO.datos.keywords.find(x => x.id === id);
  ddAbrir(btn, opciones, k?.cluster_id || '', async (cid) => {
    try { await seoPost({ accion: 'keyword_mover', id, cluster_id: cid || null }); await seoRecargar(); } catch (e) { showToast(e.message, 'error'); }
  });
}

async function seoBorrarKeyword(id) {
  const k = SEO.datos.keywords.find(x => x.id === id);
  if (!(await confirmarAguaP({ titulo: 'Dejar de seguir esta keyword', texto: '«' + (k?.kw || '') + '»\n\nSe deja de medir. Su historial deja de verse en el reporte.', confirmar: 'Dejar de seguir', peligro: true }))) return;
  try { await seoPost({ accion: 'keyword_borrar', id }); await seoRecargar(); } catch (e) { showToast(e.message, 'error'); }
}

// ── Preguntas GEO ───────────────────────────────────────────────────────────
function seoPintarPreguntas(c) {
  const d = SEO.datos;
  const nombres = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity' };
  let h = '<p class="seo-adm-nota">Escribe lo que un cliente real le preguntaría a una IA para encontrar un negocio como este («¿qué inmobiliaria recomiendas en Barranquilla para arrendar?»). Cada mes se le hace cada pregunta 3 veces a ' +
    (SEO.motores.map(m => nombres[m] || m).join(', ') || 'las IAs configuradas') + '. Máximo 15 preguntas.</p>' +
    '<div class="seo-adm-caja"><div class="seo-adm-form"><label class="seo-adm-ancho">Nuevas preguntas (una por línea)<textarea class="auto-input" id="seo-q-nuevas" rows="3"></textarea></label></div>' +
    '<div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoAgregarPreguntas(this)">' + icn('plus', 12) + ' Agregar</button></div></div>';
  h += d.preguntas.length ? '<ul class="seo-adm-preguntas">' + d.preguntas.map(q => '<li><span>' + esc(q.pregunta) + '</span><button class="btn-ghost sm" onclick="seoBorrarPregunta(\'' + esc(q.id) + '\')">Quitar</button></li>').join('') + '</ul>'
    : emptyAgua('sparkles', 'Sin preguntas todavía', 'Con 8 a 12 preguntas bien elegidas basta para ver si la marca aparece en las IAs.');
  c.innerHTML = h;
}

async function seoAgregarPreguntas(btn, lista) {
  const preguntas = lista || (document.getElementById('seo-q-nuevas')?.value || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  if (!preguntas.length) { showToast('Escribe al menos una pregunta', 'error'); return; }
  if (btn) btn.disabled = true;
  try {
    const r = await seoPost({ accion: 'preguntas_agregar', proyecto_id: SEO.datos.proyecto.id, preguntas });
    showToast(r.agregadas + (r.agregadas === 1 ? ' pregunta agregada' : ' preguntas agregadas') + (r.sinEspacio ? ' · ' + r.sinEspacio + ' no cupieron (máximo ' + r.maximo + ')' : ''), r.sinEspacio ? 'error' : undefined);
    await seoRecargar();
  } catch (e) { if (btn) btn.disabled = false; showToast(e.message, 'error'); }
}

async function seoBorrarPregunta(id) {
  if (!(await confirmarAguaP({ titulo: 'Quitar esta pregunta', texto: 'Se deja de medir desde el próximo mes. Lo ya medido sigue en el historial.', confirmar: 'Quitar', peligro: true }))) return;
  try { await seoPost({ accion: 'pregunta_borrar', id }); await seoRecargar(); } catch (e) { showToast(e.message, 'error'); }
}

// ── Cronograma ──────────────────────────────────────────────────────────────
function seoPintarCronograma(c) {
  const meses = SEO.panel.mesesCronograma(SEO.datos);
  const tienePlantilla = SEO.datos.acciones.some(a => String(a.plantilla || '').startsWith('inicial-'));
  let h = '<p class="seo-adm-nota">Lo que se hace mes a mes. El cliente lo ve en su enlace; las acciones marcadas como internas no le aparecen.</p>' +
    '<div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoFormAccion()">' + icn('plus', 12) + ' Nueva acción</button>' +
    (tienePlantilla ? '' : '<button class="btn-ghost sm" onclick="seoPlantillaInicial(this)">Agregar configuración on-page inicial</button>') + '</div><div id="seo-adm-form"></div>';
  h += meses.slice().reverse().map(m => '<section class="seo-adm-cluster"><div class="seo-adm-cluster-cab"><strong>Mes ' + m.numero + ' · ' + esc(SEO.panel.nombreMes(m.mes)) + '</strong>' +
    '<button class="btn-ghost sm" onclick="seoFormAccion(null, \'' + m.mes + '\')">' + icn('plus', 12) + '</button></div>' +
    (m.acciones.length ? '<ul class="seo-adm-acc">' + m.acciones.map(a => '<li class="' + (a.visible_cliente ? '' : 'seo-adm-interna') + '">' +
      '<button class="dd-btn seo-adm-estado seo-adm-estado-' + esc(a.estado) + '" onclick="seoEstadoAccion(\'' + esc(a.id) + '\', this)">' + esc((SEO_ESTADOS.find(e => e[0] === a.estado) || [])[1] || a.estado) + '</button>' +
      '<div class="seo-adm-acc-t"><strong>' + esc(a.titulo) + '</strong> <span class="seo-adm-sub">' + esc((SEO_CATEGORIAS.find(x => x[0] === a.categoria) || [])[1] || a.categoria) + (a.visible_cliente ? '' : ' · interna') + '</span>' +
      (a.detalle ? '<div class="seo-adm-sub">' + esc(a.detalle) + '</div>' : '') + '</div>' +
      '<button class="btn-ghost sm" onclick="seoFormAccion(\'' + esc(a.id) + '\')">' + icn('edit', 12) + '</button></li>').join('') + '</ul>'
      : '<p class="seo-adm-sub">Sin acciones este mes.</p>') + '</section>').join('');
  c.innerHTML = h;
}

let _seoAcc = {};
function seoFormAccion(id, mes) {
  const a = id ? SEO.datos.acciones.find(x => x.id === id) : null;
  _seoAcc = { categoria: a?.categoria || 'onpage', estado: a?.estado || 'pendiente' };
  const nombreDe = (lista, k) => (lista.find(x => x[0] === k) || [])[1] || k;
  document.getElementById('seo-adm-form').innerHTML = '<div class="seo-adm-caja"><div class="seo-adm-form">' +
    '<label class="seo-adm-ancho">Qué se hizo o se hará<input class="auto-input" id="seo-a-titulo" value="' + esc(a?.titulo || '') + '" placeholder="Ej: Optimización de títulos del clúster Arriendo"></label>' +
    '<label>Mes<input class="auto-input" type="month" id="seo-a-mes" value="' + esc(a?.mes || mes || new Date().toISOString().slice(0, 7)) + '"></label>' +
    '<label>Categoría<button type="button" class="dd-btn" onclick="seoElegirEn(this, SEO_CATEGORIAS, \'categoria\')">' + esc(nombreDe(SEO_CATEGORIAS, _seoAcc.categoria)) + '</button></label>' +
    '<label>Estado<button type="button" class="dd-btn" onclick="seoElegirEn(this, SEO_ESTADOS, \'estado\')">' + esc(nombreDe(SEO_ESTADOS, _seoAcc.estado)) + '</button></label>' +
    '<label class="seo-adm-ancho">Detalle para el cliente (opcional)<textarea class="auto-input" id="seo-a-detalle" rows="3">' + esc(a?.detalle || '') + '</textarea></label>' +
    '<label class="seo-adm-check seo-adm-ancho"><input type="checkbox" id="seo-a-visible"' + (a && !a.visible_cliente ? '' : ' checked') + '> El cliente la ve en su enlace</label>' +
    '</div><div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoGuardarAccion(' + (a ? '\'' + esc(a.id) + '\'' : 'null') + ', this)">Guardar</button>' +
    (a ? '<button class="btn-ghost sm" onclick="seoBorrarAccion(\'' + esc(a.id) + '\')">Quitar</button>' : '') +
    '<button class="btn-ghost sm" onclick="document.getElementById(\'seo-adm-form\').innerHTML=\'\'">Cancelar</button></div></div>';
  document.getElementById('seo-adm-form').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  document.getElementById('seo-a-titulo')?.focus();
}

function seoElegirEn(btn, lista, campo) {
  ddAbrir(btn, lista.map(([id, name]) => ({ id, name })), _seoAcc[campo], (id) => { _seoAcc[campo] = id; btn.textContent = (lista.find(x => x[0] === id) || [])[1] || id; });
}

async function seoGuardarAccion(id, btn) {
  const titulo = document.getElementById('seo-a-titulo').value.trim();
  if (!titulo) { showToast('Escribe qué se hizo o se hará', 'error'); return; }
  btn.disabled = true;
  try {
    await seoPost({ accion: 'accion_guardar', proyecto_id: SEO.datos.proyecto.id, id, titulo, mes: document.getElementById('seo-a-mes').value,
      detalle: document.getElementById('seo-a-detalle').value.trim(), categoria: _seoAcc.categoria, estado: _seoAcc.estado,
      visible_cliente: document.getElementById('seo-a-visible').checked });
    showToast('Acción guardada');
    await seoRecargar();
  } catch (e) { btn.disabled = false; showToast(e.message, 'error'); }
}

function seoEstadoAccion(id, btn) {
  const a = SEO.datos.acciones.find(x => x.id === id);
  ddAbrir(btn, SEO_ESTADOS.map(([i, name]) => ({ id: i, name })), a?.estado, async (estado) => {
    try { await seoPost({ accion: 'accion_guardar', id, estado }); await seoRecargar(); } catch (e) { showToast(e.message, 'error'); }
  });
}

async function seoBorrarAccion(id) {
  if (!(await confirmarAguaP({ titulo: 'Quitar esta acción', texto: 'Desaparece del cronograma, también del enlace del cliente.', confirmar: 'Quitar', peligro: true }))) return;
  try { await seoPost({ accion: 'accion_borrar', id }); await seoRecargar(); } catch (e) { showToast(e.message, 'error'); }
}

async function seoPlantillaInicial(btn) {
  btn.disabled = true;
  try { const r = await seoPost({ accion: 'plantilla_inicial', proyecto_id: SEO.datos.proyecto.id }); showToast(r.agregadas + ' tareas agregadas'); await seoRecargar(); }
  catch (e) { btn.disabled = false; showToast(e.message, 'error'); }
}

// ── Calendario de contenido (fase 2) ────────────────────────────────────────
// La agencia sube la pieza y la manda a revisión; el cliente la aprueba o pide
// cambios desde su enlace. Cada envío guarda una versión.
function seoPintarContenido(c) {
  const d = SEO.datos;
  const p = d.proyecto;
  const sinEnlace = !SEO.enlaces.length;
  let h = '<p class="seo-adm-nota">Sube cada pieza (el texto o el enlace a un Google Doc) y mándala a revisión. Tu cliente la aprueba o pide cambios desde su enlace' +
    (p.correo_cliente ? ', y le llega un correo a ' + esc(p.correo_cliente) : '') + '.</p>' +
    (sinEnlace ? '<div class="seo-adm-caja">' + icn('alert', 13) + ' Para que tu cliente pueda revisar, crea su enlace (botón «Enlace del cliente»).</div>' : '') +
    (!p.correo_cliente ? '<p class="seo-adm-cupo">Sin correo del cliente: no le llegará aviso cuando haya algo para revisar. Agrégalo en Ajustes › Editar.</p>' : '') +
    '<div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoFormPieza()">' + icn('plus', 12) + ' Nueva pieza</button></div><div id="seo-adm-form"></div>';
  h += (d.contenidos || []).length
    ? SEO.panel.panelSeo(d, { seccion: 'contenido', vistaCliente: false }).replace(/<header[\s\S]*?<\/nav>/, '')
    : emptyAgua('calendar', 'El calendario está vacío', 'Planea los artículos y páginas del mes. Puedes empezar solo con el título y la fecha: tu cliente los verá como «Planeado».');
  c.innerHTML = h;
  c.querySelectorAll('[data-contenido]').forEach(b => b.addEventListener('click', () => { SEO.pieza = b.dataset.contenido; seoPintarTab(); }));
}

let _seoPieza = {};
function seoFormPieza(id) {
  const c = id ? SEO.datos.contenidos.find(x => x.id === id) : null;
  const editable = !c || c.estado === 'borrador' || c.estado === 'cambios';
  _seoPieza = { tipo: c?.tipo || 'articulo', cluster: c?.cluster_id || '' };
  const nombreDe = (lista, k) => (lista.find(x => x[0] === k) || [])[1] || k;
  const clusters = [['', 'Sin clúster'], ...SEO.datos.clusters.map(x => [x.id, x.nombre])];
  const destino = id ? 'seo-adm-pieza-form' : 'seo-adm-form';
  document.getElementById(destino).innerHTML = '<div class="seo-adm-caja"><div class="seo-adm-form">' +
    '<label class="seo-adm-ancho">Título<input class="auto-input" id="seo-p-titulo" value="' + esc(c?.titulo || '') + '"' + (editable ? '' : ' disabled') + ' placeholder="Ej: Cómo elegir barrio para arrendar en Barranquilla"></label>' +
    '<label>Tipo<button type="button" class="dd-btn" onclick="seoElegirPieza(this, SEO_TIPOS, \'tipo\')">' + esc(nombreDe(SEO_TIPOS, _seoPieza.tipo)) + '</button></label>' +
    '<label>Clúster<button type="button" class="dd-btn" onclick="seoElegirPieza(this, [[\'\', \'Sin clúster\'], ...SEO.datos.clusters.map(x => [x.id, x.nombre])], \'cluster\')">' + esc(nombreDe(clusters, _seoPieza.cluster)) + '</button></label>' +
    '<label>Keyword principal<input class="auto-input" id="seo-p-kw" value="' + esc(c?.keyword || '') + '"></label>' +
    '<label>Publicación prevista<input class="auto-input" type="date" id="seo-p-fecha" value="' + esc(c?.fecha || '') + '"></label>' +
    '<label class="seo-adm-ancho">Enlace al documento (opcional)<input class="auto-input" id="seo-p-doc" value="' + esc(c?.enlace_doc || '') + '"' + (editable ? '' : ' disabled') + ' placeholder="https://docs.google.com/…"></label>' +
    '<label class="seo-adm-ancho">Contenido o brief<textarea class="auto-input" id="seo-p-cuerpo" rows="12"' + (editable ? '' : ' disabled') + '>' + esc(c?.cuerpo || '') + '</textarea></label>' +
    (editable ? '' : '<p class="seo-adm-sub seo-adm-ancho">El texto no se puede cambiar mientras el cliente lo revisa o después de aprobado. Vuélvela a borrador para editarlo.</p>') +
    '</div><div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoGuardarPieza(' + (c ? '\'' + esc(c.id) + '\'' : 'null') + ', this)">Guardar</button>' +
    '<button class="btn-ghost sm" onclick="document.getElementById(\'' + destino + '\').innerHTML=\'\'">Cancelar</button></div></div>';
  document.getElementById(destino).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function seoElegirPieza(btn, lista, campo) {
  ddAbrir(btn, lista.map(([id, name]) => ({ id, name })), _seoPieza[campo], (id) => { _seoPieza[campo] = id; btn.textContent = (lista.find(x => x[0] === id) || [])[1] || id; });
}

async function seoGuardarPieza(id, btn) {
  const v = (x) => (document.getElementById(x)?.value || '').trim();
  const c = id ? SEO.datos.contenidos.find(x => x.id === id) : null;
  const editable = !c || c.estado === 'borrador' || c.estado === 'cambios';
  if (editable && !v('seo-p-titulo')) { showToast('Ponle un título a la pieza', 'error'); return; }
  const cuerpo = { accion: 'contenido_guardar', proyecto_id: SEO.datos.proyecto.id, id, tipo: _seoPieza.tipo, cluster_id: _seoPieza.cluster || null, keyword: v('seo-p-kw'), fecha: v('seo-p-fecha') };
  if (editable) Object.assign(cuerpo, { titulo: v('seo-p-titulo'), enlace_doc: v('seo-p-doc'), cuerpo: document.getElementById('seo-p-cuerpo').value });
  btn.disabled = true;
  try {
    const r = await seoPost(cuerpo);
    showToast('Pieza guardada');
    SEO.pieza = r.id;
    await seoRecargar();
  } catch (e) { btn.disabled = false; showToast(e.message, 'error'); }
}

const SEO_ESTADO_PIEZA = { borrador: 'Borrador', en_revision: 'Esperando al cliente', cambios: 'Cambios pedidos', aprobado: 'Aprobado', publicado: 'Publicado' };
function seoPintarPieza(cont) {
  const c = SEO.datos.contenidos.find(x => x.id === SEO.pieza);
  if (!c) { SEO.pieza = null; return seoPintarContenido(cont); }
  const botones = [];
  if (c.estado === 'borrador' || c.estado === 'cambios') botones.push('<button class="btn-pri sm" onclick="seoAccionPieza(\'contenido_enviar\', this)">' + icn('send', 12) + ' Enviar a revisión</button>');
  if (c.estado === 'aprobado') botones.push('<button class="btn-pri sm" onclick="seoPublicarPieza(this)">' + icn('check', 12) + ' Marcar como publicada</button>');
  if (c.estado !== 'borrador') botones.push('<button class="btn-ghost sm" onclick="seoAccionPieza(\'contenido_borrador\', this)">Volver a borrador</button>');
  botones.push('<button class="btn-ghost sm" onclick="seoFormPieza(\'' + esc(c.id) + '\')">' + icn('edit', 12) + ' Editar</button>');
  if (c.version) botones.push('<button class="btn-ghost sm" onclick="seoVersiones(this)">Versiones (' + c.version + ')</button>');
  botones.push('<button class="btn-ghost sm" onclick="seoBorrarPieza()">Quitar</button>');
  cont.innerHTML = '<div class="seo-adm-botones">' + botones.join('') + '</div><div id="seo-adm-pieza-form"></div><div id="seo-adm-versiones"></div>' +
    SEO.panel.panelSeo(SEO.datos, { contenido: c.id, vistaCliente: false }).replace(/<header[\s\S]*?<\/nav>/, '') +
    '<div class="seo-adm-caja"><div class="seo-adm-form"><label class="seo-adm-ancho">Responderle al cliente<textarea class="auto-input" id="seo-p-resp" rows="3" placeholder="Lo verá en su enlace, en la conversación de esta pieza"></textarea></label></div>' +
    '<div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoComentarPieza(this)">' + icn('chat', 12) + ' Responder</button></div></div>';
  cont.querySelectorAll('[data-seccion]').forEach(b => b.addEventListener('click', () => { SEO.pieza = null; seoPintarTab(); }));
}

async function seoAccionPieza(accion, btn) {
  btn.disabled = true;
  try {
    const r = await seoPost({ accion, id: SEO.pieza });
    if (accion === 'contenido_enviar') {
      const a = r.aviso || {};
      showToast(a.enviado ? 'Enviada a revisión: le llegó un correo a tu cliente' : 'Enviada a revisión' + (a.motivo ? ' (sin aviso por correo: ' + a.motivo + ')' : ''), a.enviado ? undefined : 'error');
    } else showToast('Listo');
    await seoRecargar();
  } catch (e) { btn.disabled = false; showToast(e.message, 'error'); }
}

function seoPublicarPieza() {
  document.getElementById('seo-adm-pieza-form').innerHTML = '<div class="seo-adm-caja"><div class="seo-adm-form"><label class="seo-adm-ancho">URL donde quedó publicada (opcional)<input class="auto-input" id="seo-p-url" placeholder="https://…"></label></div>' +
    '<div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoConfirmarPublicada(this)">Marcar como publicada</button></div></div>';
  document.getElementById('seo-p-url').focus();
}
async function seoConfirmarPublicada(btn) {
  btn.disabled = true;
  try { await seoPost({ accion: 'contenido_publicar', id: SEO.pieza, url_publicada: document.getElementById('seo-p-url').value.trim() }); showToast('Marcada como publicada'); await seoRecargar(); }
  catch (e) { btn.disabled = false; showToast(e.message, 'error'); }
}

async function seoComentarPieza(btn) {
  const texto = document.getElementById('seo-p-resp').value.trim();
  if (!texto) { showToast('Escribe la respuesta', 'error'); return; }
  btn.disabled = true;
  try { await seoPost({ accion: 'contenido_comentar', id: SEO.pieza, texto }); showToast('Respuesta enviada'); await seoRecargar(); }
  catch (e) { btn.disabled = false; showToast(e.message, 'error'); }
}

async function seoVersiones(btn) {
  btn.disabled = true;
  try {
    const d = await seoGet('versiones=' + encodeURIComponent(SEO.pieza));
    document.getElementById('seo-adm-versiones').innerHTML = '<div class="seo-adm-caja"><strong>Lo que se envió a revisión, versión por versión</strong>' +
      d.versiones.map(v => '<details><summary>Versión ' + v.version + ' · ' + esc(String(v.creado_at).slice(0, 10)) + ' · ' + esc(v.titulo || '') + '</summary>' +
        (v.enlace_doc ? '<p class="seo-adm-sub">Documento: ' + esc(v.enlace_doc) + '</p>' : '') + '<div class="seo-adm-version">' + esc(v.cuerpo || '').replace(/\n/g, '<br>') + '</div></details>').join('') + '</div>';
  } catch (e) { showToast(e.message, 'error'); } finally { btn.disabled = false; }
}

async function seoBorrarPieza() {
  const c = SEO.datos.contenidos.find(x => x.id === SEO.pieza);
  if (!(await confirmarAguaP({ titulo: 'Quitar esta pieza', texto: '«' + (c?.titulo || '') + '»\n\nDesaparece del calendario, también del enlace del cliente.', confirmar: 'Quitar', peligro: true }))) return;
  try { await seoPost({ accion: 'contenido_borrar', id: SEO.pieza }); SEO.pieza = null; await seoRecargar(); } catch (e) { showToast(e.message, 'error'); }
}

// ── Medir ahora ─────────────────────────────────────────────────────────────
async function seoMedir(que, btn) {
  if (SEO.ocupado) return;
  SEO.ocupado = true;
  const antes = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Midiendo…';
  try {
    const r = await seoPost({ accion: que === 'geo' ? 'medir_geo' : 'medir_posiciones', proyecto_id: SEO.datos.proyecto.id });
    if (que === 'geo') {
      showToast(r.hechas + ' respuestas de las IAs' + (r.pendientes ? ' · faltan ' + r.pendientes + ', siguen solas en los próximos minutos' : ' · medición del mes completa') + (r.sinCupo ? ' · ' + r.sinCupo + ' no caben en el cupo del mes' : ''), r.sinCupo ? 'error' : undefined);
    } else {
      showToast(r.medidas + ' keywords medidas' + (r.fallidas ? ' · ' + r.fallidas + ' fallaron' : '') + (r.sinCupo ? ' · ' + r.sinCupo + ' no caben en el cupo del mes' : ''), r.sinCupo || r.fallidas ? 'error' : undefined);
    }
    await seoRecargar();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    SEO.ocupado = false;
    btn.disabled = false; btn.innerHTML = antes;
  }
}

// ── Enlace del cliente y ajustes ────────────────────────────────────────────
async function seoEnlace(btn) {
  const vivo = SEO.enlaces[0];
  if (vivo) { seoCopiar('https://app.acuarius.app/seo/' + vivo.token); return; }
  btn.disabled = true;
  try {
    const r = await seoPost({ accion: 'enlace_crear', proyecto_id: SEO.datos.proyecto.id });
    await seoRecargar();
    seoCopiar(r.url);
  } catch (e) { showToast(e.message, 'error'); } finally { btn.disabled = false; }
}

async function seoCopiar(url) {
  try { await navigator.clipboard.writeText(url); showToast('Enlace copiado: ' + url); }
  catch { SEO.tab = 'ajustes'; seoPintarProyecto(); showToast('Copia el enlace desde Ajustes', 'error'); }
}

function seoPintarAjustes(c) {
  const p = SEO.datos.proyecto;
  const enlaces = SEO.enlaces;
  let h = '<section class="seo-adm-cluster"><div class="seo-adm-cluster-cab"><strong>Enlace del cliente</strong>' +
    '<button class="btn-ghost sm" onclick="seoNuevoEnlace(this)">' + icn('plus', 12) + ' Crear otro</button></div>' +
    '<p class="seo-adm-sub">Tu cliente lo abre sin cuenta y ve el reporte en vivo: posiciones, presencia en IAs, cronograma y competencia. Si lo desactivas, deja de funcionar al instante.</p>' +
    (enlaces.length ? '<ul class="seo-adm-preguntas">' + enlaces.map(e => '<li><span><input class="auto-input" readonly value="https://app.acuarius.app/seo/' + esc(e.token) + '" onclick="this.select()"> ' +
      '<span class="seo-adm-sub">' + e.vistas + (e.vistas === 1 ? ' visita' : ' visitas') + (e.ultima_vista ? ' · última ' + esc(String(e.ultima_vista).slice(0, 10)) : '') + '</span></span>' +
      '<span class="seo-adm-acciones"><button class="btn-ghost sm" onclick="seoCopiar(\'https://app.acuarius.app/seo/' + esc(e.token) + '\')">' + icn('copy', 12) + '</button>' +
      '<a class="btn-ghost sm" href="/seo/' + esc(e.token) + '" target="_blank" rel="noopener">' + icn('external', 12) + '</a>' +
      '<button class="btn-ghost sm" onclick="seoRevocarEnlace(\'' + esc(e.id) + '\')">Desactivar</button></span></li>').join('') + '</ul>'
      : '<p class="seo-adm-sub">Todavía no hay enlace.</p>') + '</section>';
  h += seoSeccionTrafico();
  h += '<section class="seo-adm-cluster"><div class="seo-adm-cluster-cab"><strong>Datos del proyecto</strong><button class="btn-ghost sm" onclick="seoFormProyecto(true)">' + icn('edit', 12) + ' Editar</button></div>' +
    '<p class="seo-adm-sub">Dominio: ' + esc(p.dominio) + ' · Marca: ' + esc(p.marca || '—') + ' · País: ' + esc((SEO_PAISES.find(x => x[0] === p.pais) || [])[1] || p.pais) +
    ' · Inicio: ' + esc(p.inicio) + ' · Competidores: ' + esc((p.competidores || []).join(', ') || '—') + '</p></section>' + seoLineaCupo() +
    '<div class="seo-adm-botones"><button class="btn-ghost sm" onclick="seoArchivar()">' + icn('archivar', 12) + ' Archivar proyecto</button></div>';
  c.innerHTML = h;
}

// ── Tráfico: Search Console y GA4 (fase 3) ──────────────────────────────────
// El cliente agrega el correo de Acuarius como lector y aquí se escribe qué
// propiedad leer. Se prueba al guardar: quien conecta sabe ya si falta el acceso.
function seoEstadoConexion(estado, error, at) {
  if (!estado) return '<span class="seo-adm-sub">Sin conectar</span>';
  if (estado === 'ok') return '<span class="seo-adm-ok">' + icn('check', 12) + ' Conectado' + (at ? ' · actualizado ' + esc(String(at).slice(0, 10)) : '') + '</span>';
  return '<span class="seo-adm-mal">' + icn('alert', 12) + ' ' + esc(error || 'No se pudo leer') + '</span>';
}
function seoSeccionTrafico() {
  const p = SEO.datos.proyecto;
  const correo = SEO.datos.correoServicio || '';
  return '<section class="seo-adm-cluster"><div class="seo-adm-cluster-cab"><strong>Tráfico: Search Console y Google Analytics</strong>' +
    ((p.gsc_propiedad || p.ga4_propiedad) ? '<button class="btn-ghost sm" onclick="seoSincronizar(this)">' + icn('refresh', 12) + ' Actualizar ahora</button>' : '') + '</div>' +
    '<p class="seo-adm-sub">Para ver clics, impresiones, visitas orgánicas y visitas desde IAs, tu cliente (o tú, si tienes acceso) agrega este correo como lector:</p>' +
    '<div class="seo-adm-correo"><code>' + esc(correo || 'falta configurar la cuenta de servicio') + '</code>' +
    (correo ? '<button class="btn-ghost sm" onclick="seoCopiarTexto(\'' + esc(correo) + '\')">' + icn('copy', 12) + ' Copiar</button>' : '') + '</div>' +
    '<ol class="seo-adm-pasos"><li><strong>Search Console</strong> › Configuración › Usuarios y permisos › Agregar usuario › pega el correo › permiso «Restringido».</li>' +
    '<li><strong>Google Analytics</strong> › Administrar › Gestión de acceso a la propiedad › + › pega el correo › rol «Lector» (sin marcar «notificar»).</li></ol>' +
    '<div class="seo-adm-form">' +
    '<label>Propiedad de Search Console<input class="auto-input" id="seo-t-gsc" value="' + esc(p.gsc_propiedad || '') + '" placeholder="sc-domain:' + esc(p.dominio) + '"><span class="seo-adm-estado-con">' + seoEstadoConexion(p.gsc_estado, p.gsc_error, p.gsc_sincronizado_at) + '</span></label>' +
    '<label>ID de propiedad de GA4<input class="auto-input" id="seo-t-ga4" value="' + esc(p.ga4_propiedad || '') + '" placeholder="Ej: 412345678 (no el «G-…»)"><span class="seo-adm-estado-con">' + seoEstadoConexion(p.ga4_estado, p.ga4_error, p.ga4_sincronizado_at) + '</span></label>' +
    '</div><div class="seo-adm-botones"><button class="btn-pri sm" onclick="seoConectarTrafico(this)">Guardar y probar</button></div>' +
    '<p class="seo-adm-sub">La primera vez se trae el historial que da Google (16 meses de Search Console, 13 de Analytics); después se actualiza solo cada día y queda guardado aquí aunque Google lo borre.</p></section>';
}

async function seoCopiarTexto(t) {
  try { await navigator.clipboard.writeText(t); showToast('Copiado'); } catch { showToast('No se pudo copiar: selecciónalo a mano', 'error'); }
}

function seoResultadoConexion(nombre, r) {
  if (!r) return '';
  if (r.ok) return nombre + ': conectado';
  return nombre + ': ' + (r.error || 'no se pudo leer');
}

async function seoConectarTrafico(btn) {
  const p = SEO.datos.proyecto;
  const gsc = document.getElementById('seo-t-gsc').value.trim();
  const ga4 = document.getElementById('seo-t-ga4').value.trim();
  const cuerpo = { accion: 'conectar', proyecto_id: p.id };
  if (gsc !== (p.gsc_propiedad || '')) cuerpo.gsc_propiedad = gsc;
  if (ga4 !== (p.ga4_propiedad || '')) cuerpo.ga4_propiedad = ga4;
  if (!('gsc_propiedad' in cuerpo) && !('ga4_propiedad' in cuerpo)) return seoSincronizar(btn);
  const antes = btn.textContent;
  btn.disabled = true; btn.textContent = 'Probando con Google…';
  try {
    const r = await seoPost(cuerpo);
    const partes = [seoResultadoConexion('Search Console', r.gsc), seoResultadoConexion('Analytics', r.ga4)].filter(Boolean);
    const bien = [r.gsc, r.ga4].filter(Boolean).every(x => x.ok);
    showToast(partes.join(' · ') || 'Guardado', bien ? undefined : 'error');
    await seoRecargar();
  } catch (e) { showToast(e.message, 'error'); btn.disabled = false; btn.textContent = antes; }
}

async function seoSincronizar(btn) {
  const antes = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Actualizando…';
  try {
    const r = await seoPost({ accion: 'sincronizar', proyecto_id: SEO.datos.proyecto.id });
    const partes = [seoResultadoConexion('Search Console', r.gsc), seoResultadoConexion('Analytics', r.ga4)].filter(Boolean);
    showToast(partes.join(' · ') || 'Nada que actualizar', [r.gsc, r.ga4].filter(Boolean).every(x => x.ok) ? undefined : 'error');
    await seoRecargar();
  } catch (e) { showToast(e.message, 'error'); } finally { btn.disabled = false; btn.innerHTML = antes; }
}

async function seoNuevoEnlace(btn) {
  btn.disabled = true;
  try { const r = await seoPost({ accion: 'enlace_crear', proyecto_id: SEO.datos.proyecto.id }); await seoRecargar(); seoCopiar(r.url); }
  catch (e) { btn.disabled = false; showToast(e.message, 'error'); }
}

async function seoRevocarEnlace(id) {
  if (!(await confirmarAguaP({ titulo: 'Desactivar el enlace', texto: 'Quien lo tenga ya no podrá abrir el reporte. Puedes crear otro cuando quieras.', confirmar: 'Desactivar', peligro: true }))) return;
  try { await seoPost({ accion: 'enlace_revocar', id }); await seoRecargar(); } catch (e) { showToast(e.message, 'error'); }
}

async function seoArchivar() {
  if (!(await confirmarAguaP({ titulo: 'Archivar el proyecto', texto: 'Deja de medirse y sus enlaces dejan de funcionar. Los datos se conservan.', confirmar: 'Archivar', peligro: true }))) return;
  try { await seoPost({ accion: 'archivar', id: SEO.datos.proyecto.id }); SEO.datos = null; SEO.lista = null; await seoCargarLista(); } catch (e) { showToast(e.message, 'error'); }
}

// ── Lo que propone el agente SEO ([SEO_KEYWORDS] / [GEO_QUERIES]) ───────────
// Va al proyecto abierto. Sin proyecto abierto se dice dónde hacerlo, en vez
// del alert() del módulo viejo.
function seoImportKeywords(msgId) {
  const list = (window._seoKwImports || {})[msgId];
  if (!list) return;
  if (!SEO.datos) { showToast('Abre primero el proyecto SEO al que van estas keywords (Marketing › Proyecto SEO)', 'error'); openSeoProject(); return; }
  SEO.tab = 'keywords';
  openSeoProject();
  seoAgregarKeywords(null, null, list);
}
function seoImportGeoQueries(msgId) {
  const list = (window._geoQImports || {})[msgId];
  if (!list) return;
  if (!SEO.datos) { showToast('Abre primero el proyecto SEO al que van estas preguntas (Marketing › Proyecto SEO)', 'error'); openSeoProject(); return; }
  SEO.tab = 'geo';
  openSeoProject();
  seoAgregarPreguntas(null, list);
}
