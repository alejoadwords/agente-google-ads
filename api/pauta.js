// api/pauta.js — Plataformas de pauta
//
// Une dos mundos que hasta hoy vivían separados: lo que dice la red
// publicitaria (inversión, impresiones, clics) y lo que dice el CRM (cuántos
// de esos leads entraron, en qué etapa quedaron, cuántos se ganaron). La
// mitad de la red la enseña cualquiera; la del CRM es la única razón para
// construir esta pantalla.
//
//   GET  /api/pauta?client_id=&desde=&hasta=     lista de campañas
//   GET  /api/pauta?campana=<clave>&...          detalle de una campaña
//   GET  /api/pauta?cartera=1&desde=&hasta=      una fila por cliente (agencia)
//   GET  /api/pauta?cuentas=<conexion_id>        cuentas publicitarias a las que llega
//   POST /api/pauta  {conexion_id, account_id…}  cuál de ellas leer, y de qué cliente
//
// De Google y de Meta solo LEE: nunca crea, pausa ni cambia nada allí. Lo
// único que escribe es en nuestra propia tabla de conexiones.

export const config = { runtime: 'edge' };

import { quienPregunta, exigeModulo, soloSusLeads } from './_perfiles.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const GRAPH = 'https://graph.facebook.com/v19.0';

// Las etapas cerradas son las mismas que usa el pipeline en el navegador. Si
// cambian allí y no aquí, el embudo dejaría de cuadrar con el tablero.
const ETAPAS_CERRADAS = ['ganado', 'perdido', 'won', 'lost', 'cerrado', 'descartado'];
const ETAPAS_GANADAS = ['ganado', 'won'];
const ETAPAS_PERDIDAS = ['perdido', 'lost', 'descartado'];

function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
async function sb(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error('supabase ' + r.status + ' en ' + ruta.slice(0, 60));
  return r.json();
}

// Verificación del JWT de Clerk (mismo patrón que api/leads.js)
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const [hB64, pB64, sB64] = token.split('.');
    if (!sB64) return null;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const p = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p.sub || null;
  } catch { return null; }
}

// ── claves de campaña ───────────────────────────────────────────────────────
// El id manda sobre el nombre: el nombre se puede cambiar en la red en
// cualquier momento y entonces los leads viejos quedarían colgando de un
// nombre que ya no existe, partiendo en dos una campaña que es una sola.
function normNombre(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}
function claveDeLead(l) {
  const cf = l.custom_fields || {};
  const id = String(cf['ID de campaña'] || '').trim();
  if (id) return 'id:' + id;
  const nom = normNombre(cf['Campaña']);
  return nom ? 'nom:' + nom : null;
}

// ── conexiones ──────────────────────────────────────────────────────────────
// `client_id` es texto en la base (ver el esquema de pipelines): comparar con
// eq. y el valor tal cual, sin castear.
async function conexionesDe(userId, clientId) {
  let ruta = `/platform_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&platform=in.(google_ads,meta_ads)` +
    `&select=id,platform,account_id,account_name,client_id,label,access_token,refresh_token,token_expires_at,updated_at,extra_data`;
  // Una conexión sin cliente asignado es «de la cuenta» y tiene que verse
  // TAMBIÉN dentro de un cliente. Filtrarla fuera es lo que hacía que la
  // pantalla dijera «no hay ninguna cuenta conectada» con una conectada
  // delante. Se muestra, marcada, para que se pueda asignar desde aquí.
  if (clientId) ruta += `&or=(client_id.eq.${encodeURIComponent(clientId)},client_id.is.null)`;
  return sb(ruta);
}

