// api/campaigns.js
// Campañas masivas de email y WhatsApp segmentadas por etiquetas/etapa/fuente.
// El envío real lo hace api/cron-campaigns.js por lotes; aquí vive el CRUD,
// el resolver de audiencia, la cola (con cupo mensual por plan) y las stats.
// Reglas de costo/reputación: cupo de emails por plan, exclusión automática
// de leads con etiqueta 'no-email' (baja) y de leads sin email/teléfono.
export const config = { runtime: 'edge' };

import { quienPregunta, puedeVer, exigeModulo, alcanceDeCliente } from './_perfiles.js';

import { campaignHtml } from './_campaign-email.js';

// PostgREST corta en 1.000 filas aunque se le pida más. Aquí eso significaba
// que una audiencia de 4.000 salía a mil personas sin decirlo. Ver _paginado.js.
import { traerTodo } from './_paginado.js';

// La conexión de WhatsApp del cliente: de ahí salen el waba_id y el token con
// los que se le pregunta a Meta por el estado de una plantilla.
import { conexionWhatsapp, plantillasDeMeta, huecosDe } from './_whatsapp.js';


// ── Plan del usuario ──────────────────────────────────────────────────────────
// Clerk dejó de incluir public_metadata en el token de sesión (formato v2), así
// que el plan ya no viaja en el JWT y todo usuario de pago se leía como "free".
// Cuando el token no lo trae, se consulta a Clerk y se cachea un minuto.
const _planCache = new Map();
async function clerkMeta(userId) {
  if (!userId || !process.env.CLERK_SECRET_KEY) return {};
  const hit = _planCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.meta;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const u = await r.json();
    const meta = Object.assign({}, u.public_metadata || {});
    meta._email = (u.email_addresses?.[0]?.email_address || '').toLowerCase();
    meta._creada = u.created_at || null;
    _planCache.set(userId, { meta, exp: Date.now() + 60000 });
    return meta;
  } catch { return {}; }
}

import { registrarUso, cuentaDe } from './_uso-ia.js';
import { enviarResend } from './_correo.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Cupo de emails de campaña por mes calendario
// Infinity = sin tope. Los planes de pago no tienen limite de envios; free sigue en 0
// (las campanas masivas son de pago). Las automatizaciones nunca consumieron cupo:
// monthlySent solo cuenta envios con campaign_id.
const EMAIL_QUOTAS = { free: 0, pro: Infinity, individual: Infinity, agency: Infinity, agencia: Infinity, trial: Infinity };

// Tope de correos AL DÍA por cuenta. El cupo mensual no sirve de freno: el
// 21-09-2026 una cuenta recién creada pagó Agencia, importó 5.000 contactos y
// disparó una campaña de phishing 22 minutos después de registrarse. Agotó la
// cuota diaria del proveedor y dejó sin correo a todos los demás — los avisos,
// las campañas y las invitaciones de equipo de los clientes de verdad.
//
// El tope NO es un número fijo: sale de los contactos que el plan permite.
// Vendemos «envíos ilimitados» y eso es verdad — lo que se paga son contactos,
// no correos. Un número fijo rompería la promesa en cuanto alguien comprara
// paquetes de contactos: un Agency con 7.000 contactos y un techo de 5.000 no
// podría escribirle a su propia base. Derivarlo deja pasar siempre el envío
// completo y sigue frenando al que quiere mandar 20.000 desde un plan de 1.000.
const CONTACTOS_PLAN = { free: 50, pro: 1000, individual: 1000, trial: 1000, agency: 5000, agencia: 5000 };
const PAQUETE_CONTACTOS = 1000; // lo que suma cada paquete extra comprado
const RECORRIDOS_DIA = 3;       // veces que puede recorrer su base entera en un día

function topeDiario(plan, leadsExtra) {
  if (plan === 'free') return 0; // las campañas masivas son de pago
  const base = CONTACTOS_PLAN[plan] ?? 1000;
  return (base + (parseInt(leadsExtra || 0) || 0) * PAQUETE_CONTACTOS) * RECORRIDOS_DIA;
}

// Una cuenta con pocas horas de vida no dispara una campaña masiva. Quien
// llega a hacer marketing de verdad prepara su base antes; quien se registra y
// manda 5.000 correos en veinte minutos no está haciendo marketing.
const HORAS_DE_GRACIA  = 24;
const TOPE_CUENTA_NUEVA = 300;

// Hasta dónde llega una audiencia antes de que prefiramos parar y decirlo. Son
// 100 viajes a la base: por encima de esto el envío hay que repensarlo, no
// resolverlo trayendo más filas a una función que dura segundos.
const TECHO_AUDIENCIA = 100000;


function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': prefer || 'return=representation',
  };
}

let _lastPlan = 'free';
let _emailsExtra = 0; // paquetes de 2.000 emails/mes comprados (Hotmart → Clerk emails_extra)
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    const meta = payload.public_metadata || payload.publicMetadata || {};
    _lastPlan = meta.plan || 'free';
    _emailsExtra = parseInt(meta.emails_extra || 0) || 0;
    return payload.sub || null;
  } catch { return null; }
}

