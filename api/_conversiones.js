// api/_conversiones.js — reportarle a Meta y a Google las ventas cerradas en Acuarius
//
// Una campaña de clientes potenciales se mide, por defecto, en leads. Lo que
// de verdad importa es cuántos de esos leads compraron y por cuánto, y eso solo
// lo sabe el CRM. Aquí se le devuelve a cada red: cada lead ganado sale como
// evento «Purchase», con su valor, identificado con la mejor llave que haya.
//
// La cola (`conversiones_pauta`) la llena un disparador de la base al ganar un
// lead (sql/conversiones_pauta.sql) y la vacía api/cron-conversiones.js.
//
// LAS LLAVES, de mejor a peor. Sin llave la red no puede unir la venta con el
// anuncio, así que cuál se usó queda escrito en la fila:
//   Meta   — id del lead del formulario de Meta · clic a WhatsApp (ctwa_clid)
//            · clic web (fbclid → fbc) · teléfono y correo cifrados
//   Google — gclid / gbraid / wbraid · correo y teléfono cifrados
//            (conversiones mejoradas para leads)
//
// Lo que NO se puede: Meta rechaza eventos de hace más de 7 días. Por eso la
// cola corre cada 10 minutos y una venta vieja se marca «vencido» en vez de
// reintentarse para nada.
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

import { abrirConexion, cifrar, descifrar } from './_cifrado.js';
import { dondePreguntar } from './_google-login.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
export const GRAPH = 'https://graph.facebook.com/v21.0';
// Las mismas que api/pauta.js: la 22 en uso, la 23 de respaldo.
const VERSIONES_GOOGLE = [22, 23];
export const NOMBRE_ACCION_GOOGLE = 'Venta en Acuarius';
export const DIAS_META = 7;
export const MAX_INTENTOS = 6;

const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' en ' + ruta.split('?')[0]);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ── Normalizar y cifrar como piden las redes ────────────────────────────────
export async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * El teléfono en E.164 SIN el «+» (Meta) — Google lo quiere con «+», y se lo
 * pone quien lo usa. Un celular colombiano guardado sin indicativo (10 dígitos
 * que empiezan por 3) se completa con 57: es la inmensa mayoría de la cartera
 * hoy, y sin indicativo la red no reconoce a nadie. Cualquier otro número sin
 * indicativo se deja como está: inventarle un país sería peor que no mandarlo.
 */
