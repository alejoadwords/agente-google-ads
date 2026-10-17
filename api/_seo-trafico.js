// api/_seo-trafico.js — traer Search Console y GA4 a nuestra base (fase 3).
//
// Con la cuenta de servicio (_google-sa.js): el cliente agregó nuestro correo
// como lector. La primera vez se trae todo el historial que da Google (16
// meses de Search Console, 13 de GA4); después, cada día, los últimos 10 días
// (Search Console tarda 2-3 en consolidar) y los meses en curso enteros.
// Las búsquedas de cada mes se van llenando hacia atrás, un mes por vuelta,
// para no pasarse del tiempo de una función. Solo se importa desde edge.

import { tokenServicio, correoServicio } from './_google-sa.js';
import { hoyCO, mesesAtras, rangoMes, nombreIA, REGEX_IA, errorGoogle, mismoSitio } from './_seo.js';
import { registrarError } from './_registro-errores.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { ...init, headers: sbH(init.prefer ? { Prefer: init.prefer } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
async function guardar(tabla, conflicto, filas) {
  for (let i = 0; i < filas.length; i += 500) {
    await sb(`/${tabla}?on_conflict=${conflicto}`, { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: JSON.stringify(filas.slice(i, i + 500)) });
  }
}
const HISTORIAL_GSC = 16, HISTORIAL_GA4 = 13;
const restar = (fecha, dias) => new Date(Date.parse(fecha) - dias * 86400000).toISOString().slice(0, 10);

class ErrorGoogle extends Error { constructor(status, mensaje) { super(mensaje); this.status = status; } }
async function google(url, token, cuerpo) {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorGoogle(r.status, d?.error?.message || ('HTTP ' + r.status));
  return d;
}