const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];
async function isAdmin(userId) {
  if (!userId || !process.env.CLERK_SECRET_KEY) return false;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const u = await r.json();
    return ADMIN_EMAILS.includes((u.email_addresses?.[0]?.email_address || '').toLowerCase());
  } catch { return false; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Audiencia: etiquetas (ANY de las seleccionadas), etapa y fuente opcionales.
// Excluye siempre leads dados de baja (etiqueta no-email) en canal email.
function audienceQuery(userId, clientId, audience, channel) {
  const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
  let q = `user_id=eq.${encodeURIComponent(userId)}${scope}&deleted_at=is.null`;
  const a = audience || {};
  if (Array.isArray(a.tags) && a.tags.length) {
    q += `&tags=ov.{${a.tags.map(t => '"' + String(t).replace(/["{}\\]/g, '') + '"').join(',')}}`;
  }
  if (a.stage) q += `&stage=eq.${encodeURIComponent(a.stage)}`;
  if (a.source) q += `&source=eq.${encodeURIComponent(a.source)}`;
  if (channel === 'email') q += `&email=not.is.null&tags=not.cs.{"no-email"}`;
  if (channel === 'whatsapp') q += `&phone=not.is.null`;
  return q;
}

// Una lista guardada se traduce a su audiencia real: estática → lead_ids,
// dinámica → sus filtros. Lista borrada → audiencia vacía (no enviar a todos).
async function normalizeAudience(userId, audience) {
  const a = audience || {};
  if (!a.list_id) return a;
  try {
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/lead_lists?id=eq.${encodeURIComponent(a.list_id)}&user_id=eq.${encodeURIComponent(userId)}&select=*`, { headers: sbHeaders() }).then(r => r.json());
    const l = rows?.[0];
    if (!l) return { lead_ids: ['00000000-0000-0000-0000-000000000000'] };
    return l.kind === 'static' ? { lead_ids: l.lead_ids || [] } : (l.filters || {});
  } catch { return { lead_ids: ['00000000-0000-0000-0000-000000000000'] }; }
}

// Selección manual: cargar leads por id en chunks (respeta scope y exclusiones de canal)
async function leadsByIds(userId, clientId, ids, channel, select) {
  const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
  let ch = '';
  if (channel === 'email') ch = `&email=not.is.null&tags=not.cs.{"no-email"}`;
  if (channel === 'whatsapp') ch = `&phone=not.is.null`;
  const out = [];
  for (let i = 0; i < ids.length; i += 150) {
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}${scope}&deleted_at=is.null&id=in.(${ids.slice(i, i + 150).join(',')})${ch}&select=${select}`, { headers: sbHeaders() }).then(r => r.json());
    out.push(...(rows || []));
  }
  return out;
}

// Correos que NUNCA deben recibir otra campaña. Resend nos avisa de los rebotes
// duros y de las quejas de spam, y los guardábamos en email_events sin que nadie
// los leyera nunca: seguíamos escribiendo a buzones muertos. Eso no es solo
// inútil, quema la reputación del dominio — y el dominio es el mismo para TODOS
// los clientes, así que el descuido de uno se lo come el resto.
// OJO: NO se filtra por user_id. api/resend-webhook.js guarda estos eventos sin
// él —solo resend_id, event y to_email— así que filtrar por cuenta no devolvería
// absolutamente nada y la supresión no haría nada, en silencio.
//
// Y además es lo correcto: el dominio remitente es compartido, así que un rebote
// duro es un hecho del BUZÓN, no de la cuenta. Solo se comprueba contra las
// direcciones de la propia audiencia, así que nadie ve datos de nadie.
async function correosQuemados() {
  try {
    // Esta lista es lo único que impide reescribirle a una dirección que ya
    // rebotó. Cortada en mil, a partir del rebote 1.001 volvíamos a escribirle
    // a todos los anteriores — que es exactamente como se quema un dominio.
    const { filas } = await traerTodo(
      `${SUPABASE_URL}/rest/v1/email_events?event=in.(bounced,complained)&select=to_email`,
      sbHeaders(), { techo: 100000 }
    );
    return new Set((filas || []).map(f => String(f.to_email || '').toLowerCase()).filter(Boolean));
  } catch { return new Set(); }
}

// Los ids que hay que sacar: los de las listas de exclusión y los de las
// etiquetas excluidas. Una lista dinámica se resuelve a sus leads en el momento,
// para que excluir «clientes actuales» siga funcionando cuando entren nuevos.
async function idsExcluidos(userId, clientId, audience) {
  const a = audience || {};
  const listas = Array.isArray(a.exclude_list_ids) ? a.exclude_list_ids.slice(0, 20) : [];
  const etiquetas = Array.isArray(a.exclude_tags) ? a.exclude_tags.slice(0, 20) : [];
  if (!listas.length && !etiquetas.length) return new Set();
  const fuera = new Set();

  for (const lid of listas) {
    const sub = await normalizeAudience(userId, { list_id: lid });
    let filas = [];
    if (Array.isArray(sub.lead_ids) && sub.lead_ids.length) {
      filas = await leadsByIds(userId, clientId, sub.lead_ids, null, 'id');
    } else if (Object.keys(sub).length) {
      // Una exclusión cortada es peor que ninguna: se le escribe a quien pidió
      // que no le escribieran y nadie se entera hasta que se queja.
      filas = await traerTodo(`${SUPABASE_URL}/rest/v1/leads?${audienceQuery(userId, clientId, sub, null)}&select=id`,
        sbHeaders(), { techo: 100000 }).then(r => r.filas).catch(() => []);
    }
    (filas || []).forEach(l => fuera.add(l.id));
  }

  if (etiquetas.length) {
    const q = audienceQuery(userId, clientId, { tags: etiquetas }, null);
    const filas = await traerTodo(`${SUPABASE_URL}/rest/v1/leads?${q}&select=id`,
      sbHeaders(), { techo: 100000 }).then(r => r.filas).catch(() => []);
    (filas || []).forEach(l => fuera.add(l.id));
  }
  return fuera;
}