// ── Google Ads ──────────────────────────────────────────────────────────────
async function refrescarGoogle(fila) {
  const vence = fila.token_expires_at ? new Date(fila.token_expires_at).getTime() : 0;
  // Un minuto de margen: un token que caduca mientras vuela la petición da un
  // 401 que parece una desconexión y no lo es.
  if (vence && vence - 60000 > Date.now()) return fila.access_token;
  if (!fila.refresh_token) return fila.access_token;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: fila.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) return null;

  await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?id=eq.${fila.id}`, {
    method: 'PATCH', headers: sbHeaders(),
    body: JSON.stringify({
      access_token: d.access_token,
      token_expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});
  return d.access_token;
}

// Por dónde hay que preguntar por una cuenta publicitaria.
//
// Mandábamos SIEMPRE nuestro propio MCC como `login-customer-id`, y eso es
// falso: el cliente conecta SU cuenta de Google, no la nuestra. La cuenta de
// Certain cuelga del administrador del cliente, no del nuestro, y Google
// contestaba USER_PERMISSION_DENIED — un 403 que parecía un permiso caducado
// cuando el permiso estaba perfecto.
//
// La respuesta se guarda en la conexión: averiguarla cuesta una llamada por
// cada administrador al que llega el usuario, y no tiene sentido repetirlo.
async function porDondePreguntar(fila, token, cid) {
  const guardado = fila.extra_data && fila.extra_data.login_customer_id;
  if (guardado !== undefined && guardado !== null) return guardado || null;

  const h = { Authorization: `Bearer ${token}`, 'developer-token': DEV_TOKEN };
  const la = await fetch('https://googleads.googleapis.com/v22/customers:listAccessibleCustomers', { headers: h });
  if (!la.ok) throw new Error('google-auth:no se pudo listar las cuentas accesibles');
  const alcance = ((await la.json()).resourceNames || []).map(n => n.split('/').pop());

  let elegido = null;
  if (alcance.includes(cid)) {
    elegido = '';              // se llega directo: no hace falta cabecera
  } else {
    for (const m of alcance) {
      try {
        const r = await fetch(`https://googleads.googleapis.com/v22/customers/${m}/googleAds:search`, {
          method: 'POST',
          headers: { ...h, 'Content-Type': 'application/json', 'login-customer-id': m },
          body: JSON.stringify({ query: 'SELECT customer_client.id FROM customer_client' }),
        });
        if (!r.ok) continue;
        const filas = (await r.json()).results || [];
        if (filas.some(x => String(x.customerClient?.id) === cid)) { elegido = m; break; }
      } catch { /* un administrador que no contesta no puede parar la búsqueda */ }
    }
    if (elegido === null) throw new Error('google-auth:el permiso no llega a esa cuenta');
  }

  await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?id=eq.${fila.id}`, {
    method: 'PATCH', headers: sbHeaders(),
    body: JSON.stringify({ extra_data: { ...(fila.extra_data || {}), login_customer_id: elegido } }),
  }).catch(() => {});
  return elegido || null;
}

async function gaql(customerId, token, query, login) {
  const h = { Authorization: `Bearer ${token}`, 'developer-token': DEV_TOKEN, 'Content-Type': 'application/json' };
  if (login) h['login-customer-id'] = login;
  // Se prueban varias versiones porque Google retira las viejas sin avisarnos:
  // atarse a una sola convierte una depreciación en una pantalla en blanco.
  for (const v of [22, 21, 20]) {
    const r = await fetch(`https://googleads.googleapis.com/v${v}/customers/${customerId}/googleAds:search`, {
      method: 'POST', headers: h, body: JSON.stringify({ query }),
    });
    if (r.ok) return (await r.json()).results || [];
    if (r.status === 401 || r.status === 403) {
      const t = await r.text();
      throw new Error('google-auth:' + t.slice(0, 160));
    }
  }
  throw new Error('google: ninguna versión de la API respondió');
}

// Una conexión sin cuenta elegida no es un fallo de permisos ni de red: es que
// nunca se dijo QUÉ cuenta publicitaria leer. Se distingue a propósito, porque
// «no se pudo leer» mandaría a reconectar algo que está perfectamente bien.
class SinCuenta extends Error {
  constructor() { super('sin-cuenta'); this.sinCuenta = true; }
}

