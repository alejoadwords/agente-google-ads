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
const PRESUPUESTO  = 5000; // destinatarios por corrida, repartidos entre campañas
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
  const r = await fetch('https://api.resend.com/emails/batch', {
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
  return {
    convs: convs || [],
    conexiones: Object.fromEntries((conns || []).map(c => [c.id, c])),
  };
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

  let processed = 0, closed = 0;
  try {
    // Programación: una campaña con scheduled_at futuro espera su hora
    const nowIso = new Date().toISOString();
    const campaigns = await sb(`/campaigns?status=in.(queued,sending)&or=(scheduled_at.is.null,scheduled_at.lte.${encodeURIComponent(nowIso)})&select=*&order=queued_at.asc&limit=5`);
    for (const c of (campaigns || [])) {
      if (c.status === 'queued') {
        await sb(`/campaigns?id=eq.${c.id}`, 'PATCH', { status: 'sending' }, 'return=minimal');
      }
      const cupo = PRESUPUESTO - processed;
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
        for (const rcpt of pending) {
          const lead = byId[rcpt.lead_id];
          const r = (!lead || lead.deleted_at)
            ? { status: 'skipped', detail: 'lead eliminado' }
            : await sendWhatsapp(c, lead, indice);
          resueltos.set(rcpt.id, r);
        }
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
    console.log('[cron-campaigns] processed:', processed, 'closed:', closed);
    return res.status(200).json({ ok: true, processed, closed });
  } catch (e) {
    console.error('[cron-campaigns] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
