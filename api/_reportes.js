// api/_reportes.js — reportes programados para clientes (punto 8)
//
// Una agencia le manda a cada cliente, cada semana, quincena o mes, lo que pasó
// con su pauta Y con sus leads: cuánto se invirtió, cuántos leads entraron al
// CRM, cuántos se volvieron venta, a qué costo, y qué se hizo en el período.
// Sale con la firma, el logo y el color de la agencia, y con un enlace a una
// página pública que congela los números del día en que se armó.
//
// El reporte de WhatsApp del panel de clientes hacía algo parecido con números
// escritos a mano, y guardaba en una tabla que nunca existió. Este no pide
// nada: lo arma todo con lo que Acuarius ya sabe.
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

import { conexionesDe, traerCampanas, leadsDelPeriodo, unir, claveDeLead } from './pauta.js';
import { emailHtml, esc } from './_email-layout.js';
import { enviarResend } from './_correo.js';
import { correoDelDueno } from './_alertas-pauta.js';
import { registrarUso } from './_uso-ia.js';
import { leerBusquedas, analizarTerminos, calidadPorPalabra } from './_busquedas.js';
import { metaDelPeriodo } from './_meta-reporte.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' en ' + ruta.split('?')[0]);
  return r.status === 204 ? null : r.json().catch(() => null);
}

export const MAX_DESTINATARIOS = 5;
// Programas por plan. Free no tiene: es una función de agencia.
export const TOPE_PROGRAMAS = { free: 0, pro: 2, trial: 50, agency: 50 };
// Sonnet y no Haiku: este texto lo firma la agencia ante su cliente. Haiku se
// inventaba acciones («ajustamos la distribución hacia Performance Max») que
// nadie hizo. Cuesta cerca de un centavo de dólar por reporte.
const MODELO_RESUMEN = 'claude-sonnet-5';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ── Fechas (todo en texto AAAA-MM-DD, hora de Colombia) ─────────────────────
export const hoyColombia = (ms = Date.now()) => new Date(ms - 5 * 3600000).toISOString().slice(0, 10);
const aFecha = (s) => new Date(s + 'T00:00:00Z');
const aTexto = (d) => d.toISOString().slice(0, 10);
const mas = (s, dias) => aTexto(new Date(aFecha(s).getTime() + dias * 86400000));
const finDeMes = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** El período cerrado que toca reportar hoy, y el anterior para comparar. Pura. */
export function periodoDe(frecuencia, hoy) {
  const d = aFecha(hoy);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dia = d.getUTCDate();
  const iso = (yy, mm, dd) => aTexto(new Date(Date.UTC(yy, mm, dd)));
  let desde, hasta, antDesde, antHasta;
  if (frecuencia === 'semanal') {
    const lunes = mas(hoy, -((d.getUTCDay() + 6) % 7));
    desde = mas(lunes, -7); hasta = mas(lunes, -1);
    antDesde = mas(desde, -7); antHasta = mas(desde, -1);
  } else if (frecuencia === 'quincenal') {
    if (dia >= 16) { desde = iso(y, m, 1); hasta = iso(y, m, 15); antDesde = iso(y, m - 1, 16); antHasta = iso(y, m, 0); }
    else { desde = iso(y, m - 1, 16); hasta = iso(y, m, 0); antDesde = iso(y, m - 1, 1); antHasta = iso(y, m - 1, 15); }
  } else {
    desde = iso(y, m - 1, 1); hasta = iso(y, m, 0);
    antDesde = iso(y, m - 2, 1); antHasta = iso(y, m - 1, 0);
  }
  return { desde, hasta, anterior: { desde: antDesde, hasta: antHasta }, etiqueta: etiquetaDe(frecuencia, desde, hasta) };
}

function etiquetaDe(frecuencia, desde, hasta) {
  const a = aFecha(desde), b = aFecha(hasta);
  if (frecuencia === 'mensual') return MESES[a.getUTCMonth()] + ' de ' + a.getUTCFullYear();
  const mismoMes = a.getUTCMonth() === b.getUTCMonth();
  return a.getUTCDate() + (mismoMes ? '' : ' de ' + MESES[a.getUTCMonth()]) + ' al ' + b.getUTCDate() + ' de ' + MESES[b.getUTCMonth()] + ' de ' + b.getUTCFullYear();
}

/** El siguiente día de envío, estrictamente después de `hoy`. Pura. */
export function proximoEnvio(frecuencia, hoy) {
  const d = aFecha(hoy);
  if (frecuencia === 'semanal') return mas(hoy, 7 - ((d.getUTCDay() + 6) % 7));
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dia = d.getUTCDate();
  if (frecuencia === 'quincenal' && dia < 16) return aTexto(new Date(Date.UTC(y, m, 16)));
  return aTexto(new Date(Date.UTC(y, m + 1, 1)));
}