async function campanasGoogle(fila, desde, hasta) {
  if (!fila.account_id) throw new SinCuenta();
  const token = await refrescarGoogle(fila);
  if (!token) throw new Error('google-auth:sin token');
  const cid = String(fila.account_id || '').replace(/-/g, '');
  const login = await porDondePreguntar(fila, token, cid);
  const filas = await gaql(cid, token, `
    SELECT campaign.id, campaign.name, campaign.status, customer.currency_code,
           metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${desde}' AND '${hasta}'`, login);

  return filas.map(f => ({
    red: 'google',
    id: String(f.campaign?.id || ''),
    nombre: f.campaign?.name || '(sin nombre)',
    estado: (f.campaign?.status || '').toLowerCase(),
    moneda: f.customer?.currencyCode || null,
    inversion: Number(f.metrics?.costMicros || 0) / 1e6,
    impresiones: Number(f.metrics?.impressions || 0),
    clics: Number(f.metrics?.clicks || 0),
    // Para Google esto son CONVERSIONES, no necesariamente leads del
    // formulario. Se dice así en la interfaz para no mezclar dos cosas.
    conv: Number(f.metrics?.conversions || 0),
  }));
}

// ── Meta Ads ────────────────────────────────────────────────────────────────
async function campanasMeta(fila, desde, hasta) {
  if (!fila.account_id) throw new SinCuenta();
  const act = String(fila.account_id || '').replace(/^act_/, '');
  const rango = encodeURIComponent(JSON.stringify({ since: desde, until: hasta }));
  const url = `${GRAPH}/act_${act}/insights?level=campaign&time_range=${rango}` +
    `&fields=campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency` +
    `&limit=200&access_token=${encodeURIComponent(fila.access_token)}`;
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (d.error) throw new Error('meta-auth:' + String(d.error.message || '').slice(0, 160));

  // El estado no viene en insights; se pide aparte y se cruza por id.
  let estados = {};
  try {
    const re = await fetch(`${GRAPH}/act_${act}/campaigns?fields=id,status&limit=200&access_token=${encodeURIComponent(fila.access_token)}`);
    const de = await re.json();
    for (const c of de.data || []) estados[String(c.id)] = String(c.status || '').toLowerCase();
  } catch { /* sin estado se pinta «—», no se cae la pantalla */ }

  return (d.data || []).map(f => {
    const acciones = f.actions || [];
    const leads = acciones
      .filter(a => /lead/i.test(String(a.action_type || '')))
      .reduce((s, a) => s + Number(a.value || 0), 0);
    return {
      red: 'meta',
      id: String(f.campaign_id || ''),
      nombre: f.campaign_name || '(sin nombre)',
      estado: estados[String(f.campaign_id)] || '',
      moneda: f.account_currency || null,
      inversion: Number(f.spend || 0),
      impresiones: Number(f.impressions || 0),
      clics: Number(f.clicks || 0),
      conv: leads,
    };
  });
}

// ── el lado del CRM ─────────────────────────────────────────────────────────
async function leadsDelPeriodo(userId, clientId, desde, hasta, soloDe) {
  let ruta = `/leads?user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null` +
    `&created_at=gte.${desde}T00:00:00&created_at=lte.${hasta}T23:59:59` +
    `&select=id,name,stage,value,closed_at,close_reason,created_at,updated_at,assigned_name,custom_fields,pipeline_id,source` +
    `&order=created_at.desc&limit=2000`;
  if (clientId) ruta += `&client_id=eq.${encodeURIComponent(clientId)}`;
  if (soloDe) ruta += `&assigned_to=eq.${encodeURIComponent(soloDe)}`;
  return sb(ruta);
}

function resumenCrm(leads) {
  const r = { leads: leads.length, en_proceso: 0, ganados: 0, perdidos: 0, ingresos: 0 };
  for (const l of leads) {
    const et = String(l.stage || '').toLowerCase();
    const cerrado = l.closed_at || ETAPAS_CERRADAS.includes(et);
    if (ETAPAS_GANADAS.includes(et)) { r.ganados++; r.ingresos += Number(l.value || 0); }
    else if (ETAPAS_PERDIDAS.includes(et)) r.perdidos++;
    else if (!cerrado) r.en_proceso++;
  }
  return r;
}

