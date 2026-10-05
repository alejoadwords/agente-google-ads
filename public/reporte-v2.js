/* Acuarius — reporte de resultados para clientes, versión 2 (/r/<token>).
 *
 * El diseño sigue el reporte que la agencia Check In Creativos hacía a mano
 * para Certain & Pezzano (agosto 2026): pestañas, una franja con las cifras
 * grandes, tabla de período contra período, gráficos, hallazgos y plan.
 * Las cifras y tablas salen de los datos congelados del reporte; los textos
 * (titulares, hallazgo, plan) los escribió la IA con esas mismas cifras.
 *
 * Lo que Acuarius suma y el reporte a mano no tenía: la pestaña «Del clic a
 * la venta», con lo que pasó con esos contactos dentro del CRM.
 *
 * Se llama desde reporte.html cuando datos.version === 2.
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // **negrita** de la IA → <b>, después de escapar: nunca entra HTML del modelo.
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const fechaCorta = (s) => { const p = String(s || '').split('-'); return p.length === 3 ? Number(p[2]) + ' de ' + MESES[Number(p[1]) - 1] : ''; };
  const mesDe = (s) => { const p = String(s || '').split('-'); return p.length === 3 ? MESES[Number(p[1]) - 1] : ''; };

  window.pintarReporteV2 = function (r, raiz) {
    const d = r.datos, m = d.moneda, marca = d.marca || {}, n = d.narrativa || {};
    const t = d.actual.totales, ta = d.anterior.totales;
    const g = d.google, metas = d.meta || [];
    const meta = metas[0] || null;   // casi siempre una cuenta; las demás suman en los totales
    const c = d.contactos || { actual: { total: 0 }, anterior: { total: 0 } };
    const sinAtrib = !!d.aviso_atribucion;
    const etiquetaAnt = mesDe(d.anterior_desde) === mesDe(d.anterior_hasta) && Number(String(d.anterior_desde).slice(8)) === 1 ? mesDe(d.anterior_desde) : 'el período anterior';
    const etiquetaAct = d.etiqueta;

    // ── formato ──
    const plata = (v) => {
      if (v == null || !isFinite(v)) return '—';
      try { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: m || 'COP', maximumFractionDigits: 0 }).format(v); }
      catch (e) { return '$' + Math.round(v).toLocaleString('es-CO'); }
    };
    const num = (v) => v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('es-CO');
    const dec = (v) => v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString('es-CO');
    const pct = (v) => v == null || !isFinite(v) ? '—' : (Math.round(v * 1000) / 10).toLocaleString('es-CO') + ' %';
    const div = (a, b) => (a != null && b) ? a / b : null;
    const delta = (act, ant, menosEsMejor) => {
      if (act == null || ant == null || !ant || !isFinite(act) || !isFinite(ant)) return '';
      const p = (act - ant) / ant * 100;
      if (Math.abs(p) < 0.5) return '<span class="delta flat">igual</span>';
      const bien = menosEsMejor ? p < 0 : p > 0;
      return '<span class="delta ' + (bien ? 'up' : 'down') + '">' + (p > 0 ? '+' : '−') + (Math.round(Math.abs(p) * 10) / 10).toLocaleString('es-CO') + ' %</span>';
    };
    const neutro = (act, ant) => delta(act, ant).replace(/delta (up|down)/, 'delta flat');

    // ── colores de la agencia ──
    if (marca.color && /^#[0-9a-f]{6}$/i.test(marca.color)) {
      document.documentElement.style.setProperty('--v2-accent', marca.color);
      document.documentElement.style.setProperty('--v2-accent-d', marca.color);
      document.documentElement.style.setProperty('--v2-accent-l', marca.color + '1A');
    }
    document.body.classList.add('v2');
    document.title = (marca.nombre ? marca.nombre + ' · ' : '') + 'Reporte de resultados · ' + etiquetaAct;

    const paginas = [];
    const graficos = {};   // por página: se dibujan al mostrarla (en una oculta, Chart.js mide 0)

    // ════════ Resumen ejecutivo ════════
    {
      const cpcAct = div(t.inversion, c.actual.total), cpcAnt = div(ta.inversion, c.anterior.total);
      let h = '<div class="ph"><h1 class="ph-t">Resumen ejecutivo<br><em>' + esc(etiquetaAct) + '</em></h1>' +
        '<div class="ph-s">' + md(r.resumen || n.titular || '') + '</div></div>';
      h += '<div class="heroes">' +
        hero(num(c.actual.total), 'Contactos según las plataformas', etiquetaAnt + ': ' + num(c.anterior.total) + ' ' + delta(c.actual.total, c.anterior.total)) +
        hero(plata(cpcAct), 'Costo por contacto', etiquetaAnt + ': ' + plata(cpcAnt) + ' ' + delta(cpcAct, cpcAnt, true)) +
        hero(num(t.leads), 'Leads que llegaron al CRM', num(t.ganados) + (t.ganados === 1 ? ' venta' : ' ventas') + ' · ' + etiquetaAnt + ': ' + num(ta.leads)) +
      '</div>';
      // Período contra período: solo las filas que tienen dato.
      const filas = [
        ['Inversión total', plata(ta.inversion), plata(t.inversion), neutro(t.inversion, ta.inversion)],
        ['Contactos según las plataformas', num(c.anterior.total), num(c.actual.total), delta(c.actual.total, c.anterior.total), true],
        ['Costo por contacto', plata(cpcAnt), plata(cpcAct), delta(cpcAct, cpcAnt, true), true],
      ];
      if (g) filas.push(['Conversiones de Google', dec(c.anterior.google), dec(c.actual.google), delta(c.actual.google, c.anterior.google)]);
      if (meta && (c.actual.meta_conversaciones || c.anterior.meta_conversaciones)) filas.push(['Conversaciones de WhatsApp (Meta)', num(c.anterior.meta_conversaciones), num(c.actual.meta_conversaciones), delta(c.actual.meta_conversaciones, c.anterior.meta_conversaciones)]);
      if (meta && (c.actual.meta_leads || c.anterior.meta_leads)) filas.push(['Formularios de Meta', num(c.anterior.meta_leads), num(c.actual.meta_leads), delta(c.actual.meta_leads, c.anterior.meta_leads)]);
      if (meta) {
        const al = metas.reduce((s, x) => s + x.totales.alcance, 0), ala = metas.reduce((s, x) => s + x.totales_anterior.alcance, 0);
        const vi = metas.reduce((s, x) => s + x.totales.video, 0), via = metas.reduce((s, x) => s + x.totales_anterior.video, 0);
        filas.push(['Personas alcanzadas', num(ala), num(al), delta(al, ala)]);
        if (vi || via) filas.push(['Reproducciones de video', num(via), num(vi), delta(vi, via)]);
      }
      filas.push(['Leads que llegaron al CRM', num(ta.leads), num(t.leads), delta(t.leads, ta.leads), true]);
      filas.push(['Ventas', num(ta.ganados), num(t.ganados), delta(t.ganados, ta.ganados), true]);
      if (t.ingresos || ta.ingresos) filas.push(['Ingresos por ventas', plata(ta.ingresos), plata(t.ingresos), delta(t.ingresos, ta.ingresos)]);
      h += '<div class="sec">' + esc(cap(etiquetaAct)) + ' frente a ' + esc(etiquetaAnt) + '</div>' +
        tabla(['Indicador', cap(etiquetaAnt), cap(mesDe(d.desde) && Number(String(d.desde).slice(8)) === 1 && mesDe(d.desde) === mesDe(d.hasta) ? mesDe(d.desde) : 'Este período'), 'Variación'], filas.map(f =>
          '<tr><td>' + (f[4] ? '<b>' + esc(f[0]) + '</b>' : esc(f[0])) + '</td><td class="n">' + f[1] + '</td><td class="n">' + (f[4] ? '<b>' + f[2] + '</b>' : f[2]) + '</td><td class="n">' + f[3] + '</td></tr>'), [0, 1, 1, 1]);
      if (n.conclusion) h += '<div class="alerta ' + ({ bien: 'a-bien', atencion: 'a-ojo' }[n.conclusion_tono] || 'a-info') + '">' + md(n.conclusion) + '</div>';
      if (sinAtrib) h += '<div class="alerta a-ojo">Casi ningún lead de este período llegó al CRM con el dato de la campaña que lo trajo, así que todavía no se puede decir cuántos leads reales dejó cada campaña. Los contactos de arriba son los que cuentan Google y Meta. Estamos corrigiendo esa medición.</div>';
      if ((d.cuentas_sin_leer || []).length) h += '<div class="alerta a-mal">No pudimos leer ' + esc(d.cuentas_sin_leer.join(', ')) + ' al armar este reporte: su inversión no está en estas cifras.</div>';

      // Gráficos: contactos y costo, anterior contra actual; costo por contacto por canal.
      const canales = [];
      if (g) for (const x of g.campanas) if (x.conv >= 0.5) canales.push([x.nombre + ' (Google)', x.cpa]);
      for (const mm of metas) {
        const cap_ = mm.capas.captacion; const k = cap_.conversaciones + cap_.leads;
        if (k) canales.push(['Captación ' + (cap_.conversaciones ? 'WhatsApp' : 'formularios') + ' (Meta)', cap_.inversion / k]);
      }
      h += '<div class="graficos">' +
        '<div class="tarjeta"><div class="tarjeta-l">Contactos y costo por contacto · ' + esc(etiquetaAnt) + ' vs. ' + esc(mesDe(d.desde) || 'este período') + '</div><div class="lienzo"><canvas id="g-res-1"></canvas></div>' +
          '<div class="nota">Escala logarítmica, para que un número pequeño y uno grande se vean en la misma gráfica.</div></div>' +
        (canales.length > 1 ? '<div class="tarjeta"><div class="tarjeta-l">Costo por contacto según el canal</div><div class="lienzo"><canvas id="g-res-2"></canvas></div>' +
          '<div class="nota">Lo que cuesta cada contacto que cuenta la plataforma, canal por canal.</div></div>' : '') +
      '</div>';
      graficos.resumen = () => {
        barras('g-res-1', ['Contactos', 'Costo por contacto'], [
          { label: cap(etiquetaAnt), data: [c.anterior.total, cpcAnt], color: '#B9C7D6' },
          { label: cap(mesDe(d.desde) || 'Este período'), data: [c.actual.total, cpcAct], color: 'acento' },
        ], { log: true });
        if (canales.length > 1) barras('g-res-2', canales.map(x => x[0]), [{ label: 'Costo por contacto', data: canales.map(x => x[1]), color: canales.map(x => x[0].includes('Meta') ? '#2F5FA8' : '#A6772F') }], { log: true, horizontal: true, plata: true });
      };
      if (n.hallazgo && n.hallazgo.texto) h += '<div class="alerta a-info">✦ <b>' + md(n.hallazgo.titulo || '') + '</b> ' + md(n.hallazgo.texto) + '</div>';
      if ((n.destacados || []).length) {
        const bordes = ['bl-terra', 'bl-verde', 'bl-azul'];
        h += '<div class="tres">' + n.destacados.slice(0, 3).map((x, i) => '<div class="caja ' + bordes[i] + '"><div class="caja-t">' + esc(x.titulo) + '</div><div class="caja-b">' + md(x.texto) + '</div></div>').join('') + '</div>';
      }
      paginas.push({ id: 'resumen', nombre: 'Resumen ejecutivo', html: h });
    }

    // ════════ Google Ads ════════
    if (g && g.campanas.length) {
      const T = g.totales, A = g.totales_anterior;
      let h = '<span class="etq etq-goog">● Google Ads</span><div class="ph"><h1 class="ph-t">' + md(n.google?.titular || 'Google Ads') + '</h1>' +
        (n.google?.texto ? '<div class="ph-s">' + md(n.google.texto) + '</div>' : '') + '</div>';
      h += '<div class="kpis">' +
        kpi('Inversión', plata(T.inversion), etiquetaAnt + ': ' + plata(A.inversion) + ' ' + neutro(T.inversion, A.inversion)) +
        kpi('Conversiones', dec(T.conv), etiquetaAnt + ': ' + dec(A.conv) + ' ' + delta(T.conv, A.conv), true) +
        kpi('Costo por conversión', plata(T.cpa), etiquetaAnt + ': ' + plata(A.cpa) + ' ' + delta(T.cpa, A.cpa, true)) +
        kpi('CTR', pct(T.ctr), num(T.clics) + ' clics') +
        kpi('CPC promedio', plata(T.cpc), etiquetaAnt + ': ' + plata(A.cpc)) +
        kpi('Impresiones', num(T.impresiones), etiquetaAnt + ': ' + num(A.impresiones)) +
      '</div>';
      if (n.google?.alerta) h += '<div class="alerta a-bien">' + md(n.google.alerta) + '</div>';
      // La mejor y la peor por costo por conversión, si hay con qué comparar.
      const conCpa = g.campanas.filter(x => x.cpa != null);
      const mejor = conCpa.length > 1 ? conCpa.reduce((a, b) => a.cpa < b.cpa ? a : b) : null;
      const peor = conCpa.length > 1 ? conCpa.reduce((a, b) => a.cpa > b.cpa ? a : b) : null;
      h += tabla(['Campaña', 'Inversión', '% del presup.', 'Impresiones', 'CTR', 'Conversiones', 'Costo / conv.', 'vs. ' + etiquetaAnt],
        g.campanas.map(x => '<tr><td>' + esc(x.nombre) + (x === mejor ? '<span class="badge b-best">★ La más eficiente</span>' : x === peor ? '<span class="badge b-warn">A corregir</span>' : '') +
          (x.conv < 0.5 && x.inversion > 0 ? '<span class="badge b-warn">Sin conversiones</span>' : '') + '</td>' +
          '<td class="n">' + plata(x.inversion) + '</td><td class="n">' + pct(div(x.inversion, T.inversion)) + '</td><td class="n">' + num(x.impresiones) + '</td>' +
          '<td class="n">' + pct(x.ctr) + '</td><td class="n">' + dec(x.conv) + '</td><td class="n">' + plata(x.cpa) + '</td><td class="n">' + (x.anterior ? delta(x.cpa, x.anterior.cpa, true) : '') + '</td></tr>')
        .concat(['<tr class="pie"><td>Total Google</td><td class="n">' + plata(T.inversion) + '</td><td class="n">100 %</td><td class="n">' + num(T.impresiones) + '</td><td class="n">' + pct(T.ctr) + '</td><td class="n">' + dec(T.conv) + '</td><td class="n">' + plata(T.cpa) + '</td><td class="n">' + delta(T.cpa, A.cpa, true) + '</td></tr>']),
        [0, 1, 1, 1, 1, 1, 1, 1]);
      h += '<div class="graficos">' +
        '<div class="tarjeta"><div class="tarjeta-l">Conversiones por campaña · ' + esc(etiquetaAnt) + ' vs. ' + esc(mesDe(d.desde) || 'este período') + '</div><div class="lienzo"><canvas id="g-goo-1"></canvas></div></div>' +
        '<div class="tarjeta"><div class="tarjeta-l">Costo por conversión · ' + esc(etiquetaAnt) + ' vs. ' + esc(mesDe(d.desde) || 'este período') + '</div><div class="lienzo"><canvas id="g-goo-2"></canvas></div><div class="nota">Escala logarítmica.</div></div>' +
      '</div>';
      graficos.google = () => {
        const nom = g.campanas.map(x => x.nombre);
        barras('g-goo-1', nom, [{ label: cap(etiquetaAnt), data: g.campanas.map(x => x.anterior?.conv || 0), color: '#B9C7D6' }, { label: cap(mesDe(d.desde) || 'Este período'), data: g.campanas.map(x => x.conv), color: 'acento' }]);
        barras('g-goo-2', nom, [{ label: cap(etiquetaAnt), data: g.campanas.map(x => x.anterior?.cpa ?? null), color: '#B9C7D6' }, { label: cap(mesDe(d.desde) || 'Este período'), data: g.campanas.map(x => x.cpa), color: 'acento' }], { log: true, plata: true });
      };
      const B = g.busquedas;
      if (B && B.modo === 'gasto') {
        h += '<div class="sec">Medición</div><div class="alerta a-ojo"><b>Google no está contando conversiones en las búsquedas de esta cuenta.</b> Sin eso no se puede saber qué búsqueda funciona ni dejar que Google optimice hacia contactos. Es lo primero que hay que corregir.</div>';
      }
      if (B && B.terminos.length) {
        h += '<div class="sec">El hallazgo: en qué se gastó la campaña de búsqueda</div>' +
          '<div class="alerta a-ojo">⚠ ' + (n.google?.busquedas ? md(n.google.busquedas) : '<b>' + plata(B.desperdicio) + '</b> (' + pct(B.pct) + ' del gasto en búsquedas) se fue en búsquedas que no trajeron ninguna conversión.') + '</div>' +
          tabla(['Término de búsqueda', 'Campaña', 'Costo', 'Clics', 'Conversiones'], B.terminos.map(x => '<tr><td>' + esc(x.texto) + '</td><td>' + esc(x.campana) + '</td><td class="n">' + plata(x.costo) + '</td><td class="n">' + num(x.clics) + '</td><td class="n">' + dec(x.conv) + '</td></tr>'), [0, 0, 1, 1, 1]);
      }
      if (B && B.palabras.length) {
        h += '<div class="sec">Palabras que se cuelan en las búsquedas</div>' +
          tabla(['Palabra', 'Ejemplos', 'Costo', 'Clics', 'Conversiones'], B.palabras.map(x => '<tr><td><b>' + esc(x.texto) + '</b></td><td style="font-size:12px;color:var(--v2-muted)">' + esc((x.ejemplos || []).join(' · ')) + '</td><td class="n">' + plata(x.costo) + '</td><td class="n">' + num(x.clics) + '</td><td class="n">' + dec(x.conv) + '</td></tr>'), [0, 0, 1, 1, 1]);
      }
      paginas.push({ id: 'google', nombre: 'Google Ads', punto: 'var(--v2-goog)', html: h });
    }

    // ════════ Meta Ads ════════
    if (meta && meta.campanas.length) {
      const T = metas.reduce((s, x) => sumar(s, x.totales), {}), A = metas.reduce((s, x) => sumar(s, x.totales_anterior), {});
      const cm = meta.capas.marca, cc = meta.capas.captacion;
      const k = T.conversaciones + T.leads, ka = A.conversaciones + A.leads;
      let h = '<span class="etq etq-meta">● Meta Ads · Facebook e Instagram</span><div class="ph"><h1 class="ph-t">' + md(n.meta?.titular || 'Meta Ads') + '</h1>' +
        (n.meta?.texto ? '<div class="ph-s">' + md(n.meta.texto) + '</div>' : '') + '</div>';
      h += '<div class="kpis">' +
        kpi('Inversión total', plata(T.inversion), etiquetaAnt + ': ' + plata(A.inversion) + ' ' + neutro(T.inversion, A.inversion)) +
        (T.conversaciones ? kpi('Conversaciones', num(T.conversaciones), 'a ' + plata(div(cc.inversion, T.conversaciones)) + ' cada una ' + delta(T.conversaciones, A.conversaciones), true) : '') +
        (T.leads ? kpi('Formularios', num(T.leads), 'a ' + plata(div(cc.inversion, T.leads)) + ' cada uno') : '') +
        kpi('Alcance', num(T.alcance), etiquetaAnt + ': ' + num(A.alcance) + ' ' + delta(T.alcance, A.alcance)) +
        kpi('Impresiones', num(T.impresiones), 'CPM ' + plata(div(T.inversion, T.impresiones) * 1000)) +
        (T.video ? kpi('Reproducciones', num(T.video), 'de video ' + delta(T.video, A.video)) : '') +
      '</div>';
      if (n.meta?.alerta) h += '<div class="alerta a-bien">' + md(n.meta.alerta) + '</div>';
      if (cm.inversion && cc.inversion) {
        h += '<div class="sec">Las dos capas, lado a lado</div><div class="dos">' +
          '<div class="caja bl-azul"><div class="caja-t">Capa 1 · Reconocimiento de marca</div><div class="caja-b">Inversión <b>' + plata(cm.inversion) + '</b> · ' + num(cm.alcance) + ' personas<br>CPM ' + plata(cm.cpm) + ' ' + delta(cm.cpm, cm.anterior.cpm, true) +
            (cm.anterior.inversion ? '<br><span style="color:var(--v2-light)">' + esc(etiquetaAnt) + ': ' + num(cm.anterior.alcance) + ' personas a CPM ' + plata(cm.anterior.cpm) + '</span>' : '') + '</div></div>' +
          '<div class="caja bl-verde"><div class="caja-t">Capa 2 · Captación</div><div class="caja-b">Inversión <b>' + plata(cc.inversion) + '</b> · ' + num(cc.conversaciones + cc.leads) + ' contactos<br>Costo ' + plata(div(cc.inversion, cc.conversaciones + cc.leads)) +
            (cc.anterior.inversion ? '<br><span style="color:var(--v2-light)">' + esc(etiquetaAnt) + ': ' + num(cc.anterior.conversaciones + cc.anterior.leads) + ' a ' + plata(div(cc.anterior.inversion, cc.anterior.conversaciones + cc.anterior.leads)) + '</span>' : '') + '</div></div>' +
        '</div>';
      }
      const captacion = meta.campanas.filter(x => x.capa === 'captacion');
      if (captacion.length) {
        const cpk = (x) => div(x.inversion, x.conversaciones + x.leads);
        const best = captacion.filter(x => cpk(x) != null).sort((a, b) => cpk(a) - cpk(b))[0];
        h += '<div class="sec">Campañas de captación</div>' + tabla(['Campaña', 'Inversión', 'Impresiones', 'Alcance', 'Contactos', 'Costo / contacto', 'Costo ' + etiquetaAnt],
          captacion.map(x => '<tr><td>' + esc(x.nombre) + (x === best && captacion.length > 1 ? '<span class="badge b-best">★ La más eficiente</span>' : '') + '</td><td class="n">' + plata(x.inversion) + '</td><td class="n">' + num(x.impresiones) + '</td><td class="n">' + num(x.alcance) + '</td>' +
            '<td class="n">' + num(x.conversaciones + x.leads) + '</td><td class="n">' + plata(cpk(x)) + '</td><td class="n">' + (x.anterior ? plata(div(x.anterior.inversion, x.anterior.conversaciones + x.anterior.leads)) : '—') + '</td></tr>'), [0, 1, 1, 1, 1, 1, 1]);
      }
      if (meta.conjuntos.length) {
        h += '<div class="sec">Rendimiento por público</div>' + tabla(['Conjunto de anuncios', 'Inversión', 'Impresiones', 'CTR enlace', 'Contactos', 'Costo / contacto'],
          meta.conjuntos.slice(0, 10).map(x => '<tr><td>' + esc(x.nombre) + '</td><td class="n">' + plata(x.inversion) + '</td><td class="n">' + num(x.impresiones) + '</td><td class="n">' + (x.ctr ? dec(x.ctr) + ' %' : '—') + '</td><td class="n">' + num(x.conversaciones + x.leads) + '</td><td class="n">' + plata(div(x.inversion, x.conversaciones + x.leads)) + '</td></tr>'), [0, 1, 1, 1, 1, 1]);
      }
      if (cm.inversion && cc.inversion) {
        h += '<div class="graficos"><div class="tarjeta"><div class="tarjeta-l">Reparto de inversión por objetivo</div><div class="lienzo"><canvas id="g-meta-1"></canvas></div></div>' +
          (meta.conjuntos.length ? '<div class="tarjeta"><div class="tarjeta-l">Costo por contacto por público</div><div class="lienzo"><canvas id="g-meta-2"></canvas></div></div>' : '') + '</div>';
        graficos.meta = () => {
          dona('g-meta-1', ['Reconocimiento', 'Captación'], [cm.inversion, cc.inversion]);
          const pub = meta.conjuntos.filter(x => x.conversaciones + x.leads).slice(0, 8);
          if (pub.length) barras('g-meta-2', pub.map(x => x.nombre), [{ label: 'Costo por contacto', data: pub.map(x => x.inversion / (x.conversaciones + x.leads)), color: '#2F5FA8' }], { horizontal: true, plata: true });
        };
      }
      paginas.push({ id: 'meta', nombre: 'Meta Ads', punto: 'var(--v2-meta)', html: h });

      // ════════ Marca y comunidad ════════
      if (cm.inversion > 0) {
        let hm = '<span class="etq etq-meta">● Marca y comunidad · Facebook e Instagram</span><div class="ph"><h1 class="ph-t">' + md(n.marca?.titular || 'Marca y comunidad') + '</h1>' +
          (n.marca?.texto ? '<div class="ph-s">' + md(n.marca.texto) + '</div>' : '') + '</div>';
        hm += '<div class="soc">' + soc(num(cm.alcance), 'Personas alcanzadas') + soc(num(cm.video), 'Reproducciones de video') + soc(plata(cm.cpm), 'Costo por mil impresiones') + soc(dec(cm.frecuencia), 'Frecuencia promedio') + '</div>';
        hm += '<div class="kpis">' +
          kpi('Alcance de la capa de marca', num(cm.alcance), etiquetaAnt + ': ' + num(cm.anterior.alcance) + ' ' + delta(cm.alcance, cm.anterior.alcance), true) +
          kpi('Costo por mil impresiones', plata(cm.cpm), etiquetaAnt + ': ' + plata(cm.anterior.cpm) + ' ' + delta(cm.cpm, cm.anterior.cpm, true)) +
          kpi('Reproducciones de video', num(cm.video), etiquetaAnt + ': ' + num(cm.anterior.video) + ' ' + delta(cm.video, cm.anterior.video)) +
        '</div>';
        hm += '<div class="graficos"><div class="tarjeta"><div class="tarjeta-l">Alcance y video · ' + esc(etiquetaAnt) + ' vs. ' + esc(mesDe(d.desde) || 'este período') + '</div><div class="lienzo"><canvas id="g-marca-1"></canvas></div><div class="nota">Escala logarítmica.</div></div></div>';
        graficos.marca = () => barras('g-marca-1', ['Alcance', 'Reproducciones de video'], [{ label: cap(etiquetaAnt), data: [cm.anterior.alcance, cm.anterior.video], color: '#B9C7D6' }, { label: cap(mesDe(d.desde) || 'Este período'), data: [cm.alcance, cm.video], color: 'acento' }], { log: true });
        paginas.push({ id: 'marca', nombre: 'Marca y comunidad', punto: 'var(--v2-rec)', html: hm });
      }

      // ════════ Mejores anuncios ════════
      const conContacto = metas.flatMap(x => x.anuncios).filter(a => a.conversaciones + a.leads > 0);
      if (conContacto.length) {
        let ha = '<span class="etq etq-meta">● Meta Ads · creativos</span><div class="ph"><h1 class="ph-t">' + md(n.anuncios?.titular || 'Los anuncios que más contactos abrieron') + '</h1>' +
          (n.anuncios?.texto ? '<div class="ph-s">' + md(n.anuncios.texto) + '</div>' : '') + '</div>';
        const rangos = ['#1 · Mayor volumen', '#2', '#3'];
        ha += '<div class="ads">' + conContacto.slice(0, 3).map((a, i) => '<div class="ad">' + (a.imagen ? '<img class="ad-img" src="' + esc(a.imagen) + '" alt="">' : '') +
          '<div class="ad-hd"><div class="ad-rank">' + rangos[i] + '</div><div class="ad-nom">' + esc(a.nombre) + '</div></div>' +
          '<div class="ad-st"><div class="ad-s"><div class="ad-sv">' + num(a.conversaciones + a.leads) + '</div><div class="ad-sl">Contactos</div></div>' +
            '<div class="ad-s"><div class="ad-sv">' + plata(div(a.inversion, a.conversaciones + a.leads)) + '</div><div class="ad-sl">Costo / contacto</div></div>' +
            '<div class="ad-s"><div class="ad-sv">' + (a.ctr ? dec(a.ctr) + ' %' : '—') + '</div><div class="ad-sl">CTR de enlace</div></div>' +
            '<div class="ad-s"><div class="ad-sv">' + plata(a.inversion) + '</div><div class="ad-sl">Inversión</div></div></div>' +
          (a.texto ? '<div class="ad-pie">' + esc(a.texto) + '</div>' : '') + '</div>').join('') + '</div>';
        ha += '<div class="sec">Todos los anuncios con contactos</div>' + tabla(['Anuncio', 'Inversión', 'Impresiones', 'CTR enlace', 'Contactos', 'Costo / contacto'],
          conContacto.slice(0, 15).map(a => '<tr><td>' + esc(a.nombre) + '</td><td class="n">' + plata(a.inversion) + '</td><td class="n">' + num(a.impresiones) + '</td><td class="n">' + (a.ctr ? dec(a.ctr) + ' %' : '—') + '</td><td class="n">' + num(a.conversaciones + a.leads) + '</td><td class="n">' + plata(div(a.inversion, a.conversaciones + a.leads)) + '</td></tr>'), [0, 1, 1, 1, 1, 1]);
        paginas.push({ id: 'anuncios', nombre: 'Mejores anuncios', html: ha });
      }
    }

    // ════════ Del clic a la venta (lo que solo sabe el CRM) ════════
    {
      let h = '<span class="etq etq-crm">● CRM · lo que pasó con los contactos</span><div class="ph"><h1 class="ph-t">' + md(n.crm?.titular || 'Del clic a la venta') + '</h1>' +
        '<div class="ph-s">' + (n.crm?.texto ? md(n.crm.texto) : 'Las plataformas cuentan contactos; aquí se ve cuántos llegaron de verdad al CRM, de dónde y en qué terminaron.') + '</div></div>';
      h += '<div class="kpis">' +
        kpi('Leads que llegaron', num(t.leads), etiquetaAnt + ': ' + num(ta.leads) + ' ' + delta(t.leads, ta.leads), true) +
        kpi('Ventas', num(t.ganados), etiquetaAnt + ': ' + num(ta.ganados) + ' ' + delta(t.ganados, ta.ganados)) +
        kpi('Ingresos', plata(t.ingresos), etiquetaAnt + ': ' + plata(ta.ingresos)) +
        kpi('En proceso', num(t.en_proceso), 'todavía se trabajan') +
        kpi('Perdidos', num(t.perdidos), '') +
      '</div>';
      if (sinAtrib) h += '<div class="alerta a-ojo">De los ' + num(t.leads) + ' leads del período, casi ninguno trae la campaña que lo trajo. Mientras eso no se corrija, no se puede decir cuántas ventas dejó cada campaña.</div>';
      const camps = (d.actual.campanas || []).filter(x => x.inversion > 0 || x.leads);
      if (camps.length) {
        h += '<div class="sec">Cada campaña: lo que cuenta la plataforma y lo que llegó al CRM</div>' + tabla(['Campaña', 'Inversión', 'Conversiones de la plataforma', 'Leads en el CRM', 'Ventas'],
          camps.map(x => '<tr><td>' + esc(x.nombre) + ' <span class="badge b-neu">' + (x.red === 'google' ? 'Google' : 'Meta') + '</span></td><td class="n">' + plata(x.inversion) + '</td><td class="n">' + dec(x.conv_red) + '</td><td class="n">' + num(x.leads) + '</td><td class="n">' + num(x.ganados) + '</td></tr>'), [0, 1, 1, 1, 1]);
      }
      if ((d.actual.fuentes || []).length) {
        h += '<div class="graficos"><div class="tarjeta"><div class="tarjeta-l">De dónde llegaron los leads</div><div class="lienzo"><canvas id="g-crm-1"></canvas></div></div>' +
          '<div class="tarjeta"><div class="tarjeta-l">En qué terminaron</div><div class="lienzo"><canvas id="g-crm-2"></canvas></div></div></div>';
        graficos.crm = () => {
          barras('g-crm-1', d.actual.fuentes.map(x => x.fuente), [{ label: 'Leads', data: d.actual.fuentes.map(x => x.n), color: '#6B4FA0' }], { horizontal: true });
          dona('g-crm-2', ['En proceso', 'Ganados', 'Perdidos'], [t.en_proceso, t.ganados, t.perdidos], ['#5BB0E5', '#2E8560', '#B0463F']);
        };
      }
      if ((d.palabras_clave_crm || []).length) {
        h += '<div class="sec">Las palabras clave de Google, según lo que pasó con sus leads</div>' + tabla(['Palabra clave', 'Leads', 'Ganados', 'Perdidos', 'Por qué se perdieron'],
          d.palabras_clave_crm.map(x => '<tr><td>' + esc(x.palabra) + '</td><td class="n">' + num(x.leads) + '</td><td class="n">' + num(x.ganados) + '</td><td class="n">' + num(x.perdidos) + '</td><td style="font-size:12px;color:var(--v2-muted)">' + esc((x.motivos || []).map(mo => mo.motivo + ' (' + mo.n + ')').join(' · ') || '—') + '</td></tr>'), [0, 1, 1, 1, 0]);
      }
      paginas.push({ id: 'crm', nombre: 'Del clic a la venta', punto: 'var(--v2-crm)', html: h });
    }

    // ════════ Plan ════════
    {
      let h = '<div class="ph"><h1 class="ph-t">Lo que sigue</h1><div class="ph-s">Lo que ya funciona, la palanca más clara y el plan para el próximo período.</div></div>';
      if (n.funciona || n.palanca || n.falta) {
        h += '<div class="tres">' +
          (n.funciona ? '<div class="caja bl-verde"><div class="caja-t">Lo que ya funciona</div><div class="caja-b">' + md(n.funciona) + '</div></div>' : '') +
          (n.palanca ? '<div class="caja bl-acc"><div class="caja-t">La palanca del período</div><div class="caja-b">' + md(n.palanca) + '</div></div>' : '') +
          (n.falta ? '<div class="caja bl-terra"><div class="caja-t">El dato que falta</div><div class="caja-b">' + md(n.falta) + '</div></div>' : '') + '</div>';
      }
      if ((n.plan || []).length) {
        h += '<div class="sec">Plan de acción</div><div class="caja">' + n.plan.map((p, i) => '<div class="pri"><span class="pri-n">' + (i + 1) + '</span><div class="pri-x"><b>' + md(p.titulo) + '</b>' +
          (p.red && p.red !== 'general' ? ' <span class="badge b-neu">' + ({ google: 'Google', meta: 'Meta', crm: 'CRM' }[p.red] || esc(p.red)) + '</span>' : '') + '<br>' + md(p.texto) + '</div></div>').join('') + '</div>';
      }
      if ((d.hicimos || []).length) h += '<div class="sec">Lo que hicimos en el período</div><div class="caja">' + d.hicimos.map(x => '<div class="pri"><span class="pri-n">✓</span><div class="pri-x">' + esc(x.que) + '</div></div>').join('') + '</div>';
      if (!n.plan && !d.hicimos?.length) h += '<div class="alerta a-info">Este reporte salió sin textos escritos: solo con las cifras.</div>';
      paginas.push({ id: 'plan', nombre: 'Plan', html: h });
    }

    // ── armado ──
    const firma = marca.firma || '';
    raiz.innerHTML =
      '<header class="topnav"><div class="brand">' +
        (marca.logo_url ? '<img src="' + esc(marca.logo_url) + '" alt="' + esc(firma) + '">' : '<div class="brand-nombre">' + esc(marca.nombre || firma) + '</div>') +
        '<div class="brand-sub">Reporte de resultados</div></div>' +
        '<nav class="tabs">' + paginas.map((p, i) => '<button class="tab' + (i ? '' : ' on') + '" data-p="' + p.id + '">' + (p.punto ? '<span class="dot" style="background:' + p.punto + '"></span>' : '') + esc(p.nombre) + '</button>').join('') + '</nav>' +
        '<div class="periodo">' + esc(fechaCorta(d.desde)) + ' – ' + esc(fechaCorta(d.hasta)) + '</div>' +
        '<button class="pdf" onclick="window.print()">PDF</button>' +
      '</header>' +
      paginas.map((p, i) => '<section class="pagina' + (i ? '' : ' on') + '" id="p-' + p.id + '">' + p.html + '</section>').join('') +
      '<footer class="footer"><span>' + (firma ? 'Preparado por <b>' + esc(firma) + '</b>' + (marca.nombre ? ' para ' + esc(marca.nombre) : '') : '') + '</span>' +
        '<span>Hecho con Acuarius · Números al ' + esc(new Date(r.creado).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })) + '</span></footer>';

    const dibujados = {};
    const mostrar = (id) => {
      raiz.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.p === id));
      raiz.querySelectorAll('.pagina').forEach(s => s.classList.toggle('on', s.id === 'p-' + id));
      if (graficos[id] && !dibujados[id] && window.Chart) { dibujados[id] = true; try { graficos[id](); } catch (e) { console.error(e); } }
      window.scrollTo({ top: 0 });
    };
    raiz.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => mostrar(b.dataset.p)));
    // Chart.js llega del CDN; si tarda, los gráficos del resumen se dibujan al llegar.
    const alListo = () => mostrar('resumen');
    if (window.Chart) alListo(); else window.addEventListener('chartjs-listo', alListo, { once: true });
    // Al imprimir se ven todas las páginas: se dibujan todos los gráficos antes.
    window.addEventListener('beforeprint', () => { for (const id in graficos) if (!dibujados[id] && window.Chart) { dibujados[id] = true; try { graficos[id](); } catch (e) {} } });

    // ── piezas ──
    function hero(v, l, s) { return '<div class="hero"><div class="hero-v">' + v + '</div><div class="hero-l">' + esc(l) + '</div><div class="hero-s">' + s + '</div></div>'; }
    function kpi(l, v, nn, hl) { return '<div class="kpi' + (hl ? ' hl' : '') + '"><div class="kpi-l">' + esc(l) + '</div><div class="kpi-v">' + v + '</div><div class="kpi-n">' + (nn || '') + '</div></div>'; }
    function soc(v, l) { return '<div class="soc-s"><div class="soc-v">' + v + '</div><div class="soc-l">' + esc(l) + '</div></div>'; }
    function tabla(cab, filas, numCols) {
      return '<div class="tabla-c"><table><thead><tr>' + cab.map((x, i) => '<th' + (numCols && numCols[i] ? ' class="n"' : '') + '>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + filas.join('') + '</tbody></table></div>';
    }
    function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
    function sumar(acc, x) { const o = { ...acc }; for (const k in x) o[k] = (o[k] || 0) + (x[k] || 0); return o; }
    function acento() { return getComputedStyle(document.documentElement).getPropertyValue('--v2-accent').trim() || '#007FC6'; }
    function barras(id, etiquetas, series, op) {
      const el = document.getElementById(id); if (!el) return;
      op = op || {};
      const fmt = (v) => op.plata ? plata(v) : num(v);
      new Chart(el, {
        type: 'bar',
        data: { labels: etiquetas, datasets: series.map(s => ({ label: s.label, data: s.data.map(v => v == null ? null : (op.log && v <= 0 ? null : v)), backgroundColor: s.color === 'acento' ? acento() : s.color, borderRadius: 4 })) },
        options: {
          indexAxis: op.horizontal ? 'y' : 'x', maintainAspectRatio: false, responsive: true,
          plugins: { legend: { display: series.length > 1, position: 'bottom', labels: { font: { family: 'DM Sans', size: 11 }, boxWidth: 10 } },
            tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + fmt(ctx.raw) } } },
          scales: {
            // En logarítmica, solo las potencias de 10: si no, el eje se llena de etiquetas.
            [op.horizontal ? 'x' : 'y']: { type: op.log ? 'logarithmic' : 'linear', grid: { color: 'rgba(10,42,70,.06)' },
              ticks: { font: { family: 'DM Mono', size: 10 }, autoSkip: true, maxTicksLimit: 6,
                callback: (v) => op.log && !/^1(0*)$/.test(String(Math.round(v))) ? '' : fmt(v) } },
            [op.horizontal ? 'y' : 'x']: { ticks: { font: { family: 'DM Sans', size: 11 } }, grid: { display: false } },
          },
        },
      });
    }
    function dona(id, etiquetas, datos, colores) {
      const el = document.getElementById(id); if (!el) return;
      new Chart(el, {
        type: 'doughnut',
        data: { labels: etiquetas, datasets: [{ data: datos, backgroundColor: colores || ['#5BB0E5', acento()], borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { family: 'DM Sans', size: 11 }, boxWidth: 10 } } } },
      });
    }
  };
})();