// Devuelve { leads, truncado }. `truncado` no es decorativo: si viene true la
// audiencia está incompleta y NO se puede encolar la campaña, porque enviarla
// dejaría fuera a gente sin que nadie lo sepa.
async function resolveAudience(userId, clientId, audience, channel) {
  const a = await normalizeAudience(userId, audience);
  let base, truncado = false;
  if (Array.isArray(a.lead_ids) && a.lead_ids.length) {
    base = await leadsByIds(userId, clientId, a.lead_ids, channel, 'id,name,email,phone');
  } else {
    const q = audienceQuery(userId, clientId, a, channel);
    const r = await traerTodo(`${SUPABASE_URL}/rest/v1/leads?${q}&select=id,name,email,phone`,
      sbHeaders(), { techo: TECHO_AUDIENCIA });
    base = r.filas || [];
    truncado = r.truncado;
  }
  // Las exclusiones se aplican sobre la audiencia YA resuelta, no dentro de la
  // consulta: mezclarlas en el filtro haría imposible contar cuántos se quitan y
  // por qué, que es justo lo que hay que enseñar antes de enviar.
  const fuera = await idsExcluidos(userId, clientId, audience);
  const quemados = channel === 'email' ? await correosQuemados() : new Set();
  const leads = base.filter(l => !fuera.has(l.id) && !(channel === 'email' && quemados.has(String(l.email || '').toLowerCase())));
  return { leads, truncado };
}

/**
 * ¿Puede salir esta campaña de WhatsApp? Devuelve null si sí, o el error a
 * enseñar. Se pregunta a Meta en el momento porque una plantilla aprobada se
 * puede pausar por calidad de un día para otro: fiarnos de una copia nuestra
 * sería enterarnos del bloqueo con la campaña ya encolada.
 */
async function revisarPlantilla(userId, clientId, wa) {
  if (!wa || !wa.name) {
    return {
      error: 'Esta campaña no usa una plantilla aprobada, así que WhatsApp solo la entregará a quien te haya escrito en las últimas 24 horas. Elige una plantilla para llegar a toda tu audiencia.',
      sin_plantilla: true,
    };
  }
  const conn = await conexionWhatsapp(userId, clientId);
  if (!conn) return { error: 'No hay un canal de WhatsApp conectado en esta cuenta.' };
  if (!conn.waba_id || !conn.access_token) {
    return { error: 'Para usar plantillas falta el WhatsApp Business Account ID de este canal. Reconéctalo en Ajustes → Canales: te lo pedirá junto al Phone Number ID.' };
  }
  const res = await plantillasDeMeta(conn, 'name,status,language,components');
  if (!res.ok) return { error: 'No se pudo comprobar la plantilla con Meta: ' + res.aviso };
  const t = res.plantillas.find(x => x.name === wa.name && x.language === wa.language);
  if (!t) return { error: `La plantilla «${wa.name}» (${wa.language}) ya no existe en tu cuenta de WhatsApp.` };
  if (t.status !== 'APPROVED') {
    return { error: `La plantilla «${wa.name}» está en estado ${t.status}. Solo se pueden enviar las aprobadas.`, estado: t.status };
  }
  // Una plantilla con cabecera de imagen exige la imagen en CADA envío. Sin
  // ella Meta rechaza uno por uno y la campaña se gasta entera en errores.
  if (huecosDe(t.components).header_format === 'IMAGE' && !wa.header_image) {
    return { error: `La plantilla «${wa.name}» lleva una imagen en la cabecera y esta campaña no tiene ninguna. Elígela en el paso de Contenido.`, falta_imagen: true };
  }
  return null;
}

// Emails de campaña enviados este mes (para el cupo)
async function monthlySent(userId) {
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/email_events?user_id=eq.${encodeURIComponent(userId)}&event=eq.sent&campaign_id=not.is.null&created_at=gte.${monthStart.toISOString()}&select=id&limit=0`,
    { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } }
  );
  return parseInt((r.headers.get('content-range') || '*/0').split('/')[1] || '0') || 0;
}

async function dailySent(userId) {
  const desde = new Date(); desde.setUTCHours(0, 0, 0, 0);
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/email_events?user_id=eq.${encodeURIComponent(userId)}&event=eq.sent&campaign_id=not.is.null&created_at=gte.${desde.toISOString()}&select=id&limit=0`,
    { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } }
  );
  return parseInt((r.headers.get('content-range') || '*/0').split('/')[1] || '0') || 0;
}

// ── El historial de envíos de un contacto ───────────────────────────────────

const ESTADO_ENVIO = {
  sent: 'Enviado', failed: 'Falló', skipped: 'No se le envió', pending: 'En cola',
};
// Lo que hizo con el correo, de menos a más. Se queda con lo más avanzado: si
// hizo clic, decir «abierto» se queda corto.
const ESCALA = ['delivered', 'opened', 'clicked'];
const REACCION = {
  delivered: 'Entregado', opened: 'Abierto', clicked: 'Hizo clic',
  bounced: 'Rebotó', complained: 'Lo marcó como spam',
};

/**
 * Qué campañas le tocaron a este lead, en qué acabó cada una y qué hizo con
 * ella. Devuelve también si su dirección está quemada.
 *
 * Exportada aparte del handler para poder ejecutarla de verdad en
 * pruebas/campanas-ficha.mjs: aquí lo que se puede equivocar en silencio no es
 * el código, son los dos empalmes de datos que hay debajo.
 */
