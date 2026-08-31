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
const PAID_PLANS = ['pro', 'agency', 'individual', 'agencia', 'trial'];
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
async function actionSendEmail(step, lead, auto, job) {
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
  // Registrar el envío — la rama "¿Abrió el email?" busca el último send del job
  if (d.id && auto && job) {
    await sb('/email_events', 'POST', {
      resend_id: d.id, event: 'sent', user_id: auto.user_id,
      lead_id: lead.id, automation_id: auto.id, job_id: job.id, to_email: lead.email,
    }, 'return=minimal').catch(e => console.error('[automations] email_events sent:', e.message));
  }
  return { result: 'sent', detail: 'Email a ' + lead.email + ' · "' + subject + '"' };
}

// ¿El último email enviado por ESTE job fue abierto (o clickeado)?
async function emailWasOpened(job) {
  const sent = await sb(`/email_events?job_id=eq.${job.id}&event=eq.sent&select=resend_id&order=created_at.desc&limit=1`);
  if (!sent?.length || !sent[0].resend_id) return false;
  const opened = await sb(`/email_events?resend_id=eq.${encodeURIComponent(sent[0].resend_id)}&event=in.(opened,clicked)&select=id&limit=1`);
  return !!opened?.length;
}

// Encuesta NPS: crea el registro con token único y envía el email con la
// escala 0-10. La respuesta (api/nps.js) etiqueta al lead como nps promotor/
// neutro/detractor y eso dispara las automatizaciones tag_added del usuario.
async function actionSendNps(step, lead, auto) {
  if (!lead.email) return { result: 'skipped', detail: 'El lead no tiene email' };
  if (!RESEND_API_KEY) return { result: 'failed', detail: 'RESEND_API_KEY no configurada' };
  const token = globalThis.crypto.randomUUID().replace(/-/g, '');
  await sb('/nps_responses', 'POST', {
    user_id: auto.user_id, client_id: auto.client_id || null, lead_id: lead.id, token,
  }, 'return=minimal');
  const question = renderVars(step.question || '¿Qué tan probable es que nos recomiendes a un amigo o colega?', lead);
  const intro = renderVars(step.message || 'Hola {{nombre}}, tu opinión nos ayuda a mejorar. Solo te tomará 5 segundos:', lead);
  const base = 'https://app.acuarius.app/api/nps?t=' + token + '&s=';
  const btn = (n) =>
    '<td style="padding:2px"><a href="' + base + n + '" style="display:block;width:34px;height:34px;line-height:34px;text-align:center;' +
    'background:' + (n <= 6 ? '#FEE2E2' : n <= 8 ? '#FEF3C7' : '#D1FAE5') + ';color:#1a1a2e;font-weight:bold;font-size:14px;' +
    'border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">' + n + '</a></td>';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' +
    '<p style="margin:0 0 14px">' + intro + '</p>' +
    '<p style="margin:0 0 16px;font-weight:bold;font-size:16px">' + question + '</p>' +
    '<table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>' + Array.from({ length: 11 }, (_, n) => btn(n)).join('') + '</tr></table>' +
    '<p style="margin:10px 0 0;font-size:11.5px;color:#9ca3af;text-align:center">0 = Nada probable &nbsp;·&nbsp; 10 = Muy probable</p>' +
    '</div>';
  const subject = renderVars(step.subject || '¿Nos recomendarías? — 5 segundos', lead);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Acuarius <notificaciones@app.acuarius.app>', to: [lead.email], subject, html }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { result: 'failed', detail: 'Resend: ' + JSON.stringify(d).slice(0, 200) };
  return { result: 'sent', detail: 'Encuesta NPS a ' + lead.email };
}

// ── Pedir reseña en Google ──────────────────────────────────────────────────
// El enlace que recibe el cliente es NUESTRO y redirige a Google (api/resenas.js).
// Así el clic queda en la ficha del lead y se puede medir cuántos de los que
// compraron fueron de verdad a dejar la reseña.
//
// La firma se replica aquí a propósito en vez de importar api/resenas.js: ese
// es un endpoint edge y este un cron Node, y mezclar los dos entornos ya nos
// costó caro con los _*.js. El formato manda en resenas.js; si cambia allí,
// cambia aquí.
const LINK_SECRET = process.env.LINK_SECRET || process.env.CRON_SECRET || '';