// ── Los números ─────────────────────────────────────────────────────────────
const GANADAS = ['ganado', 'won'], PERDIDAS = ['perdido', 'lost', 'descartado'];

/** Totales de un período a partir de campañas (ya leídas) y leads. Pura. */
export function resumirPeriodo(campanas, leads) {
  const unidas = unir(campanas, leads).filas;
  // conv_red: lo que la red cuenta con su propia medición (en Google, la
  // columna «Conversiones»). No es lo mismo que un lead en el CRM, y el reporte
  // enseña las dos: sin ellas, al contrastar con Google Ads, parecía que
  // faltaban 231 conversiones (Certain, septiembre).
  const t = { inversion: 0, clics: 0, impresiones: 0, conv_red: 0, leads: leads.length, leads_pauta: 0, ganados: 0, ganados_pauta: 0,
    perdidos: 0, en_proceso: 0, ingresos: 0, ingresos_pauta: 0 };
  const red = {};
  for (const c of unidas) {
    t.inversion += c.inversion || 0; t.clics += c.clics || 0; t.impresiones += c.impresiones || 0; t.conv_red += c.conv || 0;
    const r = red[c.red] || (red[c.red] = { inversion: 0, leads: 0, ganados: 0, ingresos: 0 });
    r.inversion += c.inversion || 0; r.leads += c.crm?.leads || 0; r.ganados += c.crm?.ganados || 0; r.ingresos += c.crm?.ingresos || 0;
  }
  const fuentes = {};
  for (const l of leads) {
    const et = String(l.stage || '').toLowerCase();
    const dePauta = !!claveDeLead(l);
    if (dePauta) t.leads_pauta++;
    if (GANADAS.includes(et)) {
      t.ganados++; t.ingresos += Number(l.value || 0);
      if (dePauta) { t.ganados_pauta++; t.ingresos_pauta += Number(l.value || 0); }
    } else if (PERDIDAS.includes(et)) t.perdidos++;
    else t.en_proceso++;
    const f = String(l.source || 'Sin fuente').slice(0, 40);
    fuentes[f] = (fuentes[f] || 0) + 1;
  }
  // Sin inversión no hay costo: un «$0 por lead» parecería un logro.
  t.cpl_real = t.leads_pauta && t.inversion ? t.inversion / t.leads_pauta : null;
  t.costo_venta = t.ganados_pauta && t.inversion ? t.inversion / t.ganados_pauta : null;
  t.retorno = t.inversion ? t.ingresos_pauta / t.inversion : null;
  return {
    totales: t,
    por_red: red,
    campanas: unidas.filter(c => c.inversion > 0 || c.crm?.leads)
      .sort((a, b) => b.inversion - a.inversion).slice(0, 10)
      .map(c => ({ red: c.red, id: String(c.id || ''), nombre: c.nombre, inversion: c.inversion, clics: c.clics || 0, conv_red: c.conv || 0, leads: c.crm?.leads || 0, ganados: c.crm?.ganados || 0,
        ingresos: c.crm?.ingresos || 0, cpl_real: c.crm?.leads ? c.inversion / c.crm.leads : null })),
    fuentes: Object.entries(fuentes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([fuente, n]) => ({ fuente, n })),
  };
}

/**
 * ¿Entran las cuentas publicitarias sin cliente asignado? En una cuenta Pro
 * (un solo negocio, cliente implícito «pro_main») SÍ: son las suyas, y sin
 * ellas el reporte de Certain salía con inversión 0. En una agencia con varios
 * clientes NO: una cuenta sin asignar es casi siempre la de otro cliente.
 */
export async function incluyeSueltas(userId, clientId) {
  if (!clientId) return true;
  try {
    const [f] = await sb(`/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.__agency_clients__&select=profile_data&limit=1`) || [];
    return (f?.profile_data?.clients || []).length <= 1;
  } catch { return false; }
}

