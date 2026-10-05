// api/_busquedas.js — palabras negativas con la calidad del lead (punto 6)
//
// Google enseña por qué búsquedas apareció un anuncio y cuánto costó cada una.
// Lo que no sabe es si de esas búsquedas salió un cliente o un curioso. Esa
// mitad está en el CRM, y llega a Google de dos formas:
//
//   · Por término: si «Ventas a la pauta» está activo, Google recibe la venta
//     y las etapas del embudo como conversiones de Acuarius, y las reparte
//     por término de búsqueda. Así se ve qué búsquedas traen leads que nunca
//     avanzan.
//   · Por palabra clave: Google no da el término de un clic suelto, pero sí la
//     palabra clave (click_view). Cada lead con gclid la guarda, y se ve qué
//     palabras traen leads que se pierden.
//
// Comprobado contra dos cuentas reales el 03-10-2026. Una (Tierra de
// Mascotas) pagaba por «venta de perros pincher» y «eutanasia» siendo una
// funeraria. La otra (Certain) tenía TODOS los términos en 0 conversiones,
// marca incluida, con leads entrando al CRM: su medición en Google está rota.
// Juzgar por «0 conversiones» ahí habría propuesto excluir su propia marca.
// Por eso: si la cuenta no cuenta conversiones, no hay veredicto, solo una
// lista para revisar; y la marca y lo que ya es palabra clave nunca se proponen.
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

import { gaql, accesoGoogleDeFila, mutarGoogle } from './pauta.js';

const VACIAS = new Set(('de la el en y a los las del para por con un una que es se al lo como mas más sin sobre ' +
  'mi tu su sus mis cerca near me cuanto cuánto cuanta cuesta vale precio precios valor costo ' +
  'the of and for in to on with o u e ni le les nos este esta esto donde dónde cual cuál cómo hay ' +
  // Verbos y muletillas de cualquier búsqueda: no dicen de qué trata.
  'puedo puede pueden quiero busco necesito tengo hacer hace mejor mejores buen bueno buena hoy ahora aqui aquí ' +
  'cerca mas muy todo todos toda todas otro otra ver saber').split(/\s+/));

