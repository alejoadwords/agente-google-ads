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

const PAID_PLANS = ['pro', 'agency', 'individual', 'agencia', 'trial'];
const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];

async function isPaidOrAdmin(userId) {
  if (PAID_PLANS.includes(_lastPlan)) return true;
  const meta = await clerkMeta(userId);
  if (PAID_PLANS.includes(meta.plan)) { _lastPlan = meta.plan; return true; }
  if (ADMIN_EMAILS.includes(meta._email)) return true;
  return false;
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const VALID_TRIGGERS = ['lead_created', 'stage_changed', 'lead_inactive', 'webhook', 'tag_added'];
const VALID_STEPS = ['send_email', 'send_whatsapp', 'wait', 'condition', 'change_stage', 'add_note', 'create_activity', 'notify_owner', 'branch', 'add_tag', 'remove_tag', 'send_nps'];

// Valida el árbol de pasos (las ramas yes/no anidan sub-pasos, un solo nivel).
// Devuelve {error, count} — count suma todos los pasos incluidos los anidados.
function validateSteps(steps, depth) {
  let count = 0;
  for (const s of (steps || [])) {
    count++;
    if (!VALID_STEPS.includes(s.type)) return { error: 'Paso inválido: ' + s.type, count };
    if (s.type === 'send_email' && (!s.subject || !s.body)) return { error: 'El paso de email requiere asunto y cuerpo', count };
    if (s.type === 'send_whatsapp' && !s.body) return { error: 'El paso de WhatsApp requiere el mensaje', count };
    if (s.type === 'wait' && !(parseFloat(s.hours) > 0)) return { error: 'El paso de espera requiere horas > 0', count };
    if (s.type === 'condition' && (!s.field || !s.op)) return { error: 'La condición requiere campo y operador', count };
    if (s.type === 'change_stage' && !s.stage) return { error: 'El cambio de etapa requiere la etapa destino', count };
    if (s.type === 'add_note' && !s.text) return { error: 'La nota requiere texto', count };
    if (s.type === 'create_activity' && !s.title) return { error: 'La tarea requiere un título', count };
    if (s.type === 'notify_owner' && !s.body) return { error: 'La notificación requiere el mensaje', count };
    if ((s.type === 'add_tag' || s.type === 'remove_tag') && !String(s.tag || '').trim()) return { error: 'El paso de etiqueta requiere el nombre de la etiqueta', count };
    if (s.type === 'branch') {
      if (depth > 0) return { error: 'Las ramas no pueden anidarse dentro de otra rama', count };
      if (!s.field || !s.op) return { error: 'La rama requiere campo y operador', count };
      if (!(s.yes || []).length && !(s.no || []).length) return { error: 'La rama necesita al menos un paso en Sí o en No', count };
      for (const key of ['yes', 'no']) {
        const sub = validateSteps(s[key], depth + 1);
        count += sub.count;
        if (sub.error) return { error: sub.error, count };
      }
    }
  }
  return { error: null, count };
}

function validateAutomation(body) {
  if (!body.name || !String(body.name).trim()) return 'El nombre es requerido';
  if (!body.trigger || !VALID_TRIGGERS.includes(body.trigger.type)) return 'Trigger inválido';
  if (body.trigger.type === 'lead_inactive' && !(parseInt(body.trigger.days) > 0)) return 'El trigger de inactividad requiere días > 0';
  if (body.trigger.window) {
    const w = body.trigger.window;
    const s = parseInt(w.start), e = parseInt(w.end);
    if (isNaN(s) || isNaN(e) || s < 0 || s > 23 || e < 0 || e > 23 || s === e) return 'La ventana horaria requiere horas válidas (0–23) y distintas';
  }
  if (!Array.isArray(body.steps) || !body.steps.length) return 'La automatización necesita al menos un paso';
  const r = validateSteps(body.steps, 0);
  if (r.error) return r.error;
  if (r.count > 20) return 'Máximo 20 pasos en total (incluyendo los de las ramas)';
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
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
    // El trigger webhook recibe su token secreto aquí (nunca lo elige el cliente)
    if (body.trigger.type === 'webhook') {
      body.trigger = { type: 'webhook', token: crypto.randomUUID().replace(/-/g, ''), ...(body.trigger.window ? { window: body.trigger.window } : {}) };
    }
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
      // El token del webhook lo controla el servidor: se conserva el existente
      // o se genera uno nuevo si el trigger cambió a webhook
      if (body.trigger.type === 'webhook') {
        const curRes = await fetch(`${SUPABASE_URL}/rest/v1/automations?id=eq.${body.id}&user_id=eq.${userId}&select=trigger`, { headers: sbHeaders() });
        const cur = (await curRes.json())?.[0];
        const existingToken = cur?.trigger?.type === 'webhook' ? cur.trigger.token : null;
        body.trigger = { type: 'webhook', token: existingToken || crypto.randomUUID().replace(/-/g, ''), ...(body.trigger.window ? { window: body.trigger.window } : {}) };
      }
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
