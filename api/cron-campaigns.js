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

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET    = process.env.CRON_SECRET;

const BATCH = 80; // destinatarios por corrida (Resend aguanta ~2/s — margen amplio)

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

async function sendEmail(campaign, lead) {
  if (!lead.email) return { status: 'skipped', detail: 'sin email' };
  if ((lead.tags || []).includes('no-email')) return { status: 'skipped', detail: 'dado de baja' };
  const subject = renderVars(campaign.subject, lead);
  const bodyTxt = renderVars(campaign.body, lead);
  const unsub = unsubLink(lead.id);
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' +
    bodyTxt.split('\n').map(p => p.trim() ? '<p style="margin:0 0 14px">' + p + '</p>' : '').join('') +
    '<p style="margin:26px 0 0;padding-top:14px;border-top:1px solid #eee;font-size:11.5px;color:#9ca3af">' +
    '¿No quieres recibir estos correos? <a href="' + unsub + '" style="color:#9ca3af">Darte de baja</a></p></div>';
  const from = (campaign.from_name ? campaign.from_name.replace(/[<>"]/g, '') : 'Acuarius') + ' <notificaciones@app.acuarius.app>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [lead.email], subject, html,
      headers: { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { status: 'failed', detail: JSON.stringify(d).slice(0, 150) };
  // Registro del envío — cruce de aperturas y cupo mensual
  await sb('/email_events', 'POST', {
    resend_id: d.id, event: 'sent', user_id: campaign.user_id,
    lead_id: lead.id, campaign_id: campaign.id, to_email: lead.email,
  }, 'return=minimal').catch(() => {});
  return { status: 'sent', resend_id: d.id };
}

async function sendWhatsapp(campaign, lead) {
  if (!lead.phone) return { status: 'skipped', detail: 'sin teléfono' };
  const digits = String(lead.phone).replace(/\D/g, '');
  if (digits.length < 7) return { status: 'skipped', detail: 'teléfono inválido' };
  const convs = await sb(`/chat_conversations?user_id=eq.${encodeURIComponent(campaign.user_id)}&select=id,contact_id,channel,connection_id&order=last_message_at.desc&limit=300`);
  const conv = (convs || []).find(c => {
    const cid = String(c.contact_id || '').replace(/\D/g, '');
    return cid && (cid.endsWith(digits.slice(-10)) || digits.endsWith(cid.slice(-10)));
  });
  if (!conv) return { status: 'skipped', detail: 'sin conversación de Inbox' };
  const conns = await sb(`/channel_connections?id=eq.${conv.connection_id}&select=*`);
  const conn = conns?.[0];
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
    const campaigns = await sb(`/campaigns?status=in.(queued,sending)&select=*&order=queued_at.asc&limit=5`);
    for (const c of (campaigns || [])) {
      if (c.status === 'queued') {
        await sb(`/campaigns?id=eq.${c.id}`, 'PATCH', { status: 'sending' }, 'return=minimal');
      }
      const pending = await sb(`/campaign_recipients?campaign_id=eq.${c.id}&status=eq.pending&select=id,lead_id&limit=${BATCH}`);
      if (!pending?.length) {
        await sb(`/campaigns?id=eq.${c.id}`, 'PATCH', { status: 'sent', sent_at: new Date().toISOString() }, 'return=minimal');
        closed++;
        continue;
      }
      // Cargar los leads del lote de una vez
      const leadIds = pending.map(p => p.lead_id);
      const leads = await sb(`/leads?id=in.(${leadIds.join(',')})&select=*`);
      const byId = Object.fromEntries((leads || []).map(l => [l.id, l]));

      const counts = { sent: 0, skipped: 0, failed: 0 };
      for (const rcpt of pending) {
        const lead = byId[rcpt.lead_id];
        let result;
        if (!lead || lead.deleted_at) result = { status: 'skipped', detail: 'lead eliminado' };
        else if (c.channel === 'whatsapp') result = await sendWhatsapp(c, lead);
        else result = await sendEmail(c, lead);
        counts[result.status] = (counts[result.status] || 0) + 1;
        await sb(`/campaign_recipients?id=eq.${rcpt.id}`, 'PATCH', {
          status: result.status, detail: result.detail || null, resend_id: result.resend_id || null,
          processed_at: new Date().toISOString(),
        }, 'return=minimal');
        processed++;
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