// La ñ se protege: sin esto «dueño» quedaba «dueno», y esa palabra no existe.
export function norm(s) {
  return String(s || '').toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const palabrasDe = (s) => norm(s).split(' ').filter(w => w.length >= 3 && !VACIAS.has(w) && !/^\d+$/.test(w));

/**
 * Decide qué proponer. Pura, para probarla sin Google.
 * @param o.terminos  [{ texto, estado, campanaId, campana, costo, clics, conv, crmCalif, crmVentas }]
 *                    estado: NONE | ADDED | EXCLUDED | ADDED_EXCLUDED (el de search_term_view)
 * @param o.claves    textos de las palabras clave positivas de la cuenta
 * @param o.negativas textos de las negativas que ya existen (cualquier nivel)
 * @param o.marca     textos que nombran el negocio (cuenta, cliente): nunca se proponen
 * @param o.crmActivo si Google recibe las etapas o ventas de Acuarius
 * @returns {{ modo, cpl, terminos, palabras }}
 */
export function analizarTerminos({ terminos = [], claves = [], negativas = [], marca = [], crmActivo = false } = {}) {
  const costoTotal = terminos.reduce((s, t) => s + t.costo, 0);
  const convTotal = terminos.reduce((s, t) => s + t.conv, 0);
  // Sin conversiones en toda la cuenta, «0 conversiones» en un término no dice
  // nada del término: dice que la medición no funciona.
  const modo = convTotal >= 1 ? 'conversiones' : 'gasto';
  const cpl = convTotal >= 1 ? costoTotal / convTotal : null;

  const enClaves = new Set(claves.flatMap(palabrasDe));
  const deMarca = new Set(marca.flatMap(palabrasDe));
  // Las negativas son de una campaña (o de toda la cuenta, si no dicen cuál):
  // «gratis» excluida en una campaña sigue entrando por las demás.
  const negs = negativas.map(x => typeof x === 'string' ? { texto: x, campanaId: null } : x)
    .map(x => ({ t: norm(x.texto), c: x.campanaId ? String(x.campanaId) : null }));
  const aplica = (x, campanaId) => !x.c || x.c === String(campanaId);
  const palabraNegada = (w, campanaId) => negs.some(x => aplica(x, campanaId) && x.t === w);
  // De la marca: trae TODAS sus palabras, o una distintiva. «Mascotas» en
  // «Tierra de Mascotas» no es distintiva —sale en palabras clave genéricas
  // como «cremación de mascotas cali»—; «certain» en Certain & Pezzano sí.
  // Cada nombre por separado: juntar el de la cuenta con el del cliente haría
  // que «todas sus palabras» no se cumpliera nunca.
  const clavesPal = claves.map(palabrasDe);
  const nombres = marca.map(palabrasDe).filter(ws => ws.length);
  const distintivas = new Set(nombres.flatMap(ws => ws.filter(w =>
    clavesPal.filter(k => k.includes(w)).every(k => k.some(o => o !== w && ws.includes(o))))));
  const esMarca = (texto) => {
    const ws = palabrasDe(texto);
    return nombres.some(nm => nm.every(w => ws.includes(w))) || ws.some(w => distintivas.has(w));
  };
  // Las palabras de un término que no salen en ninguna palabra clave: si no
  // hay ninguna, la búsqueda es de tu negocio y excluirla puede costar ventas.
  const ajenasDe = (texto) => palabrasDe(texto).filter(w => !enClaves.has(w));
  const yaNegativo = (texto, campanaId) => {
    const t = norm(texto), ws = palabrasDe(texto);
    return negs.some(x => aplica(x, campanaId) && (x.t === t || (!x.t.includes(' ') && ws.includes(x.t)) || (x.t.includes(' ') && (' ' + t + ' ').includes(' ' + x.t + ' '))));
  };

  // Un término «NONE» es una búsqueda que no es palabra clave ni está excluida.
  const libres = terminos.filter(t => t.estado === 'NONE' && !esMarca(t.texto) && !yaNegativo(t.texto, t.campanaId));

  const veredicto = (x) => {
    if (crmActivo && x.conv >= 2 && !x.crmCalif && !x.crmVentas && x.costo >= (cpl || 0)) {
      return { motivo: 'trajo ' + fmtConv(x.conv) + ' según Google, y ninguno avanzó en tu CRM', fuerte: true };
    }
    if (modo !== 'conversiones' || x.costo < cpl || x.clics < 2) return null;
    if (x.conv < 0.5) return { motivo: 'sin ninguna conversión', fuerte: true };
    if (x.costo / x.conv >= 3 * cpl) return { motivo: 'cada conversión le costó ' + Math.round(x.costo / x.conv / cpl * 10) / 10 + ' veces tu promedio', fuerte: false };
    return null;
  };

  const terminosOut = [];
  for (const t of libres) {
    const v = veredicto(t);
    if (v) terminosOut.push({ ...t, ...v, propia: !ajenasDe(t.texto).length });
  }
  terminosOut.sort((a, b) => b.costo - a.costo);

  // Palabras sueltas que se repiten en búsquedas ajenas: «gratis», «empleo»,
  // «venta». Excluirlas tapa de una vez todas las variantes. Nunca una palabra
  // que esté en una palabra clave: bloquearía el tráfico bueno.
  // Cada palabra se propone como la escribe la gente (con su tilde), la de la
  // búsqueda que más gastó: la versión sin tilde puede no tapar la real.
  const forma = new Map();
  for (const t of [...libres].sort((a, b) => b.costo - a.costo)) {
    for (const o of String(t.texto).toLowerCase().split(/\s+/)) {
      const k = norm(o);
      if (k && !forma.has(k)) forma.set(k, o.replace(/[^\p{L}\p{N}]+/gu, ''));
    }
  }
  const comoSeEscribe = (w) => w.split(' ').map(x => forma.get(x) || x).join(' ');
  const agg = new Map();
  for (const t of libres) {
    for (const w of new Set(palabrasDe(t.texto))) {
      if (enClaves.has(w) || deMarca.has(w) || palabraNegada(w, t.campanaId)) continue;
      if (!agg.has(w)) agg.set(w, { texto: w, costo: 0, clics: 0, conv: 0, crmCalif: 0, crmVentas: 0, ejemplos: [], campanas: new Map() });
      const a = agg.get(w);
      a.costo += t.costo; a.clics += t.clics; a.conv += t.conv; a.crmCalif += t.crmCalif || 0; a.crmVentas += t.crmVentas || 0;
      a.ejemplos.push(t);
      a.campanas.set(t.campanaId, t.campana);
    }
  }
  // Palabras que siempre van juntas («metro» y «cuadrado») salen como una
  // frase: «metro cuadrado». Excluir solo «metro» taparía «metro de Bogotá».
  const firma = (a) => a.ejemplos.map(e => e.campanaId + '|' + norm(e.texto)).sort().join('#');
  const grupos = new Map();
  for (const a of agg.values()) {
    const f = firma(a);
    if (!grupos.has(f)) grupos.set(f, []);
    grupos.get(f).push(a);
  }
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const ejemplo = palabrasDe(g[0].ejemplos[0].texto);
    const enOrden = g.map(a => a.texto).sort((x, y) => ejemplo.indexOf(x) - ejemplo.indexOf(y));
    // Solo si en el ejemplo van seguidas; si no, la frase no existe tal cual.
    const frase = enOrden.join(' ');
    const base = g[0];
    for (const a of g.slice(1)) agg.delete(a.texto);
    agg.delete(base.texto);
    if (norm(base.ejemplos[0].texto).includes(frase)) agg.set(frase, { ...base, texto: frase });
    else agg.set(base.texto, base);
  }
  const palabras = [];
  for (const a of agg.values()) {
    if (a.ejemplos.length < 2 && modo === 'conversiones') continue;   // una sola búsqueda ya sale como término
    const v = modo === 'conversiones' ? veredicto(a) : null;
    if (modo === 'conversiones' && !v) continue;
    a.ejemplos.sort((x, y) => y.costo - x.costo);
    palabras.push({
      texto: comoSeEscribe(a.texto), costo: a.costo, clics: a.clics, conv: a.conv, busquedas: a.ejemplos.length,
      ejemplos: a.ejemplos.slice(0, 3).map(e => e.texto),
      campanas: [...a.campanas].map(([id, nombre]) => ({ id, nombre })),
      ...(v || { motivo: null, fuerte: false }),
    });
  }
  palabras.sort((a, b) => b.costo - a.costo);
  // Sin medición no hay veredicto: se ordena por gasto y se limita, para revisar.
  return { modo, cpl, costoTotal, convTotal, terminos: terminosOut, palabras: modo === 'gasto' ? palabras.slice(0, 15) : palabras };
}

