// public/informes.js — los informes de Análisis, en un solo sitio.
//
// Resumen, Ventas, Productividad, Marketing y Por comercial se calculaban y se
// dibujaban dentro de app.js, pegados a variables globales de la pantalla. Para
// compartirlos por un enlace vivo (/i/<código>) y descargarlos en PDF hacía
// falta que el MISMO código los dibujara en tres sitios: la app, la página
// pública y el PDF. Si hubiera dos versiones, un día el enlace y la app dirían
// cifras distintas sobre la misma cuenta, que es justo lo que no puede pasar
// con un informe que el cliente le enseña a su jefe (09-10-2026).
//
// Aquí no se toca el DOM ni se lee nada global: cada informe recibe un
// contexto con los datos y devuelve HTML. Dos banderas cambian lo que sale:
//
//   interactivo  botones, clics y la botonera de fechas (solo en la app).
//   privado      sin nombres ni datos de contacto de los leads: lo que va por
//                un enlace público. Los comerciales sí salen: son del equipo.
//
// Las funciones auxiliares (fechaDeCierre, pipeProbFor…) son copia exacta de
// las de app.js; pruebas/informes-compartidos.mjs vigila que no se separen.

// ── Auxiliares (copia exacta de app.js) ─────────────────────────────────────
export function esc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function escJsAttr(v){return esc(JSON.stringify(v==null?'':String(v)))}

export const ETAPAS_CERRADAS = ['ganado', 'perdido', 'won', 'lost', 'cerrado', 'descartado'];
export const TAG_PALETTE = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EC4899','#14B8A6','#EF4444','#6366F1','#84CC16','#F97316'];

export function fechaDeCierre(l) {
  return (l && (l.closed_at || l.created_at)) || null;
}

export function leadCerrado(l) {
  if (!l) return false;
  if (l.closed_at) return true;
  return ETAPAS_CERRADAS.includes(String(l.stage || '').toLowerCase());
}

export function pipeProbFor(stage, idx, total) {
  if (stage.key === 'ganado') return 100;
  if (stage.key === 'perdido') return 0;
  if (Number.isFinite(stage.probability) && stage.probability !== null) return stage.probability;
  const openCount = Math.max(1, total - 2);
  return Math.min(90, Math.round(((idx + 1) / (openCount + 1)) * 100));
}

export function crmFechaLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// ── Rangos (copia de app.js) ─────────────────────────────────────────────────
export const RANGOS = [[7, '7 días'], [30, '30 días'], [90, '90 días'], [0, 'Todo']];
export function esRangoLibre(r) { return !!r && typeof r === 'object'; }
export function rangoIni(r, tope) {
  if (esRangoLibre(r)) return r.desde;
  return r ? Date.now() - r * 86400000 : (tope ? Date.now() - tope * 86400000 : 0);
}
export function rangoFin(r) {
  if (esRangoLibre(r)) return r.hasta;
  const fin = new Date();
  fin.setHours(23, 59, 59, 999);
  return fin.getTime();
}
export function rangoDias(r, porDefecto) {
  if (esRangoLibre(r)) return Math.max(1, Math.ceil((r.hasta - r.desde) / 86400000));
  return r || porDefecto;
}
export function rangoEtiqueta(r) {
  if (!esRangoLibre(r)) return null;
  const f = t => new Date(t).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  return f(r.desde) + ' – ' + f(r.hasta);
}
// Cómo se dice un periodo en una portada o en un subtítulo.
export function rangoTexto(r) {
  if (esRangoLibre(r)) return rangoEtiqueta(r);
  if (!r) return 'Toda la historia';
  return 'Últimos ' + r + ' días';
}

// ── El contexto ─────────────────────────────────────────────────────────────
// Lo que recibe cada informe. Los campos que no apliquen pueden faltar.
//
//   leads        los del ámbito y el proceso, ya recortados
//   etapas       las del proceso elegido ({key,label,color,probability})
//   todos        true si se suman todos los procesos
//   rango        el del informe (número de días, 0 o {desde,hasta})
//   botones      HTML de la botonera de fechas ('' fuera de la app)
//   etiquetas    catálogo [{name,color,kind}]
//   fuentes      catálogo [{key,label}]
//   tareasPorLead {lead_id: 'AAAA-MM-DD' de la próxima tarea pendiente}
//   moneda       la de la cuenta, si se sabe
//   acts, inter, falla        Productividad y Por comercial
//   equipo                    Por comercial [{id,nombre}]
//   camps, autos, logs        Marketing
function base(c) {
  return Object.assign({
    leads: [], etapas: [], todos: false, rango: 0, botones: '', etiquetas: [], fuentes: [],
    tareasPorLead: {}, moneda: '', interactivo: false, privado: false,
    acts: [], inter: [], falla: false, equipo: [], camps: [], autos: [], logs: [],
  }, c || {});
}

function fuenteLabel(c, key) {
  if (!key) return 'Manual';
  const f = (c.fuentes || []).find(x => x.key === key);
  return f ? f.label : String(key).replace(/_/g, ' ');
}
function tagColor(c, name) {
  const cat = (c.etiquetas || []).find(t => t.name === name);
  if (cat && cat.color) return cat.color;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}
function tagIsAuto(c, name) {
  const cat = (c.etiquetas || []).find(t => t.name === name);
  return cat ? cat.kind === 'auto' : false;
}
function tieneSeguimientoProgramado(c, l) {
  const f = l && (c.tareasPorLead || {})[l.id];
  return !!f && f >= crmFechaLocal(new Date());
}

// Las actividades de los leads del informe. Las que cuelgan de un lead de otro
// cliente o de otro proceso no son de este informe; las que no cuelgan de
// ninguno (una tarea suelta del equipo) solo cuentan cuando no hay un proceso
// concreto elegido.
export function actsDelInforme(actividades, leads, conProceso) {
  const ids = new Set((leads || []).map(l => l.id));
  return (actividades || []).filter(a => a.lead_id ? ids.has(a.lead_id) : !conProceso);
}

// Los leads de un proceso. Un lead sin proceso es del principal: así se
// migraron los de antes de que hubiera varios. Sin proceso elegido, todos.
export function leadsDelProceso(leads, pipelineId, pipelines) {
  if (!pipelineId) return leads || [];
  const esPrincipal = !!((pipelines || []).find(p => p.id === pipelineId) || {}).is_default;
  return (leads || []).filter(l => l.pipeline_id === pipelineId || (!l.pipeline_id && esPrincipal));
}

// ── Piezas de dibujo (las de Ventas, que usan todos) ─────────────────────────
export function salesFmtMoney(n, cur) {
  return (cur ? cur + ' ' : '$') + Math.round(n || 0).toLocaleString('es-CO');
}

function salesBar(label, value, max, color, extra) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">' +
    '<div style="width:170px;font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(label) + '">' + esc(label) + '</div>' +
    '<div style="flex:1;height:9px;background:var(--bg-muted);border-radius:5px;overflow:hidden">' +
      '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:5px"></div></div>' +
    '<div style="width:44px;text-align:right;font-size:12.5px;font-weight:700">' + value + '</div>' +
    (extra ? '<div style="width:96px;text-align:right;font-size:11.5px;color:var(--muted)">' + extra + '</div>' : '') +
  '</div>';
}