/** Todo lo que lleva el reporte de un período. */
export async function datosDelReporte(userId, clientId, per) {
  const conexiones = (await conexionesDe(userId, clientId, await incluyeSueltas(userId, clientId))).filter(c => c.account_id);
  const [resA, leadsA, resB, leadsB, acciones] = await Promise.all([
    traerCampanas(conexiones, per.desde, per.hasta),
    leadsDelPeriodo(userId, clientId, per.desde, per.hasta, null),
    traerCampanas(conexiones, per.anterior.desde, per.anterior.hasta),
    leadsDelPeriodo(userId, clientId, per.anterior.desde, per.anterior.hasta, null),
    sb(`/acciones_pauta?user_id=eq.${encodeURIComponent(userId)}&estado=eq.ejecutada` +
      (clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '') +
      `&decidida_at=gte.${per.desde}T05:00:00Z&decidida_at=lt.${mas(per.hasta, 1)}T05:00:00Z` +
      `&select=accion,red,campana,resultado,regla,detalle,decidida_at&order=decidida_at.asc&limit=30`).catch(() => []),
  ]);
  const actual = resumirPeriodo(resA.flatMap(r => r.filas), leadsA);
  const anterior = resumirPeriodo(resB.flatMap(r => r.filas), leadsB);

  // ── Versión 2: el reporte de agencia completo (ver el de Certain de agosto
  // 2026, hecho a mano). Cada pieza que falla se omite; el reporte sale igual.
  const google = await googleDelPeriodo(conexiones, resA, resB, per).catch(e => { console.error('[reportes] google', e?.message); return null; });
  const meta = [];
  for (const c of conexiones.filter(c => c.platform === 'meta_ads')) {
    try { meta.push(await metaDelPeriodo(c, per)); }
    catch (e) { console.error('[reportes] meta', e?.message); }
  }
  // «Contactos según las plataformas»: lo que cuentan Google y Meta con su
  // propia medición. NO son leads del CRM y nunca se suman a ellos.
  const contactos = (g, m) => ({ google: g, meta_conversaciones: m.conversaciones, meta_leads: m.leads, total: g + m.conversaciones + m.leads });
  const sumaMeta = (k) => meta.reduce((acc, x) => ({ conversaciones: acc.conversaciones + (x[k].conversaciones || 0), leads: acc.leads + (x[k].leads || 0) }), { conversaciones: 0, leads: 0 });
  return {
    version: 2,
    google, meta: meta.length ? meta : null,
    contactos: { actual: contactos(google?.totales.conv || 0, sumaMeta('totales')), anterior: contactos(google?.totales_anterior.conv || 0, sumaMeta('totales_anterior')) },
    palabras_clave_crm: calidadPorPalabra(leadsA).slice(0, 10),
    desde: per.desde, hasta: per.hasta, etiqueta: per.etiqueta, anterior_desde: per.anterior.desde, anterior_hasta: per.anterior.hasta,
    moneda: resA.flatMap(r => r.filas).find(f => f.moneda)?.moneda || null,
    actual, anterior: { totales: anterior.totales },
    // Una cuenta que no se pudo leer se dice en el reporte: sin esto, la
    // inversión saldría más baja de lo que fue y nadie sabría por qué.
    cuentas_sin_leer: resA.filter(r => r.error).map(r => r.conexion.account_name || r.conexion.account_id),
    hicimos: (acciones || []).map(a => ({
      accion: a.accion, red: a.red, campana: a.campana, texto: a.detalle?.texto || null,
      que: a.accion === 'pausar' ? 'Pausamos la campaña «' + a.campana + '»'
        : a.accion === 'bajar_presupuesto' ? 'Bajamos el presupuesto de «' + a.campana + '»'
        : a.accion === 'negativa' ? 'Excluimos las búsquedas con «' + (a.detalle?.texto || '') + '» en «' + a.campana + '»'
        : a.resultado,
    })),
    sin_conexiones: !conexiones.length,
    aviso_atribucion: avisoAtribucion(actual.totales),
  };
}

/**
 * Hubo inversión y casi ningún lead trae la campaña de origen: lo más probable
 * es que los leads de la pauta lleguen sin ese dato (UTM, gclid, formulario),
 * no que la pauta no traiga nada. Sin este aviso, el reporte de Certain le
 * habría dicho al cliente que cada lead de pauta costó 3 millones. Pura.
 */
export function avisoAtribucion(t) {
  return t.inversion > 0 && t.leads >= 20 && t.leads_pauta / t.leads < 0.05;
}

// ── El resumen, en palabras ─────────────────────────────────────────────────
const plata = (n, m) => {
  if (n == null) return '—';
  try { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: m || 'COP', maximumFractionDigits: 0 }).format(n); }
  catch { return '$' + Math.round(n).toLocaleString('es-CO'); }
};