async function marcar(p, api, cambios) {
  await sb(`/seo_proyectos?id=eq.${p.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(
    Object.fromEntries(Object.entries(cambios).map(([k, v]) => [api + '_' + k, v]))) });
}

// ── Search Console ──────────────────────────────────────────────────────────
export async function sincronizarGsc(p) {
  if (!p.gsc_propiedad) return { omitido: true };
  const hoy = hoyCO();
  const url = 'https://searchconsole.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(p.gsc_propiedad) + '/searchAnalytics/query';
  try {
    const token = await tokenServicio('https://www.googleapis.com/auth/webmasters.readonly');
    // Por día: TODO el historial en cada vuelta (una sola petición, ~500 filas).
    // Una propiedad recién creada en Search Console llega vacía y Google la va
    // llenando días después, también hacia atrás: con solo «los últimos 10
    // días» esos meses no se habrían pedido nunca (acuarius.app, 17-10-2026).
    const dias = await google(url, token, { startDate: restar(hoy, HISTORIAL_GSC * 31), endDate: hoy, dimensions: ['date'], dataState: 'all', rowLimit: 25000 });
    await guardar('seo_gsc_dias', 'proyecto_id,fecha', (dias.rows || []).map(r => ({
      proyecto_id: p.id, fecha: r.keys[0], clics: r.clicks || 0, impresiones: r.impressions || 0, ctr: r.ctr ?? null, posicion: r.position ?? null })));
    // Búsquedas y páginas por mes: el mes en curso, el anterior en los primeros
    // días (aún se consolida) y uno más hacia atrás por vuelta hasta el tope.
    const actual = hoy.slice(0, 7);
    const meses = [actual];
    if (+hoy.slice(8, 10) <= 5) meses.push(mesesAtras(actual, 2)[1]);
    let hechos = p.gsc_meses_atras || 1;
    if (hechos < HISTORIAL_GSC) { meses.push(mesesAtras(actual, hechos + 1)[hechos]); hechos++; }
    // Y los meses que ya tienen impresiones pero ninguna búsqueda guardada (se
    // pidieron cuando Google aún no los mostraba): dos por vuelta.
    const conImpresiones = [...new Set((dias.rows || []).filter(r => r.impressions > 0).map(r => r.keys[0].slice(0, 7)))];
    if (conImpresiones.length) {
      const guardados = new Set((await sb(`/seo_gsc_consultas?proyecto_id=eq.${p.id}&mes=in.(${conImpresiones.join(',')})&select=mes`) || []).map(x => x.mes));
      conImpresiones.filter(m => !guardados.has(m) && !meses.includes(m)).sort().reverse().slice(0, 2).forEach(m => meses.push(m));
    }
    for (const mes of [...new Set(meses)]) {
      const { desde, hasta } = rangoMes(mes, hoy);
      const [consultas, paginas] = await Promise.all([
        google(url, token, { startDate: desde, endDate: hasta, dimensions: ['query'], dataState: 'all', rowLimit: 2000 }),
        google(url, token, { startDate: desde, endDate: hasta, dimensions: ['page'], dataState: 'all', rowLimit: 500 }),
      ]);
      // El mes se reemplaza entero: una búsqueda que salió del top no queda con cifras viejas.
      await sb(`/seo_gsc_consultas?proyecto_id=eq.${p.id}&mes=eq.${mes}`, { method: 'DELETE', prefer: 'return=minimal' });
      await sb(`/seo_gsc_paginas?proyecto_id=eq.${p.id}&mes=eq.${mes}`, { method: 'DELETE', prefer: 'return=minimal' });
      await guardar('seo_gsc_consultas', 'proyecto_id,mes,consulta', (consultas.rows || []).map(r => ({
        proyecto_id: p.id, mes, consulta: String(r.keys[0]).slice(0, 300), clics: r.clicks || 0, impresiones: r.impressions || 0, ctr: r.ctr ?? null, posicion: r.position ?? null })));
      await guardar('seo_gsc_paginas', 'proyecto_id,mes,pagina', (paginas.rows || []).map(r => ({
        proyecto_id: p.id, mes, pagina: String(r.keys[0]).slice(0, 600), clics: r.clicks || 0, impresiones: r.impressions || 0, ctr: r.ctr ?? null, posicion: r.position ?? null })));
    }
    await marcar(p, 'gsc', { estado: 'ok', error: null, sincronizado_at: new Date().toISOString(), meses_atras: hechos });
    return { ok: true, dias: (dias.rows || []).length, meses };
  } catch (e) {
    const g = errorGoogle('gsc', e.status || 0, e.message, correoServicio());
    await marcar(p, 'gsc', { estado: g.estado, error: g.texto });
    // «Sin acceso» es cosa del cliente; un error de verdad (API apagada, caída) es nuestro.
    if (g.estado === 'error') await registrarError({ origen: 'servidor', donde: 'seo-trafico.gsc', error: e, usuario: p.user_id, detalle: p.id }).catch(() => {});
    return { ok: false, estado: g.estado, error: g.texto, detalle: e.message };
  }
}

// ── GA4 ─────────────────────────────────────────────────────────────────────
export async function sincronizarGa4(p) {
  if (!p.ga4_propiedad) return { omitido: true };
  const hoy = hoyCO();
  const url = 'https://analyticsdata.googleapis.com/v1beta/properties/' + encodeURIComponent(p.ga4_propiedad) + ':runReport';
  try {
    const token = await tokenServicio('https://www.googleapis.com/auth/analytics.readonly');
    const primera = !p.ga4_meses_atras;
    const desde = primera ? mesesAtras(hoy.slice(0, 7), HISTORIAL_GA4)[HISTORIAL_GA4 - 1] + '-01' : restar(hoy, 10);
    // Las IAs por mes van con meses ENTEROS (el anterior y el actual), o el
    // total del mes quedaría con solo los últimos 10 días.
    const desdeIA = primera ? desde : mesesAtras(hoy.slice(0, 7), 2)[1] + '-01';
    const [canales, usuarios, ia] = await Promise.all([
      google(url, token, { dateRanges: [{ startDate: desde, endDate: hoy }], dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], limit: 100000 }),
      google(url, token, { dateRanges: [{ startDate: desde, endDate: hoy }], dimensions: [{ name: 'date' }], metrics: [{ name: 'totalUsers' }], limit: 100000 }),
      google(url, token, { dateRanges: [{ startDate: desdeIA, endDate: hoy }], dimensions: [{ name: 'date' }, { name: 'sessionSource' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], limit: 100000,
        dimensionFilter: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: REGEX_IA, caseSensitive: false } } } }),
    ]);
    const fechaDe = (d) => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
    const porDia = {};
    const dia = (f) => (porDia[f] ||= { proyecto_id: p.id, fecha: f, sesiones: 0, usuarios: 0, conversiones: 0, sesiones_organicas: 0, conversiones_organicas: 0, sesiones_ia: 0, conversiones_ia: 0 });
    for (const r of canales.rows || []) {
      const d = dia(fechaDe(r.dimensionValues[0].value));
      const s = +r.metricValues[0].value || 0, c = +r.metricValues[1].value || 0;
      d.sesiones += s; d.conversiones += c;
      if (r.dimensionValues[1].value === 'Organic Search') { d.sesiones_organicas += s; d.conversiones_organicas += c; }
    }
    for (const r of usuarios.rows || []) dia(fechaDe(r.dimensionValues[0].value)).usuarios = +r.metricValues[0].value || 0;
    const porMes = {};
    for (const r of ia.rows || []) {
      const fuente = nombreIA(r.dimensionValues[1].value);
      if (!fuente) continue;
      const f = fechaDe(r.dimensionValues[0].value), s = +r.metricValues[0].value || 0, c = +r.metricValues[1].value || 0;
      if (f >= desde) { const d = dia(f); d.sesiones_ia += s; d.conversiones_ia += c; }
      const k = f.slice(0, 7) + '|' + fuente;
      const x = (porMes[k] ||= { proyecto_id: p.id, mes: f.slice(0, 7), fuente, sesiones: 0, conversiones: 0 });
      x.sesiones += s; x.conversiones += c;
    }
    await guardar('seo_ga4_dias', 'proyecto_id,fecha', Object.values(porDia));
    await guardar('seo_ga4_ia', 'proyecto_id,mes,fuente', Object.values(porMes));
    await marcar(p, 'ga4', { estado: 'ok', error: null, sincronizado_at: new Date().toISOString(), meses_atras: HISTORIAL_GA4 });
    return { ok: true, dias: Object.keys(porDia).length, fuentesIA: Object.keys(porMes).length };
  } catch (e) {
    const g = errorGoogle('ga4', e.status || 0, e.message, correoServicio());
    await marcar(p, 'ga4', { estado: g.estado, error: g.texto });
    // «Sin acceso» es cosa del cliente; un error de verdad (API apagada, caída) es nuestro.
    if (g.estado === 'error') await registrarError({ origen: 'servidor', donde: 'seo-trafico.ga4', error: e, usuario: p.user_id, detalle: p.id }).catch(() => {});
    return { ok: false, estado: g.estado, error: g.texto, detalle: e.message };
  }
}

// ¿Toca sincronizar hoy? Una vez al día (hora de Colombia), o si nunca se hizo.
export const tocaSincronizar = (at, hoy = hoyCO()) => !at || hoyCO(new Date(at)) < hoy;

// Las propiedades de Search Console y GA4 que Acuarius puede leer Y que son del
// sitio del proyecto: para elegirlas de una lista en vez de buscar el ID.
// GA4 se reconoce por la URL de su flujo web (Admin API).
export async function propiedadesDelSitio(dom) {
  const out = { gsc: [], ga4: [], errores: [] };
  let token;
  try { token = await tokenServicio(['https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly']); }
  catch (e) { out.errores.push('No se pudo hablar con Google: ' + e.message); return out; }
  const H = { Authorization: 'Bearer ' + token };
  const pedir = async (url) => { const r = await fetch(url, { headers: H }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error?.message || 'HTTP ' + r.status); return d; };
  await Promise.all([
    (async () => {
      try {
        const d = await pedir('https://searchconsole.googleapis.com/webmasters/v3/sites');
        out.gsc = (d.siteEntry || []).filter(x => mismoSitio(x.siteUrl, dom) && x.permissionLevel !== 'siteUnverifiedUser')
          .map(x => ({ id: x.siteUrl, nombre: x.siteUrl.startsWith('sc-domain:') ? 'Dominio completo: ' + x.siteUrl.slice(10) : x.siteUrl }));
      } catch (e) { out.errores.push('Search Console: ' + e.message); }
    })(),
    (async () => {
      try {
        const props = [];
        let pagina = '';
        for (let i = 0; i < 10; i++) {
          const d = await pedir('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200' + (pagina ? '&pageToken=' + pagina : ''));
          for (const a of d.accountSummaries || []) for (const p of a.propertySummaries || []) props.push({ id: p.property.split('/')[1], nombre: p.displayName, cuenta: a.displayName });
          if (!d.nextPageToken) break;
          pagina = d.nextPageToken;
        }
        // De a 8 a la vez: con muchas cuentas conectadas, todas juntas chocan con la cuota.
        for (let i = 0; i < props.length; i += 8) {
          await Promise.all(props.slice(i, i + 8).map(async (p) => {
            try {
              const d = await pedir('https://analyticsadmin.googleapis.com/v1beta/properties/' + p.id + '/dataStreams');
              const web = (d.dataStreams || []).map(x => x.webStreamData?.defaultUri).filter(Boolean);
              const del = web.find(u => mismoSitio(u, dom));
              if (del) out.ga4.push({ id: p.id, nombre: p.nombre + ' · ' + del, cuenta: p.cuenta });
            } catch { /* una propiedad sin permiso de lectura de flujos no se lista */ }
          }));
        }
      } catch (e) { out.errores.push('Google Analytics: ' + e.message); }
    })(),
  ]);
  return out;
}