async function tokenResena(userId, leadId, clientId) {
  const { createHmac } = await import('node:crypto');
  const datos = [userId, leadId, clientId || ''].join('|');
  const firma = createHmac('sha256', LINK_SECRET).update(datos).digest('hex').slice(0, 32);
  return encodeURIComponent(datos) + '.' + firma;
}

async function configResenas(userId, clientId) {
  const filas = await sb(`/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.__resenas__&select=profile_data&limit=1`);
  const todo = filas?.[0]?.profile_data || {};
  return todo[clientId || '_cuenta'] || null;
}

// Una sola vez por lead: insistir con quien ya dejó la reseña es la forma más
// rápida de que un cliente contento deje de estarlo.
async function yaSePidio(leadId) {
  const previas = await sb(`/lead_activities?lead_id=eq.${leadId}&metadata->>resena=eq.pedida&select=id&limit=1`);
  return Array.isArray(previas) && previas.length > 0;
}

async function actionPedirResena(step, lead, auto) {
  const cfg = await configResenas(auto.user_id, auto.client_id || lead.client_id || null);
  if (!cfg?.url) return { result: 'skipped', detail: 'Sin enlace de reseñas configurado para este cliente' };
  if (await yaSePidio(lead.id)) return { result: 'skipped', detail: 'A este lead ya se le pidió la reseña' };

  const enlace = 'https://app.acuarius.app/api/resenas?t=' + (await tokenResena(auto.user_id, lead.id, auto.client_id || lead.client_id || null));
  const texto = renderVars(step.mensaje || cfg.mensaje ||
    'Hola {{nombre}}, gracias por confiar en nosotros. ¿Nos ayudas con una reseña? Te toma 30 segundos:', lead);

  const canal = step.canal === 'whatsapp' ? 'whatsapp' : 'email';
  let envio;
  if (canal === 'whatsapp') {
    envio = await actionSendWhatsapp({ ...step, message: texto + '\n' + enlace }, lead);
  } else {
    if (!lead.email) return { result: 'skipped', detail: 'El lead no tiene email' };
    if (!RESEND_API_KEY) return { result: 'failed', detail: 'RESEND_API_KEY no configurada' };
    const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' +
      '<p style="margin:0 0 18px">' + texto.replace(/\n/g, '<br>') + '</p>' +
      '<p style="margin:0 0 18px"><a href="' + enlace + '" style="display:inline-block;background:#1E2BCC;color:#fff;' +
      'padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Dejar mi reseña</a></p>' +
      '<p style="margin:0;font-size:12px;color:#9ca3af">Si el botón no funciona, copia este enlace: ' + enlace + '</p></div>';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Acuarius <notificaciones@app.acuarius.app>',
        to: [lead.email],
        subject: renderVars(step.asunto || '¿Nos dejas una reseña?', lead),
        html,
      }),
    });
    if (!r.ok) return { result: 'failed', detail: 'Resend: ' + (await r.text()).slice(0, 200) };
    envio = { result: 'sent', detail: 'Reseña pedida a ' + lead.email };
  }
  if (envio.result !== 'sent') return envio;

  // La marca de "ya pedida" vive en el historial del lead, que es donde el
  // comercial la va a buscar, y de paso es lo que lee yaSePidio().
  await sb('/lead_activities', 'POST', {
    user_id: auto.user_id, lead_id: lead.id, type: 'nota',
    content: 'Se le pidió una reseña en Google por ' + (canal === 'whatsapp' ? 'WhatsApp' : 'correo') + '.',
    metadata: { resena: 'pedida', canal },
  }, 'return=minimal');
  return envio;
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