// ── unir los dos mundos ─────────────────────────────────────────────────────
function unir(campanas, leads) {
  // Índice de leads por clave. Un lead con id casa por id; uno viejo, que solo
  // trae el nombre, casa por nombre normalizado.
  const porId = new Map(), porNombre = new Map(), huerfanos = [];
  for (const l of leads) {
    const cf = l.custom_fields || {};
    const id = String(cf['ID de campaña'] || '').trim();
    const nom = normNombre(cf['Campaña']);
    if (id) { if (!porId.has(id)) porId.set(id, []); porId.get(id).push(l); }
    else if (nom) { if (!porNombre.has(nom)) porNombre.set(nom, []); porNombre.get(nom).push(l); }
    else huerfanos.push(l);
  }

  const usados = new Set();
  const filas = campanas.map(c => {
    const suyos = [...(porId.get(c.id) || []), ...(porNombre.get(normNombre(c.nombre)) || [])];
    if (porId.has(c.id)) usados.add('id:' + c.id);
    if (porNombre.has(normNombre(c.nombre))) usados.add('nom:' + normNombre(c.nombre));
    const crm = resumenCrm(suyos);
    return {
      ...c,
      crm,
      // El CPL real se calcula sobre los que SÍ entraron al CRM, no sobre lo
      // que reporta la red: es el costo de un lead con el que se puede trabajar.
      cpl_real: crm.leads ? Math.round(c.inversion / crm.leads) : null,
      costo_por_venta: crm.ganados ? Math.round(c.inversion / crm.ganados) : null,
    };
  });

  // Leads que traen campaña pero cuya campaña no aparece en el período de la
  // red (se renombró, es de otra cuenta, o está fuera del rango de fechas).
  const sueltos = [];
  for (const [id, ls] of porId) if (!usados.has('id:' + id)) sueltos.push(...ls);
  for (const [nom, ls] of porNombre) if (!usados.has('nom:' + nom)) sueltos.push(...ls);

  return { filas, huerfanos, sueltos };
}

// ── manejadores ─────────────────────────────────────────────────────────────
function rangoPorDefecto(url) {
  const hoy = new Date();
  const hasta = url.searchParams.get('hasta') || hoy.toISOString().slice(0, 10);
  const d = new Date(hoy.getTime() - 29 * 86400000);
  const desde = url.searchParams.get('desde') || d.toISOString().slice(0, 10);
  return { desde, hasta };
}

// Trae las campañas de todas las conexiones en paralelo. Una conexión que
// falla NO tumba la pantalla: se devuelve su error y las demás se pintan.
async function traerCampanas(conexiones, desde, hasta) {
  const resultados = await Promise.all(conexiones.map(async c => {
    try {
      const filas = c.platform === 'google_ads'
        ? await campanasGoogle(c, desde, hasta)
        : await campanasMeta(c, desde, hasta);
      return { conexion: c, filas, error: null };
    } catch (e) {
      const msg = String(e.message || e);
      if (e.sinCuenta) {
        return { conexion: c, filas: [], sin_cuenta: true, error: 'Falta elegir cuál cuenta publicitaria leer.' };
      }
      return {
        conexion: c, filas: [],
        error: /auth/.test(msg)
          ? 'El permiso de esta cuenta caducó. Hay que volver a conectarla.'
          : 'No se pudo leer esta cuenta ahora mismo.',
      };
    }
  }));
  return resultados;
}

function estadoConexion(r) {
  return {
    id: r.conexion.id,
    red: r.conexion.platform === 'google_ads' ? 'google' : 'meta',
    cuenta: r.conexion.account_name || r.conexion.account_id,
    account_id: r.conexion.account_id,
    client_id: r.conexion.client_id || null,
    campanas: r.filas.length,
    sin_cuenta: !!r.sin_cuenta,
    // Sin cliente asignado, sus cifras salen igual dentro de CADA cliente: la
    // misma inversión contada varias veces. Se avisa en vez de repartirla.
    sin_cliente: !r.conexion.client_id,
    error: r.error,
  };
}