export function telefonoE164(tel) {
  let d = String(tel || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.length === 10 && d.startsWith('3')) d = '57' + d;
  d = d.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export function correoNormal(correo, paraGoogle) {
  let c = String(correo || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return null;
  // Google pide quitar los puntos de la parte local en gmail: para Gmail
  // «ana.perez» y «anaperez» son el mismo buzón.
  if (paraGoogle) {
    const [u, dom] = c.split('@');
    if (dom === 'gmail.com' || dom === 'googlemail.com') c = u.replace(/\./g, '') + '@' + dom;
  }
  return c;
}

function partirNombre(nombre) {
  const p = String(nombre || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return { fn: p[0] || null, ln: p.length > 1 ? p[p.length - 1] : null };
}

// ── Qué llaves tiene un lead ────────────────────────────────────────────────
/**
 * Lo que se sabe del lead para que la red lo reconozca. `Tipo de clic` lo
 * guardan los leads nuevos; en los viejos se deduce: un clic que vino con
 * «ID de anuncio» (el referral de WhatsApp) es un clic a WhatsApp, y un clic de
 * Google sin tipo es un gclid, que es el de siempre.
 */
export function llavesDelLead(lead) {
  const cf = lead.custom_fields || {};
  const clic = String(cf['Clic de anuncio'] || '').trim() || null;
  const plataforma = String(cf['Plataforma'] || '').toLowerCase();
  let tipo = String(cf['Tipo de clic'] || '').toLowerCase() || null;
  if (clic && !tipo) {
    if (plataforma.startsWith('meta')) tipo = cf['ID de anuncio'] ? 'ctwa_clid' : 'fbclid';
    else if (plataforma.startsWith('google')) tipo = 'gclid';
  }
  return {
    metaLeadId: String(cf['ID de lead de Meta'] || '').trim() || null,
    ctwa:   tipo === 'ctwa_clid' ? clic : null,
    fbclid: tipo === 'fbclid' ? clic : null,
    gclid:  tipo === 'gclid' ? clic : null,
    gbraid: tipo === 'gbraid' ? clic : null,
    wbraid: tipo === 'wbraid' ? clic : null,
    telefono: telefonoE164(lead.phone),
    correo: lead.email || null,
  };
}

// ── Conexiones ──────────────────────────────────────────────────────────────
/** La conexión de la red para este lead: la de su cliente gana a la de la cuenta. */
export function conexionPara(conexiones, red, lead) {
  const plataforma = red === 'meta' ? 'meta_capi' : 'google_ads';
  const activas = (conexiones || []).filter(c => c.platform === plataforma &&
    (red === 'meta' ? c.extra_data?.activo : c.extra_data?.conversiones?.activo));
  return activas.find(c => lead.client_id && c.client_id === lead.client_id)
    || activas.find(c => !c.client_id) || null;
}

/**
 * Las conexiones de la cuenta, con la forma de `platform_connections`: Google
 * sale de ahí; Meta, de `conversiones_conexion` (una por cliente), traducida
 * a la misma forma para que quien elige no tenga que saber de dónde vino.
 */
export async function conexionesDe(userId) {
  const [google, meta] = await Promise.all([
    sb(`/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_ads` +
      `&select=id,user_id,platform,account_id,account_name,client_id,access_token,refresh_token,token_expires_at,extra_data`),
    sb(`/conversiones_conexion?user_id=eq.${encodeURIComponent(userId)}&red=eq.meta&select=*`),
  ]);
  return [
    ...await Promise.all((google || []).map(abrirConexion)),
    ...await Promise.all((meta || []).map(metaComoConexion)),
  ];
}

export async function metaComoConexion(f) {
  return {
    id: f.id, user_id: f.user_id, client_id: f.client_id, platform: 'meta_capi',
    account_id: f.dataset, account_name: f.nombre, access_token: await descifrar(f.token),
    extra_data: { activo: !!f.activo, test_event_code: f.test_event_code || null },
  };
}

// ── Meta ────────────────────────────────────────────────────────────────────
/**
 * El evento tal como lo pide la API de conversiones para CRM:
 * action_source `system_generated`, `lead_event_source` con el nombre del CRM
 * y `event_source: crm`. El clic a WhatsApp va por `business_messaging`, que
 * es como Meta lo une a su anuncio.
 */
/**
 * `whatsapp` = { waba } cuando el lead vino de un clic a WhatsApp y se conoce
 * la cuenta de WhatsApp Business por la que entró. Solo entonces el evento va
 * como mensajería de negocio: Meta exige el `whatsapp_business_account_id`
 * junto al `ctwa_clid`, y sin él lo rechaza. Sin cuenta, el clic no se manda
 * y la venta sale como CRM con teléfono y correo.
 */
export async function eventoMeta({ fila, lead, moneda, whatsapp }) {
  const k = llavesDelLead(lead);
  const ud = {};
  const llaves = [];
  const porWhatsapp = !!(k.ctwa && whatsapp?.waba);
  if (k.metaLeadId) { ud.lead_id = k.metaLeadId; llaves.push('lead de Meta'); }
  if (porWhatsapp) {
    ud.ctwa_clid = k.ctwa;
    ud.whatsapp_business_account_id = String(whatsapp.waba);
    llaves.push('clic a WhatsApp');
  }
  if (k.fbclid) {
    const t = Date.parse(lead.created_at) || Date.now();
    ud.fbc = `fb.1.${t}.${k.fbclid}`;
    llaves.push('clic web');
  }
  if (k.telefono) { ud.ph = [await sha256(k.telefono)]; llaves.push('teléfono'); }
  const correo = correoNormal(k.correo);
  if (correo) { ud.em = [await sha256(correo)]; llaves.push('correo'); }
  const { fn, ln } = partirNombre(lead.name);
  if (fn) ud.fn = [await sha256(fn)];
  if (ln) ud.ln = [await sha256(ln)];
  ud.external_id = [await sha256(lead.id)];
  if (!llaves.length) return { sinDatos: true };

  const evento = {
    event_name: fila.evento || 'Purchase',
    event_time: Math.floor(Date.parse(fila.ocurrio_at) / 1000),
    event_id: fila.event_id,
    user_data: ud,
    custom_data: {},
  };
  // El valor es de la VENTA. Un «Lead» con el importe del negocio haría creer
  // a Meta que entrar ya facturó.
  if (evento.event_name === 'Purchase') evento.custom_data = { value: Number(lead.value) || 0, currency: moneda };
  if (porWhatsapp) {
    evento.action_source = 'business_messaging';
    evento.messaging_channel = 'whatsapp';
  } else {
    evento.action_source = 'system_generated';
    evento.custom_data.lead_event_source = 'Acuarius';
    evento.custom_data.event_source = 'crm';
  }
  return { evento, llave: llaves.join(' + ') };
}

/** Manda eventos a un conjunto de datos. Devuelve la respuesta de Meta tal cual, más `ok`. */
export async function mandarAMeta({ dataset, token, eventos, testCode }) {
  const cuerpo = { data: eventos, access_token: token };
  if (testCode) cuerpo.test_event_code = testCode;
  let r;
  try {
    r = await fetch(`${GRAPH}/${encodeURIComponent(dataset)}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    return { ok: false, red: true, motivo: 'Meta no respondió: ' + (e?.message || e) };
  }
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.events_received >= 1) return { ok: true, respuesta: d };
  const err = d.error || {};
  return {
    ok: false,
    // 5xx, límite de peticiones o fallo temporal: vale la pena reintentar.
    red: r.status >= 500 || r.status === 429 || err.is_transient === true || [1, 2, 4, 17, 341].includes(err.code),
    motivo: motivoMeta(err, r.status),
    respuesta: d,
  };
}

function motivoMeta(err, status) {
  if (err.code === 190) return 'El token de Meta no es válido o venció. Genera uno nuevo en el Administrador de eventos y pégalo otra vez.';
  if (err.code === 100 && /does not exist|Unsupported post request/i.test(err.message || '')) {
    return 'Meta no encuentra ese conjunto de datos, o el token no tiene permiso sobre él.';
  }
  return 'Meta lo rechazó: ' + (err.error_user_msg || err.message || ('estado ' + status));
}

// ── WhatsApp: el conjunto de datos de la cuenta de WhatsApp Business ────────
/**
 * La conexión de WhatsApp por la que entró el lead: la de su conversación, y
 * si no hay conversación ligada, la conexión activa de su cuenta o cliente.
 * Trae el token descifrado, que es el que manda los eventos de mensajería.
 */
export async function canalWhatsappDelLead(lead) {
  let conexionId = null;
  const convs = await sb(`/chat_conversations?lead_id=eq.${encodeURIComponent(lead.id)}&channel=eq.whatsapp` +
    `&select=connection_id&order=last_message_at.desc.nullslast&limit=1`).catch(() => []);
  conexionId = convs?.[0]?.connection_id || null;
  const filtro = conexionId
    ? `id=eq.${encodeURIComponent(conexionId)}`
    : `user_id=eq.${encodeURIComponent(lead.user_id)}&channel=eq.whatsapp&is_active=eq.true` +
      (lead.client_id ? `&or=(client_id.eq.${encodeURIComponent(lead.client_id)},client_id.is.null)` : '');
  const filas = await sb(`/channel_connections?${filtro}&select=id,waba_id,access_token,conversiones_dataset,client_id&limit=5`).catch(() => []);
  const fila = (filas || []).find(f => lead.client_id && f.client_id === lead.client_id) || (filas || [])[0];
  if (!fila || !fila.waba_id || !fila.access_token) return null;
  return { id: fila.id, waba: fila.waba_id, token: await descifrar(fila.access_token), dataset: fila.conversiones_dataset || null };
}

/**
 * El conjunto de datos de la WABA. Meta lo crea al pedirlo, o devuelve el que
 * ya tenga (pedirlo dos veces no crea dos). Se guarda en la conexión para no
 * preguntarlo en cada venta.
 */
export async function datasetDeWhatsapp(canal) {
  if (canal.dataset) return canal.dataset;
  const r = await fetch(`${GRAPH}/${encodeURIComponent(canal.waba)}/dataset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: canal.token }),
  }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || !d.id) {
    throw new Error('Meta no dio el conjunto de datos de tu cuenta de WhatsApp: ' +
      (d?.error?.error_user_msg || d?.error?.message || 'sin respuesta') +
      '. El token de WhatsApp necesita el permiso whatsapp_business_management.');
  }
  await fetch(`${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${encodeURIComponent(canal.id)}`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify({ conversiones_dataset: d.id }),
  }).catch(() => {});
  canal.dataset = d.id;
  return d.id;
}