function salesCard(title, value, sub, delta) {
  let d = '';
  if (delta !== undefined && delta !== null && isFinite(delta)) {
    const up = delta >= 0;
    d = '<span style="font-size:11.5px;font-weight:700;color:' + (up ? '#059669' : '#DC2626') + ';margin-left:7px">' +
      (up ? '▲' : '▼') + ' ' + Math.abs(Math.round(delta)) + '%</span>';
  }
  return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:14px 16px">' +
    '<div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">' + esc(title) + '</div>' +
    '<div style="font-size:23px;font-weight:800;margin-top:6px;letter-spacing:-.5px">' + value + d + '</div>' +
    (sub ? '<div style="font-size:11.5px;color:var(--muted2);margin-top:3px">' + sub + '</div>' : '') +
  '</div>';
}

function cabecera(titulo, sub, botones) {
  return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">' +
    '<div><div style="font-size:var(--fs-lg);font-weight:800">' + titulo + '</div>' +
    '<div style="font-size:12px;color:var(--muted)">' + sub + '</div></div>' +
    (botones || '') + '</div>';
}

// Lo que se omite por privacidad se dice, no se esconde en silencio: quien lee
// un enlace compartido tiene que saber que ahí había una lista.
function omitido(que) {
  return '<div style="font-size:12px;color:var(--muted2)">' + que + ' no se muestra en el informe compartido.</div>';
}

// ── Resumen ─────────────────────────────────────────────────────────────────
export function htmlResumen(ctx) {
  const c = base(ctx);
  const now = Date.now();
  const desdeR = rangoIni(c.rango), hastaR = rangoFin(c.rango);
  const leads = c.rango
    ? c.leads.filter(l => { const t = new Date(l.created_at || 0).getTime(); return t >= desdeR && t <= hastaR; })
    : c.leads;
  const active = leads.filter(l => l.stage !== 'ganado' && l.stage !== 'perdido');
  const won = leads.filter(l => l.stage === 'ganado');
  const total = leads.length;
  const pipelineValue = active.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const wonValue = won.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const avgValue = total > 0 ? Math.round(pipelineValue / Math.max(active.length, 1)) : 0;
  const convRate = total > 0 ? Math.round((won.length / total) * 100) : 0;
  // Con «Todos los procesos» cada uno trae sus etapas y no hay un embudo común:
  // se resume en abiertos, ganados y perdidos en vez de mezclar etapas ajenas.
  const etapasEmbudo = c.todos
    ? [{ key: '__abiertos', label: 'Abiertos', color: 'var(--blue)' },
       { key: 'ganado', label: 'Ganados', color: 'var(--success)' },
       { key: 'perdido', label: 'Perdidos', color: 'var(--muted2)' }]
    : c.etapas;
  const enEtapa = (l, k) => k === '__abiertos' ? !leadCerrado(l) : l.stage === k;
  const maxCount = Math.max(...etapasEmbudo.map(s => leads.filter(l => enEtapa(l, s.key)).length), 1);
  const stageFunnel = etapasEmbudo.map(s => {
    const cnt = leads.filter(l => enEtapa(l, s.key)).length;
    const val = leads.filter(l => enEtapa(l, s.key)).reduce((sum, l) => sum + (Number(l.value) || 0), 0);
    return { label: s.label, color: s.color, key: s.key, count: cnt, value: val, pct: Math.round((cnt / maxCount) * 100) };
  });
  const sourceCounts = {};
  leads.forEach(l => { const s = l.source || 'manual'; sourceCounts[s] = (sourceCounts[s] || 0) + 1; });
  const maxSrc = Math.max(...Object.values(sourceCounts), 1);
  const needsAttention = leads.filter(l => {
    if (leadCerrado(l) || tieneSeguimientoProgramado(c, l)) return false;
    const lastActive = l.updated_at ? new Date(l.updated_at).getTime() : new Date(l.created_at || 0).getTime();
    return Math.floor((now - lastActive) / 86400000) >= 7;
  }).sort((a, b) => new Date(a.updated_at || a.created_at) - new Date(b.updated_at || b.created_at));
  // Distribución por etiqueta: conteo + valor de pipeline por tag (top 12)
  const tagStats = {};
  leads.forEach(l => (l.tags || []).forEach(t => {
    if (!tagStats[t]) tagStats[t] = { count: 0, value: 0 };
    tagStats[t].count++;
    tagStats[t].value += Number(l.value) || 0;
  }));
  const tagRows = Object.entries(tagStats).sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  const maxTag = Math.max(...tagRows.map(([, s]) => s.count), 1);
  const tagSection = tagRows.length
    ? '<div class="crm-analytics-section"><div class="crm-analytics-section-title">Leads por etiqueta</div>' +
      tagRows.map(([name, s]) => {
        const col = tagColor(c, name);
        const clic = c.interactivo
          ? ' style="cursor:pointer" title="Ver estos leads en el pipeline" onclick="crmFilterTags=[' + escJsAttr(name) + '];crmRenderTagFilter();crmSetView(\'kanban\')"'
          : '';
        return '<div class="crm-source-row"' + clic + '>' +
          '<div class="crm-source-label"><span class="tag-chip" style="background:' + col + '1A;color:' + col + '">' + (tagIsAuto(c, name) ? '⚡' : '') + esc(name) + '</span></div>' +
          '<div class="crm-source-bar-wrap"><div class="crm-source-bar" style="width:' + Math.round((s.count / maxTag) * 100) + '%;background:' + col + '"></div></div>' +
          '<div class="crm-source-count">' + s.count + '</div>' +
          '<div class="crm-analytics-stage-val">' + (s.value > 0 ? '$' + s.value.toLocaleString('es-CO') : '') + '</div>' +
        '</div>';
      }).join('') + '</div>'
    : '';
  const cabResumen = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<div><div style="font-size:var(--fs-lg);font-weight:800">Resumen</div>' +
    '<div style="font-size:12px;color:var(--muted)">' + (c.rango ? 'Los leads que entraron en el periodo y dónde están hoy' : 'Todos los leads, desde el primero') +
      (c.todos ? ' · todos los procesos' : '') + '</div></div>' +
    c.botones + '</div>';

  const atencion = !needsAttention.length ? '' :
    '<div class="crm-analytics-section"><div class="crm-analytics-section-title" style="color:#D97706">Requieren atención (' + needsAttention.length + ')</div>' +
    (c.privado
      ? omitido('El nombre de cada lead')
      : needsAttention.slice(0, 8).map(l => {
          const days = Math.floor((now - new Date(l.updated_at || l.created_at).getTime()) / 86400000);
          const st = c.etapas.find(s => s.key === l.stage) || { label: l.stage, color: 'var(--muted)' };
          const color = /^#/.test(st.color || '') ? st.color : '#6B7280';
          return '<div class="crm-attention-item"' + (c.interactivo ? ' onclick="crmOpenDetail(\'' + esc(l.id) + '\')"' : '') + '>' +
            '<div class="crm-attention-days">' + days + 'd</div>' +
            '<div style="flex:1">' + esc(l.name || '') + (l.company ? '<span style="color:var(--muted);margin-left:4px">- ' + esc(l.company) + '</span>' : '') + '</div>' +
            '<div class="crm-attention-stage" style="background:' + color + '20;color:' + color + '">' + esc(st.label || '') + '</div></div>';
        }).join('')) +
    '</div>';

  return cabResumen +
    '<div class="crm-analytics-grid">' +
      '<div class="crm-analytics-card"><div class="crm-analytics-card-title">Total leads</div><div class="crm-analytics-stat">' + total + '</div><div class="crm-analytics-sub">' + active.length + ' activos - ' + won.length + ' ganados</div></div>' +
      '<div class="crm-analytics-card"><div class="crm-analytics-card-title">Pipeline activo</div><div class="crm-analytics-stat" style="font-size:20px">$' + pipelineValue.toLocaleString('es-CO') + '</div><div class="crm-analytics-sub">Valor en proceso</div></div>' +
      '<div class="crm-analytics-card"><div class="crm-analytics-card-title">Deals ganados</div><div class="crm-analytics-stat" style="font-size:20px">$' + wonValue.toLocaleString('es-CO') + '</div><div class="crm-analytics-sub">' + convRate + '% tasa de cierre</div></div>' +
      '<div class="crm-analytics-card"><div class="crm-analytics-card-title">Valor promedio</div><div class="crm-analytics-stat" style="font-size:20px">$' + avgValue.toLocaleString('es-CO') + '</div><div class="crm-analytics-sub">Por deal activo</div></div>' +
    '</div>' +
    (c.interactivo ? '<div id="crm-nps-section"></div>' : (c.npsHtml || '')) +
    '<div class="crm-analytics-section"><div class="crm-analytics-section-title">Embudo del pipeline</div>' +
      stageFunnel.map(s => '<div class="crm-analytics-stage-row"><div class="crm-analytics-dot" style="background:' + s.color + '"></div><div class="crm-analytics-stage-name">' + esc(s.label) + '</div><div class="crm-analytics-bar-wrap"><div class="crm-analytics-bar" style="width:' + s.pct + '%;background:' + s.color + '"></div></div><div class="crm-analytics-stage-count">' + s.count + '</div><div class="crm-analytics-stage-val">' + (s.value > 0 ? '$' + s.value.toLocaleString('es-CO') : '') + '</div></div>').join('') +
    '</div>' +
    (Object.keys(sourceCounts).length > 0
      ? '<div class="crm-analytics-section"><div class="crm-analytics-section-title">Fuentes de leads</div>' +
        Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).map(([src, cnt]) => '<div class="crm-source-row"><div class="crm-source-label">' + esc(fuenteLabel(c, src)) + '</div><div class="crm-source-bar-wrap"><div class="crm-source-bar" style="width:' + Math.round((cnt / maxSrc) * 100) + '%"></div></div><div class="crm-source-count">' + cnt + '</div></div>').join('') + '</div>'
      : '') +
    tagSection + atencion;
}

