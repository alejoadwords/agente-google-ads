// api/campaigns.js
// Campañas masivas de email y WhatsApp segmentadas por etiquetas/etapa/fuente.
// El envío real lo hace api/cron-campaigns.js por lotes; aquí vive el CRUD,
// el resolver de audiencia, la cola (con cupo mensual por plan) y las stats.
// Reglas de costo/reputación: cupo de emails por plan, exclusión automática
// de leads con etiqueta 'no-email' (baja) y de leads sin email/teléfono.
export const config = { runtime: 'edge' };

import { campaignHtml } from './_campaign-email.js';


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
    _planCache.set(userId, { meta, exp: Date.now() + 60000 });
    return meta;
  } catch { return {}; }
}

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

async function resolveAudience(userId, clientId, audience, channel) {
  const a = await normalizeAudience(userId, audience);
  if (Array.isArray(a.lead_ids) && a.lead_ids.length) {
    return leadsByIds(userId, clientId, a.lead_ids, channel, 'id,name,email,phone');
  }
  const q = audienceQuery(userId, clientId, a, channel);
  const rows = await fetch(`${SUPABASE_URL}/rest/v1/leads?${q}&select=id,name,email,phone&limit=10000`, { headers: sbHeaders() }).then(r => r.json());
  return rows || [];
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const userId = await getUserId(req);
  if (userId && _lastPlan === 'free') {
    const meta = await clerkMeta(userId);
    if (meta.plan) _lastPlan = meta.plan;
    if (meta.emails_extra) _emailsExtra = parseInt(meta.emails_extra) || 0;
  }
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;
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
    const [leads, all] = await Promise.all([
      resolveAudience(userId, clientId, a, channel),
      hasIds
        ? leadsByIds(userId, clientId, a.lead_ids, null, 'id,email,phone,tags')
        : fetch(`${SUPABASE_URL}/rest/v1/leads?${audienceQuery(userId, clientId, a, null)}&select=id,email,phone,tags&limit=10000`, { headers: sbHeaders() }).then(r => r.json()).then(r => r || []),
    ]);
    const breakdown = { matched: all.length, unsubscribed: 0, missing: 0 };
    for (const l of all) {
      if (channel === 'email') {
        if ((l.tags || []).includes('no-email')) breakdown.unsubscribed++;
        else if (!l.email) breakdown.missing++;
      } else if (!l.phone) breakdown.missing++;
    }
    return jsonResp({ count: leads.length, sample: leads.slice(0, 5).map(l => l.name), breakdown });
  }

  // GET ?stats=1&id= — aperturas de una campaña (join sent → opened por resend_id)
  if (req.method === 'GET' && url.searchParams.get('stats') && url.searchParams.get('id')) {
    const id = url.searchParams.get('id');
    const sent = await fetch(`${SUPABASE_URL}/rest/v1/email_events?campaign_id=eq.${id}&event=eq.sent&select=resend_id&limit=10000`, { headers: sbHeaders() }).then(r => r.json());
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
    const sampleRows = await resolveAudience(userId, clientId, c.audience, 'email');
    const lead = sampleRows[0] || { name: 'Ana Ejemplo', email: toEmail, phone: '', stage: 'nuevo', source: 'demo', company: 'Empresa Demo', value: 0 };
    const render = (t) => String(t || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => ({
      nombre: lead.name || '', empresa: lead.company || '', email: lead.email || '', telefono: lead.phone || '',
      etapa: lead.stage || '', fuente: lead.source || '', valor: lead.value ? '$' + Number(lead.value).toLocaleString('es-CO') : '',
    })[k.toLowerCase()] ?? m);
    const html = campaignHtml(c, render(c.body), 'https://app.acuarius.app/api/unsubscribe?test=1');
    const payload = {
      from: (c.from_name ? c.from_name.replace(/[<>"]/g, '') : 'Acuarius') + ' <notificaciones@app.acuarius.app>',
      to: [toEmail], subject: '[PRUEBA] ' + render(c.subject), html,
    };
    if (c.reply_to) payload.reply_to = c.reply_to;
    const r = await fetch('https://api.resend.com/emails', {
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

    const leads = await resolveAudience(userId, clientId, c.audience, c.channel);
    if (!leads.length) return jsonResp({ error: 'La audiencia quedó vacía con esos filtros' }, 400);

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
