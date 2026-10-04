// api/_alertas-pauta.js — lo que se rompió AYER en la pauta, dicho a primera hora
//
// El Diagnóstico de Plataformas de pauta mira 30 días y espera a que alguien
// lo abra. Esto mira lo que cambió de un día para otro y lo manda por correo:
// una campaña que dejó de entregar, un gasto que se disparó, un costo por lead
// real que se duplicó o dos días gastando sin que entre un lead al CRM. Es lo
// que hacen Optmyzr, Madgicx o Bïrch; la diferencia es que aquí «lead» es el
// que llegó al CRM, no la conversión que reporta la red.
//
// Solo LEE. No pausa ni toca presupuestos: avisa y enlaza al Diagnóstico.
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

import { conexionesDe, traerCampanas, leadsDelPeriodo, unir } from './pauta.js';
import { emailHtml, bloque, esc } from './_email-layout.js';
import { enviarResend } from './_correo.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });

// Los mismos objetivos que el Diagnóstico: a una campaña de tráfico o de
// alcance no se le reprocha que no traiga leads.
const OBJETIVOS_SIN_LEADS = new Set(['OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'LINK_CLICKS', 'REACH', 'BRAND_AWARENESS', 'VIDEO_VIEWS', 'POST_ENGAGEMENT']);
export const UMBRAL = {
  vecesGasto: 2,        // ayer gastó más del doble del promedio diario de la semana
  vecesCpl: 2,          // el CPL real de los últimos 2 días, más del doble del de la semana
  leadsMinimos: 3,      // con menos leads en la semana, un CPL no dice nada
  cplsSinLeads: 2,      // 2 días sin leads tras gastar lo que costarían 2 leads
  silencioDias: 3,      // la misma alerta no se repite antes de 3 días
};

const activa = e => ['enabled', 'active'].includes(String(e || '').toLowerCase());
const buscaLeads = c => !(c.red === 'meta' && OBJETIVOS_SIN_LEADS.has(String(c.objetivo || '').toUpperCase()));
const plata = (n, m) => {
  try { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: m || 'COP', maximumFractionDigits: 0 }).format(n); }
  catch { return '$' + Math.round(n).toLocaleString('es-CO'); }
};

/**
 * Decide las alertas de un conjunto de campañas. Pura: recibe los números y
 * devuelve la lista, para poder probarla sin red.
 *
 * @param campanas [{ red, id, nombre, estado, objetivo, moneda,
 *                    semana: {inv, leads},   // los 7 días antes de anteayer
 *                    ayer:   {inv, leads},
 *                    dos:    {inv, leads} }] // anteayer + ayer
 */
export function alertasDeCampanas(campanas) {
  const out = [];
  for (const c of campanas) {
    const promDia = (c.semana?.inv || 0) / 7;
    const ayer = c.ayer || { inv: 0, leads: 0 };
    const dos = c.dos || { inv: 0, leads: 0 };
    const semLeads = c.semana?.leads || 0;
    const cplSemana = semLeads >= UMBRAL.leadsMinimos ? c.semana.inv / semLeads : null;
    const base = { red: c.red, campana_id: c.id, campana: c.nombre, moneda: c.moneda || null };

    // 1. Dejó de entregar: gastó la semana, gastó anteayer y ayer, cero.
    const anteayer = Math.max(0, dos.inv - ayer.inv);
    if (activa(c.estado) && promDia > 0 && anteayer > 0 && ayer.inv === 0) {
      out.push({ ...base, tipo: 'detenida', gravedad: 'alta',
        titulo: '«' + c.nombre + '» dejó de entregar ayer',
        detalle: 'Está activa y venía gastando unos ' + plata(promDia, c.moneda) + ' al día, pero ayer no gastó nada. ' +
          'Suele ser un anuncio rechazado, un pago que no pasó o el presupuesto agotado: revísala en la plataforma.' });
      continue;   // sin gasto no hay más que decir de ella
    }
    // 2. Gasto disparado.
    if (promDia > 0 && ayer.inv > promDia * UMBRAL.vecesGasto) {
      out.push({ ...base, tipo: 'gasto', gravedad: 'media',
        titulo: '«' + c.nombre + '» gastó ' + (ayer.inv / promDia).toFixed(1).replace('.', ',') + ' veces lo normal ayer',
        detalle: 'Ayer: ' + plata(ayer.inv, c.moneda) + '. Promedio diario de la semana anterior: ' + plata(promDia, c.moneda) + '.' +
          (ayer.leads ? ' Trajo ' + ayer.leads + (ayer.leads === 1 ? ' lead.' : ' leads.') : ' No trajo ningún lead al CRM.') });
    }
    if (!buscaLeads(c) || !cplSemana) continue;
    // 3. Gasta sin traer leads (con historial de que sí los traía).
    if (dos.leads === 0 && dos.inv >= cplSemana * UMBRAL.cplsSinLeads) {
      out.push({ ...base, tipo: 'sin_leads', gravedad: 'alta',
        titulo: '«' + c.nombre + '» lleva 2 días gastando sin traer leads',
        detalle: 'Gastó ' + plata(dos.inv, c.moneda) + ' entre anteayer y ayer y no entró ningún lead al CRM. ' +
          'La semana anterior cada lead le costaba ' + plata(cplSemana, c.moneda) + '.' });
      continue;
    }
    // 4. CPL real disparado.
    if (dos.leads > 0 && dos.inv / dos.leads > cplSemana * UMBRAL.vecesCpl) {
      out.push({ ...base, tipo: 'cpl', gravedad: 'media',
        titulo: 'Cada lead de «' + c.nombre + '» cuesta ' + ((dos.inv / dos.leads) / cplSemana).toFixed(1).replace('.', ',') + ' veces más',
        detalle: 'Últimos 2 días: ' + plata(dos.inv / dos.leads, c.moneda) + ' por lead (' + dos.leads + (dos.leads === 1 ? ' lead' : ' leads') + '). ' +
          'Semana anterior: ' + plata(cplSemana, c.moneda) + ' por lead.' });
    }
  }
  return out;
}