/** Lo que el modelo ve: los números redondeados, sin imágenes. Pura. */
export function compactarParaIA(datos, nombre) {
  const r = (n) => n == null ? null : Math.round(n);
  const r1 = (n) => n == null ? null : Math.round(n * 10) / 10;
  const t = datos.actual.totales, a = datos.anterior.totales;
  const out = {
    cliente: nombre || null, periodo: datos.etiqueta, moneda: datos.moneda,
    contactos_segun_plataformas: datos.contactos ? { este_periodo: datos.contactos.actual, anterior: datos.contactos.anterior } : null,
    crm: {
      este_periodo: { leads: t.leads, leads_con_campana_de_pauta: t.leads_pauta, ventas: t.ganados, ventas_de_pauta: t.ganados_pauta, ingresos: r(t.ingresos), en_proceso: t.en_proceso, perdidos: t.perdidos },
      anterior: { leads: a.leads, ventas: a.ganados, ingresos: r(a.ingresos) },
      fuentes: datos.actual.fuentes,
      casi_ningun_lead_trae_campana: !!datos.aviso_atribucion,
      palabras_clave: (datos.palabras_clave_crm || []).slice(0, 6).map(p => ({ palabra: p.palabra, leads: p.leads, ganados: p.ganados, perdidos: p.perdidos, motivos: p.motivos })),
    },
    inversion_total: { este_periodo: r(t.inversion), anterior: r(a.inversion) },
    lo_que_hicimos: datos.hicimos.map(h => h.que),
    cuentas_sin_leer: datos.cuentas_sin_leer,
  };
  if (datos.google) {
    const g = datos.google;
    out.google = {
      totales: { ...g.totales, inversion: r(g.totales.inversion), ctr: g.totales.ctr && r1(g.totales.ctr * 100), cpc: r(g.totales.cpc), cpa: r(g.totales.cpa), conv: r1(g.totales.conv) },
      anterior: { inversion: r(g.totales_anterior.inversion), conv: r1(g.totales_anterior.conv), cpa: r(g.totales_anterior.cpa) },
      // Los leads que llegaron al CRM con esta campaña, al lado de las
      // conversiones que cuenta Google: si no se parecen, la campaña no es «lo
      // que funciona» sino algo a verificar (Certain: PMax 232 contra 1).
      campanas: g.campanas.slice(0, 8).map(c => ({ nombre: c.nombre, inversion: r(c.inversion), clics: c.clics, ctr_pct: c.ctr && r1(c.ctr * 100), conversiones: r1(c.conv), costo_por_conversion: r(c.cpa),
        leads_crm_con_esta_campana: (datos.actual.campanas.find(x => x.id === c.id) || {}).leads ?? 0,
        anterior: c.anterior ? { inversion: r(c.anterior.inversion), conversiones: r1(c.anterior.conv), costo_por_conversion: r(c.anterior.cpa) } : null })),
      busquedas: g.busquedas ? { modo: g.busquedas.modo, gasto_en_busquedas: r(g.busquedas.costo_busqueda), gastado_sin_resultado: r(g.busquedas.desperdicio),
        pct_sin_resultado: g.busquedas.pct && r1(g.busquedas.pct * 100),
        terminos: g.busquedas.terminos.slice(0, 8).map(x => ({ texto: x.texto, costo: r(x.costo), clics: x.clics, conv: r1(x.conv) })),
        palabras: g.busquedas.palabras.slice(0, 6).map(x => ({ texto: x.texto, costo: r(x.costo), ejemplos: x.ejemplos })) } : null,
    };
  }
  if (datos.meta) {
    out.meta = datos.meta.map(m => ({
      cuenta: m.cuenta, totales: m.totales, anterior: m.totales_anterior,
      capas: { marca: { ...m.capas.marca, cpm: r(m.capas.marca.cpm) }, captacion: { ...m.capas.captacion, cpm: r(m.capas.captacion.cpm) } },
      campanas: m.campanas.slice(0, 8).map(c => ({ nombre: c.nombre, capa: c.capa, inversion: r(c.inversion), alcance: c.alcance, conversaciones: c.conversaciones, leads: c.leads,
        costo_por_contacto: (c.conversaciones + c.leads) ? r(c.inversion / (c.conversaciones + c.leads)) : null, anterior: c.anterior ? { inversion: r(c.anterior.inversion), conversaciones: c.anterior.conversaciones } : null })),
      publicos: m.conjuntos.slice(0, 8).map(c => ({ nombre: c.nombre, inversion: r(c.inversion), conversaciones: c.conversaciones, leads: c.leads })),
      anuncios: m.anuncios.slice(0, 10).map(x => ({ nombre: x.nombre, inversion: r(x.inversion), conversaciones: x.conversaciones, leads: x.leads, ctr: r1(x.ctr), texto: x.texto })),
    }));
  }
  return out;
}