// ── Google ──────────────────────────────────────────────────────────────────
async function refrescarGoogle(fila) {
  const vence = fila.token_expires_at ? new Date(fila.token_expires_at).getTime() : 0;
  if (vence && vence - 60000 > Date.now()) return fila.access_token;
  if (!fila.refresh_token) return fila.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: fila.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) return null;
  await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?id=eq.${fila.id}`, {
    method: 'PATCH', headers: sbH(),
    body: JSON.stringify({
      access_token: await cifrar(d.access_token),
      token_expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});
  fila.access_token = d.access_token;
  return d.access_token;
}

/** Token y login-customer-id listos para hablarle a la cuenta de la conexión. */
export async function accesoGoogle(fila) {
  const cid = String(fila.account_id || '').replace(/-/g, '');
  if (!cid) throw new Error('La conexión de Google Ads no tiene cuenta elegida. Elígela en Plataformas de pauta → Conexiones.');
  const token = await refrescarGoogle(fila);
  if (!token) throw new Error('El permiso de Google caducó. Vuelve a conectar Google Ads.');
  const login = await dondePreguntar({ fila, token, customerId: cid, devToken: DEV_TOKEN, sbUrl: SUPABASE_URL, sbKey: SUPABASE_KEY });
  const h = { Authorization: `Bearer ${token}`, 'developer-token': DEV_TOKEN, 'Content-Type': 'application/json' };
  if (login) h['login-customer-id'] = String(login).replace(/-/g, '');
  return { cid, h };
}

/** POST a la API de Google Ads, probando las versiones vigentes. */
export async function llamarGoogle(ruta, h, cuerpo) {
  let ultimo = null;
  for (const v of VERSIONES_GOOGLE) {
    let r;
    try {
      r = await fetch(`https://googleads.googleapis.com/v${v}/${ruta}`, { method: 'POST', headers: h, body: JSON.stringify(cuerpo) });
    } catch (e) { ultimo = { ok: false, red: true, motivo: 'Google no respondió: ' + (e?.message || e) }; continue; }
    if (r.status === 404) { ultimo = { ok: false, red: true, motivo: 'Google: versión de la API retirada' }; continue; }
    const d = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, datos: d };
    const det = d?.error?.details?.[0]?.errors?.[0]?.message || d?.error?.message || ('estado ' + r.status);
    return { ok: false, red: r.status >= 500 || r.status === 429, motivo: 'Google lo rechazó: ' + det, respuesta: d };
  }
  return ultimo || { ok: false, red: true, motivo: 'Google: ninguna versión de la API respondió' };
}