// Si dos cuentas facturan en monedas distintas, sumar sus inversiones da un
// número que no significa nada. Antes que un total falso, ninguno.
function monedaDe(filas) {
  const ms = [...new Set(filas.map(f => f.moneda).filter(Boolean))];
  return ms.length === 1 ? ms[0] : null;
}

async function listaDeCampanas(quien, url) {
  const { desde, hasta } = rangoPorDefecto(url);
  const clientId = url.searchParams.get('client_id') || null;
  const soloDe = soloSusLeads(quien.perfil) ? quien.actorId : null;

  const conexiones = await conexionesDe(quien.userId, clientId);
  const [resultados, leads] = await Promise.all([
    traerCampanas(conexiones, desde, hasta),
    leadsDelPeriodo(quien.userId, clientId, desde, hasta, soloDe),
  ]);

  const campanas = resultados.flatMap(r => r.filas);
  const { filas, huerfanos, sueltos } = unir(campanas, leads);
  filas.sort((a, b) => b.inversion - a.inversion);

  const moneda = monedaDe(campanas);
  const invTotal = campanas.reduce((s, c) => s + c.inversion, 0);
  const crmTotal = resumenCrm(leads.filter(l => claveDeLead(l)));
  const sinCampana = resumenCrm(huerfanos);

  return jsonResp({
    desde, hasta,
    moneda,
    moneda_mixta: moneda === null && campanas.length > 0,
    conexiones: resultados.map(estadoConexion),
    campanas: filas,
    sin_campana: { ...sinCampana, motivo: 'Entraron sin el dato de campaña, o por una fuente que no lo manda.' },
    fuera_de_rango: resumenCrm(sueltos),
    totales: {
      inversion: moneda === null ? null : Math.round(invTotal),
      ...crmTotal,
      cpl_real: (moneda !== null && crmTotal.leads) ? Math.round(invTotal / crmTotal.leads) : null,
      conv_plataforma: campanas.reduce((s, c) => s + c.conv, 0),
    },
    solo_mios: !!soloDe,
  });
}

