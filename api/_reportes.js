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
const MODELO_RESUMEN = 'claude-haiku-4-5';
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
  const t = { inversion: 0, clics: 0, impresiones: 0, leads: leads.length, leads_pauta: 0, ganados: 0, ganados_pauta: 0,
    perdidos: 0, en_proceso: 0, ingresos: 0, ingresos_pauta: 0 };
  const red = {};
  for (const c of unidas) {
    t.inversion += c.inversion || 0; t.clics += c.clics || 0; t.impresiones += c.impresiones || 0;
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
      .map(c => ({ red: c.red, nombre: c.nombre, inversion: c.inversion, clics: c.clics || 0, leads: c.crm?.leads || 0, ganados: c.crm?.ganados || 0,
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
  return {
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

/** Tres o cuatro frases para el cliente, con Haiku. null si no se pudo: el reporte sale igual. */
export async function resumenIA({ datos, firma, nombre, userId }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const t = datos.actual.totales, a = datos.anterior.totales;
  const compacto = {
    periodo: datos.etiqueta, moneda: datos.moneda,
    este_periodo: { inversion: Math.round(t.inversion), leads_crm: t.leads, leads_de_pauta: t.leads_pauta, ventas: t.ganados, ventas_de_pauta: t.ganados_pauta,
      ingresos_de_pauta: Math.round(t.ingresos_pauta), costo_por_lead: t.cpl_real && Math.round(t.cpl_real), en_proceso: t.en_proceso, perdidos: t.perdidos },
    periodo_anterior: { inversion: Math.round(a.inversion), leads_crm: a.leads, leads_de_pauta: a.leads_pauta, ventas: a.ganados, costo_por_lead: a.cpl_real && Math.round(a.cpl_real) },
    campanas: datos.actual.campanas.slice(0, 6).map(c => ({ nombre: c.nombre, red: c.red, inversion: Math.round(c.inversion), leads: c.leads, ventas: c.ganados })),
    lo_que_hicimos: datos.hicimos.map(h => h.que),
    cuentas_sin_leer: datos.cuentas_sin_leer,
    casi_ningun_lead_trae_campana: datos.aviso_atribucion,
  };
  // Sin el dato de campaña en los leads, «1 lead de pauta» es falso, y la
  // instrucción de no usarlo no bastó: Haiku lo citaba igual. No se le da.
  if (datos.aviso_atribucion) {
    for (const k of ['leads_de_pauta', 'ventas_de_pauta', 'ingresos_de_pauta', 'costo_por_lead']) { delete compacto.este_periodo[k]; delete compacto.periodo_anterior[k]; }
    compacto.campanas = compacto.campanas.map(({ nombre, red, inversion }) => ({ nombre, red, inversion }));
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO_RESUMEN, max_tokens: 700,
        system: 'Eres el ejecutivo de cuenta de ' + (firma || 'una agencia de marketing') + '. Escribes el párrafo con el que abre el reporte de resultados para el cliente ' +
          (nombre || '') + '. Tres o cuatro frases, en español de Latinoamérica, claras y directas. ' +
          'Primera persona del plural ("invertimos", "ajustamos", "excluimos") SOLO para lo que hizo la agencia: la inversión y lo_que_hicimos. ' +
          'Lo que pasó en el CRM va en tercera persona ("llegaron 456 leads", "se cerraron 11 ventas"): no es mérito ni culpa de la pauta salvo lo que viene de ella. ' +
          'Usa solo los números que te doy: compara con el período anterior, destaca lo mejor y lo que hay que vigilar, y si hubo acciones, menciónalas. ' +
          'Distingue lo que viene de la pauta (leads_de_pauta, ventas_de_pauta) del total del CRM, que incluye referidos, portales y otras fuentes: ' +
          'no te atribuyas ("logramos") cambios del total que no vienen de la pauta; preséntalos como lo que pasó en el CRM. Si no hubo inversión en pauta, dilo. ' +
          'Si casi_ningun_lead_trae_campana es true, NO concluyas que la pauta no funciona ni cites su costo por lead: di que los leads están llegando sin el dato de la campaña de origen y que eso se está corrigiendo para medirla bien. ' +
          'Nunca inventes cifras ni causas. Montos con separador de miles y su moneda. Sin saludo, sin despedida, sin títulos, sin viñetas ni markdown.',
        messages: [{ role: 'user', content: JSON.stringify(compacto) }],
      }),
    });
    if (!r.ok) { console.error('[reportes] resumen', r.status); return null; }
    const d = await r.json();
    if (d.usage) await registrarUso({ userId, actorId: null, origen: 'reporte', agente: 'Reporte', modelo: d.model, uso: d.usage });
    const texto = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return d.stop_reason === 'max_tokens' || !texto ? null : texto.slice(0, 1200);
  } catch (e) {
    console.error('[reportes] resumen', e?.message);
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
  const resumen = programa.incluir_ia && !datos.sin_conexiones
    ? await resumenIA({ datos, firma: programa.firma, nombre: programa.nombre, userId: programa.user_id }) : null;
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
  let html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:6px 0 14px"><tr>' +
    celda('Inversión', esc(plata(t.inversion, m)), flecha(t.inversion, a.inversion, false).replace(/#0E8A4F|#B4231F/, '#5B6072')) +
    celda('Leads en el CRM', String(t.leads), flecha(t.leads, a.leads)) +
    '</tr><tr>' +
    celda('Ventas', String(t.ganados), flecha(t.ganados, a.ganados)) +
    (d.aviso_atribucion ? celda('Ingresos', esc(plata(t.ingresos, m)), flecha(t.ingresos, a.ingresos))
      : celda('Costo por lead', esc(plata(t.cpl_real, m)), flecha(t.cpl_real, a.cpl_real, true))) +
    '</tr></table>';
  if (fila.resumen) html += '<p style="margin:0 0 14px;line-height:1.6">' + esc(fila.resumen) + '</p>';
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