const HERRAMIENTA_REPORTE = {
  name: 'entregar_textos',
  description: 'Entrega los textos del reporte.',
  input_schema: {
    type: 'object',
    properties: {
      titular: { type: 'string', description: 'Una frase que resume el período, sin cifras inventadas.' },
      resumen: { type: 'string', description: 'Párrafo de 2 a 4 frases que abre el reporte. Puede usar **negritas**.' },
      conclusion: { type: 'string', description: 'Una o dos frases bajo la tabla comparativa: la lectura del período.' },
      conclusion_tono: { type: 'string', enum: ['bien', 'neutro', 'atencion'] },
      hallazgo: { type: 'object', properties: { titulo: { type: 'string' }, texto: { type: 'string' } }, description: 'El hallazgo más útil del período, si lo hay.' },
      destacados: { type: 'array', maxItems: 3, items: { type: 'object', properties: { titulo: { type: 'string' }, texto: { type: 'string' } }, required: ['titulo', 'texto'] } },
      google: { type: 'object', properties: { titular: { type: 'string' }, texto: { type: 'string' }, alerta: { type: 'string' }, busquedas: { type: 'string' } } },
      meta: { type: 'object', properties: { titular: { type: 'string' }, texto: { type: 'string' }, alerta: { type: 'string' } } },
      marca: { type: 'object', properties: { titular: { type: 'string' }, texto: { type: 'string' } } },
      anuncios: { type: 'object', properties: { titular: { type: 'string' }, texto: { type: 'string' } } },
      crm: { type: 'object', properties: { titular: { type: 'string' }, texto: { type: 'string' } } },
      funciona: { type: 'string', description: 'Lo que ya funciona, en una o dos frases.' },
      palanca: { type: 'string', description: 'La palanca más clara para el próximo período.' },
      falta: { type: 'string', description: 'El dato o la medición que falta.' },
      plan: { type: 'array', maxItems: 5, items: { type: 'object', properties: { titulo: { type: 'string' }, texto: { type: 'string' }, red: { type: 'string', enum: ['google', 'meta', 'crm', 'general'] } }, required: ['titulo', 'texto'] } },
    },
    required: ['titular', 'resumen', 'conclusion', 'plan'],
  },
};

/**
 * Los textos del reporte, con Sonnet. Los números y tablas los pinta la página
 * con los datos; el modelo solo escribe la lectura. null si no se pudo: el
 * reporte sale igual, con cifras y sin prosa.
 */
export async function narrativaIA({ datos, firma, nombre, userId }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const compacto = compactarParaIA(datos, nombre);
  // Sin el dato de campaña en los leads, «1 lead de pauta» es falso: no se le da.
  if (datos.aviso_atribucion) { delete compacto.crm.este_periodo.leads_con_campana_de_pauta; delete compacto.crm.este_periodo.ventas_de_pauta; }
  const sistema = 'Eres el estratega de cuenta de ' + (firma || 'una agencia de marketing') + ' y escribes los textos del reporte mensual de pauta para el cliente ' + (nombre || '') + '. ' +
    'Español de Latinoamérica, claro y concreto, para el dueño del negocio. Números al estilo de Colombia: punto para los miles y coma para los decimales (3.007.487 COP, 11,2 %). ' +
    'Reglas: ' +
    '1) Usa SOLO las cifras de los datos; nunca inventes una cifra, una causa ni una referencia del sector (no tienes datos del sector: no cites promedios de la industria). ' +
    '2) "contactos_segun_plataformas" es lo que cuentan Google y Meta con su propia medición; "crm" son los leads que de verdad entraron. No son lo mismo y nunca los sumes ni los presentes como lo mismo. ' +
    '3) Primera persona del plural solo para lo que hizo la agencia (la inversión y lo_que_hicimos). Si lo_que_hicimos está vacío, no digas que se ajustó u optimizó nada. Lo del CRM va en tercera persona. ' +
    '4) Si casi_ningun_lead_trae_campana es true, no juzgues la pauta por leads del CRM: dilo como algo que falta medir. ' +
    '5) Si busquedas.modo es "gasto", Google no está midiendo conversiones: es el problema prioritario. Si hay términos gastando sin resultado, el hallazgo es ese, con los términos y el monto. ' +
    '5b) Si una campaña tiene muchas conversiones de la plataforma y casi ningún lead en el CRM (leads_crm_con_esta_campana), NO la presentes como lo que funciona ni como la más eficiente: di que hay que verificar qué cuenta su etiqueta de conversión (puede estar contando clics a WhatsApp u otras acciones que no son contactos) y que parte de sus leads puede llegar sin el dato de campaña. ' +
    '6) El plan: 3 a 5 acciones concretas que salen de estos datos (excluir búsquedas listadas, mover presupuesto entre campañas que muestran resultados distintos, corregir la medición, conectar la captura de leads). Nada genérico. ' +
    '7) Omite las secciones sin datos (por ejemplo meta si no hay Meta). Frases cortas; puedes usar **negritas** en 1 o 2 cifras clave por párrafo.';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO_RESUMEN, max_tokens: 6000, system: sistema,
        tools: [HERRAMIENTA_REPORTE], tool_choice: { type: 'tool', name: HERRAMIENTA_REPORTE.name },
        messages: [{ role: 'user', content: 'Datos del período (JSON):\n' + JSON.stringify(compacto) }],
      }),
    });
    if (!r.ok) { console.error('[reportes] narrativa', r.status, (await r.text()).slice(0, 200)); return null; }
    const d = await r.json();
    if (d.usage) await registrarUso({ userId, actorId: null, origen: 'reporte', agente: 'Reporte', modelo: d.model, uso: d.usage });
    const b = (d.content || []).find(x => x.type === 'tool_use');
    if (!b || d.stop_reason === 'max_tokens') return null;
    return b.input;
  } catch (e) {
    console.error('[reportes] narrativa', e?.message);
    return null;
  }
}