async function detalleDeCampana(quien, url) {
  const { desde, hasta } = rangoPorDefecto(url);
  const clientId = url.searchParams.get('client_id') || null;
  const clave = url.searchParams.get('campana');
  const soloDe = soloSusLeads(quien.perfil) ? quien.actorId : null;

  const conexiones = await conexionesDe(quien.userId, clientId);
  const [resultados, leads] = await Promise.all([
    traerCampanas(conexiones, desde, hasta),
    leadsDelPeriodo(quien.userId, clientId, desde, hasta, soloDe),
  ]);

  const campanas = resultados.flatMap(r => r.filas);
  const campana = clave === 'sin-campana'
    ? { red: null, id: 'sin-campana', nombre: 'Sin campaña identificada', estado: '', moneda: null, inversion: 0, impresiones: 0, clics: 0, conv: 0 }
    : campanas.find(c => c.id === clave || normNombre(c.nombre) === normNombre(clave));
  if (!campana) return jsonResp({ error: 'No encontramos esa campaña en el período elegido.' }, 404);

  const suyos = clave === 'sin-campana'
    ? leads.filter(l => !claveDeLead(l))
    : leads.filter(l => {
        const k = claveDeLead(l);
        return k === 'id:' + campana.id || k === 'nom:' + normNombre(campana.nombre);
      });

  // El embudo se pinta con los rótulos del tablero, no con las claves: en
  // Certain la clave «propuesta» se llama «Cita de inmueble», y enseñar la
  // clave sería enseñar una etapa que nadie reconoce.
  const pids = [...new Set(suyos.map(l => l.pipeline_id).filter(Boolean))];
  let etapas = [];
  if (pids.length) {
    etapas = await sb(`/pipeline_stages?pipeline_id=in.(${pids.join(',')})&select=key,label,position&order=position.asc`);
  }
  const rotulo = {};
  for (const e of etapas) if (!rotulo[e.key]) rotulo[e.key] = e.label;

  const cuenta = {};
  for (const l of suyos) {
    const k = String(l.stage || 'nuevo').toLowerCase();
    cuenta[k] = (cuenta[k] || 0) + 1;
  }
  const orden = etapas.length ? [...new Set(etapas.map(e => e.key))] : Object.keys(cuenta);
  const embudo = orden
    .filter(k => cuenta[k])
    .map(k => ({ key: k, etiqueta: rotulo[k] || k, n: cuenta[k], pct: Math.round(cuenta[k] / (suyos.length || 1) * 100) }));

  const motivos = {};
  for (const l of suyos) {
    if (!ETAPAS_PERDIDAS.includes(String(l.stage || '').toLowerCase())) continue;
    const m = l.close_reason || 'Sin motivo registrado';
    motivos[m] = (motivos[m] || 0) + 1;
  }

  // Desglose por conjunto y anuncio, con los datos que el propio lead guardó.
  const desglose = {};
  for (const l of suyos) {
    const cf = l.custom_fields || {};
    const k = (cf['Conjunto'] || '(sin conjunto)') + ' · ' + (cf['Anuncio'] || '(sin anuncio)');
    if (!desglose[k]) desglose[k] = { etiqueta: k, leads: 0, avanzados: 0 };
    desglose[k].leads++;
    const et = String(l.stage || '').toLowerCase();
    if (!['nuevo', 'new'].includes(et) && !ETAPAS_PERDIDAS.includes(et)) desglose[k].avanzados++;
  }

  const ahora = Date.now();
  return jsonResp({
    desde, hasta,
    campana,
    crm: resumenCrm(suyos),
    cpl_real: suyos.length ? Math.round(campana.inversion / suyos.length) : null,
    embudo,
    motivos: Object.entries(motivos).map(([m, n]) => ({ motivo: m, n })).sort((a, b) => b.n - a.n),
    desglose: Object.values(desglose).sort((a, b) => b.leads - a.leads),
    leads: suyos.map(l => ({
      id: l.id, nombre: l.name, etapa: l.stage,
      etapa_etiqueta: rotulo[String(l.stage || '').toLowerCase()] || l.stage,
      responsable: l.assigned_name || null,
      conjunto: (l.custom_fields || {})['Conjunto'] || null,
      valor: l.value || null,
      cerrado: !!(l.closed_at || ETAPAS_CERRADAS.includes(String(l.stage || '').toLowerCase())),
      dias_sin_tocar: Math.floor((ahora - new Date(l.updated_at || l.created_at).getTime()) / 86400000),
    })).sort((a, b) => (b.cerrado ? -1 : b.dias_sin_tocar) - (a.cerrado ? -1 : a.dias_sin_tocar)),
  });
}

async function vistaDeCartera(quien, url) {
  const { desde, hasta } = rangoPorDefecto(url);

  const [conexiones, leads, clientes] = await Promise.all([
    conexionesDe(quien.userId, null),
    leadsDelPeriodo(quien.userId, null, desde, hasta, null),
    sb(`/client_dashboards?user_id=eq.${encodeURIComponent(quien.userId)}&select=id,client_name&order=client_name.asc`).catch(() => []),
  ]);

  const resultados = await traerCampanas(conexiones, desde, hasta);

  // Se agrupa por el cliente de la CONEXIÓN, que es el que define de quién es
  // esa inversión. Los leads se agrupan por su propio client_id.
  const porCliente = new Map();
  const tocar = (cid) => {
    const k = cid || '__sin__';
    if (!porCliente.has(k)) porCliente.set(k, { client_id: cid || null, redes: [], inversion: 0, moneda: null, campanas: 0, errores: [], leads: [] });
    return porCliente.get(k);
  };
  for (const r of resultados) {
    const e = tocar(r.conexion.client_id);
    const red = r.conexion.platform === 'google_ads' ? 'google' : 'meta';
    if (!e.redes.includes(red)) e.redes.push(red);
    if (r.error) { e.errores.push({ red, error: r.error }); continue; }
    e.campanas += r.filas.length;
    e.inversion += r.filas.reduce((s, f) => s + f.inversion, 0);
    const m = monedaDe(r.filas);
    e.moneda = e.moneda && m && e.moneda !== m ? null : (e.moneda || m);
  }
  for (const l of leads) {
    if (!claveDeLead(l)) continue;
    tocar(l.client_id).leads.push(l);
  }

  const nombre = {};
  for (const c of clientes || []) nombre[c.id] = c.client_name;

  const filas = [...porCliente.values()].map(e => {
    const crm = resumenCrm(e.leads);
    const sano = !e.errores.length;
    return {
      client_id: e.client_id,
      cliente: e.client_id ? (nombre[e.client_id] || 'Cliente ' + String(e.client_id).slice(0, 8)) : 'Mi cuenta',
      redes: e.redes,
      campanas: e.campanas,
      // Con un permiso caducado la columna va en BLANCO, nunca en cero: un
      // cero diría que la campaña no gastó, y eso es una afirmación falsa.
      inversion: sano ? Math.round(e.inversion) : null,
      moneda: e.moneda,
      ...crm,
      cpl_real: (sano && crm.leads) ? Math.round(e.inversion / crm.leads) : null,
      errores: e.errores,
    };
  }).sort((a, b) => (b.inversion || 0) - (a.inversion || 0));

  return jsonResp({ desde, hasta, clientes: filas });
}

