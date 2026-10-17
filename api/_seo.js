// api/_seo.js — Proyecto SEO: lo que no toca la red.
//
// Normalizar dominios, leer una respuesta de IA (¿menciona la marca? ¿cita la
// web?), la plantilla de configuración on-page inicial del cronograma y las
// fechas de medición. Probado en pruebas/seo-proyectos.mjs. Solo se importa
// desde funciones edge.

export const MAX_KEYWORDS = 200;
export const MAX_PREGUNTAS = 15;
export const MAX_COMPETIDORES = 8;
export const CORRIDAS_GEO = 3;
export const MOTORES = ['claude', 'gemini', 'chatgpt', 'perplexity'];
export const CATEGORIAS = ['onpage', 'tecnico', 'contenido', 'enlaces', 'local', 'geo', 'analitica', 'otro'];
export const ESTADOS = ['pendiente', 'en_curso', 'hecha'];

export function dominio(x) {
  return String(x || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/\.$/, '');
}

// «certainpezzano.com» → «certainpezzano». Lo que se busca en el texto.
export function nombreBase(x) {
  return dominio(x).split('.')[0];
}

const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Términos con los que se reconoce la marca: el nombre base del dominio y la
// marca escrita, con y sin espacios («Certain & Pezzano», «certainpezzano»).
export function terminosMarca(dom, marca) {
  const out = new Set();
  const base = nombreBase(dom);
  if (base.length > 2) out.add(base);
  const m = sinTildes(marca).trim();
  if (m.length > 2) {
    out.add(m);
    const pegada = m.replace(/[^a-z0-9ñ]/g, '');
    if (pegada.length > 2) out.add(pegada);
    const conY = m.replace(/\s*&\s*/g, ' y ');
    if (conY !== m) out.add(conY);
  }
  return [...out];
}

// Lee una respuesta de IA. `citas`: URLs que la IA dio como fuente (solo
// algunos motores, p. ej. Perplexity). Mencionada ≠ citada: una IA puede
// enlazar la web sin nombrar la marca, o nombrarla sin enlazarla.
export function leerRespuesta(texto, { dominio: dom, marca, competidores = [] }, citas = []) {
  const t = sinTildes(texto);
  const plano = t.replace(/[^a-z0-9ñ]/g, '');
  const primera = (terms) => {
    let idx = -1;
    for (const term of terms) {
      let i = t.indexOf(term);
      if (i < 0) { const p = plano.indexOf(term.replace(/[^a-z0-9ñ]/g, '')); if (p >= 0) i = Math.round(p * (t.length / Math.max(plano.length, 1))); }
      if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    }
    return idx;
  };
  const iMarca = primera(terminosMarca(dom, marca));
  const entidades = iMarca >= 0 ? [{ quien: '__marca', i: iMarca }] : [];
  const encontrados = [];
  for (const c of competidores) {
    const term = nombreBase(c);
    if (term.length < 3) continue;
    const i = t.indexOf(term);
    if (i >= 0) { entidades.push({ quien: c, i }); encontrados.push(dominio(c)); }
  }
  entidades.sort((a, b) => a.i - b.i);
  const urls = (citas || []).map(u => String(u || '')).filter(Boolean).slice(0, 20);
  const propio = dominio(dom);
  const citada = urls.length ? urls.some(u => dominio(u) === propio || dominio(u).endsWith('.' + propio)) : null;
  let fragmento = null;
  if (iMarca >= 0) {
    const ini = Math.max(0, iMarca - 90);
    fragmento = (ini > 0 ? '…' : '') + String(texto || '').slice(ini, iMarca + 140).replace(/\s+/g, ' ').trim() + '…';
  }
  return {
    mencionada: iMarca >= 0,
    citada,
    posicion: iMarca >= 0 ? entidades.findIndex(e => e.quien === '__marca') + 1 : null,
    competidores: encontrados,
    citas: urls,
    fragmento,
  };
}