// ── Ventas ──────────────────────────────────────────────────────────────────
// Devuelve también las ganadas, para la descarga en CSV de la app.
export function datosVentas(ctx) {
  const c = base(ctx);
  const from = rangoIni(c.rango);
  const hastaV = rangoFin(c.rango);
  const inRange = d => { if (!d) return false; const t = new Date(d).getTime(); return t >= from && t <= hastaV; };
  // NUNCA `updated_at` para fechar un cierre: se mueve cada vez que alguien
  // toca el lead, así que un negocio cerrado en agosto se iba al reporte de
  // septiembre en cuanto alguien le editaba algo. Le pasó a Certain.
  const won  = c.leads.filter(l => l.stage === 'ganado'  && inRange(fechaDeCierre(l)));
  const lost = c.leads.filter(l => l.stage === 'perdido' && inRange(fechaDeCierre(l)));
  return { won, lost, from, hastaV };
}

export function htmlVentas(ctx) {
  const c = base(ctx);
  const leads = c.leads;
  const { won, lost, from, hastaV } = datosVentas(c);
  const open = leads.filter(l => !['ganado', 'perdido'].includes(l.stage));
  const revenue = won.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const pipeline = open.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const ticket = won.length ? revenue / won.length : 0;
  const closeRate = (won.length + lost.length) ? Math.round(won.length / (won.length + lost.length) * 100) : 0;
  const cycles = won.filter(l => l.closed_at && l.created_at)
    .map(l => (new Date(l.closed_at) - new Date(l.created_at)) / 86400000).filter(d => d >= 0);
  const cycle = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : 0;
  const cur = won.find(l => l.close_currency)?.close_currency || c.moneda || '';

  // Periodo anterior de la misma longitud, para la comparativa
  let dRev = null, dCount = null;
  if (c.rango) {
    const largo = hastaV - from;
    const prevFrom = from - largo;
    const prevWon = leads.filter(l => {
      if (l.stage !== 'ganado') return false;
      const t = new Date(fechaDeCierre(l) || 0).getTime();
      return t >= prevFrom && t < from;
    });
    const prevRev = prevWon.reduce((s2, l) => s2 + (Number(l.value) || 0), 0);
    if (prevRev > 0) dRev = ((revenue - prevRev) / prevRev) * 100;
    if (prevWon.length > 0) dCount = ((won.length - prevWon.length) / prevWon.length) * 100;
  }

  let html = cabecera('Rendimiento de ventas', 'Cómo cerró tu pipeline en el periodo', c.botones);

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;margin-bottom:20px">' +
    salesCard('Importe ganado', salesFmtMoney(revenue, cur), won.length + (won.length === 1 ? ' venta' : ' ventas') + (dRev !== null ? ' · vs periodo anterior' : ''), dRev) +
    salesCard('Ticket medio', salesFmtMoney(ticket, cur), 'por venta cerrada', dCount) +
    salesCard('Tasa de cierre', closeRate + '%', won.length + ' ganadas · ' + lost.length + ' perdidas') +
    salesCard('Ciclo de venta', cycle + ' d', 'del alta al cierre') +
    salesCard('Pipeline abierto', salesFmtMoney(pipeline, cur), open.length + ' oportunidades') +
  '</div>';

  // Motivos de pérdida y de ganada
  const group = (arr) => {
    const m = {};
    arr.forEach(l => { const k = l.close_reason || 'Sin motivo registrado'; m[k] = m[k] || { n: 0, v: 0 }; m[k].n++; m[k].v += Number(l.value) || 0; });
    return Object.entries(m).sort((a, b) => b[1].n - a[1].n);
  };
  const lostG = group(lost), wonG = group(won);
  const maxL = Math.max(1, ...lostG.map(e => e[1].n)), maxW = Math.max(1, ...wonG.map(e => e[1].n));

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;margin-bottom:20px">';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Motivos de pérdida</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">Por qué se cayeron ' + lost.length + ' oportunidades</div>' +
    (lostG.length ? lostG.map(([k, d]) => salesBar(k, d.n, maxL, '#EF4444', Math.round(d.n / lost.length * 100) + '%')).join('')
                  : '<div style="font-size:12px;color:var(--muted2)">Sin pérdidas registradas en el periodo</div>') +
  '</div>';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Motivos de ganada</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">Qué hace que te compren</div>' +
    (wonG.length ? wonG.map(([k, d]) => salesBar(k, d.n, maxW, '#10B981', salesFmtMoney(d.v, cur))).join('')
                 : '<div style="font-size:12px;color:var(--muted2)">Sin ventas registradas en el periodo</div>') +
  '</div></div>';

  // Embudo del pipeline con conversión entre etapas + forecast ponderado
  const stages = c.etapas || [];
  const openStages = stages.filter(st => !['ganado', 'perdido'].includes(st.key));
  const cnt = k => leads.filter(l => l.stage === k).length;
  const val = k => leads.filter(l => l.stage === k).reduce((a, l) => a + (Number(l.value) || 0), 0);
  const maxF = Math.max(1, ...openStages.map(st => cnt(st.key)), won.length);

  const forecast = openStages.reduce((sum, st, i) => {
    const prob = pipeProbFor(st, i, stages.length) / 100;
    return sum + val(st.key) * prob;
  }, 0);

  const funnelRows = openStages.concat(stages.filter(st => st.key === 'ganado')).map((st, i, arr) => {
    const n = cnt(st.key), v = val(st.key);
    const prev = i > 0 ? cnt(arr[i - 1].key) : null;
    const conv = (prev && prev > 0) ? Math.round(n / prev * 100) : null;
    const prob = pipeProbFor(st, i, stages.length);
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
      '<div style="width:130px;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(st.label) + '</div>' +
      '<div style="flex:1;height:26px;background:var(--bg-muted);border-radius:7px;overflow:hidden;position:relative">' +
        '<div style="height:100%;width:' + Math.max(2, Math.round(n / maxF * 100)) + '%;background:' + (st.color || '#1E2BCC') + ';border-radius:7px;opacity:.85"></div>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;padding-left:9px;font-size:12px;font-weight:700;color:var(--text)">' + n + '</div>' +
      '</div>' +
      '<div style="width:92px;text-align:right;font-size:11.5px;color:var(--muted)">' + salesFmtMoney(v, cur) + '</div>' +
      '<div style="width:52px;text-align:right;font-size:11.5px;color:var(--muted2)">' + (st.key === 'ganado' ? '' : prob + '%') + '</div>' +
      '<div style="width:62px;text-align:right;font-size:11.5px;font-weight:700;color:' + (conv === null ? 'var(--muted2)' : conv >= 50 ? '#059669' : '#B45309') + '">' +
        (conv === null ? '—' : '↓ ' + conv + '%') + '</div>' +
    '</div>';
  }).join('');

  // Con todos los procesos no hay un embudo común: cada uno tiene sus etapas.
  if (!c.todos) {
    html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:20px">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">' +
        '<div><div style="font-size:13.5px;font-weight:800">Embudo del pipeline</div>' +
        '<div style="font-size:11.5px;color:var(--muted)">Cuántas oportunidades hay en cada etapa y qué porcentaje pasa a la siguiente</div></div>' +
        '<div style="text-align:right"><div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">Forecast ponderado</div>' +
        '<div style="font-size:19px;font-weight:800;color:var(--blue)">' + salesFmtMoney(forecast, cur) + '</div>' +
        '<div style="font-size:10.5px;color:var(--muted2)">importe × probabilidad de cada etapa</div></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:6px;font-size:10.5px;color:var(--muted2);font-weight:700;text-transform:uppercase;letter-spacing:.04em">' +
        '<div style="width:130px">Etapa</div><div style="flex:1">Oportunidades</div>' +
        '<div style="width:92px;text-align:right">Valor</div><div style="width:52px;text-align:right">Prob.</div><div style="width:62px;text-align:right">Conv.</div>' +
      '</div>' + funnelRows +
    '</div>';
  }

  // Evolución de ingresos por mes
  const byMonth = {};
  won.forEach(l => {
    const d = new Date(fechaDeCierre(l));
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    byMonth[k] = (byMonth[k] || 0) + (Number(l.value) || 0);
  });
  const months = Object.entries(byMonth).sort();
  const maxM = Math.max(1, ...months.map(e => e[1]));
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:20px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:12px">Evolución de ingresos</div>' +
    (months.length
      ? '<div style="display:flex;align-items:flex-end;gap:8px;height:130px">' + months.map(([k, v]) =>
          '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px" title="' + salesFmtMoney(v, cur) + '">' +
            '<div style="font-size:10.5px;color:var(--muted);white-space:nowrap">' + (v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v)) + '</div>' +
            '<div style="width:100%;max-width:54px;height:' + Math.max(4, Math.round(v / maxM * 95)) + 'px;background:linear-gradient(180deg,#3D52E5,#1520B0);border-radius:6px 6px 0 0"></div>' +
            '<div style="font-size:10.5px;color:var(--muted2)">' + k.slice(2) + '</div>' +
          '</div>').join('') + '</div>'
      : '<div style="font-size:12px;color:var(--muted2)">Aún no hay ventas cerradas en el periodo</div>') +
  '</div>';

  // Por vendedor y por origen
  const byField = (arr, field, fallback) => {
    const m = {};
    arr.forEach(l => { const k = l[field] || fallback; m[k] = m[k] || { n: 0, v: 0 }; m[k].n++; m[k].v += Number(l.value) || 0; });
    return Object.entries(m).sort((a, b) => b[1].v - a[1].v);
  };
  const sellers = byField(won, 'assigned_name', 'Sin asignar');
  const sources = byField(won.concat(lost).concat(open), 'source', 'manual');
  const maxO = Math.max(1, ...sources.map(e => e[1].n));

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px">';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:12px">Ventas por responsable</div>' +
    (sellers.length ? sellers.map(([k, d]) => salesBar(k, d.n, Math.max(1, ...sellers.map(e => e[1].n)), '#1E2BCC', salesFmtMoney(d.v, cur))).join('')
                    : '<div style="font-size:12px;color:var(--muted2)">Sin ventas en el periodo</div>') +
  '</div>';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Oportunidades por origen</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">De dónde vienen tus leads</div>' +
    (sources.length ? sources.map(([k, d]) => salesBar(fuenteLabel(c, k), d.n, maxO, '#8B5CF6', salesFmtMoney(d.v, cur))).join('')
                    : '<div style="font-size:12px;color:var(--muted2)">Sin datos</div>') +
  '</div></div>';

  // Listado de oportunidades ganadas + descarga
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px;margin-top:14px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">' +
      '<div><div style="font-size:13.5px;font-weight:800">Oportunidades ganadas</div>' +
      '<div style="font-size:11.5px;color:var(--muted)">' + won.length + ' en el periodo</div></div>' +
      (won.length && c.interactivo ? '<button class="btn-sec sm" onclick="salesExportCsv()">Descargar CSV</button>' : '') +
    '</div>' +
    (!won.length
      ? '<div style="font-size:12px;color:var(--muted2)">Sin ventas cerradas en el periodo</div>'
      : c.privado
        ? omitido('El detalle de cada cliente')
        : '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
          '<thead><tr style="text-align:left;color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">' +
          '<th style="padding:6px 8px">Cliente</th><th style="padding:6px 8px">Motivo</th>' +
          '<th style="padding:6px 8px">Cierre</th><th style="padding:6px 8px;text-align:right">Importe</th></tr></thead><tbody>' +
          won.slice().sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).map(l =>
            '<tr style="border-top:1px solid var(--border)">' +
            '<td style="padding:8px"><b>' + esc(l.name || '') + '</b>' + (l.company ? '<div style="font-size:11px;color:var(--muted2)">' + esc(l.company) + '</div>' : '') + '</td>' +
            '<td style="padding:8px;color:var(--muted)">' + esc(l.close_reason || '—') + '</td>' +
            '<td style="padding:8px;color:var(--muted)">' + ((l.closed_at || '').slice(0, 10) || '—') + '</td>' +
            '<td style="padding:8px;text-align:right;font-weight:700">' + salesFmtMoney(Number(l.value) || 0, l.close_currency || cur) + '</td>' +
            '</tr>').join('') +
          '</tbody></table></div>') +
  '</div>';

  return html;
}