// ── elegir qué cuenta publicitaria leer ─────────────────────────────────────
// Hasta hoy la cuenta se escogía en el navegador y vivía en sessionStorage, así
// que el servidor no sabía cuál leer y la conexión quedaba a medias. Aquí se
// elige una vez y se guarda con la conexión.
async function cuentasDisponibles(quien, url) {
  const id = url.searchParams.get('cuentas');
  const fila = (await sb(`/platform_connections?id=eq.${encodeURIComponent(id)}` +
    `&user_id=eq.${encodeURIComponent(quien.userId)}&select=*&limit=1`))[0];
  if (!fila) return jsonResp({ error: 'Esa conexión no es de tu cuenta.' }, 404);

  if (fila.platform === 'meta_ads') {
    const r = await fetch(`${GRAPH}/me/adaccounts?fields=account_id,name&limit=100` +
      `&access_token=${encodeURIComponent(fila.access_token)}`);
    const d = await r.json().catch(() => ({}));
    if (d.error) return jsonResp({ error: 'Meta no nos dejó ver tus cuentas: ' + String(d.error.message || '').slice(0, 120) }, 502);
    return jsonResp({ cuentas: (d.data || []).map(c => ({ id: 'act_' + c.account_id, nombre: c.name || c.account_id })) });
  }

  const token = await refrescarGoogle(fila);
  if (!token) return jsonResp({ error: 'El permiso de Google caducó. Vuelve a conectar la cuenta.' }, 502);
  const h = { Authorization: `Bearer ${token}`, 'developer-token': DEV_TOKEN };
  let raices = [];
  for (const v of [22, 21, 20]) {
    const r = await fetch(`https://googleads.googleapis.com/v${v}/customers:listAccessibleCustomers`, { headers: h });
    if (r.ok) { raices = ((await r.json()).resourceNames || []).map(n => n.split('/').pop()); break; }
  }
  if (!raices.length) return jsonResp({ cuentas: [] });

  // Hay que BAJAR por la jerarquía. `listAccessibleCustomers` devuelve solo las
  // cuentas a las que se llega de primera mano —en Certain, 11— y la del
  // cliente no estaba entre ellas: cuelga de un administrador suyo. Preguntando
  // solo por las de primera mano, la cuenta que se quiere leer ni aparecía.
  //
  // De cada administrador se anota POR DÓNDE se llegó: ese es el
  // `login-customer-id` que luego hay que mandar, y sin él Google contesta que
  // no hay permiso aunque lo haya.
  const vistas = new Map();
  await Promise.all(raices.map(async raiz => {
    try {
      const r = await fetch(`https://googleads.googleapis.com/v22/customers/${raiz}/googleAds:search`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json', 'login-customer-id': raiz },
        body: JSON.stringify({
          query: 'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, ' +
                 'customer_client.currency_code, customer_client.status FROM customer_client',
        }),
      });
      if (!r.ok) return;
      for (const f of (await r.json()).results || []) {
        const c = f.customerClient || {};
        const id = String(c.id || '');
        // Una cuenta administradora no tiene campañas propias: ofrecerla sería
        // ofrecer una pantalla que siempre saldría vacía.
        if (!id || c.manager) continue;
        if (c.status && c.status !== 'ENABLED') continue;
        if (!vistas.has(id)) {
          vistas.set(id, {
            id,
            nombre: (c.descriptiveName ? c.descriptiveName + ' · ' : '') + id +
                    (c.currencyCode ? ' · ' + c.currencyCode : ''),
            login: id === raiz ? '' : raiz,
          });
        }
      }
    } catch { /* un administrador que no contesta no puede vaciar la lista */ }
  }));

  const cuentas = [...vistas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return jsonResp({ cuentas });
}