function fmtConv(n) {
  const r = Math.round(n * 10) / 10;
  return r + (r === 1 ? ' lead' : ' leads');
}

/**
 * Leads por palabra clave, con lo que pasó en el CRM. Los motivos de pérdida
 * son los del propio negocio («No era el perfil», «Corredor»…): se cuentan tal
 * cual, sin adivinar cuáles son «de calidad».
 */
export function calidadPorPalabra(leads) {
  const m = new Map();
  for (const l of leads) {
    const k = String(l.custom_fields?.['Palabra clave'] || '').trim();
    if (!k) continue;
    if (!m.has(k)) m.set(k, { palabra: k, leads: 0, ganados: 0, perdidos: 0, en_proceso: 0, motivos: {} });
    const x = m.get(k);
    x.leads++;
    const et = String(l.stage || '').toLowerCase();
    if (['ganado', 'won'].includes(et)) x.ganados++;
    else if (['perdido', 'lost', 'descartado'].includes(et)) {
      x.perdidos++;
      const mo = String(l.close_reason || 'Sin motivo').trim();
      x.motivos[mo] = (x.motivos[mo] || 0) + 1;
    } else x.en_proceso++;
  }
  return [...m.values()].map(x => ({
    ...x,
    motivos: Object.entries(x.motivos).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([motivo, n]) => ({ motivo, n })),
    // Se marca, no se decide: tres o más leads, ninguno ganado y la mayoría perdidos.
    flojo: x.leads >= 3 && !x.ganados && x.perdidos / x.leads >= 0.6,
  })).sort((a, b) => b.leads - a.leads);
}