/**
 * La acción de conversión a la que se suben las ventas. Si ya existe una con
 * nuestro nombre se reutiliza (activar dos veces no puede crear dos); si no,
 * se crea: tipo «importación de clics», categoría compra, valor por venta.
 */
export async function asegurarAccionGoogle(fila, moneda) {
  const { cid, h } = await accesoGoogle(fila);
  const q = await llamarGoogle(`customers/${cid}/googleAds:search`, h, {
    query: `SELECT conversion_action.resource_name, conversion_action.status FROM conversion_action ` +
      `WHERE conversion_action.name = '${NOMBRE_ACCION_GOOGLE}' AND conversion_action.status != 'REMOVED'`,
  });
  if (!q.ok) throw new Error(q.motivo);
  const ya = q.datos?.results?.[0]?.conversionAction?.resourceName;
  if (ya) return ya;
  const c = await llamarGoogle(`customers/${cid}/conversionActions:mutate`, h, {
    operations: [{ create: {
      name: NOMBRE_ACCION_GOOGLE, type: 'UPLOAD_CLICKS', category: 'PURCHASE', status: 'ENABLED',
      valueSettings: { defaultValue: 0, defaultCurrencyCode: moneda || 'COP', alwaysUseDefaultValue: false },
    } }],
  });
  if (!c.ok) throw new Error(c.motivo);
  const nueva = c.datos?.results?.[0]?.resourceName;
  if (!nueva) throw new Error('Google no devolvió la acción de conversión creada');
  return nueva;
}