// ── Fechas ──────────────────────────────────────────────────────────────────
// En hora de Colombia: un cliente que mira el lunes temprano no puede ver «la
// semana pasada» porque en UTC ya es martes.
export function hoyCO(ahora = new Date()) {
  return new Date(ahora.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
export function periodoCO(ahora = new Date()) {
  return hoyCO(ahora).slice(0, 7);
}
// ¿Toca medir posiciones? Cada 7 días.
export function tocaMedirPosiciones(ultimaFecha, ahora = new Date()) {
  if (!ultimaFecha) return true;
  const dias = (Date.parse(hoyCO(ahora)) - Date.parse(ultimaFecha)) / 86400000;
  return dias >= 7;
}

// ── Plantilla de configuración on-page inicial ──────────────────────────────
// Lo que se configura al empezar con un cliente. Va al cronograma del primer
// mes; se marca a medida que se hace y el cliente ve el avance.
export const PLANTILLA_INICIAL = [
  ['analitica', 'Search Console verificado y sitemap enviado', 'Propiedad de dominio verificada en Google Search Console y sitemap.xml enviado.'],
  ['analitica', 'Google Analytics 4 con conversiones', 'GA4 instalado (idealmente por Google Tag Manager) y las conversiones del sitio marcadas: formularios, WhatsApp, llamadas.'],
  ['analitica', 'Canal de asistentes de IA en GA4', 'Agrupación de canales que separa el tráfico que llega desde ChatGPT, Gemini, Perplexity, Copilot y Claude.'],
  ['tecnico', 'Indexación y robots.txt', 'Revisar que las páginas importantes estén indexadas, que robots.txt no bloquee nada clave y que los rastreadores de IA (GPTBot, PerplexityBot, Google-Extended) tengan el acceso decidido.'],
  ['tecnico', 'Velocidad y Core Web Vitals', 'Medir LCP, INP y CLS en móvil y corregir lo que esté en rojo (imágenes, scripts, fuentes).'],
  ['tecnico', 'HTTPS, redirecciones y errores 404', 'Una sola versión del dominio (con o sin www) por 301, sin cadenas de redirecciones ni enlaces rotos.'],
  ['tecnico', 'Datos estructurados (schema)', 'Organización o negocio local, productos o servicios, preguntas frecuentes y artículos, según el sitio.'],
  ['onpage', 'Títulos y meta descripciones', 'Un título y una descripción únicos por página, con la keyword principal de su clúster.'],
  ['onpage', 'Encabezados H1–H3', 'Un solo H1 por página y una jerarquía clara que responda a la intención de búsqueda.'],
  ['onpage', 'URLs limpias y enlazado interno', 'URLs cortas y descriptivas; cada página pilar enlaza a sus páginas del clúster y viceversa.'],
  ['onpage', 'Imágenes optimizadas', 'Peso reducido (WebP), dimensiones definidas y texto alternativo descriptivo.'],
  ['contenido', 'Mapa de clústeres temáticos', 'Clústeres definidos con su página pilar y sus keywords principales.'],
  ['geo', 'Preguntas para medir la presencia en IAs', 'Preguntas que haría un cliente real en ChatGPT, Gemini, Claude y Perplexity, para medir cada mes si aparece la marca.'],
  ['local', 'Perfil de Google Business', 'Perfil completo y verificado: categorías, horarios, fotos, servicios y reseñas (si el negocio atiende en una zona).'],
];

export function accionesIniciales(proyectoId, inicio, creadoPor = null) {
  const mes = String(inicio || hoyCO()).slice(0, 7);
  return PLANTILLA_INICIAL.map(([categoria, titulo, detalle], i) => ({
    proyecto_id: proyectoId, mes, categoria, titulo, detalle, orden: i, plantilla: 'inicial-' + i,
    estado: 'pendiente', visible_cliente: true, creado_por: creadoPor,
  }));
}

// Una fecha del blob viejo: a veces texto ISO, a veces milisegundos.
export function isoDe(x, otra = null) {
  if (x == null || x === '') return otra;
  const d = typeof x === 'number' || /^\d{10,}$/.test(String(x)) ? new Date(Number(x)) : new Date(x);
  return isNaN(d) ? otra : d.toISOString();
}

// Del blob viejo (user_profiles 'seo-project') a filas nuevas. Puro: devuelve
// lo que hay que insertar; quien llama le pone los ids.
export function desdeBlob(b) {
  const kws = (b?.keywords || []).filter(k => k?.kw).map(k => ({
    kw: String(k.kw).trim(),
    historial: Object.entries(k.history || {}).filter(([, h]) => h)
      .map(([mes, h]) => ({ fecha: (isoDe(h.checkedAt) || mes + '-01').slice(0, 10), pos: h.pos ?? null, url: h.url || null }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    top: k.top || null,
  }));
  const preguntas = (b?.geoQueries || []).filter(q => q?.q).map(q => String(q.q).trim());
  const geo = [];
  for (const [periodo, h] of Object.entries(b?.geoHistory || {})) {
    for (const r of (h?.results || [])) {
      if (!r?.query || !r?.engine) continue;
      geo.push({ pregunta: r.query, periodo, motor: r.engine, corrida: 1, mencionada: r.error ? null : !!r.mentioned,
        posicion: r.rank ?? null, competidores: r.competitorsFound || [], fragmento: r.snippet || null, error: r.error || null });
    }
  }
  const acciones = (b?.actions || []).filter(a => a?.text).map(a => ({
    titulo: String(a.text).slice(0, 300), estado: a.done ? 'hecha' : 'pendiente',
    mes: (isoDe(a.createdAt) || isoDe(b.createdAt) || new Date().toISOString()).slice(0, 7),
  }));
  return { kws, preguntas, geo, acciones };
}