async function guardarEleccion(quien, req) {
  // Un comercial no reconfigura de dónde salen los datos de toda la cuenta.
  if (soloSusLeads(quien.perfil)) {
    return jsonResp({ error: 'Tu perfil no puede cambiar las conexiones de pauta. Pídeselo al administrador.' }, 403);
  }
  const body = await req.json().catch(() => ({}));

  // Se puede llamar con el id de la conexión (desde esta pantalla) o con la
  // plataforma (desde el selector de cuentas de Ajustes, que no conoce el id).
  let fila;
  if (body.conexion_id) {
    fila = (await sb(`/platform_connections?id=eq.${encodeURIComponent(body.conexion_id)}` +
      `&user_id=eq.${encodeURIComponent(quien.userId)}&select=id&limit=1`))[0];
  } else if (body.plataforma) {
    fila = (await sb(`/platform_connections?platform=eq.${encodeURIComponent(body.plataforma)}` +
      `&user_id=eq.${encodeURIComponent(quien.userId)}&select=id&order=updated_at.desc&limit=1`))[0];
  }
  if (!fila) return jsonResp({ error: 'No encontramos esa conexión en tu cuenta.' }, 404);
  const id = fila.id;

  const cambios = { updated_at: new Date().toISOString() };
  if (body.account_id !== undefined) cambios.account_id = body.account_id || null;
  if (body.account_name !== undefined) cambios.account_name = body.account_name || null;
  // Por dónde preguntar por esa cuenta. Se guarda al elegirla porque en ese
  // momento ya se sabe; si no viene, se borra lo que hubiera para que se
  // vuelva a averiguar contra la cuenta nueva y no se herede la anterior.
  if (body.account_id !== undefined) {
    const previo = (await sb(`/platform_connections?id=eq.${encodeURIComponent(id)}&select=extra_data&limit=1`))[0];
    cambios.extra_data = { ...((previo && previo.extra_data) || {}) };
    if (body.login !== undefined && body.login !== null) cambios.extra_data.login_customer_id = body.login;
    else delete cambios.extra_data.login_customer_id;
  }
  // client_id es texto en la base; '' significa «de la cuenta», no de un cliente.
  if (body.client_id !== undefined) cambios.client_id = body.client_id || null;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(cambios),
  });
  if (!r.ok) return jsonResp({ error: 'No se pudo guardar la elección.' }, 500);
  return jsonResp({ ok: true });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResp({ error: 'Method not allowed' }, 405);

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  try {
    const quien = await quienPregunta(userId);
    const corte = exigeModulo(quien, 'marketing');
    if (corte) return corte;

    if (req.method === 'POST') return await guardarEleccion(quien, req);

    const url = new URL(req.url);
    if (url.searchParams.get('cuentas')) return await cuentasDisponibles(quien, url);
    if (url.searchParams.get('cartera')) return await vistaDeCartera(quien, url);
    if (url.searchParams.get('campana')) return await detalleDeCampana(quien, url);
    return await listaDeCampanas(quien, url);
  } catch (e) {
    console.error('[pauta]', e);
    return jsonResp({ error: 'No pudimos leer tus campañas ahora mismo. Vuelve a intentarlo en un momento.' }, 500);
  }
}
