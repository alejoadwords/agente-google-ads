// public/seo-panel.js — el dashboard SEO, para la app y para el cliente.
//
// Un solo módulo calcula y dibuja: lo usan la vista «Lo que ve el cliente» de
// la app y la página pública /seo/<código>. Si cada uno tuviera su código,
// algún día dirían cifras distintas sobre el mismo proyecto (la lección de
// public/informes.js). Sin DOM ni globales: recibe los datos y devuelve HTML.
// Todo vive dentro de `.seo-doc` (estilos en public/seo-panel.css).

export const SECCIONES = [
  ['resumen', 'Resumen'],
  ['trafico', 'Tráfico'],
  ['posiciones', 'Posiciones'],
  ['geo', 'Presencia en IAs'],
  ['contenido', 'Contenido'],
  ['cronograma', 'Cronograma'],
  ['competencia', 'Competencia'],
];
export const MOTORES = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity' };
export const CATEGORIAS = {
  onpage: 'On-page', tecnico: 'Técnico', contenido: 'Contenido', enlaces: 'Enlaces',
  local: 'SEO local', geo: 'IAs (GEO)', analitica: 'Analítica', otro: 'Otro',
};
export const PAISES = { co: 'Colombia', mx: 'México', ar: 'Argentina', cl: 'Chile', pe: 'Perú', ec: 'Ecuador', es: 'España', us: 'Estados Unidos' };
const ESTADO = { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha' };
export const TIPOS = { articulo: 'Artículo', pagina: 'Página', landing: 'Landing', post: 'Post', video: 'Video', otro: 'Otro' };
// Cómo ve el cliente cada estado: un borrador es «Planeado» (sabe que viene,
// no ve el texto todavía).
export const ESTADOS_CONTENIDO = {
  borrador: { agencia: 'Borrador', cliente: 'Planeado' },
  en_revision: { agencia: 'Esperando al cliente', cliente: 'Para revisar' },
  cambios: { agencia: 'Cambios pedidos', cliente: 'Cambios pedidos' },
  aprobado: { agencia: 'Aprobado', cliente: 'Aprobado' },
  publicado: { agencia: 'Publicado', cliente: 'Publicado' },
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function esc(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export const nombreMes = (ym) => { const [y, m] = String(ym).split('-'); return MESES[(+m || 1) - 1] + ' ' + y; };
const fechaCorta = (d) => { const [y, m, dd] = String(d).split('-'); return (+dd) + ' ' + MESES[(+m || 1) - 1].slice(0, 3) + ' ' + y; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const dominio = (u) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];

// ── Cálculos ────────────────────────────────────────────────────────────────

// Serie de cada keyword y su comparación con ~4 semanas antes.
export function seriesDeKeywords(datos) {
  const porKw = {};
  for (const p of datos.posiciones || []) (porKw[p.keyword_id] ||= []).push(p);
  const top = Object.fromEntries((datos.top || []).map(t => [t.keyword_id, t.top || []]));
  return (datos.keywords || []).map(k => {
    const serie = (porKw[k.id] || []).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const ultima = serie[serie.length - 1] || null;
    let antes = null;
    if (ultima) {
      const limite = Date.parse(ultima.fecha) - 21 * 86400000;
      for (let i = serie.length - 2; i >= 0; i--) if (Date.parse(serie[i].fecha) <= limite) { antes = serie[i]; break; }
    }
    const conPos = serie.filter(s => s.pos != null).map(s => s.pos);
    return {
      ...k, serie, top: top[k.id] || [],
      pos: ultima?.pos ?? null, url: ultima?.url || null, fecha: ultima?.fecha || null,
      antes: antes ? antes.pos : undefined,
      mejor: conPos.length ? Math.min(...conPos) : null,
      cambio: ultima && antes && ultima.pos != null && antes.pos != null ? antes.pos - ultima.pos : null,
      // Entrar a los 100 primeros (o salir) también es un cambio, y de los grandes.
      entro: !!(ultima && antes && antes.pos == null && ultima.pos != null),
      salio: !!(ultima && antes && antes.pos != null && ultima.pos == null),
    };
  });
}

export function resumenPosiciones(series) {
  const medidas = series.filter(s => s.fecha);
  const conPos = medidas.filter(s => s.pos != null);
  return {
    total: series.length,
    medidas: medidas.length,
    enTop3: conPos.filter(s => s.pos <= 3).length,
    enTop10: conPos.filter(s => s.pos <= 10).length,
    enTop100: conPos.length,
    promedio: conPos.length ? Math.round(conPos.reduce((a, s) => a + s.pos, 0) / conPos.length * 10) / 10 : null,
    suben: medidas.filter(s => s.cambio > 0 || s.entro).length,
    bajan: medidas.filter(s => s.cambio < 0 || s.salio).length,
  };
}

export function porCluster(datos, series) {
  const grupos = (datos.clusters || []).map(c => ({ ...c, keywords: series.filter(s => s.cluster_id === c.id) }));
  const sueltas = series.filter(s => !s.cluster_id || !grupos.some(g => g.id === s.cluster_id));
  if (sueltas.length) grupos.push({ id: null, nombre: 'Sin clúster', keywords: sueltas });
  return grupos.map(g => ({ ...g, resumen: resumenPosiciones(g.keywords) }));
}

// El periodo de GEO que se muestra: el más reciente con alguna respuesta.
export function periodosGeo(datos) {
  return [...new Set((datos.geo || []).filter(r => !r.error).map(r => r.periodo))].sort();
}

export function resumenGeo(datos, periodo) {
  const filas = (datos.geo || []).filter(r => r.periodo === periodo && !r.error);
  const motores = {};
  for (const r of filas) {
    const m = (motores[r.motor] ||= { respuestas: 0, menciones: 0, conCitas: 0, citada: 0 });
    m.respuestas++;
    if (r.mencionada) m.menciones++;
    if (r.citada !== null && r.citada !== undefined) { m.conCitas++; if (r.citada) m.citada++; }
  }
  const total = filas.length, menciones = filas.filter(r => r.mencionada).length;
  const corridas = filas.reduce((m, r) => Math.max(m, r.corrida || 1), 0);
  const preguntas = (datos.preguntas || []).map(q => {
    const suyas = filas.filter(r => r.pregunta_id === q.id);
    const pm = {};
    for (const r of suyas) { const x = (pm[r.motor] ||= { n: 0, si: 0, fragmento: null }); x.n++; if (r.mencionada) { x.si++; x.fragmento ||= r.fragmento; } }
    return { ...q, motores: pm, n: suyas.length, si: suyas.filter(r => r.mencionada).length };
  });
  const competidores = {};
  for (const r of filas) for (const c of r.competidores || []) competidores[c] = (competidores[c] || 0) + 1;
  const fuentes = {};
  for (const r of filas) for (const u of r.citas || []) { const d = dominio(u); if (d) fuentes[d] = (fuentes[d] || 0) + 1; }
  return {
    periodo, total, menciones, tasa: pct(menciones, total), motores, preguntas, corridas,
    competidores: Object.entries(competidores).sort((a, b) => b[1] - a[1]),
    fuentes: Object.entries(fuentes).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

export function competenciaSerp(series, propio) {
  const c = {};
  for (const s of series) for (const t of s.top || []) {
    const d = t.dominio || dominio(t.url);
    if (!d || d === propio) continue;
    const x = (c[d] ||= { dominio: d, apariciones: 0, ganan: 0 });
    x.apariciones++;
    if (s.pos == null || t.pos < s.pos) x.ganan++;
  }
  return Object.values(c).sort((a, b) => b.apariciones - a.apariciones).slice(0, 15);
}

// Meses del cronograma: desde el inicio del proyecto hasta el último con
// acciones (o el actual), aunque un mes no tenga ninguna: el hueco también dice algo.
export function mesesCronograma(datos, hoy = new Date()) {
  const inicio = String(datos.proyecto?.inicio || '').slice(0, 7) || hoy.toISOString().slice(0, 7);
  const acciones = datos.acciones || [];
  const ultimo = [hoy.toISOString().slice(0, 7), ...acciones.map(a => a.mes)].sort().pop();
  const meses = [];
  let [y, m] = (acciones.map(a => a.mes).concat(inicio).sort()[0]).split('-').map(Number);
  for (let i = 0; i < 60; i++) {
    const ym = y + '-' + String(m).padStart(2, '0');
    meses.push({ mes: ym, numero: i + 1, acciones: acciones.filter(a => a.mes === ym) });
    if (ym >= ultimo) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return meses;
}

// ── Piezas de dibujo ────────────────────────────────────────────────────────

function sparkline(serie) {
  const pts = serie.filter(s => s.pos != null).slice(-26);
  if (pts.length < 2) return '<span class="sd-tenue">—</span>';
  const w = 90, h = 26, max = Math.max(...pts.map(p => p.pos)), min = Math.min(...pts.map(p => p.pos));
  const rango = Math.max(max - min, 1);
  const xy = pts.map((p, i) => [Math.round(i * (w - 4) / (pts.length - 1)) + 2, Math.round(((p.pos - min) / rango) * (h - 6)) + 3]);
  return `<svg class="sd-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${xy.map(p => p.join(',')).join(' ')}"/><circle cx="${xy[xy.length - 1][0]}" cy="${xy[xy.length - 1][1]}" r="2.6"/></svg>`;
}

function cambioHtml(c, s = {}) {
  if (s.entro) return '<span class="sd-sube">▲ entró</span>';
  if (s.salio) return '<span class="sd-baja">▼ salió</span>';
  if (c == null) return '<span class="sd-tenue">—</span>';
  if (c === 0) return '<span class="sd-tenue">=</span>';
  return c > 0 ? `<span class="sd-sube">▲ ${c}</span>` : `<span class="sd-baja">▼ ${-c}</span>`;
}

const posHtml = (p) => (p == null ? '<span class="sd-tenue">+100</span>' : `<strong>${p}</strong>`);
// Con `seccion`, la tarjeta lleva a donde se explica esa cifra.
const tarjeta = (titulo, valor, nota = '', clase = '', seccion = '') =>
  `<div class="sd-tarjeta ${clase}${seccion ? ' sd-tarjeta-link' : ''}"${seccion ? ` data-seccion="${seccion}" role="button" tabindex="0" title="Ver el detalle"` : ''}><div class="sd-tarjeta-t">${titulo}${seccion ? ' <span class="sd-flecha">→</span>' : ''}</div><div class="sd-tarjeta-v">${valor}</div>${nota ? `<div class="sd-tarjeta-n">${nota}</div>` : ''}</div>`;

function barrasMes(puntos) {
  // puntos: [{ etiqueta, valor (0-100) }]
  if (!puntos.length) return '';
  return `<div class="sd-barras">${puntos.map(p => `<div class="sd-barra"><div class="sd-barra-col"><div style="height:${Math.max(2, p.valor)}%"></div></div><div class="sd-barra-v">${p.valor}%</div><div class="sd-barra-e">${esc(p.etiqueta)}</div></div>`).join('')}</div>`;
}

// ── Secciones ───────────────────────────────────────────────────────────────

function seccionResumen(datos, series) {
  const r = resumenPosiciones(series);
  const per = periodosGeo(datos);
  const g = per.length ? resumenGeo(datos, per[per.length - 1]) : null;
  const meses = mesesCronograma(datos);
  const todas = datos.acciones || [];
  const hechas = todas.filter(a => a.estado === 'hecha').length;
  const marca = esc(datos.proyecto.marca || datos.proyecto.nombre);
  const tr = resumenTrafico(datos);
  let h = `<div class="sd-tarjetas">
    ${tr.hayGsc && tr.cerrado ? tarjeta('Clics desde Google', num(tr.cerrado.clics), nombreMes(tr.cerrado.mes) + (tr.previo ? ' · ' + delta(tr.cerrado.clics, tr.previo.clics) : ''), '', 'trafico') : ''}
    ${tr.hayGa4 && tr.cerrado ? tarjeta('Visitas desde buscadores', num(tr.cerrado.organicas), nombreMes(tr.cerrado.mes) + (tr.previo ? ' · ' + delta(tr.cerrado.organicas, tr.previo.organicas) : ''), '', 'trafico') : ''}
    ${tr.hayGa4 && tr.cerrado && tr.cerrado.ia ? tarjeta('Visitas desde IAs', num(tr.cerrado.ia), nombreMes(tr.cerrado.mes), 'sd-pendiente', 'geo') : ''}
    ${tarjeta('Keywords en seguimiento', r.total, r.medidas ? `${r.enTop100} aparecen en los 100 primeros de Google` : 'Aún sin medir', '', 'posiciones')}
    ${tarjeta('En la primera página', r.enTop10, r.enTop3 ? `${r.enTop3} en los 3 primeros puestos` : 'Top 10 de Google', '', 'posiciones')}
    ${tarjeta('Posición promedio', r.promedio ?? '—', r.suben || r.bajan ? `${r.suben} suben · ${r.bajan} bajan en el último mes` : '', '', 'posiciones')}
    ${tarjeta('Presencia en IAs', g ? g.tasa + '%' : '—', g ? `${marca} aparece en ${g.menciones} de ${g.total} respuestas (${nombreMes(g.periodo)})` : 'Aún sin medir', '', 'geo')}
    ${tarjeta('Acciones realizadas', hechas, todas.length ? `de ${todas.length} en el plan · mes ${meses.length} de trabajo` : '', '', 'cronograma')}
    ${(datos.contenidos || []).length ? (() => {
      const cs = datos.contenidos, rev = cs.filter(c => c.estado === 'en_revision').length;
      return tarjeta('Contenido', cs.filter(c => c.estado === 'publicado').length + ' publicadas', (rev ? rev + ' esperando tu revisión · ' : '') + cs.length + ' en el calendario', rev ? 'sd-pendiente' : '', 'contenido');
    })() : ''}
  </div>`;
  const grupos = porCluster(datos, series).filter(gr => gr.keywords.length);
  if (grupos.length) {
    h += `<h3 class="sd-h3">Clústeres temáticos</h3><div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>Clúster</th><th>Keywords</th><th>Top 10</th><th>Posición promedio</th><th>Suben / bajan</th></tr></thead><tbody>` +
      grupos.map(gr => `<tr><td><strong>${esc(gr.nombre)}</strong>${gr.pagina_pilar ? `<div class="sd-tenue sd-url">${esc(gr.pagina_pilar)}</div>` : ''}</td><td>${gr.keywords.length}</td><td>${gr.resumen.enTop10}</td><td>${gr.resumen.promedio ?? '—'}</td><td><span class="sd-sube">${gr.resumen.suben}</span> / <span class="sd-baja">${gr.resumen.bajan}</span></td></tr>`).join('') +
      `</tbody></table></div>`;
  }
  return h;
}

function seccionPosiciones(datos, series) {
  if (!series.length) return '<p class="sd-vacio">Todavía no hay keywords en seguimiento.</p>';
  const ultima = datos.ultimaMedicion;
  let h = `<p class="sd-nota">Posición en Google ${esc(PAISES[datos.proyecto.pais] || String(datos.proyecto.pais || '').toUpperCase())}${ultima ? ' · última medición: ' + fechaCorta(ultima) : ''}. Se mide cada semana; «+100» = fuera de los 100 primeros resultados.</p>`;
  for (const g of porCluster(datos, series)) {
    if (!g.keywords.length) continue;
    h += `<h3 class="sd-h3">${esc(g.nombre)} <span class="sd-tenue">· ${g.keywords.length} keywords · ${g.resumen.enTop10} en top 10</span></h3>
      <div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>Keyword</th><th>Posición</th><th>Hace un mes</th><th>Cambio</th><th>Mejor</th><th>Evolución</th><th>Página</th></tr></thead><tbody>` +
      g.keywords.sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999)).map(s => `<tr>
        <td>${esc(s.kw)}</td><td>${s.fecha ? posHtml(s.pos) : '<span class="sd-tenue">sin medir</span>'}</td>
        <td>${s.antes === undefined ? '<span class="sd-tenue">—</span>' : posHtml(s.antes)}</td><td>${cambioHtml(s.cambio, s)}</td>
        <td>${s.mejor ?? '<span class="sd-tenue">—</span>'}</td><td>${sparkline(s.serie)}</td>
        <td class="sd-url">${s.url ? esc(s.url.replace(/^https?:\/\/(www\.)?/, '')) : ''}</td></tr>`).join('') +
      `</tbody></table></div>`;
  }
  return h;
}

function seccionGeo(datos) {
  const marca = esc(datos.proyecto.marca || datos.proyecto.nombre);
  const per = periodosGeo(datos);
  if (!(datos.preguntas || []).length) return '<p class="sd-vacio">Todavía no hay preguntas para medir la presencia en IAs.</p>' + traficoIA(datos);
  if (!per.length) return '<p class="sd-vacio">La primera medición en ChatGPT, Gemini, Claude y Perplexity está en curso.</p>' + traficoIA(datos);
  const g = resumenGeo(datos, per[per.length - 1]);
  const previo = per.length > 1 ? resumenGeo(datos, per[per.length - 2]) : null;
  const delta = previo ? g.tasa - previo.tasa : null;
  let h = `<div class="sd-geo-titular">
      <div class="sd-geo-cifra">${g.tasa}%</div>
      <div><strong>En ${nombreMes(g.periodo)}, las IAs mencionaron a ${marca} en ${g.menciones} de ${g.total} respuestas.</strong>
      ${delta == null ? '' : delta === 0 ? `<div class="sd-tenue">Igual que en ${nombreMes(previo.periodo)}</div>` : `<div class="${delta > 0 ? 'sd-sube' : 'sd-baja'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} puntos frente a ${nombreMes(previo.periodo)}</div>`}
      <div class="sd-nota">Le hacemos a cada IA las preguntas que haría un cliente real${g.corridas > 1 ? `. Cada pregunta se repite ${g.corridas} veces, porque las IAs no responden siempre igual: por eso se cuenta en cuántas respuestas apareces, no un sí o un no` : ''}.</div></div>
    </div>`;
  h += '<div class="sd-tarjetas">' + Object.entries(MOTORES).filter(([k]) => g.motores[k]).map(([k, nombre]) => {
    const m = g.motores[k];
    const p = previo?.motores[k] ? pct(previo.motores[k].menciones, previo.motores[k].respuestas) : null;
    const t = pct(m.menciones, m.respuestas);
    const cita = m.conCitas ? `<br>Citó tu web en ${m.citada} de ${m.conCitas}` : '';
    return tarjeta(nombre, t + '%', `${m.menciones} de ${m.respuestas} respuestas${p == null ? '' : ` · antes ${p}%`}${cita}`, t >= 50 ? 'sd-bien' : t === 0 ? 'sd-mal' : '');
  }).join('') + '</div>';
  if (per.length > 1) {
    h += `<h3 class="sd-h3">Evolución mes a mes</h3>` + barrasMes(per.slice(-12).map(pp => ({ etiqueta: nombreMes(pp).slice(0, 3), valor: resumenGeo(datos, pp).tasa })));
  }
  const motoresVivos = Object.keys(MOTORES).filter(k => g.motores[k]);
  h += `<h3 class="sd-h3">Pregunta por pregunta</h3><div class="sd-tabla-envoltura"><table class="sd-tabla sd-geo-tabla"><thead><tr><th>Lo que preguntaría un cliente</th>${motoresVivos.map(k => `<th>${MOTORES[k]}</th>`).join('')}</tr></thead><tbody>` +
    g.preguntas.map(q => `<tr><td>${esc(q.pregunta)}</td>${motoresVivos.map(k => {
      const x = q.motores[k];
      if (!x) return '<td class="sd-tenue">—</td>';
      const cls = x.si === 0 ? 'sd-celda-no' : x.si === x.n ? 'sd-celda-si' : 'sd-celda-medio';
      return `<td class="${cls}"${x.fragmento ? ` title="${esc(x.fragmento)}"` : ''}>${x.si} de ${x.n}</td>`;
    }).join('')}</tr>`).join('') + '</tbody></table></div>';
  if (g.competidores.length) {
    h += `<h3 class="sd-h3">Competidores que las IAs mencionan</h3><div class="sd-chips">${g.competidores.map(([d, n]) => `<span class="sd-chip">${esc(d)} · ${n}</span>`).join('')}</div>`;
  }
  if (g.fuentes.length) {
    h += `<h3 class="sd-h3">Las páginas que citan las IAs como fuente</h3><p class="sd-nota">Perplexity muestra de dónde sacó su respuesta. Que aparezca tu web aquí es lo que trae visitas.</p><div class="sd-chips">${g.fuentes.map(([d, n]) => `<span class="sd-chip${d === datos.proyecto.dominio ? ' sd-chip-propio' : ''}">${esc(d)} · ${n}</span>`).join('')}</div>`;
  }
  h += traficoIA(datos);
  return h;
}

function seccionCronograma(datos) {
  const meses = mesesCronograma(datos);
  const inicial = (datos.acciones || []).filter(a => String(a.plantilla || '').startsWith('inicial-'));
  const hechasIni = inicial.filter(a => a.estado === 'hecha').length;
  let h = inicial.length ? `<div class="sd-progreso"><div class="sd-progreso-t">Configuración inicial: ${hechasIni} de ${inicial.length}</div><div class="sd-progreso-b"><div style="width:${pct(hechasIni, inicial.length)}%"></div></div></div>` : '';
  h += '<div class="sd-crono">' + meses.slice().reverse().map(m => `<section class="sd-mes">
      <div class="sd-mes-cab"><span class="sd-mes-n">Mes ${m.numero}</span> ${nombreMes(m.mes)}</div>
      ${m.acciones.length ? '<ul class="sd-acciones">' + m.acciones.map(a => `<li class="sd-accion sd-accion-${esc(a.estado)}">
        <span class="sd-estado">${ESTADO[a.estado] || esc(a.estado)}</span>
        <div><div class="sd-accion-t">${esc(a.titulo)} <span class="sd-cat">${CATEGORIAS[a.categoria] || esc(a.categoria)}</span></div>${a.detalle ? `<div class="sd-accion-d">${esc(a.detalle)}</div>` : ''}</div></li>`).join('') + '</ul>'
      : '<p class="sd-tenue">Sin acciones registradas este mes.</p>'}
    </section>`).join('') + '</div>';
  return h;
}

function seccionCompetencia(datos, series) {
  const c = competenciaSerp(series, datos.proyecto.dominio);
  if (!c.length) return '<p class="sd-vacio">La competencia aparece cuando se miden las posiciones.</p>';
  return `<p class="sd-nota">Sitios que aparecen en los 5 primeros resultados de Google para tus keywords, en la última medición.</p>
    <div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>Sitio</th><th>Aparece en</th><th>Está por encima de ti en</th></tr></thead><tbody>` +
    c.map(x => `<tr><td>${esc(x.dominio)}</td><td>${x.apariciones} keywords</td><td>${x.ganan}</td></tr>`).join('') + '</tbody></table></div>';
}

// ── Tráfico: Search Console y GA4 (fase 3) ──────────────────────────────────
const num = (n) => Math.round(n || 0).toLocaleString('es-CO');
const STOP = new Set('de del la las el los en y o a para por con sin un una unos unas que como cual cuál es mi tu su al lo the of for and to in on with a an best mejor mejores'.split(' '));
const tokens = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9ñ]+/).filter(w => w.length > 1 && !STOP.has(w));

// Mes cerrado que se reporta (el anterior) y el que va en curso.
export function mesesDeTrafico(datos) {
  const t = datos.trafico || {};
  return { actual: t.mesActual, cerrado: t.mesAnterior };
}

export function resumenTrafico(datos) {
  const t = datos.trafico || {};
  const porMes = {};
  const m = (mes) => (porMes[mes] ||= { mes, clics: 0, impresiones: 0, posPeso: 0, sesiones: 0, organicas: 0, ia: 0, conversiones: 0, convOrg: 0, convIa: 0, diasGsc: 0, diasGa4: 0 });
  for (const d of t.gscDias || []) { const x = m(d.fecha.slice(0, 7)); x.clics += d.clics; x.impresiones += d.impresiones; x.posPeso += (d.posicion || 0) * d.impresiones; x.diasGsc++; }
  for (const d of t.ga4Dias || []) { const x = m(d.fecha.slice(0, 7)); x.sesiones += d.sesiones; x.organicas += d.sesiones_organicas; x.ia += d.sesiones_ia; x.conversiones += d.conversiones; x.convOrg += d.conversiones_organicas; x.convIa += d.conversiones_ia; x.diasGa4++; }
  const serie = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-13)
    .map(x => ({ ...x, posicion: x.impresiones ? Math.round(x.posPeso / x.impresiones * 10) / 10 : null }));
  const de = (mes) => serie.find(x => x.mes === mes) || null;
  return { serie, cerrado: de(t.mesAnterior), previo: de(prevMes(t.mesAnterior)), actual: de(t.mesActual), hayGsc: !!(t.gscDias || []).length, hayGa4: !!(t.ga4Dias || []).length };
}
function prevMes(ym) {
  if (!ym) return null;
  let [y, mm] = ym.split('-').map(Number); mm--; if (mm < 1) { mm = 12; y--; }
  return y + '-' + String(mm).padStart(2, '0');
}

// Cada búsqueda que trae tráfico, en su clúster: la que está en seguimiento,
// la que se parece a las keywords de un clúster, la de la marca, o nueva.
export function clasificarConsultas(datos, mes) {
  const consultas = ((datos.trafico || {}).gscConsultas || []).filter(c => c.mes === mes);
  const kwPorTexto = new Map((datos.keywords || []).map(k => [k.kw.trim().toLowerCase(), k]));
  const clusters = (datos.clusters || []).map(c => {
    const vocab = new Set(tokens(c.nombre));
    for (const k of datos.keywords || []) if (k.cluster_id === c.id) tokens(k.kw).forEach(w => vocab.add(w));
    return { ...c, vocab };
  });
  const marca = new Set([...tokens(datos.proyecto.marca), ...tokens(String(datos.proyecto.dominio || '').split('.')[0])].filter(w => w.length > 2));
  const grupos = new Map();
  const g = (clave, nombre) => grupos.get(clave) || grupos.set(clave, { clave, nombre, consultas: [], clics: 0, impresiones: 0 }).get(clave);
  for (const c of consultas) {
    const k = kwPorTexto.get(c.consulta.trim().toLowerCase());
    const tk = tokens(c.consulta);
    let destino = null;
    if (k) destino = k.cluster_id ? clusters.find(x => x.id === k.cluster_id) : null;
    if (!destino && !k) {
      let mejor = null, puntaje = 0;
      for (const cl of clusters) {
        const comunes = tk.filter(w => cl.vocab.has(w)).length;
        const sc = tk.length ? comunes / tk.length : 0;
        if (comunes && sc > puntaje) { puntaje = sc; mejor = cl; }
      }
      if (mejor && puntaje >= 0.5) destino = mejor;
    }
    const esMarca = tk.some(w => marca.has(w));
    const grupo = destino ? g(destino.id, destino.nombre) : esMarca ? g('__marca', 'Búsquedas de tu marca')
      : k ? g('__seguimiento', 'En seguimiento, sin clúster') : g('__nuevas', 'Nuevas: fuera de las keywords elegidas');
    grupo.consultas.push({ ...c, seguimiento: !!k });
    grupo.clics += c.clics; grupo.impresiones += c.impresiones;
  }
  // Primero los clústeres, luego lo que está en seguimiento sin clúster, las
  // nuevas (lo que más interesa descubrir) y al final la marca.
  const orden = (x) => ({ __seguimiento: 1, __nuevas: 2, __marca: 3 }[x.clave] || 0);
  return [...grupos.values()].sort((a, b) => orden(a) - orden(b) || b.clics - a.clics);
}

const delta = (a, b) => {
  if (a == null || b == null) return '';
  if (!b) return a ? '<span class="sd-sube">▲ nuevo</span>' : '<span class="sd-tenue">igual</span>';
  const d = Math.round((a - b) / b * 100);
  return d === 0 ? '<span class="sd-tenue">igual</span>' : `<span class="${d > 0 ? 'sd-sube' : 'sd-baja'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`;
};

function barrasValor(puntos) {
  if (!puntos.length) return '';
  const max = Math.max(...puntos.map(p => p.valor), 1);
  return `<div class="sd-barras">${puntos.map(p => `<div class="sd-barra"><div class="sd-barra-col"><div style="height:${Math.max(2, Math.round(p.valor / max * 100))}%"></div></div><div class="sd-barra-v">${num(p.valor)}</div><div class="sd-barra-e">${esc(p.etiqueta)}</div></div>`).join('')}</div>`;
}

function seccionTrafico(datos) {
  const r = resumenTrafico(datos);
  if (!r.hayGsc && !r.hayGa4) return '<p class="sd-vacio">El tráfico aparece aquí cuando se conectan Google Search Console y Google Analytics.</p>';
  const { cerrado, actual } = mesesDeTrafico(datos);
  const c = r.cerrado, p = r.previo;
  let h = `<p class="sd-nota">Cifras de ${cerrado ? nombreMes(cerrado) : 'el último mes'}, comparadas con el mes anterior.${r.actual ? ` En ${nombreMes(actual)} (en curso): ${r.hayGsc ? num(r.actual.clics) + ' clics desde Google' : ''}${r.hayGsc && r.hayGa4 ? ' · ' : ''}${r.hayGa4 ? num(r.actual.sesiones) + ' visitas' : ''}.` : ''}</p><div class="sd-tarjetas">`;
  if (r.hayGsc) {
    h += tarjeta('Clics desde Google', c ? num(c.clics) : '—', c && p ? delta(c.clics, p.clics) + (c.clics === p.clics ? ' que en ' : ' frente a ') + nombreMes(p.mes) : '') +
      tarjeta('Veces que apareciste', c ? num(c.impresiones) : '—', c && p ? delta(c.impresiones, p.impresiones) : 'Impresiones en Google') +
      tarjeta('Posición media', c?.posicion ?? '—', 'En todas las búsquedas');
  }
  if (r.hayGa4) {
    h += tarjeta('Visitas al sitio', c ? num(c.sesiones) : '—', c && p ? delta(c.sesiones, p.sesiones) : '') +
      tarjeta('Visitas desde buscadores', c ? num(c.organicas) : '—', c ? num(c.convOrg) + ' conversiones' : '') +
      tarjeta('Visitas desde IAs', c ? num(c.ia) : '—', c ? num(c.convIa) + ' conversiones' : '', c && c.ia ? 'sd-pendiente' : '');
  }
  h += '</div>';
  const meses = r.serie.filter(x => x.mes !== actual);
  if (r.hayGsc && meses.length > 1) h += '<h3 class="sd-h3">Clics desde Google, mes a mes</h3>' + barrasValor(meses.map(x => ({ etiqueta: nombreMes(x.mes).slice(0, 3), valor: x.clics })));
  if (r.hayGa4 && meses.length > 1) h += '<h3 class="sd-h3">Visitas desde buscadores, mes a mes</h3>' + barrasValor(meses.map(x => ({ etiqueta: nombreMes(x.mes).slice(0, 3), valor: x.organicas })));
  h += seccionCalidad(datos);
  h += seccionOrigenes(datos);
  h += seccionEntradasOrganicas(datos);
  const hayConsultas = (datos.trafico.gscConsultas || []).length > 0;
  if (!hayConsultas) {
    h += `<div class="sd-aviso"><strong>¿Qué buscaron en Google para llegar?</strong> ${r.hayGsc
      ? 'Las búsquedas exactas las da Search Console y todavía no tiene datos de este sitio (una propiedad recién creada tarda unos días). Aparecerán aquí solas, clasificadas por clúster.'
      : 'Las búsquedas exactas las da Google Search Console: aparecerán aquí, clasificadas por clúster, en cuanto se conecte.'}</div>`;
  }
  if (r.hayGsc && hayConsultas) {
    const mesC = ((datos.trafico.gscConsultas || []).some(x => x.mes === cerrado)) ? cerrado : actual;
    const grupos = clasificarConsultas(datos, mesC);
    if (grupos.length) {
      h += `<h3 class="sd-h3">Las búsquedas que te traen tráfico (${nombreMes(mesC)})</h3><p class="sd-nota">Todas las búsquedas por las que apareciste en Google, en su clúster: también las que no estaban en seguimiento. ★ = keyword en seguimiento.</p>`;
      for (const gr of grupos) {
        h += `<details class="sd-grupo"${gr.clave === '__marca' ? '' : ' open'}><summary><strong>${esc(gr.nombre)}</strong> <span class="sd-tenue">· ${gr.consultas.length} ${gr.consultas.length === 1 ? 'búsqueda' : 'búsquedas'} · ${num(gr.clics)} clics · ${num(gr.impresiones)} impresiones</span></summary>
          <div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>Búsqueda</th><th>Clics</th><th>Impresiones</th><th>Posición media</th></tr></thead><tbody>` +
          gr.consultas.slice(0, 25).map(q => `<tr><td>${q.seguimiento ? '★ ' : ''}${esc(q.consulta)}</td><td>${num(q.clics)}</td><td>${num(q.impresiones)}</td><td>${q.posicion ? Math.round(q.posicion * 10) / 10 : '—'}</td></tr>`).join('') +
          (gr.consultas.length > 25 ? `<tr><td colspan="4" class="sd-tenue">y ${gr.consultas.length - 25} búsquedas más</td></tr>` : '') + '</tbody></table></div></details>';
      }
    }
    const paginas = (datos.trafico.gscPaginas || []).filter(x => x.mes === mesC).slice(0, 10);
    if (paginas.length) {
      h += `<h3 class="sd-h3">Las páginas que más tráfico traen</h3><div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>Página</th><th>Clics</th><th>Impresiones</th><th>Posición media</th></tr></thead><tbody>` +
        paginas.map(x => `<tr><td class="sd-url">${esc(x.pagina.replace(/^https?:\/\/(www\.)?/, ''))}</td><td>${num(x.clics)}</td><td>${num(x.impresiones)}</td><td>${x.posicion ? Math.round(x.posicion * 10) / 10 : '—'}</td></tr>`).join('') + '</tbody></table></div>';
    }
  }
  return h;
}

// ── El detalle de GA4: de dónde llega cada visita ──
// El mes que se muestra: el cerrado si tiene datos; si no, el que va en curso.
function detalleDe(datos, tipo) {
  const det = (datos.trafico || {}).ga4Detalle || [];
  const { cerrado, actual } = mesesDeTrafico(datos);
  const mes = det.some(x => x.mes === cerrado && x.tipo === tipo) ? cerrado : actual;
  return { mes, filas: det.filter(x => x.mes === mes && x.tipo === tipo) };
}
const duracionTxt = (seg) => { const s = Math.round(seg || 0); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s'; };
const rutaDe = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '') || '(sin dato)';
const NOMBRE_CANAL = { 'Organic Search': 'Buscadores (orgánico)', 'Direct': 'Directo', 'Referral': 'Otros sitios', 'Organic Social': 'Redes sociales', 'Paid Social': 'Redes sociales pagadas', 'Paid Search': 'Google Ads / búsqueda pagada', 'Email': 'Correo', 'AI Assistant': 'Asistentes de IA', 'Unassigned': 'Sin clasificar', 'Organic Video': 'Video', 'Display': 'Display', 'Cross-network': 'Varias redes (Performance Max)', 'Organic Shopping': 'Shopping orgánico', 'Paid Video': 'Video pagado', 'SMS': 'SMS' };
// La dirección de origen dicha en claro. Perplexity suele dejar la pregunta en
// la URL (/search/que-crm-recomiendas-XyZ): se muestra como texto.
export function origenLegible(u) {
  const t = String(u || '');
  if (!t) return 'No se sabe (la IA no envió la dirección)';
  const m = t.match(/perplexity\.ai\/search\/([^?#]+)/i);
  if (m) return 'Pregunta en Perplexity: «' + decodeURIComponent(m[1]).replace(/-[A-Za-z0-9_.]{6,}$/, '').replace(/[-_]+/g, ' ').trim() + '»';
  return rutaDe(t);
}

function seccionOrigenes(datos) {
  const { mes, filas } = detalleDe(datos, 'fuente');
  if (!filas.length) return '';
  const porCanal = {};
  for (const f of filas) { const c = (porCanal[f.valor] ||= { sesiones: 0, conv: 0 }); c.sesiones += f.sesiones; c.conv += f.conversiones; }
  const total = filas.reduce((a, f) => a + f.sesiones, 0) || 1;
  const canales = Object.entries(porCanal).sort((a, b) => b[1].sesiones - a[1].sesiones);
  let h = `<h3 class="sd-h3">De dónde llegan las visitas (${nombreMes(mes)})</h3>
    <div class="sd-canales">${canales.map(([c, x]) => `<div class="sd-canal"><div class="sd-canal-t">${esc(NOMBRE_CANAL[c] || c)}</div>
      <div class="sd-canal-b"><div style="width:${Math.max(1, Math.round(x.sesiones / total * 100))}%"></div></div>
      <div class="sd-canal-v">${num(x.sesiones)} <span class="sd-tenue">· ${Math.round(x.sesiones / total * 100)}%${x.conv ? ' · ' + num(x.conv) + ' conv.' : ''}</span></div></div>`).join('')}</div>`;
  h += `<details class="sd-grupo"><summary><strong>Fuentes exactas</strong> <span class="sd-tenue">· sitio o red que envió cada visita</span></summary><div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>Fuente</th><th>Tipo</th><th>Visitas</th><th>Tiempo medio</th><th>Conversiones</th></tr></thead><tbody>` +
    filas.slice(0, 25).map(f => `<tr><td>${esc(f.fuente)} <span class="sd-tenue">/ ${esc(f.valor2)}</span></td><td>${esc(NOMBRE_CANAL[f.valor] || f.valor)}</td><td>${num(f.sesiones)}</td><td>${duracionTxt(f.duracion)}</td><td>${num(f.conversiones)}</td></tr>`).join('') + '</tbody></table></div></details>';
  return h;
}

// Calidad de las visitas (pedido de Alejandro tras ver un reporte de Looker
// Studio): no solo cuántas llegan, sino si se quedan.
export function calidadDe(datos, mes) {
  const filas = ((datos.trafico || {}).ga4Detalle || []).filter(x => x.tipo === 'calidad' && x.mes === mes);
  const de = (canal) => {
    const f = filas.find(x => x.valor === canal);
    if (!f || !f.sesiones) return null;
    return { usuarios: f.usuarios, nuevos: f.usuarios ? f.nuevos / f.usuarios : 0, interaccion: f.comprometidas / f.sesiones,
      paginas: f.vistas / f.sesiones, tiempo: f.usuarios ? f.interaccion_seg / f.usuarios : 0, sesiones: f.sesiones };
  };
  return { total: de('__total'), organico: de('Organic Search'), ia: de('AI Assistant') };
}

function seccionCalidad(datos) {
  const det = (datos.trafico || {}).ga4Detalle || [];
  const { cerrado, actual } = mesesDeTrafico(datos);
  const mes = det.some(x => x.tipo === 'calidad' && x.mes === cerrado) ? cerrado : actual;
  const ahora = calidadDe(datos, mes), antes = calidadDe(datos, prevMes(mes));
  if (!ahora.total) return '';
  const pp = (v) => Math.round(v * 100) + '%';
  const varPts = (a, b) => (a == null || b == null) ? '' : (() => { const d = Math.round((a - b) * 100); return d === 0 ? '' : ` <span class="${d > 0 ? 'sd-sube' : 'sd-baja'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts</span>`; })();
  const varRel = (a, b) => (a == null || !b) ? '' : (() => { const d = Math.round((a - b) / b * 100); return d === 0 ? '' : ` <span class="${d > 0 ? 'sd-sube' : 'sd-baja'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`; })();
  const fila = (nombre, a, b) => !a ? '' : `<tr><td><strong>${nombre}</strong></td>
    <td>${num(a.usuarios)}${varRel(a.usuarios, b?.usuarios)}</td>
    <td>${pp(a.nuevos)}</td>
    <td>${pp(a.interaccion)}${varPts(a.interaccion, b?.interaccion)}</td>
    <td>${(Math.round(a.paginas * 10) / 10).toLocaleString('es-CO')}${varRel(a.paginas, b?.paginas)}</td>
    <td>${duracionTxt(a.tiempo)}${varRel(a.tiempo, b?.tiempo)}</td></tr>`;
  return `<h3 class="sd-h3">Calidad de las visitas (${nombreMes(mes)}, frente a ${nombreMes(prevMes(mes))})</h3>
    <p class="sd-nota">No solo cuántas visitas llegan, sino si se quedan. «Con interacción» = la visita duró más de 10 segundos, vio 2 o más páginas o hizo una conversión.</p>
    <div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th></th><th>Usuarios</th><th>Nuevos</th><th>Con interacción</th><th>Páginas por visita</th><th>Tiempo por usuario</th></tr></thead><tbody>` +
    fila('Todo el sitio', ahora.total, antes.total) + fila('Desde buscadores', ahora.organico, antes.organico) + fila('Desde IAs', ahora.ia, antes.ia) +
    '</tbody></table></div>';
}

function seccionEntradasOrganicas(datos) {
  const { mes, filas } = detalleDe(datos, 'entrada_org');
  if (!filas.length) return '';
  const porPagina = {};
  for (const f of filas) {
    const x = (porPagina[f.valor] ||= { pagina: f.valor, sesiones: 0, comprometidas: 0, durPeso: 0, conv: 0, buscadores: {} });
    x.sesiones += f.sesiones; x.comprometidas += f.comprometidas; x.durPeso += (f.duracion || 0) * f.sesiones; x.conv += f.conversiones;
    x.buscadores[f.fuente] = (x.buscadores[f.fuente] || 0) + f.sesiones;
  }
  const lista = Object.values(porPagina).sort((a, b) => b.sesiones - a.sesiones);
  return `<h3 class="sd-h3">Desde buscadores: a qué páginas llegaron (${nombreMes(mes)})</h3>
    <div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>Página de entrada</th><th>Buscador</th><th>Visitas</th><th>Se quedaron</th><th>Tiempo medio</th><th>Conversiones</th></tr></thead><tbody>` +
    lista.slice(0, 20).map(x => `<tr><td class="sd-url">${esc(x.pagina === '(not set)' ? '(sin dato)' : x.pagina)}</td><td>${Object.entries(x.buscadores).sort((a, b) => b[1] - a[1]).map(([b, n]) => esc(b) + ' ' + num(n)).join(', ')}</td>
      <td>${num(x.sesiones)}</td><td>${x.sesiones ? Math.round(x.comprometidas / x.sesiones * 100) + '%' : '—'}</td><td>${duracionTxt(x.sesiones ? x.durPeso / x.sesiones : 0)}</td><td>${num(x.conv)}</td></tr>`).join('') + '</tbody></table></div>';
}

// Las visitas que llegaron desde las IAs (GA4), para la sección de GEO.
function traficoIA(datos) {
  const ia = (datos.trafico || {}).ga4Ia || [];
  const { cerrado, actual } = mesesDeTrafico(datos);
  if (!((datos.trafico || {}).ga4Dias || []).length) {
    return `<div class="sd-aviso"><strong>¿Y el tráfico que llega desde las IAs?</strong> Las visitas desde ChatGPT, Gemini, Perplexity, Copilot y Claude se verán aquí, mes a mes, en cuanto se conecte Google Analytics.</div>`;
  }
  const mes = ia.some(x => x.mes === cerrado) ? cerrado : actual;
  const delMes = ia.filter(x => x.mes === mes).sort((a, b) => b.sesiones - a.sesiones);
  const total = delMes.reduce((a, x) => a + x.sesiones, 0), conv = delMes.reduce((a, x) => a + x.conversiones, 0);
  const porMes = {};
  for (const x of ia) porMes[x.mes] = (porMes[x.mes] || 0) + x.sesiones;
  let h = `<h3 class="sd-h3">Visitas que te llegaron desde las IAs</h3>
    <div class="sd-geo-titular"><div class="sd-geo-cifra">${num(total)}</div><div><strong>visitas en ${nombreMes(mes)} llegaron desde un asistente de IA${conv ? ', con ' + num(conv) + ' conversiones' : ''}.</strong>
    <div class="sd-nota">Es un mínimo: algunas IAs no dicen de dónde viene la visita y esas llegan como «directo».</div></div></div>`;
  if (delMes.length) h += `<div class="sd-chips">${delMes.map(x => `<span class="sd-chip">${esc(x.fuente)} · ${num(x.sesiones)} visitas${x.conversiones ? ' · ' + num(x.conversiones) + ' conv.' : ''}</span>`).join('')}</div>`;
  // Sin el mes en curso: a medias parecería una caída.
  const serie = Object.entries(porMes).filter(([m]) => m !== actual).sort().slice(-12);
  if (serie.length > 1) h += barrasValor(serie.map(([m, v]) => ({ etiqueta: nombreMes(m).slice(0, 3), valor: v })));
  // Qué se sabe de esas visitas.
  const ent = detalleDe(datos, 'entrada_ia'), refs = detalleDe(datos, 'referente_ia'), paises = detalleDe(datos, 'pais_ia');
  if (ent.filas.length) {
    h += `<h3 class="sd-h3">A qué páginas llegaron y qué hicieron (${nombreMes(ent.mes)})</h3>
      <div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>IA</th><th>Página de entrada</th><th>Visitas</th><th>Se quedaron</th><th>Tiempo medio</th><th>Conversiones</th></tr></thead><tbody>` +
      ent.filas.slice(0, 20).map(f => `<tr><td>${esc(f.fuente)}</td><td class="sd-url">${esc(f.valor === '(not set)' ? '(sin dato)' : f.valor)}</td><td>${num(f.sesiones)}</td>
        <td>${f.sesiones ? Math.round(f.comprometidas / f.sesiones * 100) + '%' : '—'}</td><td>${duracionTxt(f.duracion)}</td><td>${num(f.conversiones)}</td></tr>`).join('') + '</tbody></table></div>';
  }
  if (refs.filas.length) {
    h += `<h3 class="sd-h3">Desde dónde exactamente</h3><div class="sd-tabla-envoltura"><table class="sd-tabla"><thead><tr><th>IA</th><th>Origen</th><th>Visitas</th></tr></thead><tbody>` +
      refs.filas.slice(0, 15).map(f => `<tr><td>${esc(f.fuente)}</td><td>${esc(origenLegible(f.valor))}</td><td>${num(f.sesiones)}</td></tr>`).join('') + '</tbody></table></div>';
  }
  if (paises.filas.length) {
    const dispositivo = { desktop: 'computador', mobile: 'celular', tablet: 'tableta' };
    h += `<h3 class="sd-h3">De dónde son</h3><div class="sd-chips">${paises.filas.slice(0, 12).map(f => `<span class="sd-chip">${esc(f.valor)} · ${esc(dispositivo[f.valor2] || f.valor2)} · ${num(f.sesiones)}</span>`).join('')}</div>`;
  }
  h += '<p class="sd-nota">Lo que la persona le preguntó a la IA no llega al sitio: ChatGPT y Gemini no lo comparten. Perplexity a veces lo deja en la dirección de origen, y entonces se muestra arriba. Para saber en qué preguntas te recomiendan las IAs, mira la medición de arriba.</p>';
  return h;
}

// ── Calendario de contenido (fase 2) ────────────────────────────────────────
const etiquetaEstado = (estado, cliente) => ESTADOS_CONTENIDO[estado]?.[cliente ? 'cliente' : 'agencia'] || estado;

function seccionContenido(datos, series, { vistaCliente = false } = {}) {
  const lista = datos.contenidos || [];
  if (!lista.length) return '<p class="sd-vacio">Todavía no hay contenido en el calendario.</p>';
  const porRevisar = lista.filter(c => c.estado === 'en_revision').length;
  const clusters = Object.fromEntries((datos.clusters || []).map(c => [c.id, c.nombre]));
  const grupos = {};
  for (const c of lista) (grupos[c.fecha ? c.fecha.slice(0, 7) : 'sin-fecha'] ||= []).push(c);
  const cuenta = (e) => lista.filter(c => c.estado === e).length;
  const titular = vistaCliente
    ? [(porRevisar === 1 ? 'Hay una pieza esperando tu revisión' : 'Hay ' + porRevisar + ' piezas esperando tu revisión'), 'Ábrela, léela y apruébala o pide cambios con una nota.']
    : [(porRevisar === 1 ? 'Una pieza está esperando la revisión del cliente' : porRevisar + ' piezas están esperando la revisión del cliente'), 'Te avisamos al celular y al correo cuando responda.'];
  let h = (porRevisar ? `<div class="sd-geo-titular"><div class="sd-geo-cifra">${porRevisar}</div><div><strong>${titular[0]}.</strong><div class="sd-nota">${titular[1]}</div></div></div>` : '') +
    `<div class="sd-tarjetas">${tarjeta('En el calendario', lista.length)}${tarjeta('Aprobadas', cuenta('aprobado') + cuenta('publicado'))}${tarjeta('Publicadas', cuenta('publicado'))}${tarjeta('Con cambios pedidos', cuenta('cambios'))}</div>`;
  for (const mes of Object.keys(grupos).sort()) {
    h += `<h3 class="sd-h3">${mes === 'sin-fecha' ? 'Sin fecha' : nombreMes(mes)}</h3><div class="sd-piezas">` + grupos[mes].map(c => `
      <button class="sd-pieza sd-pieza-${esc(c.estado)}" data-contenido="${esc(c.id)}">
        <span class="sd-pieza-estado">${esc(etiquetaEstado(c.estado, vistaCliente))}</span>
        <span class="sd-pieza-t">${esc(c.titulo)}</span>
        <span class="sd-tenue">${esc(TIPOS[c.tipo] || c.tipo)}${c.fecha ? ' · ' + fechaCorta(c.fecha) : ''}${c.keyword ? ' · «' + esc(c.keyword) + '»' : ''}${c.cluster_id && clusters[c.cluster_id] ? ' · ' + esc(clusters[c.cluster_id]) : ''}</span>
      </button>`).join('') + '</div>';
  }
  return h;
}

// El detalle de una pieza: su texto, la conversación y —en el enlace del
// cliente— los botones para aprobar o pedir cambios. `formulario` lo decide
// quien dibuja: la página pública lo pide; la app no (allí responde la agencia).
export function detalleContenido(datos, id, { vistaCliente = false, formulario = false, nombre = '' } = {}) {
  const c = (datos.contenidos || []).find(x => x.id === id);
  if (!c) return '<p class="sd-vacio">Esa pieza ya no está en el calendario.</p>';
  const comentarios = (datos.comentarios || []).filter(x => x.contenido_id === id);
  const oculto = vistaCliente && c.estado === 'borrador';
  const accionTxt = { aprobado: 'aprobó', cambios: 'pidió cambios', comentario: '' };
  let h = `<button class="sd-volver" data-seccion="contenido">← Calendario</button>
    <div class="sd-pieza-cab"><span class="sd-pieza-estado sd-pieza-${esc(c.estado)}">${esc(etiquetaEstado(c.estado, vistaCliente))}</span>
    <h3 class="sd-pieza-titulo">${esc(c.titulo)}</h3>
    <div class="sd-tenue">${esc(TIPOS[c.tipo] || c.tipo)}${c.fecha ? ' · publicación prevista: ' + fechaCorta(c.fecha) : ''}${c.keyword ? ' · keyword: «' + esc(c.keyword) + '»' : ''}${c.version ? ' · versión ' + c.version : ''}</div>
    ${c.aprobado_por ? `<div class="sd-sube">Aprobado por ${esc(c.aprobado_por)}${c.aprobado_at ? ' el ' + fechaCorta(String(c.aprobado_at).slice(0, 10)) : ''}</div>` : ''}
    ${c.url_publicada ? `<a class="sd-boton" href="${esc(c.url_publicada)}" target="_blank" rel="noopener">Ver publicado</a>` : ''}</div>`;
  if (oculto) h += '<p class="sd-nota">Esta pieza está planeada. Te la enviaremos para revisar cuando esté lista.</p>';
  else {
    if (c.enlace_doc) h += `<a class="sd-boton" href="${esc(c.enlace_doc)}" target="_blank" rel="noopener">Abrir el documento</a>`;
    if (c.cuerpo) h += `<div class="sd-pieza-cuerpo">${esc(c.cuerpo).split(/\n{2,}/).map(par => '<p>' + par.replace(/\n/g, '<br>') + '</p>').join('')}</div>`;
  }
  if (comentarios.length) {
    h += '<h3 class="sd-h3">Conversación</h3><ul class="sd-hilo">' + comentarios.map(x => `<li class="sd-msj sd-msj-${esc(x.autor_tipo)}">
      <div class="sd-msj-cab"><strong>${esc(x.autor_nombre || (x.autor_tipo === 'agencia' ? 'Tu agencia' : 'Cliente'))}</strong>
      ${accionTxt[x.accion] ? `<span class="${x.accion === 'aprobado' ? 'sd-sube' : 'sd-baja'}">${accionTxt[x.accion]}</span>` : ''}
      <span class="sd-tenue">${fechaCorta(String(x.creado_at).slice(0, 10))}${x.version ? ' · v' + x.version : ''}</span></div>
      ${x.texto ? `<div>${esc(x.texto).replace(/\n/g, '<br>')}</div>` : ''}</li>`).join('') + '</ul>';
  }
  if (formulario && !oculto) {
    const revisando = c.estado === 'en_revision';
    h += `<div class="sd-form" data-form-contenido="${esc(c.id)}">
      <h3 class="sd-h3">${revisando ? 'Tu revisión' : 'Escribe a tu agencia'}</h3>
      <label>Tu nombre<input class="sd-input" name="nombre" value="${esc(nombre)}" maxlength="80" placeholder="Para que sepan quién respondió"></label>
      <label>${revisando ? 'Comentarios o cambios (opcional para aprobar)' : 'Mensaje'}<textarea class="sd-input" name="texto" rows="4" maxlength="4000"></textarea></label>
      <div class="sd-form-botones">${revisando
        ? '<button class="sd-boton sd-boton-pri" data-accion="aprobar">Aprobar</button><button class="sd-boton" data-accion="cambios">Pedir cambios</button>'
        : ''}<button class="sd-boton" data-accion="comentario">${revisando ? 'Solo comentar' : 'Enviar'}</button></div>
      <div class="sd-form-estado" aria-live="polite"></div></div>`;
  }
  return h;
}

// ── Entrada ─────────────────────────────────────────────────────────────────
export function panelSeo(datos, { seccion = 'resumen', agencia = null, contenido = null, vistaCliente = true, formulario = false, nombre = '' } = {}) {
  const series = seriesDeKeywords(datos);
  const cuerpo = contenido
    ? () => detalleContenido(datos, contenido, { vistaCliente, formulario, nombre })
    : ({ resumen: seccionResumen, trafico: seccionTrafico, posiciones: seccionPosiciones, geo: seccionGeo, contenido: (d, s) => seccionContenido(d, s, { vistaCliente }), cronograma: seccionCronograma, competencia: seccionCompetencia }[seccion] || seccionResumen);
  if (contenido) seccion = 'contenido';
  return `<div class="seo-doc">
    <header class="sd-cab"><div><div class="sd-cab-t">${esc(datos.proyecto.nombre)}</div><div class="sd-tenue">${esc(datos.proyecto.dominio)}${agencia ? ' · Preparado por ' + esc(agencia) : ''}</div></div></header>
    <nav class="sd-tabs">${SECCIONES.map(([k, t]) => `<button class="sd-tab${k === seccion ? ' act' : ''}" data-seccion="${k}">${t}</button>`).join('')}</nav>
    <div class="sd-cuerpo">${cuerpo(datos, series)}</div>
  </div>`;
}