export async function historialDelLead(userId, leadId, quien) {
  // 0. El lead, que trae su dirección y su cliente. La dirección se busca
  //    aquí y no se recibe por parámetro: un correo en la barra de
  //    direcciones acaba en los registros de medio mundo.
  const lr = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&user_id=eq.${encodeURIComponent(userId)}&select=email,client_id`,
    { headers: sbHeaders() }
  );
  if (!lr.ok) throw new Error('No se pudo leer el contacto');
  const lead = ((await lr.json()) || [])[0];
  if (!lead) return { envios: [], quemado: null };
  if (quien && quien.cliente && String(lead.client_id || '') !== String(quien.cliente)) {
    return { envios: [], quemado: null };
  }

  // 1. Las filas de destinatario. OJO: campaign_recipients NO tiene user_id,
  //    así que esta consulta sola devolvería filas de cualquiera. El alcance
  //    se pone abajo, comprobando que la campaña sea de esta cuenta.
  const rr = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_recipients?lead_id=eq.${leadId}` +
    `&select=campaign_id,status,detail,resend_id,processed_at&order=processed_at.desc&limit=25`,
    { headers: sbHeaders() }
  );
  if (!rr.ok) throw new Error('No se pudo leer el historial de campañas');
  const filas = (await rr.json()) || [];

  // 2. Las campañas, que son las que traen la cuenta y el cliente. Una fila
  //    cuya campaña no salga aquí NO es de esta cuenta y no se devuelve.
  const ids = [...new Set(filas.map(f => f.campaign_id).filter(Boolean))];
  let campanas = [];
  if (ids.length) {
    const cr = await fetch(
      `${SUPABASE_URL}/rest/v1/campaigns?id=in.(${ids.join(',')})&user_id=eq.${encodeURIComponent(userId)}` +
      `&select=id,name,channel,subject,client_id,sent_at,created_at`,
      { headers: sbHeaders() }
    );
    campanas = cr.ok ? ((await cr.json()) || []) : [];
  }
  // Y un miembro acotado a un cliente tampoco ve las campañas de otro.
  if (quien && quien.cliente) {
    campanas = campanas.filter(c => String(c.client_id || '') === String(quien.cliente));
  }
  const porId = new Map(campanas.map(c => [c.id, c]));

  // 3. Qué hizo con cada correo. El webhook de Resend guarda estos eventos SIN
  //    lead_id y SIN campaign_id —solo sabe el resend_id—, así que no se
  //    pueden pedir por lead: hay que empalmarlos por ese id. Pedirlos por
  //    lead_id devolvería cero, y la caja diría «nadie abrió nada».
  const envios = filas.filter(f => porId.has(f.campaign_id));
  const rids = envios.map(f => f.resend_id).filter(Boolean);
  const reaccion = new Map();
  for (let i = 0; i < rids.length; i += 100) {
    const trozo = rids.slice(i, i + 100).map(x => '"' + x + '"').join(',');
    const er = await fetch(
      `${SUPABASE_URL}/rest/v1/email_events?resend_id=in.(${trozo})` +
      `&event=in.(delivered,opened,clicked,bounced,complained)&select=resend_id,event`,
      { headers: sbHeaders() }
    );
    for (const e of (er.ok ? ((await er.json()) || []) : [])) {
      const antes = reaccion.get(e.resend_id);
      // Un rebote o una queja mandan sobre cualquier otra cosa: son el final
      // del camino, no un paso más.
      if (antes === 'bounced' || antes === 'complained') continue;
      if (e.event === 'bounced' || e.event === 'complained') { reaccion.set(e.resend_id, e.event); continue; }
      if (!antes || ESCALA.indexOf(e.event) > ESCALA.indexOf(antes)) reaccion.set(e.resend_id, e.event);
    }
  }

  return {
    // Un rebote duro saca la dirección de TODAS las campañas siguientes, en
    // silencio. Es lo primero que hay que saber al mirar este contacto.
    quemado: await correoQuemado(lead.email),
    envios: envios.map(f => {
      const c = porId.get(f.campaign_id);
      const r = f.resend_id ? reaccion.get(f.resend_id) : null;
      return {
        campaign_id: f.campaign_id,
        nombre: c.name || 'Campaña',
        canal: c.channel === 'whatsapp' ? 'WhatsApp' : 'Correo',
        asunto: c.subject || '',
        estado: ESTADO_ENVIO[f.status] || f.status,
        // «No se le envió» a secas no sirve: el motivo —dado de baja, sin
        // email, formato inválido— es lo que hay que hacer algo al respecto.
        motivo: (f.status === 'skipped' || f.status === 'failed') ? (f.detail || '') : '',
        malo: f.status === 'failed' || f.status === 'skipped' || r === 'bounced' || r === 'complained',
        reaccion: r ? (REACCION[r] || r) : '',
        cuando: f.processed_at || c.sent_at || c.created_at,
      };
    }),
  };
}

/**
 * ¿La dirección de este lead está quemada? Un rebote duro o una queja de spam
 * la sacan de TODAS las campañas de aquí en adelante, en silencio. Si no se
 * dice en la ficha, el comercial sigue esperando una respuesta que no va a
 * llegar porque el correo ya ni sale.
 *
 * NO se filtra por user_id, igual que en correosQuemados(): el webhook guarda
 * estos eventos sin él, así que filtrar por cuenta no devolvería nada y esto
 * diría que está limpia siempre. Y es lo correcto: el dominio remitente es
 * compartido, así que un rebote duro es un hecho del BUZÓN.
 */
