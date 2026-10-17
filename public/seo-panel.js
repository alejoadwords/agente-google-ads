// public/seo-panel.js — el dashboard SEO, para la app y para el cliente.
//
// Un solo módulo calcula y dibuja: lo usan la vista «Lo que ve el cliente» de
// la app y la página pública /seo/<código>. Si cada uno tuviera su código,
// algún día dirían cifras distintas sobre el mismo proyecto (la lección de
// public/informes.js). Sin DOM ni globales: recibe los datos y devuelve HTML.
// Todo vive dentro de `.seo-doc` (estilos en public/seo-panel.css).

export const SECCIONES = [
  ['resumen', 'Resumen'],
  ['posiciones', 'Posiciones'],
  ['geo', 'Presencia en IAs'],
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
const tarjeta = (titulo, valor, nota = '', clase = '') =>
  `<div class="sd-tarjeta ${clase}"><div class="sd-tarjeta-t">${titulo}</div><div class="sd-tarjeta-v">${valor}</div>${nota ? `<div class="sd-tarjeta-n">${nota}</div>` : ''}</div>`;

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
  let h = `<div class="sd-tarjetas">
    ${tarjeta('Keywords en seguimiento', r.total, r.medidas ? `${r.enTop100} aparecen en los 100 primeros de Google` : 'Aún sin medir')}
    ${tarjeta('En la primera página', r.enTop10, r.enTop3 ? `${r.enTop3} en los 3 primeros puestos` : 'Top 10 de Google')}
    ${tarjeta('Posición promedio', r.promedio ?? '—', r.suben || r.bajan ? `${r.suben} suben · ${r.bajan} bajan en el último mes` : '')}
    ${tarjeta('Presencia en IAs', g ? g.tasa + '%' : '—', g ? `${marca} aparece en ${g.menciones} de ${g.total} respuestas (${nombreMes(g.periodo)})` : 'Aún sin medir')}
    ${tarjeta('Acciones realizadas', hechas, todas.length ? `de ${todas.length} en el plan · mes ${meses.length} de trabajo` : '')}
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
  if (!(datos.preguntas || []).length) return '<p class="sd-vacio">Todavía no hay preguntas para medir la presencia en IAs.</p>';
  if (!per.length) return '<p class="sd-vacio">La primera medición en ChatGPT, Gemini, Claude y Perplexity está en curso.</p>';
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
  h += `<div class="sd-aviso"><strong>¿Y el tráfico que llega desde las IAs?</strong> Las visitas desde ChatGPT, Gemini, Perplexity, Copilot y Claude se verán aquí, mes a mes, en cuanto conectemos tu Google Analytics y tu Search Console.</div>`;
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

// ── Entrada ─────────────────────────────────────────────────────────────────
export function panelSeo(datos, { seccion = 'resumen', agencia = null } = {}) {
  const series = seriesDeKeywords(datos);
  const cuerpo = { resumen: seccionResumen, posiciones: seccionPosiciones, geo: seccionGeo, cronograma: seccionCronograma, competencia: seccionCompetencia }[seccion] || seccionResumen;
  return `<div class="seo-doc">
    <header class="sd-cab"><div><div class="sd-cab-t">${esc(datos.proyecto.nombre)}</div><div class="sd-tenue">${esc(datos.proyecto.dominio)}${agencia ? ' · Preparado por ' + esc(agencia) : ''}</div></div></header>
    <nav class="sd-tabs">${SECCIONES.map(([k, t]) => `<button class="sd-tab${k === seccion ? ' act' : ''}" data-seccion="${k}">${t}</button>`).join('')}</nav>
    <div class="sd-cuerpo">${cuerpo(datos, series)}</div>
  </div>`;
}