// ── Marketing ───────────────────────────────────────────────────────────────
export function htmlMarketing(ctx) {
  const c = base(ctx);
  const camps = c.camps || [], autos = c.autos || [];
  // El registro de automatizaciones es de toda la cuenta: se queda solo lo de
  // las automatizaciones de este informe. Sin esto, en una agencia los
  // «contactos impactados» de un cliente sumaban los de los demás.
  const idsAutos = new Set(autos.map(a => a.id));
  const logs = (c.logs || []).filter(l => idsAutos.has(l.automation_id));
  const leads = c.leads;
  const from = rangoIni(c.rango);
  const hasta = rangoFin(c.rango);
  // Con el rango a mano importa también el extremo superior: sin él, «hasta»
  // no se aplicaría y el informe seguiría llegando hasta hoy.
  const inR = d => { if (!d) return false; const t = new Date(d).getTime(); return t >= from && t <= hasta; };

  // Las aperturas NO están en `stats`: el motor de campañas guarda enviados y
  // fallidos, nunca aperturas. Las cuenta quien arma el contexto, desde los
  // eventos de correo (como «ver aperturas»), y las deja en `stats.opened`.
  // Una campaña cuyas aperturas no se pudieron contar no suma un cero: se
  // queda fuera de la tasa y se dice.
  const enviadas = camps.filter(c2 => c2.channel === 'email' && ['sent', 'sending'].includes(c2.status) && inR(c2.sent_at || c2.created_at));
  const totalSent = enviadas.reduce((s, c2) => s + ((c2.stats || {}).sent || 0), 0);
  const totalDeliv = enviadas.reduce((s, c2) => s + ((c2.stats || {}).delivered || (c2.stats || {}).sent || 0), 0);
  const contadas = enviadas.filter(c2 => (c2.stats || {}).opened != null);
  const baseApertura = contadas.reduce((s, c2) => s + ((c2.stats || {}).delivered || (c2.stats || {}).sent || 0), 0);
  const totalOpen = contadas.reduce((s, c2) => s + ((c2.stats || {}).opened || 0), 0);
  const openRate = baseApertura ? Math.round(totalOpen / baseApertura * 100) : 0;
  const sinContar = enviadas.length - contadas.length;

  const logsR = logs.filter(l => inR(l.created_at));
  const impactados = new Set(logsR.map(l => l.lead_id).filter(Boolean)).size;
  const activas = autos.filter(a => a.active).length;

  const nuevos = leads.filter(l => inR(l.created_at));

  let html = cabecera('Marketing', 'Campañas, automatizaciones y captación de leads', c.botones);

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;margin-bottom:20px">' +
    salesCard('Campañas enviadas', enviadas.length, 'en el periodo') +
    salesCard('Correos entregados', totalDeliv.toLocaleString('es-CO'), totalSent ? 'de ' + totalSent.toLocaleString('es-CO') + ' enviados' : '') +
    salesCard('Tasa de apertura', (contadas.length || !enviadas.length) ? openRate + '%' : '—',
      totalOpen.toLocaleString('es-CO') + ' aperturas' + (sinContar ? ' · ' + sinContar + ' sin contar' : '')) +
    salesCard('Automatizaciones activas', activas, autos.length + ' creadas') +
    salesCard('Contactos impactados', impactados, 'por automatizaciones') +
  '</div>';

  // Rendimiento por campaña
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:20px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Rendimiento por campaña</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">Contactos que abrieron o hicieron clic</div>' +
    (enviadas.length
      ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
        '<thead><tr style="text-align:left;color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">' +
        '<th style="padding:6px 8px">Campaña</th><th style="padding:6px 8px">Envío</th>' +
        '<th style="padding:6px 8px;text-align:right">Enviados</th><th style="padding:6px 8px;text-align:right">Aperturas</th>' +
        '<th style="padding:6px 8px;text-align:right">Tasa</th></tr></thead><tbody>' +
        enviadas.slice().sort((a, b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at)).map(c2 => {
          const st = c2.stats || {};
          const d = st.delivered || st.sent || 0;
          const contada = st.opened != null;
          const rate = d && contada ? Math.round((st.opened || 0) / d * 100) : 0;
          return '<tr style="border-top:1px solid var(--border)">' +
            '<td style="padding:8px"><b>' + esc(c2.name || '') + '</b>' + (c2.subject ? '<div style="font-size:11px;color:var(--muted2)">' + esc(c2.subject) + '</div>' : '') + '</td>' +
            '<td style="padding:8px;color:var(--muted)">' + (c2.sent_at ? new Date(c2.sent_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : '—') + '</td>' +
            '<td style="padding:8px;text-align:right">' + (st.sent || 0) + '</td>' +
            '<td style="padding:8px;text-align:right">' + (contada ? st.opened : '—') + '</td>' +
            '<td style="padding:8px;text-align:right;font-weight:700;color:' + (!contada ? 'var(--muted2)' : rate >= 20 ? '#059669' : rate > 0 ? '#B45309' : 'var(--muted2)') + '">' + (contada ? rate + '%' : '—') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>'
      : '<div style="font-size:12px;color:var(--muted2)">Aún no se han enviado campañas en el periodo.</div>') +
  '</div>';

  // Automatizaciones + captación
  const porAuto = {};
  logsR.forEach(l => {
    porAuto[l.automation_id] = porAuto[l.automation_id] || { n: 0, leads: new Set(), err: 0 };
    porAuto[l.automation_id].n++;
    if (l.lead_id) porAuto[l.automation_id].leads.add(l.lead_id);
    if (l.result && /error|fail/i.test(l.result)) porAuto[l.automation_id].err++;
  });
  const autoRows = autos.map(a => ({ a, d: porAuto[a.id] || { n: 0, leads: new Set(), err: 0 } }))
    .sort((x, y) => y.d.n - x.d.n);
  const maxA = Math.max(1, ...autoRows.map(r => r.d.n));

  const porFuente = {};
  nuevos.forEach(l => { const k = l.source || 'manual'; porFuente[k] = (porFuente[k] || 0) + 1; });
  const fuentes = Object.entries(porFuente).sort((a, b) => b[1] - a[1]);
  const maxFu = Math.max(1, ...fuentes.map(e => e[1]));

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px">';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Automatizaciones</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">Acciones ejecutadas y contactos únicos alcanzados</div>' +
    (autoRows.length ? autoRows.map(({ a, d }) =>
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + (a.active ? '#10B981' : 'var(--muted2)') + ';flex-shrink:0"></span>' +
        '<div style="width:150px;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(a.name || '') + '">' + esc(a.name || '') + '</div>' +
        '<div style="flex:1;height:9px;background:var(--bg-muted);border-radius:5px;overflow:hidden">' +
          '<div style="height:100%;width:' + Math.round(d.n / maxA * 100) + '%;background:#F59E0B;border-radius:5px"></div></div>' +
        '<div style="width:40px;text-align:right;font-size:12.5px;font-weight:700">' + d.n + '</div>' +
        '<div style="width:82px;text-align:right;font-size:11.5px;color:var(--muted)">' + d.leads.size + ' contactos</div>' +
      '</div>').join('')
      : '<div style="font-size:12px;color:var(--muted2)">Sin automatizaciones creadas todavía</div>') +
  '</div>';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Captación de leads</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">' + nuevos.length + ' leads nuevos en el periodo, por fuente</div>' +
    (fuentes.length ? fuentes.map(([k, v]) => salesBar(fuenteLabel(c, k), v, maxFu, '#8B5CF6', Math.round(v / nuevos.length * 100) + '%')).join('')
                    : '<div style="font-size:12px;color:var(--muted2)">Sin leads nuevos en el periodo</div>') +
  '</div></div>';

  return html;
}

// ── Productividad ───────────────────────────────────────────────────────────
export function htmlProductividad(ctx) {
  const c = base(ctx);
  const leads = c.leads;
  const acts = c.acts || [];
  const inter = c.inter || [];
  const now = Date.now();
  const from = rangoIni(c.rango, 3650);
  const hastaP = rangoFin(c.rango);

  const inRange = a => { const t = new Date(a.due_at || a.created_at).getTime(); return t >= from && t <= hastaP; };
  const periodo = acts.filter(inRange);
  const vencidas = acts.filter(a => !a.done && a.due_at && new Date(a.due_at).getTime() < now);
  const debidas = periodo.filter(a => a.due_at && new Date(a.due_at).getTime() <= now);
  const hechas = debidas.filter(a => a.done);
  const compl = debidas.length ? Math.round(hechas.length / debidas.length * 100) : 0;
  const proximas = acts.filter(a => !a.done && a.due_at &&
    new Date(a.due_at).getTime() > now && new Date(a.due_at).getTime() <= now + 7 * 86400000);

  // Interacciones reales (se excluye lo que genera el sistema)
  const SYS = ['creacion', 'stage_change'];
  const interReal = inter.filter(a => !SYS.includes(a.type));

  // Cobertura: leads abiertos con próxima actividad agendada
  const abiertos = leads.filter(l => !['ganado', 'perdido'].includes(l.stage));
  const conProxima = new Set(acts.filter(a => !a.done && a.due_at && new Date(a.due_at).getTime() > now).map(a => a.lead_id).filter(Boolean));
  const cubiertos = abiertos.filter(l => conProxima.has(l.id));
  const cobertura = abiertos.length ? Math.round(cubiertos.length / abiertos.length * 100) : 0;
  const huerfanos = abiertos.filter(l => !conProxima.has(l.id));

  let html = cabecera('Productividad comercial', 'Qué se agenda, qué se cumple y qué leads se están enfriando', c.botones);
  // Si la actividad no se pudo leer, los contadores de abajo salen en cero:
  // se avisa para que nadie lo lea como «el equipo no hizo nada».
  if (c.falla) html += '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">No se pudo leer la actividad del equipo: las cifras de llamadas y contactos están incompletas.' +
    (c.interactivo ? ' <button class="btn-ghost sm" onclick="_prodData = null; prodRender()">Reintentar</button>' : '') + '</div>';

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;margin-bottom:20px">' +
    salesCard('Actividades', periodo.length, 'agendadas en el periodo') +
    salesCard('Tasa de cumplimiento', compl + '%', hechas.length + ' de ' + debidas.length + ' vencidas') +
    salesCard('Vencidas sin hacer', vencidas.length, vencidas.length ? 'requieren acción' : 'todo al día') +
    salesCard('Próximos 7 días', proximas.length, 'ya agendadas') +
    salesCard('Cobertura de seguimiento', cobertura + '%', cubiertos.length + ' de ' + abiertos.length + ' leads abiertos') +
  '</div>';

  // Pulso diario
  const dias = Math.min(rangoDias(c.rango, 30), 30) || 30;
  const dayKey = t => new Date(t).toISOString().slice(0, 10);
  const creadas = {}, completadas = {};
  acts.forEach(a => {
    if (a.created_at && new Date(a.created_at).getTime() >= now - dias * 86400000) creadas[dayKey(a.created_at)] = (creadas[dayKey(a.created_at)] || 0) + 1;
    if (a.done && a.updated_at && new Date(a.updated_at).getTime() >= now - dias * 86400000) completadas[dayKey(a.updated_at)] = (completadas[dayKey(a.updated_at)] || 0) + 1;
  });
  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const k = dayKey(now - i * 86400000);
    serie.push([k, creadas[k] || 0, completadas[k] || 0]);
  }
  const maxD = Math.max(1, ...serie.map(s => Math.max(s[1], s[2])));
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:20px">' +
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">' +
      '<div style="font-size:13.5px;font-weight:800">Pulso diario</div>' +
      '<div style="display:flex;gap:12px;font-size:11px;color:var(--muted)">' +
        '<span><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#3D52E5;margin-right:4px"></span>creadas</span>' +
        '<span><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#10B981;margin-right:4px"></span>completadas</span>' +
      '</div></div>' +
    '<div style="display:flex;align-items:flex-end;gap:3px;height:90px">' + serie.map(([k, cr, d]) =>
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:1px" title="' + k + ' · ' + cr + ' creadas, ' + d + ' completadas">' +
        '<div style="height:' + Math.round(cr / maxD * 45) + 'px;background:#3D52E5;border-radius:3px 3px 0 0;min-height:' + (cr ? 3 : 0) + 'px"></div>' +
        '<div style="height:' + Math.round(d / maxD * 45) + 'px;background:#10B981;border-radius:0 0 3px 3px;min-height:' + (d ? 3 : 0) + 'px"></div>' +
      '</div>').join('') + '</div>' +
  '</div>';

  // Mix por tipo + interacciones registradas
  const tipoLbl = { task: 'Tareas', meeting: 'Reuniones', nota: 'Notas', llamada: 'Llamadas', email: 'Emails', reunion: 'Reuniones', tarea: 'Tareas', visita: 'Visitas' };
  const mix = {};
  periodo.forEach(a => { const k = tipoLbl[a.type] || a.type; mix[k] = (mix[k] || 0) + 1; });
  const mixArr = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  const maxMix = Math.max(1, ...mixArr.map(e => e[1]));
  const iMix = {};
  interReal.forEach(a => { const k = tipoLbl[a.type] || a.type; iMix[k] = (iMix[k] || 0) + 1; });
  const iArr = Object.entries(iMix).sort((a, b) => b[1] - a[1]);
  const maxI = Math.max(1, ...iArr.map(e => e[1]));

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;margin-bottom:20px">';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Agenda por tipo</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">Lo que se programó en el periodo</div>' +
    (mixArr.length ? mixArr.map(([k, v]) => salesBar(k, v, maxMix, '#1E2BCC', '')).join('')
                   : '<div style="font-size:12px;color:var(--muted2)">Nada agendado en el periodo</div>') +
  '</div>';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Interacciones registradas</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">Notas, llamadas y correos anotados en las fichas</div>' +
    (iArr.length ? iArr.map(([k, v]) => salesBar(k, v, maxI, '#0891B2', '')).join('')
                 : '<div style="font-size:12px;color:var(--muted2)">Sin interacciones registradas — se anotan desde la ficha del lead</div>') +
  '</div></div>';

  // Alertas accionables
  const venc = vencidas.slice().sort((a, b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 8);
  const leadName = id => (leads.find(l => l.id === id) || {}).name || '';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px">';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Actividades vencidas</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">' + vencidas.length + ' sin completar</div>' +
    (!venc.length
      ? '<div style="font-size:12px;color:var(--muted2)">Ninguna actividad vencida 👏</div>'
      : c.privado
        ? omitido('El detalle de cada actividad')
        : venc.map(a =>
          '<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-top:1px solid var(--border)">' +
            '<div style="flex:1;font-size:12.5px"><b>' + esc(a.title || '(sin título)') + '</b>' +
              (leadName(a.lead_id) ? '<div style="font-size:11px;color:var(--muted2)">' + esc(leadName(a.lead_id)) + '</div>' : '') + '</div>' +
            '<div style="font-size:11.5px;color:#DC2626;font-weight:700">' + Math.round((now - new Date(a.due_at).getTime()) / 86400000) + ' d</div>' +
          '</div>').join('')) +
  '</div>';
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Leads sin próxima actividad</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">' + huerfanos.length + ' oportunidades abiertas sin seguimiento agendado</div>' +
    (!huerfanos.length
      ? '<div style="font-size:12px;color:var(--muted2)">Todos los leads abiertos tienen seguimiento 👏</div>'
      : c.privado
        ? omitido('El nombre de cada lead')
        : huerfanos.slice(0, 8).map(l =>
          '<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-top:1px solid var(--border)">' +
            '<div style="flex:1;font-size:12.5px"><b>' + esc(l.name || '') + '</b>' +
              (l.company ? '<div style="font-size:11px;color:var(--muted2)">' + esc(l.company) + '</div>' : '') + '</div>' +
            (c.interactivo ? '<button class="btn-sec sm" onclick="crmOpenDetail(\'' + esc(l.id) + '\')">Abrir</button>' : '') +
          '</div>').join('')) +
  '</div></div>';

  return html;
}

// ── Por comercial ───────────────────────────────────────────────────────────
// Qué cuenta como "contactado": una interacción registrada por una PERSONA.
// Ni la creación, ni el cambio de etapa, ni las notas que escribe la propia
// plataforma (reparto, veredicto de calificación) cuentan: si contaran, el
// informe diría que el equipo contactó a todo el mundo en un minuto sin que
// nadie hubiera levantado el teléfono.
const EQ_SISTEMA = ['creacion', 'stage_change'];
export function eqEsDelSistema(a) {
  return EQ_SISTEMA.includes(a.type) || !!(a.metadata && a.metadata.sistema);
}
function eqFmtDur(ms) {
  if (ms === null || !isFinite(ms)) return '—';
  const h = ms / 3600000;
  if (h < 1) return Math.max(1, Math.round(ms / 60000)) + ' min';
  if (h < 48) return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h';
  return Math.round(h / 24) + ' días';
}
function eqMediana(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function htmlEquipo(ctx) {
  const c = base(ctx);
  const leads = c.leads, inter = c.inter || [], equipo = c.equipo || [];
  const desde = rangoIni(c.rango, 3650);

  let html = cabecera('Por comercial', 'Qué recibe cada uno, qué tan rápido responde y qué cierra', c.botones);
  if (c.falla) html += '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">No se pudo leer la actividad del equipo: las cifras de llamadas y contactos están incompletas.' +
    (c.interactivo ? ' <button class="btn-ghost sm" onclick="_eqData = null; eqRender()">Reintentar</button>' : '') + '</div>';

  // Primera interacción humana de cada lead
  const primera = {};
  inter.forEach(a => {
    if (eqEsDelSistema(a) || !a.lead_id) return;
    const t = new Date(a.created_at).getTime();
    if (!primera[a.lead_id] || t < primera[a.lead_id]) primera[a.lead_id] = t;
  });

  const delPeriodo = leads.filter(l => new Date(l.created_at).getTime() >= desde);

  // Una fila por persona. Los que no tienen dueño van juntos: son justo los
  // que se le escapan a todo el mundo, y esconderlos sería el peor favor.
  const filas = {};
  const fila = (id, nombre) => (filas[id] = filas[id] || {
    id, nombre, recibidos: 0, contactados: 0, tiempos: [], ganados: 0, perdidos: 0, importe: 0,
  });
  equipo.forEach(m => fila(m.id, m.nombre));

  delPeriodo.forEach(l => {
    const f = fila(l.assigned_to || '_sin', l.assigned_name || (l.assigned_to ? 'Comercial' : 'Sin asignar'));
    f.recibidos++;
    const p = primera[l.id];
    if (p) {
      f.contactados++;
      f.tiempos.push(p - new Date(l.created_at).getTime());
    }
    if (l.stage === 'ganado') { f.ganados++; f.importe += Number(l.value || 0); }
    if (l.stage === 'perdido') f.perdidos++;
  });

  const rows = Object.values(filas)
    .filter(f => f.recibidos > 0 || f.id !== '_sin')
    .sort((a, b) => b.recibidos - a.recibidos);

  // Antes llamaba a emptyAgua() con los argumentos corridos y en pantalla
  // salía «undefined». Un vacío propio, que sirve igual en la app y fuera.
  if (!rows.length) {
    return html + '<div style="border:1px dashed var(--border);border-radius:14px;padding:22px;text-align:center">' +
      '<div style="font-size:13.5px;font-weight:800;margin-bottom:4px">Todavía no hay nada que comparar</div>' +
      '<div style="font-size:12px;color:var(--muted)">Cuando los leads tengan responsable —con el reparto automático de Configuración → Equipo— este informe se llena solo.</div></div>';
  }

  // Totales de la cuenta, para leer cada fila en contexto
  const tot = rows.reduce((a, f) => ({
    recibidos: a.recibidos + f.recibidos, contactados: a.contactados + f.contactados,
    ganados: a.ganados + f.ganados, importe: a.importe + f.importe,
    tiempos: a.tiempos.concat(f.tiempos),
  }), { recibidos: 0, contactados: 0, ganados: 0, importe: 0, tiempos: [] });

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;margin-bottom:20px">' +
    salesCard('Leads del periodo', tot.recibidos, rows.length + ' persona' + (rows.length > 1 ? 's' : '')) +
    salesCard('Contactados', (tot.recibidos ? Math.round(tot.contactados / tot.recibidos * 100) : 0) + '%', tot.contactados + ' de ' + tot.recibidos) +
    salesCard('1.er contacto (mediana)', eqFmtDur(eqMediana(tot.tiempos)), tot.tiempos.length + ' leads medidos') +
    salesCard('Cerrados', tot.ganados, (tot.recibidos ? Math.round(tot.ganados / tot.recibidos * 100) : 0) + '% del total') +
  '</div>';

  const maxR = Math.max(1, ...rows.map(f => f.recibidos));
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:20px;overflow-x:auto">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Comparativa del equipo</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:14px">Leads recibidos en el periodo y qué pasó con ellos</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px">' +
    '<thead><tr style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em">' +
      '<th style="text-align:left;padding:0 8px 8px 0">Comercial</th>' +
      '<th style="text-align:left;padding:0 8px 8px">Recibidos</th>' +
      '<th style="text-align:right;padding:0 8px 8px">Contactados</th>' +
      '<th style="text-align:right;padding:0 8px 8px">1.er contacto</th>' +
      '<th style="text-align:right;padding:0 8px 8px">Cerrados</th>' +
      '<th style="text-align:right;padding:0 0 8px 8px">Importe</th>' +
    '</tr></thead><tbody>' +
    rows.map(f => {
      const pc = f.recibidos ? Math.round(f.contactados / f.recibidos * 100) : 0;
      const cierre = f.recibidos ? Math.round(f.ganados / f.recibidos * 100) : 0;
      const huerfano = f.id === '_sin';
      return '<tr style="border-top:1px solid var(--border)">' +
        '<td style="padding:10px 8px 10px 0;font-weight:600' + (huerfano ? ';color:#B45309' : '') + '">' + esc(f.nombre) + '</td>' +
        '<td style="padding:10px 8px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="flex:1;min-width:70px;height:8px;background:var(--bg-muted);border-radius:5px;overflow:hidden">' +
              '<div style="height:100%;width:' + Math.round(f.recibidos / maxR * 100) + '%;background:' + (huerfano ? '#F59E0B' : 'var(--blue)') + ';border-radius:5px"></div>' +
            '</div>' +
            '<span style="font-weight:700;width:28px;text-align:right">' + f.recibidos + '</span>' +
          '</div></td>' +
        '<td style="text-align:right;padding:10px 8px;color:' + (pc < 60 ? '#B45309' : 'var(--text)') + '">' + pc + '%</td>' +
        '<td style="text-align:right;padding:10px 8px">' + eqFmtDur(eqMediana(f.tiempos)) + '</td>' +
        '<td style="text-align:right;padding:10px 8px">' + f.ganados + ' <span style="color:var(--muted2)">(' + cierre + '%)</span></td>' +
        '<td style="text-align:right;padding:10px 0 10px 8px;font-weight:700">' + (f.importe ? '$' + f.importe.toLocaleString('es') : '—') + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';

  // Motivos de pérdida: dónde se cae el equipo
  const perdidos = delPeriodo.filter(l => l.stage === 'perdido');
  const porMotivo = {};
  perdidos.forEach(l => { const k = l.close_reason || 'Sin motivo registrado'; porMotivo[k] = (porMotivo[k] || 0) + 1; });
  const motivos = Object.entries(porMotivo).sort((a, b) => b[1] - a[1]);
  const maxM = Math.max(1, ...motivos.map(m => m[1]));

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px">' +
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
      '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Motivos de pérdida</div>' +
      '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">' + perdidos.length + ' oportunidades perdidas en el periodo</div>' +
      (motivos.length
        ? motivos.map(([k, v]) => salesBar(k, v, maxM, '#DC2626', Math.round(v / perdidos.length * 100) + '%')).join('')
        : '<div style="font-size:12px;color:var(--muted2)">Ninguna pérdida registrada en el periodo</div>') +
    '</div>';

  // Sin contactar: la lista accionable, no un número
  const sinContactarTodos = delPeriodo
    .filter(l => !primera[l.id] && !['ganado', 'perdido'].includes(l.stage))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const sinContactar = sinContactarTodos.slice(0, 12);
  html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:16px">' +
    '<div style="font-size:13.5px;font-weight:800;margin-bottom:3px">Sin contactar todavía</div>' +
    '<div style="font-size:11.5px;color:var(--muted);margin-bottom:12px">' +
      (c.privado ? sinContactarTodos.length + ' leads del periodo sin un contacto registrado' : 'Los más antiguos primero — aquí es donde se pierde dinero') + '</div>' +
    (!sinContactar.length
      ? '<div style="font-size:12px;color:var(--muted2)">Todos los leads del periodo tienen al menos un contacto registrado</div>'
      : c.privado
        ? omitido('El nombre de cada lead')
        : sinContactar.map(l => {
          const dias = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000);
          return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">' +
            '<div style="flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' + (c.interactivo ? ';cursor:pointer" onclick="tarAbrirLead(\'' + esc(l.id) + '\')"' : '"') + '>' + esc(l.name || 'Sin nombre') + '</div>' +
            '<div style="font-size:11.5px;color:var(--muted2)">' + esc(l.assigned_name || 'sin asignar') + '</div>' +
            '<div style="font-size:11.5px;font-weight:700;color:' + (dias >= 3 ? '#B91C1C' : 'var(--muted)') + ';width:56px;text-align:right">' + (dias ? dias + ' d' : 'hoy') + '</div>' +
          '</div>';
        }).join('')) +
  '</div></div>';

  return html;
}

// ── Catálogo ────────────────────────────────────────────────────────────────
// Los informes que se pueden compartir y descargar, en el orden del menú.
// `rango` es el de por defecto; `necesita` lo que hay que cargar para él.
export const INFORMES = [
  { id: 'sales',     titulo: 'Ventas',         html: htmlVentas,        rango: 90, necesita: [] },
  { id: 'prod',      titulo: 'Productividad',  html: htmlProductividad, rango: 30, necesita: ['acts', 'inter'] },
  { id: 'equipo',    titulo: 'Por comercial',  html: htmlEquipo,        rango: 30, necesita: ['inter', 'equipo'] },
  { id: 'mk',        titulo: 'Marketing',      html: htmlMarketing,     rango: 90, necesita: ['camps', 'autos', 'logs'] },
  { id: 'analytics', titulo: 'Resumen',        html: htmlResumen,       rango: 0,  necesita: [] },
];
export function informe(id) { return INFORMES.find(i => i.id === id) || null; }

// ── El documento: portada + secciones ───────────────────────────────────────
// Lo arma igual la página del enlace y el PDF de la app. `secciones` es una
// lista de { titulo, periodo, html } y cada una va en su página al imprimir.
export function htmlDocumento({ negocio, proceso, generado, secciones, nota }) {
  const fecha = (generado ? new Date(generado) : new Date())
    .toLocaleString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return '<div class="inf-portada">' +
      '<div class="inf-marca">Informe comercial</div>' +
      '<h1>' + esc(negocio || 'Informes de Análisis') + '</h1>' +
      '<div class="inf-meta">' +
        (proceso ? 'Proceso: <b>' + esc(proceso) + '</b><br>' : '') +
        'Datos al ' + esc(fecha) +
        (nota ? '<br>' + esc(nota) : '') +
      '</div>' +
    '</div>' +
    (secciones || []).map(s =>
      '<section class="inf-seccion">' +
        (s.periodo ? '<div class="inf-periodo">' + esc(s.titulo) + ' · ' + esc(s.periodo) + '</div>' : '') +
        '<div>' + s.html + '</div>' +
      '</section>').join('') +
    '<div class="inf-pie">Hecho con Acuarius · acuarius.app</div>';
}
