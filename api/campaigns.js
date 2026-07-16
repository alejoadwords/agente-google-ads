// api/campaigns.js
// Campañas masivas de email y WhatsApp segmentadas por etiquetas/etapa/fuente.
// El envío real lo hace api/cron-campaigns.js por lotes; aquí vive el CRUD,
// el resolver de audiencia, la cola (con cupo mensual por plan) y las stats.
// Reglas de costo/reputación: cupo de emails por plan, exclusión automática
// de leads con etiqueta 'no-email' (baja) y de leads sin email/teléfono.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Cupo de emails de campaña por mes calendario
const EMAIL_QUOTAS = { free: 0, pro: 2000, individual: 2000, agency: 10000, agencia: 10000 };

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': prefer || 'return=representation',
  };
}

let _lastPlan = 'free';
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
    _lastPlan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
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

async function resolveAudience(userId, clientId, audience, channel) {
  const q = audienceQuery(userId, clientId, audience, channel);
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
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;
  const admin = null; // se resuelve solo cuando hace falta (cupo/gate)

  // GET ?preview=1 — conteo de audiencia en vivo para el builder
  if (req.method === 'GET' && url.searchParams.get('preview')) {
    let audience = {};
    try { audience = JSON.parse(url.searchParams.get('audience') || '{}'); } catch {}
    const channel = url.searchParams.get('channel') === 'whatsapp' ? 'whatsapp' : 'email';
    const leads = await resolveAudience(userId, clientId, audience, channel);
    return jsonResp({ count: leads.length, sample: leads.slice(0, 5).map(l => l.name) });
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
    // Cupo del mes para mostrar en la UI
    const quota = EMAIL_QUOTAS[_lastPlan] ?? 0;
    const used = await monthlySent(userId);
    return jsonResp({ campaigns: rows || [], quota: { plan: _lastPlan, limit: quota, used } });
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
    const quota = EMAIL_QUOTAS[_lastPlan] ?? 0;
    if (!adminUser && quota === 0) return jsonResp({ error: 'Las campañas masivas son parte del plan Pro.', upgrade: true }, 403);

    const leads = await resolveAudience(userId, clientId, c.audience, c.channel);
    if (!leads.length) return jsonResp({ error: 'La audiencia quedó vacía con esos filtros' }, 400);

    if (c.channel === 'email' && !adminUser) {
      const used = await monthlySent(userId);
      if (used + leads.length > quota) {
        return jsonResp({ error: `Cupo mensual insuficiente: tu plan incluye ${quota.toLocaleString()} emails/mes, llevas ${used.toLocaleString()} y esta campaña necesita ${leads.length.toLocaleString()}.`, quota_exceeded: true }, 403);
      }
    }

    // Encolar destinatarios en lotes
    for (let i = 0; i < leads.length; i += 500) {
      await fetch(`${SUPABASE_URL}/rest/v1/campaign_recipients`, {
        method: 'POST', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(leads.slice(i, i + 500).map(l => ({ campaign_id: c.id, lead_id: l.id, status: 'pending' }))),
      });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${c.id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'queued', stats: { total: leads.length, sent: 0, skipped: 0, failed: 0 }, queued_at: new Date().toISOString() }),
    });
    return jsonResp({ ok: true, total: leads.length });
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
      }),
    }).then(r => r.ok ? r.json() : null);
    if (!rows) return jsonResp({ error: 'No se pudo crear' }, 500);
    return jsonResp({ campaign: rows[0] }, 201);
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