// ── Google ──────────────────────────────────────────────────────────────────
const n = (v) => Number(v || 0);

/** Lee términos, palabras clave y negativas de una conexión de Google. */
export async function leerBusquedas(fila, desde, hasta) {
  const g = await accesoGoogleDeFila(fila);
  if (g.error) throw new Error(g.error);
  const q = (query) => gaql(g.cid, g.token, query, g.login);
  const rango = `segments.date BETWEEN '${desde}' AND '${hasta}'`;
  const [st, kw, negC, negG, negS, cli] = await Promise.all([
    q(`SELECT search_term_view.search_term, search_term_view.status, campaign.id, campaign.name, campaign.advertising_channel_type, ` +
      `metrics.cost_micros, metrics.clicks, metrics.conversions FROM search_term_view WHERE ${rango} AND metrics.clicks > 0`),
    q(`SELECT ad_group_criterion.keyword.text FROM keyword_view WHERE ad_group_criterion.status != 'REMOVED' AND campaign.status != 'REMOVED'`),
    q(`SELECT campaign.id, campaign_criterion.keyword.text FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = KEYWORD`),
    // Negativa de un grupo: se cuenta para su campaña (aproximación: tapa ese grupo, no todos).
    q(`SELECT campaign.id, ad_group_criterion.keyword.text FROM ad_group_criterion WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = KEYWORD`).catch(() => []),
    // Las listas compartidas de negativas cuentan igual: algo ya bloqueado ahí no se vuelve a proponer.
    q(`SELECT shared_criterion.keyword.text FROM shared_criterion WHERE shared_criterion.type = KEYWORD`).catch(() => []),
    q(`SELECT customer.currency_code FROM customer LIMIT 1`).catch(() => []),
  ]);

  // Un término sale una vez por grupo de anuncios: se suma por campaña.
  const por = new Map();
  for (const r of st) {
    if (r.campaign?.advertisingChannelType && r.campaign.advertisingChannelType !== 'SEARCH') continue;
    const k = r.campaign.id + '|' + norm(r.searchTermView.searchTerm);
    if (!por.has(k)) por.set(k, { texto: r.searchTermView.searchTerm, estado: r.searchTermView.status, campanaId: String(r.campaign.id), campana: r.campaign.name, costo: 0, clics: 0, conv: 0, crmCalif: 0, crmVentas: 0 });
    const t = por.get(k);
    t.costo += n(r.metrics?.costMicros) / 1e6; t.clics += n(r.metrics?.clicks); t.conv += n(r.metrics?.conversions);
    // Si en un grupo es palabra clave o ya está excluido, manda eso.
    if (r.searchTermView.status !== 'NONE') t.estado = r.searchTermView.status;
  }

  // Lo que el CRM le contó a Google: ventas y etapas de Acuarius, por término.
  const conv = fila.extra_data?.conversiones || {};
  const venta = conv.accion || null;
  const etapas = Object.values(conv.etapas || {}).filter(Boolean);
  let crmActivo = false, avisoCrm = null;
  if (venta || etapas.length) {
    try {
      const nombres = [venta, ...etapas].map(r => `'${String(r).replace(/'/g, '')}'`).join(',');
      const filas = await q(`SELECT search_term_view.search_term, campaign.id, segments.conversion_action, metrics.all_conversions ` +
        `FROM search_term_view WHERE ${rango} AND segments.conversion_action IN (${nombres})`);
      for (const r of filas) {
        const t = por.get(r.campaign.id + '|' + norm(r.searchTermView.searchTerm));
        if (!t) continue;
        if (r.segments.conversionAction === venta) t.crmVentas += n(r.metrics?.allConversions);
        else t.crmCalif += n(r.metrics?.allConversions);
      }
      crmActivo = true;
    } catch (e) {
      avisoCrm = 'No se pudo leer qué búsquedas trajeron leads que avanzaron en el CRM.';
    }
  }

  return {
    terminos: [...por.values()],
    claves: kw.map(r => r.adGroupCriterion?.keyword?.text).filter(Boolean),
    negativas: [
      ...negC.map(r => ({ texto: r.campaignCriterion?.keyword?.text, campanaId: r.campaign?.id })),
      ...negG.map(r => ({ texto: r.adGroupCriterion?.keyword?.text, campanaId: r.campaign?.id })),
      // Las listas compartidas se toman como de toda la cuenta: casi siempre se aplican a todas.
      ...negS.map(r => ({ texto: r.sharedCriterion?.keyword?.text, campanaId: null })),
    ].filter(x => x.texto),
    crmActivo, avisoCrm, moneda: cli[0]?.customer?.currencyCode || null,
  };
}

