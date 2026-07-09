// api/cron-automations.js
// Motor de automatizaciones del CRM. Corre cada 10 min (vercel.json):
// 1) Dispara triggers de inactividad (lead_inactive N días)
// 2) Procesa la cola automation_jobs: ejecuta pasos, reprograma esperas,
//    evalúa condiciones y registra todo en automation_logs.
// Los triggers lead_created y stage_changed encolan desde api/leads.js.

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET    = process.env.CRON_SECRET;

// ── Gate por plan en ejecución: si el dueño ya no es Pro/Agency (downgrade),
// sus automatizaciones no corren ────────────────────────────────────────────
const PAID_PLANS = ['pro', 'agency', 'individual', 'agencia'];
const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];
const _planCache = {};
async function userIsPaid(userId) {
  if (userId in _planCache) return _planCache[userId];
  let ok = false;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const u = await r.json();
    const plan = u.public_metadata?.plan || 'free';
    const email = (u.email_addresses?.[0]?.email_address || '').toLowerCase();
    ok = PAID_PLANS.includes(plan) || ADMIN_EMAILS.includes(email);
  } catch (e) { console.error('[automations] plan check error:', e.message); ok = true; } // ante duda, no bloquear
  _planCache[userId] = ok;
  return ok;
}

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': prefer || 'return=representation',
  };
}

async function sb(path, method = 'GET', body = null, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: sbHeaders(prefer),
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function log(automationId, userId, leadId, stepIndex, action, result, detail) {
  try {
    await sb('/automation_logs', 'POST', {
      automation_id: automationId, user_id: userId, lead_id: leadId,
      step_index: stepIndex, action, result, detail: (detail || '').slice(0, 500),
    }, 'return=minimal');
  } catch (e) { console.error('[automations] log error:', e.message); }
}

// ── Variables {{...}} con datos del lead ─────────────────────────────────────
function renderVars(text, lead) {
  const vars = {
    nombre: lead.name || '', empresa: lead.company || '', email: lead.email || '',
    telefono: lead.phone || '', etapa: lead.stage || '', fuente: lead.source || '',
    valor: lead.value ? '$' + Number(lead.value).toLocaleString('es-CO') : '',
  };
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => vars[k.toLowerCase()] !== undefined ? vars[k.toLowerCase()] : m);
}

// ── Acciones ─────────────────────────────────────────────────────────────────
async function actionSendEmail(step, lead) {
  if (!lead.email) return { result: 'skipped', detail: 'El lead no tiene email' };
  if (!RESEND_API_KEY) return { result: 'failed', detail: 'RESEND_API_KEY no configurada' };
  const subject = renderVars(step.subject, lead);
  const bodyTxt = renderVars(step.body, lead);
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' +
    bodyTxt.split('\n').map(p => '<p style="margin:0 0 14px">' + p + '</p>').join('') +
    '</div>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Acuarius <notificaciones@app.acuarius.app>', to: [lead.email], subject, html }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { result: 'failed', detail: 'Resend: ' + JSON.stringify(d).slice(0, 200) };
  return { result: 'sent', detail: 'Email a ' + lead.email + ' · "' + subject + '"' };
}