// ── Guardar y enviar ────────────────────────────────────────────────────────
function token() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Arma el reporte de un programa y lo deja guardado. `vista` = no se envía. */
export async function armarReporte(programa, { hoy = hoyColombia(), vista = false } = {}) {
  const per = periodoDe(programa.frecuencia, hoy);
  const datos = await datosDelReporte(programa.user_id, programa.client_id, per);
  datos.marca = { firma: programa.firma || null, logo_url: programa.logo_url || null, color: programa.color || null, nombre: programa.nombre };
  // La prosa del reporte (titular, resumen, hallazgo, plan…). El resumen va
  // también en su propia columna: es lo que se edita antes de enviar.
  const narrativa = programa.incluir_ia && !datos.sin_conexiones
    ? await narrativaIA({ datos, firma: programa.firma, nombre: programa.nombre, userId: programa.user_id }) : null;
  if (narrativa) datos.narrativa = narrativa;
  const resumen = narrativa?.resumen ? String(narrativa.resumen).slice(0, 1500) : null;
  const [fila] = await sb('/reportes_enviados', {
    method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
    body: JSON.stringify({ token: token(), user_id: programa.user_id, client_id: programa.client_id || null, programa_id: programa.id || null,
      desde: per.desde, hasta: per.hasta, datos, resumen, estado: 'vista' }),
  }) || [];
  if (!fila) throw new Error('No se guardó el reporte');
  return fila;
}

// Si no se puede preguntar, no se envía: es la regla del bloqueo por abuso
// (ver api/cron-campaigns.js). Un reporte que no sale hoy sale mañana.
async function envioBloqueado(userId) {
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + encodeURIComponent(userId), { headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY } });
    if (!r.ok) return true;
    return !!(await r.json())?.public_metadata?.envio_bloqueado;
  } catch { return true; }
}

const flecha = (act, ant, menosEsMejor = false) => {
  if (act == null || ant == null || !ant) return '';
  const p = Math.round((act - ant) / ant * 100);
  if (!p) return '<span style="color:#5B6072">igual que antes</span>';
  const bien = menosEsMejor ? p < 0 : p > 0;
  return '<span style="color:' + (bien ? '#0E8A4F' : '#B4231F') + '">' + (p > 0 ? '▲ ' : '▼ ') + Math.abs(p) + ' %</span>';
};

