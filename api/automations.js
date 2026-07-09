// api/automations.js
// CRUD de automatizaciones del CRM: flujos con trigger + pasos que el motor
// (api/cron-automations.js) ejecuta server-side.
// Triggers: lead_created | stage_changed (stage opcional) | lead_inactive (days)
// Steps: send_email {subject,body} | send_whatsapp {body} | wait {hours} |
//        condition {field,op,value} | change_stage {stage} | add_note {text}
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

// Verificación completa del JWT de Clerk (mismo patrón que api/leads.js)
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
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
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

// ── Gate por plan: crear/editar automatizaciones es feature Pro ──────────────
let _lastPlan = 'free';
const PAID_PLANS = ['pro', 'agency', 'individual', 'agencia'];
const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];

async function isPaidOrAdmin(userId) {
  if (PAID_PLANS.includes(_lastPlan)) return true;
  // Bypass admin: verificar email real via Clerk (el JWT no siempre lo trae)
  if (userId && process.env.CLERK_SECRET_KEY) {
    try {
      const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
        headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
      });
      const u = await r.json();
      const email = (u.email_addresses?.[0]?.email_address || '').toLowerCase();
      if (ADMIN_EMAILS.includes(email)) return true;
    } catch {}
  }
  return false;
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const VALID_TRIGGERS = ['lead_created', 'stage_changed', 'lead_inactive'];
const VALID_STEPS = ['send_email', 'send_whatsapp', 'wait', 'condition', 'change_stage', 'add_note'];

function validateAutomation(body) {
  if (!body.name || !String(body.name).trim()) return 'El nombre es requerido';
  if (!body.trigger || !VALID_TRIGGERS.includes(body.trigger.type)) return 'Trigger inválido';
  if (body.trigger.type === 'lead_inactive' && !(parseInt(body.trigger.days) > 0)) return 'El trigger de inactividad requiere días > 0';
  if (!Array.isArray(body.steps) || !body.steps.length) return 'La automatización necesita al menos un paso';
  if (body.steps.length > 20) return 'Máximo 20 pasos';
  for (const s of body.steps) {
    if (!VALID_STEPS.includes(s.type)) return 'Paso inválido: ' + s.type;
    if (s.type === 'send_email' && (!s.subject || !s.body)) return 'El paso de email requiere asunto y cuerpo';
    if (s.type === 'send_whatsapp' && !s.body) return 'El paso de WhatsApp requiere el mensaje';
    if (s.type === 'wait' && !(parseFloat(s.hours) > 0)) return 'El paso de espera requiere horas > 0';
    if (s.type === 'condition' && (!s.field || !s.op)) return 'La condición requiere campo y operador';
    if (s.type === 'change_stage' && !s.stage) return 'El cambio de etapa requiere la etapa destino';
    if (s.type === 'add_note' && !s.text) return 'La nota requiere texto';
  }
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;

  // GET ?logs=1&automation_id= — historial de ejecuciones
  if (req.method === 'GET' && url.searchParams.get('logs')) {
    const autoId = url.searchParams.get('automation_id');
    let q = `${SUPABASE_URL}/rest/v1/automation_logs?user_id=eq.${userId}&select=*&order=created_at.desc&limit=100`;
    if (autoId) q += `&automation_id=eq.${autoId}`;
    const res = await fetch(q, { headers: sbHeaders() });
    return jsonResp({ logs: (await res.json()) || [] });
  }

  // GET — listar automatizaciones (del scope del cliente activo)
  if (req.method === 'GET') {
    const scope = clientId ? `&client_id=eq.${clientId}` : '&client_id=is.null';
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?user_id=eq.${userId}${scope}&select=*&order=created_at.desc`,
      { headers: sbHeaders() }
    );
    return jsonResp({ automations: (await res.json()) || [] });
  }

  // POST — crear (solo planes pagos)
  if (req.method === 'POST') {
    if (!(await isPaidOrAdmin(userId))) {
      return jsonResp({ error: 'Las automatizaciones son parte del plan Pro.', upgrade: true }, 403);
    }
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const err = validateAutomation(body);
    if (err) return jsonResp({ error: err }, 400);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/automations`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        user_id: userId,
        client_id: clientId,
        name: String(body.name).trim(),
        active: body.active !== false,
        trigger: body.trigger,
        steps: body.steps,
      }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ automation: rows[0] }, 201);
  }

  // PUT — actualizar (incluye toggle active; solo planes pagos)
  if (req.method === 'PUT') {
    if (!(await isPaidOrAdmin(userId))) {
      return jsonResp({ error: 'Las automatizaciones son parte del plan Pro.', upgrade: true }, 403);
    }
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.id) return jsonResp({ error: 'Falta id' }, 400);
    const update = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) update.name = String(body.name).trim();
    if (body.active !== undefined) update.active = !!body.active;
    if (body.trigger !== undefined || body.steps !== undefined) {
      const err = validateAutomation({ name: body.name || 'x', trigger: body.trigger, steps: body.steps });
      if (err) return jsonResp({ error: err }, 400);
      update.trigger = body.trigger;
      update.steps = body.steps;
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?id=eq.${body.id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ automation: rows[0] });
  }

  // DELETE — eliminar (jobs pendientes se cancelan en cascada por FK)
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