/** Lo que Google acepta como palabra negativa: hasta 80 caracteres y 10 palabras. */
export function limpiarNegativa(texto) {
  const t = String(texto || '').replace(/[^\p{L}\p{N} &'.-]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return { error: 'Falta el texto a excluir.' };
  if (t.length > 80 || t.split(' ').length > 10) return { error: 'Google acepta negativas de hasta 80 caracteres y 10 palabras.' };
  return { texto: t };
}

/**
 * Pone una negativa en una o varias campañas de la cuenta de `fila`. Solo
 * campañas de ESA cuenta: un id ajeno no se toca. La usan la pestaña
 * Búsquedas y la aprobación de una propuesta (reglas y Analista IA).
 * @returns {{ error } | { texto, resultados: [{ campana_id, campana, ok, dup, recurso, error }] }}
 */
export async function ponerNegativaEnRed(fila, campanaIds, texto, tipo) {
  const limpio = limpiarNegativa(texto);
  if (limpio.error) return { error: limpio.error };
  const match = tipo === 'PHRASE' ? 'PHRASE' : 'EXACT';
  const ids = [...new Set((campanaIds || []).map(x => String(x).replace(/\D/g, '')).filter(Boolean))].slice(0, 20);
  if (!ids.length) return { error: 'Falta la campaña.' };
  if (!fila || fila.platform !== 'google_ads') return { error: 'Las negativas son solo de Google Ads.' };
  const g = await accesoGoogleDeFila(fila);
  if (g.error) return { error: g.error };
  const propias = await gaql(g.cid, g.token, `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id IN (${ids.join(',')})`, g.login);
  const nombres = new Map(propias.map(r => [String(r.campaign.id), r.campaign.name]));
  const resultados = [];
  for (const id of ids) {
    if (!nombres.has(id)) { resultados.push({ campana_id: id, ok: false, error: 'Esa campaña no es de la cuenta conectada.' }); continue; }
    const r = await mutarGoogle(g.cid, g.h, 'campaignCriteria', {
      operations: [{ create: { campaign: `customers/${g.cid}/campaigns/${id}`, negative: true, keyword: { text: limpio.texto, matchType: match } } }],
    });
    const dup = !r.ok && /DUPLICATE|already exists|ya existe/i.test(r.error || '');
    resultados.push({
      campana_id: id, campana: nombres.get(id), ok: r.ok || dup, dup, recurso: r.datos?.results?.[0]?.resourceName || null,
      error: r.ok || dup ? null : 'Google no la aceptó: ' + String(r.error || '').slice(0, 160),
    });
  }
  return { texto: limpio.texto, tipo: match, resultados };
}