function fechaGoogle(iso) {
  // «aaaa-mm-dd hh:mm:ss+00:00», que es el único formato que acepta.
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ') + '+00:00';
}

export async function conversionGoogle({ fila, lead, moneda, accion }) {
  const k = llavesDelLead(lead);
  const conv = {
    conversionAction: accion,
    conversionDateTime: fechaGoogle(fila.ocurrio_at),
    conversionValue: Number(lead.value) || 0,
    currencyCode: moneda,
    orderId: fila.event_id,
  };
  const llaves = [];
  if (k.gclid) { conv.gclid = k.gclid; llaves.push('clic de Google'); }
  else if (k.gbraid) { conv.gbraid = k.gbraid; llaves.push('clic de Google (gbraid)'); }
  else if (k.wbraid) { conv.wbraid = k.wbraid; llaves.push('clic de Google (wbraid)'); }
  const ids = [];
  const correo = correoNormal(k.correo, true);
  if (correo) { ids.push({ hashedEmail: await sha256(correo) }); llaves.push('correo'); }
  if (k.telefono) { ids.push({ hashedPhoneNumber: await sha256('+' + k.telefono) }); llaves.push('teléfono'); }
  if (ids.length) conv.userIdentifiers = ids;
  if (!llaves.length) return { sinDatos: true };
  return { conversion: conv, llave: llaves.join(' + ') };
}

// ── La cola ─────────────────────────────────────────────────────────────────
async function monedaDeLaCuenta(userId) {
  try {
    const f = await sb(`/onboarding_cuenta?user_id=eq.${encodeURIComponent(userId)}&select=moneda&limit=1`);
    return f?.[0]?.moneda || null;
  } catch { return null; }
}