// Crear tarea en la Agenda del CRM vinculada al lead (aparece en la pestaña Agenda)
async function actionCreateActivity(step, lead, auto) {
  const title = renderVars(step.title, lead);
  const days = parseFloat(step.offset_days);
  const dueAt = new Date(Date.now() + (isNaN(days) ? 0 : days) * 864e5);
  dueAt.setHours(9, 0, 0, 0); // 9:00 am hora del server ≈ inicio de jornada
  await sb('/activities', 'POST', {
    user_id: auto.user_id, client_id: auto.client_id, lead_id: lead.id,
    type: 'task', title, description: renderVars(step.description || '', lead) || null,
    due_at: dueAt.toISOString(),
  }, 'return=minimal');
  return { result: 'done', detail: 'Tarea "' + title.slice(0, 60) + '" para el ' + dueAt.toISOString().slice(0, 10) };
}

// Email al dueño de la cuenta (no al lead) — el email se resuelve via Clerk
const _ownerEmailCache = {};
async function actionNotifyOwner(step, lead, auto) {
  if (!RESEND_API_KEY) return { result: 'failed', detail: 'RESEND_API_KEY no configurada' };
  if (!(auto.user_id in _ownerEmailCache)) {
    try {
      const r = await fetch('https://api.clerk.com/v1/users/' + auto.user_id, {
        headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
      });
      const u = await r.json();
      _ownerEmailCache[auto.user_id] = u.email_addresses?.[0]?.email_address || null;
    } catch { _ownerEmailCache[auto.user_id] = null; }
  }
  const ownerEmail = _ownerEmailCache[auto.user_id];
  if (!ownerEmail) return { result: 'failed', detail: 'No se pudo resolver el email del dueño' };
  const msg = renderVars(step.body || 'El lead {{nombre}} activó la automatización.', lead);
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' +
    msg.split('\n').map(p => '<p style="margin:0 0 14px">' + p + '</p>').join('') +
    '<p style="margin:18px 0 0;font-size:13px;color:#888">Lead: ' + (lead.name || '—') +
    (lead.email ? ' · ' + lead.email : '') + (lead.phone ? ' · ' + lead.phone : '') +
    ' · Etapa: ' + (lead.stage || '—') + '</p></div>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Acuarius <notificaciones@app.acuarius.app>', to: [ownerEmail],
      subject: '⚡ ' + renderVars(step.subject || 'Actividad de {{nombre}} en tu CRM', lead),
      html,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { result: 'failed', detail: 'Resend: ' + JSON.stringify(d).slice(0, 200) };
  return { result: 'sent', detail: 'Notificación a ' + ownerEmail };
}

// Normalización canónica de etiquetas (idéntica a api/lead-tags.js / leads.js)
function normalizeTag(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
}

const TAG_PALETTE = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EC4899','#14B8A6','#EF4444','#6366F1','#84CC16','#F97316'];
function tagColorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// Añade o quita una etiqueta del lead (los flujos son la vía de etiquetado
// automático por comportamiento). add: asegura catálogo con kind 'auto'.
async function actionTag(step, lead, auto, remove) {
  const tag = normalizeTag(step.tag);
  if (tag.length < 2) return { result: 'skipped', detail: 'Etiqueta inválida' };
  const current = lead.tags || [];
  const newTags = remove ? current.filter(t => t !== tag) : [...new Set([...current, tag])].slice(0, 15);
  if (newTags.length === current.length && !remove) {
    return { result: 'skipped', detail: 'El lead ya tiene la etiqueta "' + tag + '"' };
  }
  if (remove && newTags.length === current.length) {
    return { result: 'skipped', detail: 'El lead no tiene la etiqueta "' + tag + '"' };
  }
  await sb(`/leads?id=eq.${lead.id}`, 'PATCH', { tags: newTags, updated_at: new Date().toISOString() }, 'return=minimal');
  lead.tags = newTags; // mantener el lead en memoria al día para pasos siguientes
  // Encadenamiento: la etiqueta añadida puede disparar otras automatizaciones
  // (trigger tag_added, una vez por lead — el dedupe corta cualquier bucle)
  if (!remove) {
    try {
      const scope = auto.client_id ? `&client_id=eq.${auto.client_id}` : '&client_id=is.null';
      const autos = await sb(`/automations?user_id=eq.${encodeURIComponent(auto.user_id)}${scope}&active=eq.true&trigger->>type=eq.tag_added&select=id,trigger`);
      for (const a of (autos || [])) {
        if (a.id === auto.id) continue; // nunca re-disparar el flujo que está corriendo
        if (a.trigger.tag && a.trigger.tag !== tag) continue;
        const existing = await sb(`/automation_jobs?automation_id=eq.${a.id}&lead_id=eq.${lead.id}&select=id&limit=1`);
        if (existing?.length) continue;
        await sb('/automation_jobs', 'POST', {
          automation_id: a.id, user_id: auto.user_id, lead_id: lead.id,
          step_index: 0, status: 'pending', run_at: new Date().toISOString(),
        }, 'return=minimal');
        await log(a.id, auto.user_id, lead.id, 0, 'trigger', 'enqueued', 'Etiqueta "' + tag + '" añadida por la automatización "' + auto.name + '"');
      }
    } catch {}
  }
  if (!remove) {
    try {
      const scope = auto.client_id ? `&client_id=eq.${auto.client_id}` : '&client_id=is.null';
      const ex = await sb(`/lead_tags?user_id=eq.${encodeURIComponent(auto.user_id)}${scope}&name=eq.${encodeURIComponent(tag)}&select=id&limit=1`);
      if (!ex?.length) {
        await sb('/lead_tags', 'POST', { user_id: auto.user_id, client_id: auto.client_id, name: tag, color: tagColorFor(tag), kind: 'auto' }, 'return=minimal');
      }
    } catch {}
  }
  return { result: 'done', detail: (remove ? 'Quitada' : 'Añadida') + ' etiqueta "' + tag + '"' };
}