// ── Fechas ──────────────────────────────────────────────────────────────────
// En hora de Colombia: «ayer» es el día del cliente, no el de UTC.
export function dias(ahora = new Date()) {
  const f = (d) => new Date(d.getTime() - 5 * 3600000).toISOString().slice(0, 10);
  const D = 86400000;
  return { ayer: f(new Date(ahora - D)), anteayer: f(new Date(ahora - 2 * D)), semanaDesde: f(new Date(ahora - 9 * D)), semanaHasta: f(new Date(ahora - 3 * D)), hoy: f(ahora) };
}

// La semana es la de ANTES de los dos días que se miran: si la incluyera, el
// día raro se compararía consigo mismo.
function contarLeads(leads, desde, hasta) {
  return leads.filter(l => { const d = String(l.created_at).slice(0, 10); return d >= desde && d <= hasta; });
}

/** Las alertas de una cuenta (o de un cliente). */
export async function alertasDeCuenta(userId, clientId) {
  const d = dias();
  const conexiones = (await conexionesDe(userId, clientId, true)).filter(c => c.account_id);
  if (!conexiones.length) return { alertas: [], revisadas: 0 };
  const [semana, ayer, dos, leads] = await Promise.all([
    traerCampanas(conexiones, d.semanaDesde, d.semanaHasta),
    traerCampanas(conexiones, d.ayer, d.ayer),
    traerCampanas(conexiones, d.anteayer, d.ayer),
    leadsDelPeriodo(userId, clientId, d.semanaDesde, d.ayer, null),
  ]);
  const unirPeriodo = (res, desde, hasta) => {
    const camp = res.flatMap(r => r.filas);
    return new Map(unir(camp, contarLeads(leads, desde, hasta)).filas.map(f => [f.red + ':' + f.id, f]));
  };
  const S = unirPeriodo(semana, d.semanaDesde, d.semanaHasta);
  const A = unirPeriodo(ayer, d.ayer, d.ayer);
  const D2 = unirPeriodo(dos, d.anteayer, d.ayer);
  const claves = new Set([...S.keys(), ...A.keys(), ...D2.keys()]);
  const campanas = [...claves].map(k => {
    const s = S.get(k), a = A.get(k), x = D2.get(k);
    const ref = a || x || s;
    return {
      red: ref.red, id: ref.id, nombre: ref.nombre, estado: ref.estado, objetivo: ref.objetivo, moneda: ref.moneda,
      semana: { inv: s?.inversion || 0, leads: s?.crm?.leads || 0 },
      ayer: { inv: a?.inversion || 0, leads: a?.crm?.leads || 0 },
      dos: { inv: x?.inversion || 0, leads: x?.crm?.leads || 0 },
    };
  });
  return { alertas: alertasDeCampanas(campanas), revisadas: campanas.length };
}

// ── Registro y correo ───────────────────────────────────────────────────────
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' en ' + ruta.split('?')[0]);
  return r.status === 204 ? null : r.json().catch(() => null);
}

/** Quita las que ya se avisaron en los últimos días y guarda las nuevas. */
export async function registrarNuevas(userId, clientId, alertas) {
  if (!alertas.length) return [];
  const desde = new Date(Date.now() - UMBRAL.silencioDias * 86400000).toISOString();
  const previas = await sb(`/alertas_pauta?user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(desde)}&select=clave`) || [];
  const ya = new Set(previas.map(p => p.clave));
  const nuevas = alertas.map(a => ({ ...a, clave: a.tipo + ':' + a.red + ':' + a.campana_id })).filter(a => !ya.has(a.clave));
  if (nuevas.length) {
    await sb('/alertas_pauta', {
      method: 'POST', headers: sbH({ Prefer: 'return=minimal' }),
      body: JSON.stringify(nuevas.map(a => ({
        user_id: userId, client_id: clientId || null, clave: a.clave, tipo: a.tipo, gravedad: a.gravedad,
        red: a.red, campana_id: a.campana_id, campana: a.campana, titulo: a.titulo, detalle: a.detalle,
      }))),
    });
  }
  return nuevas;
}