async function actualizar(id, cambio) {
  await sb(`/conversiones_pauta?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(cambio),
  });
}

function espera(intentos) {
  // 10, 20, 40, 80 y 160 minutos: un corte de la red se recupera solo, y si a
  // las cinco horas sigue fallando ya no es un corte.
  return new Date(Date.now() + 10 * 60000 * Math.pow(2, Math.max(0, intentos - 1))).toISOString();
}

/**
 * Procesa UNA fila. Devuelve el cambio que se guardó (útil en las pruebas).
 * Nunca lanza: lo que falle queda escrito en la fila, que es donde el cliente
 * lo va a buscar.
 */
export async function procesarFila(fila, { lead, conexiones, moneda }) {
  const intentos = (fila.intentos || 0) + 1;
  let cambio;
  try {
    if (!lead || lead.deleted_at) {
      cambio = { estado: 'cancelado', motivo: 'El lead se borró antes de enviarse.' };
    } else if (fila.evento !== 'Lead' && lead.stage !== 'ganado') {
      cambio = { estado: 'cancelado', motivo: 'El lead dejó de estar ganado antes de enviarse.' };
    } else {
      const con = conexionPara(conexiones, fila.red, lead);
      const mon = (lead.close_currency || moneda || 'COP').toUpperCase();
      if (!con) {
        cambio = { estado: 'cancelado', motivo: 'El envío a ' + (fila.red === 'meta' ? 'Meta' : 'Google') + ' se desactivó.' };
      } else if (fila.red === 'meta') {
        if (Date.now() - Date.parse(fila.ocurrio_at) > DIAS_META * 86400000) {
          cambio = { estado: 'vencido', motivo: 'Meta solo acepta eventos de los últimos 7 días.' };
        } else {
          // Un clic a WhatsApp va al conjunto de datos de la cuenta de
          // WhatsApp, con el token de WhatsApp; todo lo demás, al pixel.
          let canal = null, nota = null;
          if (llavesDelLead(lead).ctwa) {
            canal = await canalWhatsappDelLead(lead).catch(() => null);
            if (!canal) nota = 'Vino de un anuncio de WhatsApp, pero ese WhatsApp no está conectado a Acuarius: se usaron teléfono y correo.';
          }
          const ev = await eventoMeta({ fila, lead, moneda: mon, whatsapp: canal });
          if (ev.sinDatos) cambio = { estado: 'sin_datos', motivo: 'El lead no tiene teléfono, correo ni datos del anuncio: Meta no podría reconocerlo.' };
          else {
            const destino = canal
              ? { dataset: await datasetDeWhatsapp(canal), token: canal.token }
              : { dataset: con.account_id, token: con.access_token };
            const r = await mandarAMeta({ ...destino, eventos: [ev.evento], testCode: con.extra_data?.test_event_code || null });
            cambio = r.ok
              ? { estado: 'enviado', enviado_at: new Date().toISOString(), llave: ev.llave, motivo: nota, respuesta: r.respuesta }
              : { estado: r.red && intentos < MAX_INTENTOS ? 'pendiente' : 'rechazado', llave: ev.llave, motivo: r.motivo, respuesta: r.respuesta || null };
            if (fila.evento !== 'Lead') { cambio.valor = Number(lead.value) || 0; cambio.moneda = mon; }
          }
        }
      } else {
        const accion = con.extra_data?.conversiones?.accion;
        if (!accion) {
          cambio = { estado: 'rechazado', motivo: 'Falta la acción de conversión de Google. Desactiva y vuelve a activar el envío.' };
        } else {
          const cv = await conversionGoogle({ fila, lead, moneda: mon, accion });
          if (cv.sinDatos) cambio = { estado: 'sin_datos', motivo: 'El lead no tiene clic de Google, correo ni teléfono: Google no podría reconocerlo.' };
          else {
            const { cid, h } = await accesoGoogle(con);
            const r = await llamarGoogle(`customers/${cid}:uploadClickConversions`, h, { conversions: [cv.conversion], partialFailure: true });
            const parcial = r.ok && r.datos?.partialFailureError;
            if (r.ok && !parcial) cambio = { estado: 'enviado', enviado_at: new Date().toISOString(), llave: cv.llave, motivo: null, respuesta: r.datos };
            else cambio = {
              estado: !parcial && r.red && intentos < MAX_INTENTOS ? 'pendiente' : 'rechazado',
              llave: cv.llave,
              motivo: parcial ? 'Google lo rechazó: ' + (r.datos.partialFailureError.message || 'sin detalle') : r.motivo,
              respuesta: r.datos || r.respuesta || null,
            };
            cambio.valor = Number(lead.value) || 0; cambio.moneda = mon;
          }
        }
      }
    }
  } catch (e) {
    cambio = { estado: intentos < MAX_INTENTOS ? 'pendiente' : 'rechazado', motivo: String(e?.message || e).slice(0, 300) };
  }
  cambio.intentos = intentos;
  if (cambio.estado === 'pendiente') cambio.proximo_at = espera(intentos);
  await actualizar(fila.id, cambio);
  return cambio;
}

/** Vacía la cola hasta `tope` ms. Lo llama el cron. */
export async function procesarCola({ tope = 18000, limite = 40 } = {}) {
  const fin = Date.now() + tope;
  const filas = await sb(`/conversiones_pauta?estado=eq.pendiente&proximo_at=lte.${encodeURIComponent(new Date().toISOString())}` +
    `&select=*&order=proximo_at.asc&limit=${limite}`) || [];
  if (!filas.length) return { revisadas: 0 };
  const ids = [...new Set(filas.map(f => f.lead_id))];
  const leads = await sb(`/leads?id=in.(${ids.join(',')})&select=id,user_id,client_id,name,email,phone,value,stage,close_currency,closed_at,created_at,deleted_at,custom_fields`) || [];
  const porId = new Map(leads.map(l => [l.id, l]));
  const conexiones = new Map(), monedas = new Map();
  const cuenta = { revisadas: 0, enviadas: 0, pendientes: 0, rechazadas: 0, otras: 0 };
  for (const f of filas) {
    if (Date.now() > fin) break;
    if (!conexiones.has(f.user_id)) {
      conexiones.set(f.user_id, await conexionesDe(f.user_id).catch(() => []));
      monedas.set(f.user_id, await monedaDeLaCuenta(f.user_id));
    }
    const c = await procesarFila(f, { lead: porId.get(f.lead_id), conexiones: conexiones.get(f.user_id), moneda: monedas.get(f.user_id) });
    cuenta.revisadas++;
    if (c.estado === 'enviado') cuenta.enviadas++;
    else if (c.estado === 'pendiente') cuenta.pendientes++;
    else if (c.estado === 'rechazado') cuenta.rechazadas++;
    else cuenta.otras++;
  }
  return cuenta;
}
