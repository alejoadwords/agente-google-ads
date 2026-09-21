// api/cron-campaigns.js
// Motor de envío de campañas masivas (email + WhatsApp) por lotes.
// Corre cada 10 min (vercel.json). Procesa campaign_recipients pendientes:
// - email: Resend con personalización {{...}}, footer de baja (HMAC) y
//   List-Unsubscribe; registra el envío en email_events con campaign_id
//   (las aperturas llegan por api/resend-webhook.js y se cruzan por resend_id)
// - whatsapp: via conversación existente del Inbox (limitación de Meta hasta
//   tener plantillas aprobadas — sin conversación se marca skipped)
// Actualiza stats en vivo y cierra la campaña (status sent) al agotar la cola.

import crypto from 'crypto';
import { campaignHtml } from './_campaign-email.js';
import { abrirConexion, cifrar } from './_cifrado.js';
import { enviarResendLote } from './_correo.js';

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET    = process.env.CRON_SECRET;

// Antes esto era `BATCH = 80` y el motor tardaba diez meses en recorrer una
// base de tres millones. El cuello nunca fue Resend: era hacer TRES viajes de
// red por destinatario —enviar, registrar el envío y marcar la fila— uno detrás
// de otro. Ochenta destinatarios eran 240 viajes, unos 36 segundos, que es lo
// que cabía en la función.
//
// Ahora los tres se agrupan: Resend acepta 100 correos por petición y a
// Supabase se le escribe una vez por lote en vez de una vez por persona. El
// mismo tiempo de función rinde unas sesenta veces más.
const PRESUPUESTO  = 5000; // destinatarios por TANDA, repartidos entre campañas

// La función tiene 120 s. Antes se hacía UNA tanda de 5.000 y lo que sobrara
// esperaba a la próxima vuelta del cron: diez minutos parado. Para una tienda
// que manda una promo relámpago a 7.000 contactos eso son 5.000 correos en un
// minuto y los otros 2.000 diez minutos después — la mitad de su clientela se
// entera cuando la promo ya va por la mitad.
//
// Ahora se encadenan tandas mientras quede cola y quede tiempo. El corte es
// por reloj, no por número: 85 s deja 35 de margen para cerrar las escrituras
// pendientes, que es lo que NO se puede dejar a medias.
const LIMITE_MS = 85000;

// Cuentas a las que soporte les quitó el envío. Se consulta a Clerk, que es
// donde vive la verdad del plan, y se guarda un momento: cinco campañas por
// corrida no justifican cinco viajes.
const _bloqueoCache = new Map();
async function envioBloqueado(userId) {
  if (!userId || !process.env.CLERK_SECRET_KEY) return false;
  const hit = _bloqueoCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.v;
  try {
    const u = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    }).then(r => r.json());
    const v = !!u?.public_metadata?.envio_bloqueado;
    _bloqueoCache.set(userId, { v, exp: Date.now() + 60000 });
    return v;
  } catch {
    // Si no se puede preguntar, no se envía. Al revés —enviar por si acaso— es
    // justo lo que hay que evitar cuando una cuenta está bloqueada por fraude.
    return true;
  }
}
const LOTE_RESEND  = 100;  // máximo del endpoint /emails/batch
const LOTE_BASE    = 400;  // filas por escritura a Supabase (la URL tiene límite)
const LOTE_LEADS   = 200;  // ids por consulta `in.()` — 200 uuid son ~7 KB de URL
// Resend admite unas 2 peticiones por segundo. Con lotes de 100 eso son 200
// correos/segundo, de sobra; la pausa está para no chocar con el límite y
// comerse la corrida en reintentos.
const PAUSA_RESEND = 500;

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// PostgREST corta en 1.000 filas: pedir `limit=5000` devuelve mil y se queda
// tan ancho. Pedir el presupuesto de una vez habría dejado el motor en 1.000
// por corrida creyendo que iba a 5.000. Este cron es Node y no puede importar
// api/_paginado.js (rompe el build), así que pagina aquí mismo.
const TOPE_POSTGREST = 1000;
async function colaPendiente(campaignId, cupo) {
  const filas = [];
  while (filas.length < cupo) {
    const pido = Math.min(TOPE_POSTGREST, cupo - filas.length);
    const pagina = await sb(`/campaign_recipients?campaign_id=eq.${campaignId}&status=eq.pending` +
                            `&select=id,campaign_id,lead_id&order=id.asc&limit=${pido}&offset=${filas.length}`);
    if (!pagina?.length) break;
    filas.push(...pagina);
    if (pagina.length < pido) break;
  }
  return filas;
}