export async function correoQuemado(email) {
  const dir = String(email || '').trim().toLowerCase();
  if (!dir) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/email_events?event=in.(bounced,complained)` +
      `&to_email=eq.${encodeURIComponent(dir)}&select=event&limit=1`,
      { headers: sbHeaders() }
    );
    const filas = r.ok ? ((await r.json()) || []) : [];
    return filas.length ? (filas[0].event === 'complained' ? 'spam' : 'rebote') : null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  let userId = await getUserId(req);

  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Miembros del equipo: se opera sobre la cuenta del DUEÑO. Sin esto, un
  // miembro veía esta sección VACÍA —su propia cuenta, que no tiene nada— y el
  // perfil Mercadeo no habría servido de nada.
  //
  // Y Marketing se escribe solo desde los perfiles que lo tienen. Leer sí: el
  // reporte de Marketing vive dentro de Análisis, al que Ventas sí entra.
  let quien;
  try { quien = await quienPregunta(userId); }
  catch { return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }
  userId = quien.userId;
  if (req.method !== 'GET' && !puedeVer(quien.perfil, 'marketing')) {
    const no = exigeModulo(quien, 'marketing');
    if (no) return no;
  }
  // GET ?lead_id= — qué envíos masivos le tocaron a este contacto.
  //
  // Va ANTES del cupo a propósito: leer el historial de un lead no gasta
  // correos, y el cupo cuesta una consulta a Clerk en cada llamada. La ficha
  // pide esto cada vez que se abre un contacto.
  //
  // Se lee sin exigir Marketing: es la respuesta a «¿por qué no le llegó?», y
  // quien la necesita es el comercial que lleva el lead.
  {
    const u = new URL(req.url);
    const leadId = u.searchParams.get('lead_id');
    if (req.method === 'GET' && leadId) {
      if (!/^[0-9a-f-]{32,36}$/i.test(leadId)) return jsonResp({ error: 'lead_id inválido' }, 400);
      try {
        return jsonResp(await historialDelLead(userId, leadId, quien));
      } catch (e) {
        return jsonResp({ error: String(e.message || e) }, 502);
      }
    }
  }

  // El cupo de correos es del DUEÑO. Si quien llama es un miembro, su propio
  // token trae SU plan —normalmente free— y el cupo habría salido mal.
  if (quien.esMiembro || _lastPlan === 'free') {
    const meta = await clerkMeta(userId);
    if (meta.plan) _lastPlan = meta.plan;
    if (meta.emails_extra) _emailsExtra = parseInt(meta.emails_extra) || 0;
  }

  const url = new URL(req.url);
  // Un miembro acotado a un cliente no se sale de el: el servidor manda, no
  // el navegador. Ver alcanceDeCliente en _perfiles.js.
  const clientId = alcanceDeCliente(quien, url.searchParams.get('client_id'));
  const admin = null; // se resuelve solo cuando hace falta (cupo/gate)

  // GET ?preview=1 — conteo de audiencia en vivo para el builder, con
  // desglose de exclusiones (estilo Clientify): total que matchea los
  // filtros vs. cuántos quedan fuera por baja o por falta de email/teléfono.
  if (req.method === 'GET' && url.searchParams.get('preview')) {
    let audience = {};
    try { audience = JSON.parse(url.searchParams.get('audience') || '{}'); } catch {}
    const channel = url.searchParams.get('channel') === 'whatsapp' ? 'whatsapp' : 'email';
    const a = await normalizeAudience(userId, audience);
    const hasIds = Array.isArray(a.lead_ids) && a.lead_ids.length;
    const [resuelta, all] = await Promise.all([
      resolveAudience(userId, clientId, a, channel),
      hasIds
        ? leadsByIds(userId, clientId, a.lead_ids, null, 'id,email,phone,tags')
        : traerTodo(`${SUPABASE_URL}/rest/v1/leads?${audienceQuery(userId, clientId, a, null)}&select=id,email,phone,tags`,
            sbHeaders(), { techo: TECHO_AUDIENCIA }).then(r => r.filas || []),
    ]);
    const leads = resuelta.leads;
    const breakdown = { matched: all.length, unsubscribed: 0, missing: 0, excluidos: 0, rebotados: 0 };
    const fuera = await idsExcluidos(userId, clientId, audience);
    const quemados = channel === 'email' ? await correosQuemados() : new Set();
    for (const l of all) {
      if (fuera.has(l.id)) { breakdown.excluidos++; continue; }
      if (channel === 'email') {
        if ((l.tags || []).includes('no-email')) breakdown.unsubscribed++;
        else if (!l.email) breakdown.missing++;
        else if (quemados.has(String(l.email).toLowerCase())) breakdown.rebotados++;
      } else if (!l.phone) breakdown.missing++;
    }
    // `truncado` viaja hasta la pantalla: el wizard tiene que poder avisar
    // ANTES de enviar, no después. Ver el aviso en public/app.js.
    return jsonResp({ count: leads.length, sample: leads.slice(0, 5).map(l => l.name), breakdown,
                      truncado: resuelta.truncado, techo: TECHO_AUDIENCIA });
  }

  // GET ?stats=1&id= — aperturas de una campaña (join sent → opened por resend_id)
  if (req.method === 'GET' && url.searchParams.get('stats') && url.searchParams.get('id')) {
    const id = url.searchParams.get('id');
    // Sin paginar, una campaña de más de mil envíos calculaba su tasa de
    // apertura sobre los primeros mil y el porcentaje salía inventado.
    const sent = (await traerTodo(`${SUPABASE_URL}/rest/v1/email_events?campaign_id=eq.${id}&event=eq.sent&select=resend_id`,
      sbHeaders(), { techo: TECHO_AUDIENCIA })).filas;
    const ids = (sent || []).map(s => s.resend_id).filter(Boolean);
    let opened = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/email_events?resend_id=in.(${chunk.map(x => '"' + x + '"').join(',')})&event=in.(opened,clicked)&select=resend_id`, { headers: sbHeaders() }).then(x => x.json());
      opened += new Set((r || []).map(e => e.resend_id)).size;
    }
    return jsonResp({ sent: ids.length, opened });
  }

  // GET — listar campañas
  if (req.method === 'GET') {
    const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?user_id=eq.${encodeURIComponent(userId)}${scope}&select=*&order=created_at.desc&limit=50`, { headers: sbHeaders() }).then(r => r.json());
    // Cupo del mes para mostrar en la UI (plan + paquetes extra de 2.000)
    const quota = (EMAIL_QUOTAS[_lastPlan] ?? 0) + _emailsExtra * 2000;
    const used = await monthlySent(userId);
    const unlimited = quota === Infinity;
    return jsonResp({ campaigns: rows || [], quota: { plan: _lastPlan, limit: unlimited ? null : quota, unlimited, used, extra_packs: _emailsExtra } });
  }

  // POST ?action=ai — redactar la campaña con IA. Devuelve JSON con asunto,
  // preencabezado, cuerpo (texto con {{variables}}) y CTA sugerido.
  if (req.method === 'POST' && url.searchParams.get('action') === 'ai') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.objective) return jsonResp({ error: 'Cuéntame el objetivo de la campaña' }, 400);
    const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const sys = 'Eres un copywriter experto en email marketing y mensajes directos para LatAm. Escribes en español neutro, directo y humano — cero tono corporativo vacío. ' +
      'Personalizas con las variables {{nombre}} y {{empresa}} cuando suman. Respetas las buenas prácticas anti-spam: sin MAYÚSCULAS sostenidas, sin exceso de signos, promesas creíbles. ' +
      'Respondes SOLO con un objeto JSON válido, sin markdown ni texto extra, con estas claves: ' +
      (channel === 'email'
        ? '"subject" (max 60 chars, gancho concreto), "preheader" (max 100 chars, complementa el asunto sin repetirlo), "body" (el email en texto plano, 80-160 palabras, párrafos cortos separados por \\n\\n, saludo con {{nombre}}), "cta_text" (max 4 palabras, verbo de acción).'
        : '"body" (mensaje de WhatsApp de 40-80 palabras, cercano, saludo con {{nombre}}, un solo mensaje).');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Sonnet 5 razona por defecto y el razonamiento comparte presupuesto con
        // el texto: con 900 tokens la respuesta llegaba vacía y el JSON.parse
        // reventaba con "formato no válido".
        model: 'claude-sonnet-5', max_tokens: 3000,
        system: sys,
        messages: [{ role: 'user', content:
          'OBJETIVO DE LA CAMPAÑA:\n' + String(body.objective).slice(0, 600) +
          '\n\nNEGOCIO QUE ENVÍA:\n' + String(body.business_context || 'No especificado').slice(0, 2000) +
          '\n\nAUDIENCIA (segmento del CRM): ' + String(body.audience_desc || 'leads del CRM').slice(0, 300) +
          (body.current_body ? '\n\nBORRADOR ACTUAL DEL USUARIO (mejóralo sin perder su intención):\n' + String(body.current_body).slice(0, 1500) : '') }],
      }),
    });
    const d = await r.json();
    // El costo se apunta pase lo que pase con el JSON: si el modelo respondió,
    // Anthropic ya lo cobró aunque el texto venga mal formado.
    if (d.usage) {
      await registrarUso({ userId: await cuentaDe(userId), actorId: userId,
        origen: 'campana', agente: 'copy-' + (channel || 'email'), modelo: 'claude-sonnet-5', uso: d.usage });
    }
    if (!r.ok) return jsonResp({ error: 'Error generando: ' + (d.error?.message || r.status) }, 502);
    let text = (d.content?.find(b => b.type === 'text')?.text || '').trim().replace(/^```(json)?|```$/g, '').trim();
    // Por si acompaña el JSON con alguna frase: nos quedamos con el objeto.
    if (text && text[0] !== '{') {
      const a = text.indexOf('{'), b = text.lastIndexOf('}');
      if (a >= 0 && b > a) text = text.slice(a, b + 1);
    }
    try {
      const out = JSON.parse(text);
      return jsonResp({ draft: {
        subject: String(out.subject || '').slice(0, 200),
        preheader: String(out.preheader || '').slice(0, 150),
        body: String(out.body || '').replace(/`/g, "'").slice(0, 8000),
        cta_text: String(out.cta_text || '').slice(0, 60),
      } });
    } catch { return jsonResp({ error: 'La IA no devolvió un formato válido, intenta de nuevo' }, 502); }
  }

  // POST ?action=test — correo de prueba al email del dueño (no gasta cupo:
  // no se registra en email_events). Renderiza con la plantilla real y un
  // lead de muestra de la audiencia (o datos de ejemplo si está vacía).
  if (req.method === 'POST' && url.searchParams.get('action') === 'test') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${body.id}&user_id=eq.${encodeURIComponent(userId)}&select=*`, { headers: sbHeaders() }).then(r => r.json());
    const c = rows?.[0];
    if (!c) return jsonResp({ error: 'Campaña no encontrada' }, 404);
    if (c.channel !== 'email') return jsonResp({ error: 'El correo de prueba solo aplica a campañas de email' }, 400);
    // Destino: el que pida el body (cualquier correo) o el email del dueño (Clerk)
    let toEmail = null;
    if (body.to && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.to)) toEmail = String(body.to).slice(0, 120);
    if (!toEmail) {
      const u = await fetch('https://api.clerk.com/v1/users/' + userId, { headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY } }).then(r => r.json()).catch(() => null);
      toEmail = u?.email_addresses?.[0]?.email_address;
    }
    if (!toEmail) return jsonResp({ error: 'No se pudo obtener tu email' }, 500);
    const sampleRows = (await resolveAudience(userId, clientId, c.audience, 'email')).leads;
    // La audiencia se trae con cuatro columnas —encolar no necesita más, y son
    // hasta cien mil filas—, así que en el correo de prueba {{empresa}},
    // {{etapa}}, {{fuente}} y {{valor}} salían en blanco y parecía que las
    // variables no funcionaban. Para la prueba basta con UN lead completo.
    let lead = sampleRows[0] || null;
    if (lead?.id) {
      const completo = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(lead.id)}&select=*&limit=1`,
        { headers: sbHeaders() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      if (completo?.[0]) lead = completo[0];
    }
    if (!lead) lead = { name: 'Ana Ejemplo', email: toEmail, phone: '', stage: 'nuevo', source: 'demo',
                        company: 'Empresa Demo', value: 0, assigned_name: 'Carlos Asesor' };
    const render = (t) => String(t || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => ({
      nombre: lead.name || '', empresa: lead.company || '', email: lead.email || '', telefono: lead.phone || '',
      etapa: lead.stage || '', fuente: lead.source || '', valor: lead.value ? '$' + Number(lead.value).toLocaleString('es-CO') : '',
      asesor: String(lead.assigned_name || '').replace(/\s+/g, ' ').trim() || 'nuestro equipo',
    })[k.toLowerCase()] ?? m);
    const html = campaignHtml(c, render(c.body), 'https://app.acuarius.app/api/unsubscribe?test=1', c.html ? render(c.html) : null);
    const payload = {
      from: (c.from_name ? c.from_name.replace(/[<>"]/g, '') : 'Acuarius') + ' <notificaciones@app.acuarius.app>',
      to: [toEmail], subject: '[PRUEBA] ' + render(c.subject), html,
    };
    if (c.reply_to) payload.reply_to = c.reply_to;
    const r = await enviarResend('campaigns', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return jsonResp({ error: 'Resend: ' + (await r.text()).slice(0, 150) }, 500);
    return jsonResp({ ok: true, to: toEmail });
  }

  // POST ?action=queue — encolar el envío (aquí vive el gate + cupo)
  if (req.method === 'POST' && url.searchParams.get('action') === 'queue') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${body.id}&user_id=eq.${encodeURIComponent(userId)}&select=*`, { headers: sbHeaders() }).then(r => r.json());
    const c = rows?.[0];
    if (!c) return jsonResp({ error: 'Campaña no encontrada' }, 404);
    if (c.status !== 'draft') return jsonResp({ error: 'Esta campaña ya fue enviada o está en curso' }, 400);

    const adminUser = await isAdmin(userId);
    const quota = (EMAIL_QUOTAS[_lastPlan] ?? 0) + _emailsExtra * 2000;
    if (!adminUser && quota === 0) return jsonResp({ error: 'Las campañas masivas son parte del plan Pro.', upgrade: true }, 403);

    // Cuenta con el envío bloqueado por soporte. No se le dice el motivo aquí:
    // esa conversación se tiene por correo, no en un cartelito.
    const cuentaMeta = await clerkMeta(userId);
    if (cuentaMeta.envio_bloqueado) {
      return jsonResp({
        error: 'El envío de campañas está suspendido en esta cuenta. Escríbenos a soporte@acuarius.app para revisarlo.',
        bloqueado: true,
      }, 403);
    }

    // WhatsApp: sin plantilla aprobada, Meta solo deja escribirle a quien te
    // escribió en las últimas 24 h. Encolar 50.000 destinatarios contra una
    // plantilla que no está aprobada gasta la cola entera en rechazos, así que
    // se comprueba ANTES, contra Meta, no contra lo que guardamos.
    if (c.channel === 'whatsapp') {
      const problema = await revisarPlantilla(userId, clientId, c.wa_template);
      if (problema) return jsonResp(problema, 400);
    }

    const { leads, truncado } = await resolveAudience(userId, clientId, c.audience, c.channel);
    if (!leads.length) return jsonResp({ error: 'La audiencia quedó vacía con esos filtros' }, 400);
    // Antes que enviar media campaña en silencio, no enviarla y decir por qué.
    // Una campaña incompleta no se puede "completar" después: los que sí la
    // recibieron la recibirían dos veces.
    if (truncado) {
      return jsonResp({
        error: `Esta audiencia supera los ${TECHO_AUDIENCIA.toLocaleString('es-CO')} contactos que podemos preparar de una vez. Segméntala con etiquetas y envíala por partes — así no queda nadie fuera sin que te des cuenta.`,
        audiencia_truncada: true, techo: TECHO_AUDIENCIA,
      }, 413);
    }

    // ── Los dos frenos contra el abuso ──────────────────────────────────────
    // Van aquí, con la audiencia ya resuelta: es el único punto donde se sabe
    // a cuántas personas se le va a escribir de verdad.
    if (!adminUser && c.channel === 'email') {
      const horasDeVida = cuentaMeta._creada
        ? (Date.now() - Number(cuentaMeta._creada)) / 3600000
        : 999;
      if (horasDeVida < HORAS_DE_GRACIA && leads.length > TOPE_CUENTA_NUEVA) {
        return jsonResp({
          error: `Las cuentas nuevas pueden enviar hasta ${TOPE_CUENTA_NUEVA} correos por campaña durante las primeras ${HORAS_DE_GRACIA} horas. ` +
                 'Es una medida antifraude, no un límite de tu plan: mañana desaparece sola. ' +
                 'Si necesitas enviar antes, escríbenos a soporte@acuarius.app y lo habilitamos.',
          cuenta_nueva: true, tope: TOPE_CUENTA_NUEVA,
        }, 403);
      }

      const topeDia = topeDiario(_lastPlan, cuentaMeta.leads_extra);
      const hoy = await dailySent(userId);
      if (hoy + leads.length > topeDia) {
        const quedan = Math.max(0, topeDia - hoy);
        return jsonResp({
          error: `Hoy ya enviaste ${hoy.toLocaleString('es-CO')} correos, y el máximo diario de tu cuenta es ${topeDia.toLocaleString('es-CO')} ` +
                 `— unas ${RECORRIDOS_DIA} veces tu base completa. ` +
                 (quedan
                   ? `Te quedan ${quedan.toLocaleString('es-CO')}: segmenta esta campaña o lánzala mañana.`
                   : 'Lánzala mañana, o escríbenos si necesitas más.'),
          tope_diario: topeDia, enviados_hoy: hoy, quedan,
        }, 429);
      }
    }

    if (c.channel === 'email' && !adminUser) {
      const used = await monthlySent(userId);
      if (used + leads.length > quota) {
        return jsonResp({ error: `Cupo mensual insuficiente: tienes ${quota.toLocaleString()} emails/mes (plan${_emailsExtra ? ' + ' + _emailsExtra + ' paquete(s)' : ''}), llevas ${used.toLocaleString()} y esta campaña necesita ${leads.length.toLocaleString()}. Amplía tu cupo con paquetes de 2.000 emails.`, quota_exceeded: true }, 403);
      }
    }

    // Encolar destinatarios en lotes
    for (let i = 0; i < leads.length; i += 500) {
      await fetch(`${SUPABASE_URL}/rest/v1/campaign_recipients`, {
        method: 'POST', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(leads.slice(i, i + 500).map(l => ({ campaign_id: c.id, lead_id: l.id, status: 'pending' }))),
      });
    }
    // Programación opcional: el cron no toca la campaña hasta scheduled_at
    let scheduledAt = null;
    if (body.scheduled_at) {
      const d = new Date(body.scheduled_at);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now()) scheduledAt = d.toISOString();
    }
    await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${c.id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'queued', stats: { total: leads.length, sent: 0, skipped: 0, failed: 0 }, queued_at: new Date().toISOString(), scheduled_at: scheduledAt }),
    });
    return jsonResp({ ok: true, total: leads.length, scheduled_at: scheduledAt });
  }

  // Campos v2 compartidos entre crear y editar borrador
  function extraFields(body) {
    const out = {};
    if ('preheader' in body) out.preheader = body.preheader ? String(body.preheader).slice(0, 150) : null;
    if ('reply_to' in body) out.reply_to = (body.reply_to && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.reply_to)) ? String(body.reply_to).slice(0, 120) : null;
    if ('cta_text' in body) out.cta_text = body.cta_text ? String(body.cta_text).slice(0, 60) : null;
    if ('cta_url' in body) out.cta_url = (body.cta_url && /^https?:\/\//i.test(body.cta_url)) ? String(body.cta_url).slice(0, 500) : null;
    if ('accent_color' in body) out.accent_color = /^#[0-9a-fA-F]{6}$/.test(body.accent_color || '') ? body.accent_color : null;
    if ('header_image_url' in body) out.header_image_url = (body.header_image_url && /^https?:\/\//i.test(body.header_image_url)) ? String(body.header_image_url).slice(0, 500) : null;
    if ('utm' in body) out.utm = body.utm !== false;
    // Campaña hecha con el constructor visual: su HTML ya montado y de qué
    // plantilla salió. Se copia, no se enlaza: editar la plantilla después no
    // puede cambiar un correo ya revisado.
    if ('html' in body) out.html = body.html ? String(body.html).slice(0, 400000) : null;
    if ('template_id' in body) out.template_id = body.template_id || null;
    // Plantilla de WhatsApp: { name, language, header:[campos], body:[campos] }.
    // Los campos son nombres del lead (nombre, empresa…) o texto fijo entre
    // comillas, uno por cada hueco {{n}} de la plantilla.
    if ('wa_template' in body) {
      const t = body.wa_template;
      out.wa_template = (t && t.name) ? {
        name: String(t.name).slice(0, 512),
        language: String(t.language || 'es').slice(0, 16),
        header: Array.isArray(t.header) ? t.header.slice(0, 10).map(String) : [],
        body: Array.isArray(t.body) ? t.body.slice(0, 10).map(String) : [],
        // Solo si la plantilla tiene cabecera de imagen. Es la misma para toda
        // la campaña; va por URL en cada envío.
        ...(t.header_image && /^https?:\/\//i.test(t.header_image)
          ? { header_image: String(t.header_image).slice(0, 2000) } : {}),
      } : null;
    }
    return out;
  }

  // POST — crear borrador
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.name || !body.body) return jsonResp({ error: 'La campaña requiere nombre y mensaje' }, 400);
    const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';
    if (channel === 'email' && !body.subject) return jsonResp({ error: 'El email requiere asunto' }, 400);
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/campaigns`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({
        user_id: userId, client_id: clientId,
        name: String(body.name).slice(0, 120),
        channel,
        subject: body.subject ? String(body.subject).slice(0, 200) : null,
        body: String(body.body).slice(0, 8000),
        from_name: body.from_name ? String(body.from_name).slice(0, 80) : null,
        audience: body.audience || {},
        status: 'draft',
        stats: { total: 0, sent: 0, skipped: 0, failed: 0 },
        ...extraFields(body),
      }),
    }).then(r => r.ok ? r.json() : null);
    if (!rows) return jsonResp({ error: 'No se pudo crear' }, 500);
    return jsonResp({ campaign: rows[0] }, 201);
  }

  // PUT — actualizar un borrador (el wizard guarda por pasos)
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.id) return jsonResp({ error: 'Falta id' }, 400);
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${body.id}&user_id=eq.${encodeURIComponent(userId)}&select=id,status`, { headers: sbHeaders() }).then(r => r.json());
    if (!rows?.[0]) return jsonResp({ error: 'Campaña no encontrada' }, 404);
    if (rows[0].status !== 'draft') return jsonResp({ error: 'Solo se pueden editar borradores' }, 400);
    const patch = { ...extraFields(body) };
    if (body.name) patch.name = String(body.name).slice(0, 120);
    if ('subject' in body) patch.subject = body.subject ? String(body.subject).slice(0, 200) : null;
    if (body.body) patch.body = String(body.body).slice(0, 8000);
    if ('from_name' in body) patch.from_name = body.from_name ? String(body.from_name).slice(0, 80) : null;
    if (body.audience) patch.audience = body.audience;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${body.id}`, {
      method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(patch),
    });
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    const updated = await r.json();
    return jsonResp({ campaign: updated[0] });
  }

  // DELETE — borrador o campaña terminada (los pending de una en curso se cancelan)
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/campaign_recipients?campaign_id=eq.${id}`, { method: 'DELETE', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' } });
    await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: sbHeaders() });
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