function evalCondition(step, lead) {
  const f = step.field;
  let actual;
  if (f === 'has_tag') {
    const has = (lead.tags || []).includes(normalizeTag(step.value));
    return step.op === 'neq' ? !has : has;
  }
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

// ── Ventana horaria de envío ─────────────────────────────────────────────────
// trigger.window = {start, end} en horas locales (America/Bogota, UTC-5 sin
// DST). Los pasos que le escriben al lead fuera de la ventana reprograman el
// job para la próxima apertura; el resto de pasos corre a cualquier hora.
const TZ_OFFSET = -5; // America/Bogota

function inSendWindow(win) {
  if (!win || win.start === undefined || win.end === undefined) return true;
  const localH = (new Date().getUTCHours() + TZ_OFFSET + 24) % 24;
  const s = parseInt(win.start), e = parseInt(win.end);
  return s < e ? (localH >= s && localH < e) : (localH >= s || localH < e);
}

function nextWindowStart(win) {
  const s = parseInt(win.start);
  const now = new Date();
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours((s - TZ_OFFSET) % 24); // hora local de apertura → UTC
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// ── Compilación de ramas ─────────────────────────────────────────────────────
// El paso 'branch' guarda sub-pasos en yes[]/no[]. Para que el step_index
// entero de los jobs (y las esperas) siga funcionando, el árbol se compila a
// una lista plana con saltos: _branch (salta a jumpFalse si no cumple) y
// _goto (salto incondicional al final de la rama Sí). Los índices compilados
// son estables mientras la automatización no se edite — misma garantía que
// ya tenía el step_index lineal. Pasos después de la rama = punto de
// reencuentro de ambos carriles.
function compileSteps(steps) {
  const out = [];
  const walk = (arr) => {
    for (const s of (arr || [])) {
      if (s.type === 'branch') {
        const node = { type: '_branch', field: s.field, op: s.op, value: s.value, jumpFalse: -1 };
        out.push(node);
        walk(s.yes);
        const g = { type: '_goto', to: -1 };
        out.push(g);
        node.jumpFalse = out.length;
        walk(s.no);
        g.to = out.length;
      } else {
        out.push(s);
      }
    }
  };
  walk(steps);
  return out;
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

      const steps = compileSteps(auto.steps || []);
      let i = job.step_index || 0;
      let jobDone = true;

      while (i < steps.length) {
        const step = steps[i];

        // Ventana horaria: los mensajes al lead esperan la próxima hora hábil
        if ((step.type === 'send_email' || step.type === 'send_whatsapp' || step.type === 'send_nps' || step.type === 'pedir_resena') && !inSendWindow(auto.trigger?.window)) {
          const runAt = nextWindowStart(auto.trigger.window);
          await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { step_index: i, run_at: runAt }, 'return=minimal');
          await log(auto.id, job.user_id, lead.id, i, 'window', 'scheduled', 'Fuera del horario de envío (' + auto.trigger.window.start + ':00–' + auto.trigger.window.end + ':00) — continúa a las ' + auto.trigger.window.start + ':00');
          jobDone = false;
          break;
        }

        if (step.type === '_goto') { i = step.to; continue; }

        if (step.type === '_branch') {
          let pass;
          if (step.field === 'email_opened') {
            const expected = String(step.value).toLowerCase() !== 'false';
            pass = (await emailWasOpened(job)) === expected;
          } else {
            pass = evalCondition(step, lead);
          }
          await log(auto.id, job.user_id, lead.id, i, 'branch', pass ? 'yes' : 'no', step.field + ' ' + step.op + ' ' + (step.value || '') + ' → rama ' + (pass ? 'Sí' : 'No'));
          if (!pass) { i = step.jumpFalse; continue; }
          i++; continue;
        }

        if (step.type === 'wait') {
          const runAt = new Date(Date.now() + (parseFloat(step.hours) || 1) * 3600 * 1000).toISOString();
          await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { step_index: i + 1, run_at: runAt }, 'return=minimal');
          await log(auto.id, job.user_id, lead.id, i, 'wait', 'scheduled', 'Continúa en ' + step.hours + 'h');
          jobDone = false;
          break;
        }

        if (step.type === 'condition') {
          let pass;
          if (step.field === 'email_opened') {
            const expected = String(step.value).toLowerCase() !== 'false';
            pass = (await emailWasOpened(job)) === expected;
          } else {
            pass = evalCondition(step, lead);
          }
          await log(auto.id, job.user_id, lead.id, i, 'condition', pass ? 'passed' : 'stopped', step.field + ' ' + step.op + ' ' + (step.value || ''));
          if (!pass) {
            await sb(`/automation_jobs?id=eq.${job.id}`, 'PATCH', { status: 'cancelled' }, 'return=minimal');
            jobDone = false;
            break;
          }
          i++; continue;
        }

        if (step.type === 'send_email') {
          const r = await actionSendEmail(step, lead, auto, job);
          await log(auto.id, job.user_id, lead.id, i, 'send_email', r.result, r.detail);
          i++; continue;
        }

        if (step.type === 'pedir_resena') {
          const r = await actionPedirResena(step, lead, auto);
          await log(auto.id, job.user_id, lead.id, i, 'pedir_resena', r.result, r.detail);
          i++; continue;
        }

        if (step.type === 'send_nps') {
          const r = await actionSendNps(step, lead, auto);
          await log(auto.id, job.user_id, lead.id, i, 'send_nps', r.result, r.detail);
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

        if (step.type === 'create_activity') {
          const r = await actionCreateActivity(step, lead, auto);
          await log(auto.id, job.user_id, lead.id, i, 'create_activity', r.result, r.detail);
          i++; continue;
        }

        if (step.type === 'notify_owner') {
          const r = await actionNotifyOwner(step, lead, auto);
          await log(auto.id, job.user_id, lead.id, i, 'notify_owner', r.result, r.detail);
          i++; continue;
        }

        if (step.type === 'add_tag' || step.type === 'remove_tag') {
          const r = await actionTag(step, lead, auto, step.type === 'remove_tag');
          await log(auto.id, job.user_id, lead.id, i, step.type, r.result, r.detail);
          i++; continue;
        }

        if (step.type === 'add_note') {
          const note = renderVars(step.text, lead);
          const newNotes = (lead.notes ? lead.notes + '\n' : '') + '⚡ [Automatización] ' + note;
          await sb(`/leads?id=eq.${lead.id}`, 'PATCH', { notes: newNotes }, 'return=minimal');
          lead.notes = newNotes; // mantener el lead en memoria al día — si no, la siguiente nota del flujo pisa esta
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