/** El cuerpo del correo: cuatro cifras, el resumen y lo que se hizo. */
export function cuerpoDelCorreo(fila) {
  const d = fila.datos, t = d.actual.totales, a = d.anterior.totales, m = d.moneda;
  // 2 × 2 y no 4 en fila: en un teléfono las cuatro no caben y se cortan.
  const celda = (etq, val, var_) => '<td style="padding:10px 8px;border:1px solid #E4E6F2;border-radius:10px;text-align:center;width:50%">' +
    '<div style="font-size:11px;color:#5B6072">' + etq + '</div><div style="font-size:18px;font-weight:800;margin:4px 0">' + val + '</div>' +
    '<div style="font-size:11px">' + var_ + '</div></td>';
  const c = d.contactos;
  let html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:6px 0 14px"><tr>' +
    celda('Inversión', esc(plata(t.inversion, m)), flecha(t.inversion, a.inversion, false).replace(/#0E8A4F|#B4231F/, '#5B6072')) +
    // Versión 2: los contactos que cuentan las plataformas, aparte de los leads.
    (c ? celda('Contactos según Google y Meta', String(Math.round(c.actual.total)), flecha(c.actual.total, c.anterior.total)) + '</tr><tr>' : '') +
    celda('Leads en el CRM', String(t.leads), flecha(t.leads, a.leads)) +
    (c ? '' : '</tr><tr>') +
    celda('Ventas', String(t.ganados), flecha(t.ganados, a.ganados)) +
    (c ? '' : (d.aviso_atribucion ? celda('Ingresos', esc(plata(t.ingresos, m)), flecha(t.ingresos, a.ingresos))
      : celda('Costo por lead', esc(plata(t.cpl_real, m)), flecha(t.cpl_real, a.cpl_real, true)))) +
    '</tr></table>';
  // **negrita** de la IA → <b>, después de escapar.
  if (fila.resumen) html += '<p style="margin:0 0 14px;line-height:1.6">' + esc(fila.resumen).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</p>';
  if (d.hicimos.length) {
    html += '<p style="margin:14px 0 6px;font-weight:700">Lo que hicimos en el período</p><ul style="margin:0;padding-left:18px;line-height:1.6">' +
      d.hicimos.slice(0, 8).map(h => '<li>' + esc(h.que) + '</li>').join('') + '</ul>';
  }
  if (d.aviso_atribucion) {
    html += '<p style="margin:14px 0 0;font-size:12px;color:#7A4A08">Casi ningún lead de este período llegó con el dato de la campaña que lo trajo, así que todavía no podemos decir cuánto costó cada lead de la pauta. Estamos corrigiendo esa medición.</p>';
  }
  if (d.cuentas_sin_leer.length) {
    html += '<p style="margin:14px 0 0;font-size:12px;color:#B4231F">No pudimos leer ' + esc(d.cuentas_sin_leer.join(', ')) + ': su inversión no está en estas cifras.</p>';
  }
  return html;
}

/** Manda un reporte ya armado. Devuelve { ok } o { error }. Escribe el estado en la fila. */
export async function enviarReporte(fila, programa, destinatarios) {
  const marcar = (cambio) => sb(`/reportes_enviados?id=eq.${fila.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(cambio) }).catch(() => {});
  const para = (destinatarios || []).slice(0, MAX_DESTINATARIOS);
  if (!para.length) { await marcar({ estado: 'fallido', error: 'Sin destinatarios' }); return { error: 'El reporte no tiene destinatarios.' }; }
  if (await envioBloqueado(fila.user_id)) {
    await marcar({ estado: 'fallido', error: 'Envío bloqueado o no se pudo comprobar' });
    return { error: 'No se pudo enviar: el envío de correos de esta cuenta está detenido o no se pudo comprobar. Escríbenos a soporte.' };
  }
  const dueno = await correoDelDueno(fila.user_id);
  const firma = String(programa.firma || dueno?.nombre || 'Tu agencia').replace(/[<>"\\]/g, '').slice(0, 60);
  const d = fila.datos;
  const r = await enviarResend('reportes', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: firma + ' <reportes@app.acuarius.app>',
      to: para,
      // Si el cliente contesta, le contesta a la agencia, no a un buzón muerto.
      ...(dueno?.correo ? { reply_to: dueno.correo } : {}),
      subject: 'Resultados de ' + d.etiqueta + (programa.nombre ? ' · ' + programa.nombre : ''),
      html: emailHtml({
        titulo: 'Resultados de ' + esc(d.etiqueta),
        intro: esc(firma) + ' te comparte cómo les fue' + (programa.nombre ? ' a <b>' + esc(programa.nombre) + '</b>' : '') + ' en la pauta y en los leads que llegaron.',
        cuerpo: cuerpoDelCorreo(fila),
        cta: { texto: 'Ver el reporte completo', url: 'https://app.acuarius.app/r/' + fila.token },
        pie: 'Si tienes preguntas, responde este correo: le llega directamente a ' + esc(firma) + '.',
        preheader: esc(plata(d.actual.totales.inversion, d.moneda)) + ' invertidos · ' + d.actual.totales.leads + ' leads · ' + d.actual.totales.ganados + ' ventas',
        // Marca blanca: el correo es de la agencia. Sin logo, su nombre arriba.
        marca: { logo: programa.logo_url || null, color: programa.color || null, texto: esc(firma), blanca: true },
      }),
    }),
  }, fila.user_id);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    await marcar({ estado: 'fallido', error: ('Resend ' + r.status + ': ' + t).slice(0, 300), enviado_a: para });
    return { error: 'El correo no salió (' + r.status + '). Lo reintentamos en el próximo envío.' };
  }
  await marcar({ estado: 'enviado', enviado_a: para, error: null });
  return { ok: true };
}

/**
 * El reporte quedó armado y espera que la agencia lo revise: se le avisa al
 * dueño (con la marca de Acuarius: es un aviso nuestro, no del cliente).
 */
export async function avisarParaRevisar(fila, programa) {
  const dueno = await correoDelDueno(fila.user_id);
  if (!dueno) return { error: 'sin correo del dueño' };
  const d = fila.datos;
  const r = await enviarResend('reportes-revisar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Acuarius <crm@app.acuarius.app>',
      to: dueno.correo,
      subject: 'Revisa el reporte de ' + programa.nombre + ' antes de enviarlo',
      html: emailHtml({
        titulo: 'El reporte de ' + esc(programa.nombre) + ' está listo',
        intro: 'Ya armamos el reporte de ' + esc(d.etiqueta) + '. No le llega a tu cliente hasta que lo revises y lo apruebes.',
        cuerpo: cuerpoDelCorreo(fila),
        cta: { texto: 'Revisar y enviar', url: 'https://app.acuarius.app/?ir=pauta-reportes' },
        pie: 'Lo pediste así en el reporte programado. Si prefieres que salga solo, cámbialo en Plataformas de pauta → Reportes.',
        preheader: 'Para ' + (programa.destinatarios || []).join(', '),
      }),
    }),
  }, fila.user_id);
  return r.ok ? { ok: true } : { error: 'Resend ' + r.status };
}

/** Google en el período: campañas con su comparación y el hallazgo de búsquedas. */
async function googleDelPeriodo(conexiones, resA, resB, per) {
  const cons = conexiones.filter(c => c.platform === 'google_ads');
  if (!cons.length) return null;
  const filasA = resA.filter(r => r.conexion.platform === 'google_ads').flatMap(r => r.filas);
  const filasB = new Map(resB.filter(r => r.conexion.platform === 'google_ads').flatMap(r => r.filas).map(f => [String(f.id), f]));
  const cuenta = (f) => ({ inversion: f.inversion || 0, impresiones: f.impresiones || 0, clics: f.clics || 0, conv: f.conv || 0 });
  const derivadas = (x) => ({ ...x, ctr: x.impresiones ? x.clics / x.impresiones : null, cpc: x.clics ? x.inversion / x.clics : null, cpa: x.conv >= 0.5 ? x.inversion / x.conv : null });
  const campanas = filasA.filter(f => f.inversion > 0).sort((a, b) => b.inversion - a.inversion).map(f => {
    const b = filasB.get(String(f.id));
    return { id: String(f.id), nombre: f.nombre, estado: f.estado, ...derivadas(cuenta(f)), anterior: b ? derivadas(cuenta(b)) : null };
  });
  const tot = (ls) => derivadas(ls.reduce((s, x) => ({ inversion: s.inversion + x.inversion, impresiones: s.impresiones + x.impresiones, clics: s.clics + x.clics, conv: s.conv + x.conv }),
    { inversion: 0, impresiones: 0, clics: 0, conv: 0 }));
  // Las búsquedas que gastaron sin resultado: el hallazgo que una agencia
  // busca a mano en el informe de términos (punto 6, api/_busquedas.js).
  let busquedas = null;
  try {
    const partes = await Promise.all(cons.map(async c => ({ c, d: await leerBusquedas(c, per.desde, per.hasta) })));
    const terminos = partes.flatMap(p => p.d.terminos), claves = partes.flatMap(p => p.d.claves), negativas = partes.flatMap(p => p.d.negativas);
    const a = analizarTerminos({ terminos, claves, negativas, marca: cons.map(c => c.account_name).filter(Boolean), crmActivo: partes.some(p => p.d.crmActivo) });
    const costoBusqueda = terminos.reduce((s, t) => s + t.costo, 0);
    const sinResultado = a.terminos.filter(t => !t.propia);
    const desperdicio = sinResultado.reduce((s, t) => s + t.costo, 0);
    busquedas = {
      modo: a.modo, costo_busqueda: costoBusqueda, desperdicio, pct: costoBusqueda ? desperdicio / costoBusqueda : null,
      terminos: sinResultado.slice(0, 10).map(t => ({ texto: t.texto, campana: t.campana, costo: t.costo, clics: t.clics, conv: t.conv, motivo: t.motivo })),
      palabras: a.palabras.slice(0, 8).map(p => ({ texto: p.texto, costo: p.costo, clics: p.clics, conv: p.conv, busquedas: p.busquedas, ejemplos: p.ejemplos, motivo: p.motivo })),
    };
  } catch (e) { console.error('[reportes] busquedas', e?.message); }
  return { campanas, totales: tot(campanas), totales_anterior: tot([...filasB.values()].map(cuenta)), busquedas };
}