async function correoDelDueno(userId) {
  const r = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'User-Agent': 'Acuarius/1.0' },
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const u = await r.json().catch(() => null);
  const p = (u?.email_addresses || []).find(e => e.id === u.primary_email_address_id) || (u?.email_addresses || [])[0];
  return p?.email_address ? { correo: p.email_address, nombre: u.first_name || '' } : null;
}

// `acciones` son las de las reglas (api/_reglas-pauta.js): propuestas que
// esperan aprobación, avisos, o lo que una regla automática ya hizo.
export async function mandarResumen(userId, alertas, acciones = []) {
  if (!alertas.length && !acciones.length) return { enviado: false, motivo: 'sin alertas' };
  const dest = await correoDelDueno(userId);
  if (!dest) return { enviado: false, motivo: 'sin correo del dueño' };
  const graves = alertas.filter(a => a.gravedad === 'alta').length;
  const red = (r) => '<br><span style="color:#6B7280;font-size:12px">' + (r === 'google' ? 'Google Ads' : 'Meta') + '</span>';
  const propuestas = acciones.filter(a => a.estado === 'propuesta');
  const hechas = acciones.filter(a => a.estado === 'ejecutada' || a.estado === 'fallida');
  const avisos = acciones.filter(a => a.estado === 'avisada');
  const accion = (a) => a.accion === 'pausar' ? 'Pausar' : 'Bajar el presupuesto un ' + a.porcentaje + ' %';
  let cuerpo = '';
  if (propuestas.length) {
    cuerpo += '<p style="margin:16px 0 8px"><b>Esperan tu aprobación</b></p>' + propuestas.map(a => bloque(
      '<b>' + esc(accion(a)) + ': ' + esc(a.campana) + '</b><br>' + esc(a.motivo) +
      '<br><span style="color:#6B7280;font-size:12px">Regla «' + esc(a.regla) + '»</span>' + red(a.red))).join('');
  }
  if (hechas.length) {
    cuerpo += '<p style="margin:16px 0 8px"><b>Lo que hicieron tus reglas automáticas</b></p>' + hechas.map(a => bloque(
      '<b>' + (a.estado === 'ejecutada' ? '' : 'No se pudo — ') + esc(accion(a)) + ': ' + esc(a.campana) + '</b><br>' +
      esc(a.estado === 'ejecutada' ? a.resultado : a.resultado + ' La campaña sigue igual.') + '<br>' + esc(a.motivo) + red(a.red))).join('');
  }
  if (avisos.length) {
    cuerpo += '<p style="margin:16px 0 8px"><b>Avisos de tus reglas</b></p>' + avisos.map(a => bloque(
      '<b>' + esc(a.campana) + '</b><br>' + esc(a.motivo) +
      '<br><span style="color:#6B7280;font-size:12px">Regla «' + esc(a.regla) + '»</span>' + red(a.red))).join('');
  }
  if (alertas.length) {
    cuerpo += (acciones.length ? '<p style="margin:16px 0 8px"><b>Lo que cambió ayer</b></p>' : '') +
      alertas.map(a => bloque('<b>' + esc(a.titulo) + '</b><br>' + esc(a.detalle) + red(a.red))).join('');
  }
  const asunto = propuestas.length
    ? propuestas.length + (propuestas.length === 1 ? ' cambio espera' : ' cambios esperan') + ' tu aprobación en la pauta'
    : hechas.length
      ? 'Tus reglas ' + (hechas.some(a => a.estado === 'fallida') ? 'intentaron cambiar' : 'cambiaron') + ' ' + hechas.length + (hechas.length === 1 ? ' campaña' : ' campañas')
      : (graves ? '⚠ ' : '') + (alertas.length + avisos.length) + ((alertas.length + avisos.length) === 1 ? ' alerta' : ' alertas') + ' en tu pauta de ayer';
  const r = await enviarResend('alertas-pauta', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Acuarius <crm@app.acuarius.app>',
      to: dest.correo,
      subject: asunto,
      html: emailHtml({
        titulo: (dest.nombre ? esc(dest.nombre) + ', esto' : 'Esto') + ' pasó en tus campañas',
        intro: 'Usamos los leads y las ventas que llegaron a tu CRM, no solo lo que reporta la red.',
        cuerpo,
        cta: propuestas.length
          ? { texto: 'Revisar y aprobar', url: 'https://app.acuarius.app/?ir=pauta-reglas' }
          : { texto: 'Ver el diagnóstico', url: 'https://app.acuarius.app/?ir=pauta-diagnostico' },
        pie: hechas.some(a => a.estado === 'ejecutada')
          ? 'Lo hizo una regla que tú dejaste en automático. Acuarius solo pausa o baja presupuestos: nunca activa ni sube nada. Puedes cambiar la regla en Plataformas de pauta → Reglas.'
          : 'Acuarius no cambia nada en tus cuentas sin tu aprobación. Recibes este correo solo los días en que hay algo que revisar.',
        preheader: propuestas[0] ? accion(propuestas[0]) + ': ' + propuestas[0].campana : (alertas[0]?.titulo || acciones[0]?.motivo || ''),
      }),
    }),
  }, userId);
  return r.ok ? { enviado: true } : { enviado: false, motivo: 'Resend ' + r.status };
}