async function actionSendWhatsapp(step, lead) {
  if (!lead.phone) return { result: 'skipped', detail: 'El lead no tiene teléfono' };
  const digits = String(lead.phone).replace(/\D/g, '');
  if (digits.length < 7) return { result: 'skipped', detail: 'Teléfono inválido' };
  // Buscar conversación del Inbox cuyo contact_id termine en los dígitos del lead
  const convs = await sb(`/chat_conversations?user_id=eq.${encodeURIComponent(lead.user_id)}&select=id,contact_id,channel,connection_id&order=last_message_at.desc&limit=200`);
  const conv = (convs || []).find(c => {
    const cid = String(c.contact_id || '').replace(/\D/g, '');
    return cid && (cid.endsWith(digits.slice(-10)) || digits.endsWith(cid.slice(-10)));
  });
  if (!conv) return { result: 'skipped', detail: 'Sin conversación de Inbox para ' + lead.phone + ' — WhatsApp requiere una conversación iniciada por el contacto' };
  const conns = await sb(`/channel_connections?id=eq.${conv.connection_id}&select=*`);
  const conn = conns?.[0];
  if (!conn) return { result: 'failed', detail: 'Conexión del canal no encontrada' };
  const text = renderVars(step.body, lead);
  try {
    if (conv.channel === 'whatsapp') {
      const r = await fetch(`https://graph.facebook.com/v19.0/${conn.external_id}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: conv.contact_id, type: 'text', text: { body: text } }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.error) return { result: 'failed', detail: 'Meta: ' + (d.error.message || '').slice(0, 150) };
    } else {
      const r = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${conn.access_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: conv.contact_id }, message: { text } }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.error) return { result: 'failed', detail: 'Meta: ' + (d.error.message || '').slice(0, 150) };
    }
    // Registrar el mensaje saliente en la conversación
    await sb('/chat_messages', 'POST', {
      conversation_id: conv.id, role: 'assistant', content: text, sent_by: 'automation',
    }, 'return=minimal').catch(() => {});
    return { result: 'sent', detail: (conv.channel === 'whatsapp' ? 'WhatsApp' : 'Messenger') + ' a ' + lead.phone };
  } catch (e) {
    return { result: 'failed', detail: String(e.message || e).slice(0, 200) };
  }
}

function evalCondition(step, lead) {
  const f = step.field;
  let actual;
  if (f === 'has_email') actual = !!lead.email;
  else if (f === 'has_phone') actual = !!lead.phone;
  else if (f === 'value') actual = parseFloat(lead.value) || 0;
  else actual = String(lead[f] || '').toLowerCase();

  const expected = step.value !== undefined ? String(step.value).toLowerCase() : '';
  switch (step.op) {
    case 'eq':       return f === 'has_email' || f === 'has_phone' ? actual === (expected === 'true' || expected === 'si' || expected === 'sí') : String(actual) === expected;
    case 'neq':      return String(actual) !== expected;
    case 'contains': return String(actual).includes(expected);
    case 'gte':      return parseFloat(actual) >= parseFloat(step.value);
    case 'lte':      return parseFloat(actual) <= parseFloat(step.value);
    default:         return false;
  }
}

// ── Procesador de jobs ───────────────────────────────────────────────────────
async function processJobs() {
  const now = new Date().toISOString();
  const jobs = await sb(`/automation_jobs?status=eq.pending&run_at=lte.${encodeURIComponent(now)}&select=*&order=run_at.asc&limit=50`);
  let processed = 0;

  for (const job of (jobs || [])) {
    try {
      const autos = await sb(`/automations?id=eq.${job.automation_id}&select=*`);
      const auto = autos?.[0];
      if (!auto || !auto.active) {
        await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { status: 'cancelled' }, 'return=minimal');
        continue;
      }
      if (!(await userIsPaid(auto.user_id))) {
        await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { status: 'cancelled' }, 'return=minimal');
        await log(auto.id, job.user_id, job.lead_id, job.step_index, 'run', 'skipped', 'Plan Free — las automatizaciones requieren plan Pro');
        continue;
      }
      const leads = await sb(`/leads?id=eq.${job.lead_id}&deleted_at=is.null&select=*`);
      const lead = leads?.[0];
      if (!lead) {
        await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { status: 'cancelled' }, 'return=minimal');
        await log(auto.id, job.user_id, job.lead_id, job.step_index, 'run', 'cancelled', 'Lead eliminado');
        continue;
      }

      const steps = auto.steps || [];
      let i = job.step_index || 0;
      let jobDone = true;

      while (i < steps.length) {
        const step = steps[i];

        if (step.type === 'wait') {
          const runAt = new Date(Date.now() + (parseFloat(step.hours) || 1) * 3600 * 1000).toISOString();
          await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { step_index: i + 1, run_at: runAt }, 'return=minimal');
          await log(auto.id, job.user_id, lead.id, i, 'wait', 'scheduled', 'Continúa en ' + step.hours + 'h');
          jobDone = false;
          break;
        }

        if (step.type === 'condition') {
          const pass = evalCondition(step, lead);
          await log(auto.id, job.user_id, lead.id, i, 'condition', pass ? 'passed' : 'stopped', step.field + ' ' + step.op + ' ' + (step.value || ''));
          if (!pass) {
            await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { status: 'cancelled' }, 'return=minimal');
            jobDone = false;
            break;
          }
          i++; continue;
        }

        if (step.type === 'send_email') {
          const r = await actionSendEmail(step, lead);
          await log(auto.id, job.user_id, lead.id, i, 'send_email', r.result, r.detail);
          i++; continue;
        }

        if (step.type === 'send_whatsapp') {
          const r = await actionSendWhatsapp(step, lead);
          await log(auto.id, job.user_id, lead.id, i, 'send_whatsapp', r.result, r.detail);
          i++; continue;
        }

        if (step.type === 'change_stage') {
          await sb(`/leads?id=eq.${lead.id}`, 'PATCH', { stage: step.stage, updated_at: new Date().toISOString() }, 'return=minimal');
          lead.stage = step.stage;
          await log(auto.id, job.user_id, lead.id, i, 'change_stage', 'done', 'Etapa → ' + step.stage);
          i++; continue;
        }

        if (step.type === 'add_note') {
          const note = renderVars(step.text, lead);
          const newNotes = (lead.notes ? lead.notes + '\n' : '') + '⚡ [Automatización] ' + note;
          await sb(`/leads?id=eq.${lead.id}`, 'PATCH', { notes: newNotes }, 'return=minimal');
          await log(auto.id, job.user_id, lead.id, i, 'add_note', 'done', note.slice(0, 100));
          i++; continue;
        }

        i++; // paso desconocido: saltar
      }

      if (jobDone) {
        await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { status: 'done', step_index: i }, 'return=minimal');
      }
      processed++;
    } catch (e) {
      console.error('[automations] job error:', job.id, e.message);
      await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { status: 'failed' }, 'return=minimal').catch(() => {});
      await log(job.automation_id, job.user_id, job.lead_id, job.step_index, 'run', 'failed', e.message);
    }
  }
  return processed;
}

// ── Triggers de inactividad ──────────────────────────────────────────────────
async function processInactiveTriggers() {
  const autos = await sb(`/automations?active=eq.true&trigger->>type=eq.lead_inactive&select=*`);
  let enqueued = 0;
  const closed = ['ganado', 'perdido', 'won', 'lost', 'cerrado', 'descartado'];

  for (const auto of (autos || [])) {
    try {
      if (!(await userIsPaid(auto.user_id))) continue;
      const days = parseInt(auto.trigger.days) || 3;
      const cutoff = new Date(Date.now() - days * 864e5).toISOString();
      const scope = auto.client_id ? `&client_id=eq.${auto.client_id}` : '&client_id=is.null';
      const leads = await sb(`/leads?user_id=eq.${encodeURIComponent(auto.user_id)}${scope}&deleted_at=is.null&updated_at=lt.${encodeURIComponent(cutoff)}&select=id,stage&limit=100`);

      for (const lead of (leads || [])) {
        if (closed.includes(String(lead.stage || '').toLowerCase())) continue;
        // Dedupe: un job por automatización+lead (histórico completo)
        const existing = await sb(`/automation_jobs?automation_id=eq.${auto.id}&lead_id=eq.${lead.id}&select=id&limit=1`);
        if (existing?.length) continue;
        await sb('/automation_jobs', 'POST', {
          automation_id: auto.id, user_id: auto.user_id, lead_id: lead.id,
          step_index: 0, status: 'pending', run_at: new Date().toISOString(),
        }, 'return=minimal');
        await log(auto.id, auto.user_id, lead.id, 0, 'trigger', 'enqueued', 'Lead inactivo ' + days + '+ días');
        enqueued++;
      }
    } catch (e) { console.error('[automations] inactive trigger error:', e.message); }
  }
  return enqueued;
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const enqueued = await processInactiveTriggers();
    const processed = await processJobs();
    console.log('[cron-automations] enqueued:', enqueued, 'processed:', processed);
    return res.status(200).json({ ok: true, enqueued, processed });
  } catch (e) {
    console.error('[cron-automations] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