// Un correo con forma inválida hace fallar la petición ENTERA de 100. Se aparta
// antes de armar el lote: mejor saltarse uno que perder los otros noventa y nueve.
function correoUsable(v) {
  const s = String(v || '').trim();
  return s.length > 4 && s.length < 255 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);
}

async function sb(path, method = 'GET', body = null, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': prefer || 'return=representation',
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function renderVars(text, lead) {
  const vars = {
    nombre: lead.name || '', empresa: lead.company || '', email: lead.email || '',
    telefono: lead.phone || '', etapa: lead.stage || '', fuente: lead.source || '',
    valor: lead.value ? '$' + Number(lead.value).toLocaleString('es-CO') : '',
  };
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => vars[k.toLowerCase()] !== undefined ? vars[k.toLowerCase()] : m);
}

function unsubLink(leadId) {
  const sig = crypto.createHmac('sha256', CRON_SECRET).update('unsub:' + leadId).digest('hex').slice(0, 32);
  return `https://app.acuarius.app/api/unsubscribe?l=${leadId}&s=${sig}`;
}

// Arma el correo de una persona. No envía: solo prepara el sobre, para que
// cien de estos viajen juntos en una sola petición.
function armarCorreo(campaign, lead) {
  if (!lead.email) return { status: 'skipped', detail: 'sin email' };
  if ((lead.tags || []).includes('no-email')) return { status: 'skipped', detail: 'dado de baja' };
  if (!correoUsable(lead.email)) return { status: 'skipped', detail: 'email con formato inválido' };
  const subject = renderVars(campaign.subject, lead);
  const bodyTxt = renderVars(campaign.body, lead);
  const unsub = unsubLink(lead.id);
  // El diseño también lleva variables: sin esto llegaría con las llaves puestas.
  const htmlDiseno = campaign.html ? renderVars(campaign.html, lead) : null;
  const html = campaignHtml(campaign, bodyTxt, unsub, htmlDiseno);
  const from = (campaign.from_name ? campaign.from_name.replace(/[<>"]/g, '') : 'Acuarius') + ' <notificaciones@app.acuarius.app>';
  const payload = {
    from, to: [lead.email], subject, html,
    // El lote de Resend sí admite cabeceras propias. Si no las admitiera no se
    // podría usar: sin List-Unsubscribe el correo masivo se va a spam.
    headers: { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
  if (campaign.reply_to) payload.reply_to = campaign.reply_to;
  return { status: 'listo', payload };
}

/**
 * Envía hasta LOTE_RESEND correos en una sola petición.
 * Devuelve un arreglo de resultados en el MISMO orden que entraron: Resend
 * responde `data[i]` para el sobre `i`, y de ahí sale el resend_id con el que
 * después se cruzan las aperturas.
 */
async function enviarLote(sobres) {
  const r = await enviarResendLote('cron-campaigns', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(sobres),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const motivo = JSON.stringify(d).slice(0, 150);
    // Un 429 o un 5xx es pasajero: Resend está saturado o caído un momento.
    // Marcar a esas cien personas como "fallidas" las sacaría de la cola para
    // siempre por un tropiezo de diez segundos. Se dejan pendientes y el motor
    // vuelve a intentarlo en la próxima corrida.
    if (r.status === 429 || r.status >= 500) {
      return sobres.map(() => ({ status: 'reintentar', detail: motivo }));
    }
    // Un 4xx de validación sí es definitivo: reintentarlo daría igual.
    return sobres.map(() => ({ status: 'failed', detail: motivo }));
  }
  const ids = Array.isArray(d.data) ? d.data : [];
  return sobres.map((_, i) => ids[i]?.id
    ? { status: 'sent', resend_id: ids[i].id }
    : { status: 'failed', detail: 'Resend no devolvió id para este correo' });
}

/**
 * Índice de conversaciones y conexiones de la cuenta, cargado UNA vez por
 * campaña. Antes esto se consultaba dentro del bucle: una campaña de WhatsApp a
 * 80 personas hacía 160 consultas para leer siempre lo mismo.
 */
async function indiceDeWhatsapp(userId) {
  const convs = await sb(`/chat_conversations?user_id=eq.${encodeURIComponent(userId)}&select=id,contact_id,channel,connection_id&order=last_message_at.desc&limit=1000`);
  const conns = await sb(`/channel_connections?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  // Los tokens salen descifrados: el resto del cron no tiene por qué
  // saber que en la base se guardan cifrados.
  const lista = await Promise.all((conns || []).map(abrirConexion));
  return {
    convs: convs || [],
    conexiones: Object.fromEntries(lista.map(c => [c.id, c])),
    // La conexión por la que salen las plantillas: no depende de que exista
    // una conversación previa, que es justo lo que las hace útiles.
    wa: lista.find(c => c.channel === 'whatsapp' && c.is_active && c.access_token && c.external_id) || null,
  };
}

// ── El techo de Meta ─────────────────────────────────────────────────────────
// Un número nuevo solo puede iniciar conversación con 250 personas distintas
// cada 24 horas. La escalera sigue en 2.000, 10.000, 100.000 e ilimitado, y se
// sube por verificación del negocio o enviando con buena calidad.
//
// Pasarse no da un error claro: Meta estrangula, la calificación de calidad
// cae, las plantillas se pausan y el número acaba restringido. O sea que el
// castigo de ignorar esto no lo paga la campaña — lo paga el cliente, con su
// número, durante semanas.
//
// El tope real se guarda por conexión en el perfil de la cuenta, para poder
// subirlo cuando Meta suba el escalón sin tocar código.
const TOPE_DIARIO = 250;
const ENVIOS_KEY = '__wa_envios__';

async function cupoDeHoy(userId, connId) {
  const filas = await sb(`/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${ENVIOS_KEY}&select=profile_data&limit=1`);
  const blob = filas?.[0]?.profile_data || {};
  const dia = new Date().toISOString().slice(0, 10);
  const conn = blob[connId] || {};
  // El límite de Meta es una ventana móvil de 24 h; aquí se cuenta por día UTC.
  // Es una aproximación, y a propósito por lo bajo: en el peor caso se envía de
  // menos, que es el error que no cuesta nada.
  return {
    blob, dia,
    tope: Number(conn.tope) > 0 ? Number(conn.tope) : TOPE_DIARIO,
    usados: Number(conn[dia]) || 0,
  };
}

async function anotarEnvios(userId, connId, cupo, cuantos) {
  if (!cuantos) return;
  const conn = { ...(cupo.blob[connId] || {}), [cupo.dia]: cupo.usados + cuantos };
  // Se tiran los días viejos: si no, este blob crece para siempre.
  for (const k of Object.keys(conn)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && k < cupo.dia) delete conn[k];
  }
  await sb(`/user_profiles?on_conflict=user_id,agent_key`, 'POST', {
    user_id: userId, agent_key: ENVIOS_KEY,
    profile_data: { ...cupo.blob, [connId]: conn },
    updated_at: new Date().toISOString(),
  }, 'resolution=merge-duplicates,return=minimal').catch(e => console.error('[cron-campaigns] cupo wa:', e.message));
}

// Los valores que entran en los huecos {{1}}, {{2}}… de la plantilla.
// Meta RECHAZA el mensaje si un parámetro llega vacío, así que un lead al que
// le falte un dato se salta con su motivo en vez de quemar un intento.
function parametrosDe(campos, lead) {
  const valores = {
    nombre: lead.name, empresa: lead.company, email: lead.email, telefono: lead.phone,
    etapa: lead.stage, fuente: lead.source,
    valor: lead.value ? '$' + Number(lead.value).toLocaleString('es-CO') : '',
  };
  const out = [];
  for (const campo of (campos || [])) {
    // Un campo entre comillas es texto fijo, no un campo del lead.
    const literal = /^".*"$/.test(String(campo));
    const v = literal ? String(campo).slice(1, -1) : valores[String(campo).toLowerCase()];
    const texto = String(v == null ? '' : v).trim();
    if (!texto) return { falta: campo };
    // Meta no admite saltos de línea ni tabulaciones dentro de un parámetro.
    out.push({ type: 'text', text: texto.replace(/\s+/g, ' ').slice(0, 1024) });
  }
  return { parametros: out };
}

async function enviarPlantilla(conn, telefono, plantilla, lead) {
  const componentes = [];
  // Cabecera de imagen: la misma para toda la campaña. El handle que se usó al
  // crear la plantilla NO sirve aquí — era el ejemplo para que Meta la revisara.
  // En cada envío hay que mandar la imagen otra vez, y por URL.
  if (plantilla.header_image) {
    componentes.push({ type: 'header', parameters: [{ type: 'image', image: { link: plantilla.header_image } }] });
  }
  for (const [tipo, campos] of [['header', plantilla.header], ['body', plantilla.body]]) {
    if (!campos?.length) continue;
    if (tipo === 'header' && plantilla.header_image) continue; // no puede llevar las dos
    const r = parametrosDe(campos, lead);
    if (r.falta) return { status: 'skipped', detail: `sin dato para la plantilla: ${r.falta}` };
    componentes.push({ type: tipo, parameters: r.parametros });
  }
  const res = await fetch(`https://graph.facebook.com/v23.0/${conn.external_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefono,
      type: 'template',
      template: {
        name: plantilla.name,
        language: { code: plantilla.language || 'es' },
        ...(componentes.length ? { components: componentes } : {}),
      },
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (d.error) {
    const codigo = d.error.code;
    // 131049/131047 son de ventana y ritmo: pasajeros, se reintentan. 132xxx
    // son de la plantilla (no existe, no aprobada, parámetros mal): definitivos.
    const pasajero = codigo === 131049 || codigo === 131047 || codigo === 130429 || codigo === 80007;
    return { status: pasajero ? 'reintentar' : 'failed', detail: `Meta ${codigo}: ${String(d.error.message || '').slice(0, 140)}` };
  }
  return { status: 'sent', resend_id: d.messages?.[0]?.id || null };
}

async function sendWhatsapp(campaign, lead, indice) {
  if (!lead.phone) return { status: 'skipped', detail: 'sin teléfono' };
  const digits = String(lead.phone).replace(/\D/g, '');
  if (digits.length < 7) return { status: 'skipped', detail: 'teléfono inválido' };
  const conv = indice.convs.find(c => {
    const cid = String(c.contact_id || '').replace(/\D/g, '');
    return cid && (cid.endsWith(digits.slice(-10)) || digits.endsWith(cid.slice(-10)));
  });
  if (!conv) return { status: 'skipped', detail: 'sin conversación de Inbox' };
  const conn = indice.conexiones[conv.connection_id];
  if (!conn) return { status: 'failed', detail: 'conexión no encontrada' };
  const text = renderVars(campaign.body, lead);
  try {
    if (conv.channel === 'whatsapp') {
      const r = await fetch(`https://graph.facebook.com/v19.0/${conn.external_id}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: conv.contact_id, type: 'text', text: { body: text } }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.error) return { status: 'failed', detail: (d.error.message || '').slice(0, 120) };
    } else {
      const r = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${conn.access_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: conv.contact_id }, message: { text } }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.error) return { status: 'failed', detail: (d.error.message || '').slice(0, 120) };
    }
    await sb('/chat_messages', 'POST', { conversation_id: conv.id, role: 'assistant', content: text, sent_by: 'campaign' }, 'return=minimal').catch(() => {});
    return { status: 'sent' };
  } catch (e) {
    return { status: 'failed', detail: String(e.message || e).slice(0, 120) };
  }
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let processed = 0, closed = 0, tandas = 0;
  const T0 = Date.now();
  try {
   while (Date.now() - T0 < LIMITE_MS) {
    tandas++;
    const alEmpezar = processed;
    // Programación: una campaña con scheduled_at futuro espera su hora
    const nowIso = new Date().toISOString();
    const campaigns = await sb(`/campaigns?status=in.(queued,sending)&or=(scheduled_at.is.null,scheduled_at.lte.${encodeURIComponent(nowIso)})&select=*&order=queued_at.asc&limit=5`);
    if (!campaigns?.length) break;
    for (const c of (campaigns || [])) {
      // El bloqueo de una cuenta se comprueba TAMBIÉN aquí. Comprobarlo solo al
      // encolar no sirve de nada: lo que manda los correos es este cron, y una
      // campaña ya encolada seguiría saliendo después de bloquear la cuenta.
      if (await envioBloqueado(c.user_id)) {
        await sb(`/campaigns?id=eq.${c.id}`, 'PATCH', { status: 'paused' }, 'return=minimal');
        console.warn('[campaigns] campaña', c.id, 'detenida: la cuenta tiene el envío bloqueado');
        continue;
      }
      if (c.status === 'queued') {
        await sb(`/campaigns?id=eq.${c.id}`, 'PATCH', { status: 'sending' }, 'return=minimal');
      }
      if (Date.now() - T0 > LIMITE_MS) break;
      const cupo = PRESUPUESTO - (processed - alEmpezar);
      if (cupo <= 0) break; // el presupuesto se reparte entre campañas, no por campaña
      const pending = await colaPendiente(c.id, cupo);
      if (!pending?.length) {
        await sb(`/campaigns?id=eq.${c.id}`, 'PATCH', { status: 'sent', sent_at: new Date().toISOString() }, 'return=minimal');
        closed++;
        continue;
      }

      // Los leads, por tandas: 200 uuid en un `in.()` son unos 7 KB de URL, y
      // metiendo los 5.000 de golpe el servidor la rechaza por larga.
      const byId = {};
      for (let i = 0; i < pending.length; i += LOTE_LEADS) {
        const ids = pending.slice(i, i + LOTE_LEADS).map(p => p.lead_id);
        const leads = await sb(`/leads?id=in.(${ids.join(',')})&select=*`);
        for (const l of (leads || [])) byId[l.id] = l;
      }

      const ahora = new Date().toISOString();
      const resueltos = new Map();  // id de la fila → resultado
      const eventos = [];           // email_events a insertar de una vez

      if (c.channel === 'whatsapp') {
        // WhatsApp sigue siendo uno a uno: cada mensaje es una llamada a Meta y
        // no hay endpoint de lote. Lo que se ahorró aquí son las consultas
        // repetidas del índice, que antes iban dentro del bucle.
        const indice = await indiceDeWhatsapp(c.user_id);
        const plantilla = (c.wa_template && c.wa_template.name) ? c.wa_template : null;
        // Con plantilla NO hace falta conversación previa: es lo que convierte
        // esto en una campaña de verdad y no en responderle a quien ya escribió.
        const cupo = plantilla && indice.wa ? await cupoDeHoy(c.user_id, indice.wa.id) : null;
        let enviadosHoy = 0;

        for (const rcpt of pending) {
          const lead = byId[rcpt.lead_id];
          let r;
          if (!lead || lead.deleted_at) {
            r = { status: 'skipped', detail: 'lead eliminado' };
          } else if (plantilla) {
            if (!indice.wa) {
              r = { status: 'failed', detail: 'no hay un canal de WhatsApp conectado' };
            } else if (cupo.usados + enviadosHoy >= cupo.tope) {
              // Se acabó el cupo del día. Los que faltan NO se tocan: siguen
              // pendientes y salen mañana. Forzar el techo de Meta es como se
              // pierde el número del cliente.
              console.warn(`[cron-campaigns] cupo diario de WhatsApp agotado (${cupo.tope}); el resto sigue mañana`);
              break;
            } else {
              const tel = String(lead.phone || '').replace(/\D/g, '');
              r = tel.length < 7
                ? { status: 'skipped', detail: 'teléfono inválido' }
                : await enviarPlantilla(indice.wa, tel, plantilla, lead);
              if (r.status === 'sent') enviadosHoy++;
            }
          } else {
            r = await sendWhatsapp(c, lead, indice);
          }
          // 'reintentar' no es un estado de la cola: la fila se queda pendiente
          // y vuelve en la próxima corrida.
          if (r.status === 'reintentar') continue;
          resueltos.set(rcpt.id, r);
        }
        if (cupo && enviadosHoy) await anotarEnvios(c.user_id, indice.wa.id, cupo, enviadosHoy);
      } else {
        // Primero se aparta lo que ni siquiera hay que enviar, y lo que queda se
        // manda de cien en cien.
        const sobres = [];
        for (const rcpt of pending) {
          const lead = byId[rcpt.lead_id];
          if (!lead || lead.deleted_at) { resueltos.set(rcpt.id, { status: 'skipped', detail: 'lead eliminado' }); continue; }
          const armado = armarCorreo(c, lead);
          if (armado.status !== 'listo') { resueltos.set(rcpt.id, armado); continue; }
          sobres.push({ rcpt, lead, payload: armado.payload });
        }
        for (let i = 0; i < sobres.length; i += LOTE_RESEND) {
          // Se corta por reloj ANTES de mandar, nunca después: lo que ya salió
          // hay que alcanzar a registrarlo o se enviaría dos veces.
          if (Date.now() - T0 > LIMITE_MS) {
            console.warn('[cron-campaigns] se acabó el tiempo de la función, el resto sigue pendiente');
            break;
          }
          const tanda = sobres.slice(i, i + LOTE_RESEND);
          if (i > 0) await esperar(PAUSA_RESEND);
          const res = await enviarLote(tanda.map(s => s.payload));
          // Si Resend está saturado, seguir mandándole lotes solo empeora la
          // cosa y se come la corrida. Se corta aquí y el resto queda pendiente.
          if (res[0]?.status === 'reintentar') {
            console.warn('[cron-campaigns] Resend no acepta más por ahora, se reintenta:', res[0].detail);
            break;
          }
          tanda.forEach((s, j) => {
            const r = res[j] || { status: 'failed', detail: 'sin respuesta de Resend' };
            resueltos.set(s.rcpt.id, r);
            if (r.status === 'sent') {
              eventos.push({
                resend_id: r.resend_id, event: 'sent', user_id: c.user_id,
                lead_id: s.lead.id, campaign_id: c.id, to_email: s.lead.email,
              });
            }
          });
        }
      }

      // Una escritura por tanda en vez de una por persona. El registro va antes
      // de marcar la cola: si el proceso muere aquí, la fila sigue pendiente y
      // se reintenta — preferible a darla por enviada sin haberla registrado.
      for (let i = 0; i < eventos.length; i += LOTE_BASE) {
        await sb('/email_events', 'POST', eventos.slice(i, i + LOTE_BASE), 'return=minimal').catch(() => {});
      }

      const counts = { sent: 0, skipped: 0, failed: 0 };
      const filas = [];
      for (const rcpt of pending) {
        const r = resueltos.get(rcpt.id);
        // Sin resultado = no se llegó a intentar (Resend saturado, o se acabó
        // la tanda). Esas filas NO se tocan: siguen pendientes y vuelven en la
        // próxima corrida. Marcarlas de cualquier forma las perdería.
        if (!r) continue;
        counts[r.status] = (counts[r.status] || 0) + 1;
        processed++;
        filas.push({
          id: rcpt.id, campaign_id: rcpt.campaign_id, lead_id: rcpt.lead_id,
          status: r.status, detail: r.detail || null, resend_id: r.resend_id || null,
          processed_at: ahora,
        });
      }
      // Upsert sobre la clave primaria: actualiza cientos de filas con valores
      // DISTINTOS en una sola petición. `on_conflict` es obligatorio — sin él
      // el segundo guardado choca con el índice único.
      for (let i = 0; i < filas.length; i += LOTE_BASE) {
        await sb('/campaign_recipients?on_conflict=id', 'POST', filas.slice(i, i + LOTE_BASE),
                 'resolution=merge-duplicates,return=minimal');
      }
      // Stats acumuladas en vivo
      const stats = c.stats || {};
      await sb(`/campaigns?id=eq.${c.id}`, 'PATCH', {
        stats: {
          total: stats.total || 0,
          sent: (stats.sent || 0) + counts.sent,
          skipped: (stats.skipped || 0) + counts.skipped,
          failed: (stats.failed || 0) + counts.failed,
        },
      }, 'return=minimal');
      // ¿Quedó vacía la cola? Cerrar de una vez
      const left = await sb(`/campaign_recipients?campaign_id=eq.${c.id}&status=eq.pending&select=id&limit=1`);
      if (!left?.length) {
        await sb(`/campaigns?id=eq.${c.id}`, 'PATCH', { status: 'sent', sent_at: new Date().toISOString() }, 'return=minimal');
        closed++;
      }
    }
    // Una tanda que no movió ni un destinatario no va a mover nada en la
    // siguiente: o Resend no acepta más, o no quedaba cola. Sin este corte, el
    // bucle daría vueltas en vacío hasta agotar los 85 s contra el proveedor.
    if (processed === alEmpezar) break;
   }
    console.log('[cron-campaigns] processed:', processed, 'closed:', closed);
    return res.status(200).json({ ok: true, processed, closed, tandas, ms: Date.now() - T0 });
  } catch (e) {
    console.error('[cron-campaigns] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
