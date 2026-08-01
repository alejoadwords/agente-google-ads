export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// El token de sesión de Clerk (v2) ya no trae public_metadata: si el plan no
// viene en el JWT hay que preguntárselo a Clerk, o todo usuario de pago se
// quedaría con el límite del plan gratuito. Cache de un minuto por usuario.
const _planCache = new Map();
async function clerkMeta(userId) {
  if (!userId || !process.env.CLERK_SECRET_KEY) return {};
  const hit = _planCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.meta;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const meta = (await r.json()).public_metadata || {};
    _planCache.set(userId, { meta, exp: Date.now() + 60000 });
    return meta;
  } catch { return {}; }
}

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g,'+').replace(/_/g,'/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(sB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Etiquetas ────────────────────────────────────────────────────────────────
// Normalización canónica (misma regla que api/lead-tags.js): minúsculas,
// espacios colapsados, máx 30 chars, máx 15 etiquetas por lead.
function normalizeTag(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
}

const TAG_PALETTE = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EC4899','#14B8A6','#EF4444','#6366F1','#84CC16','#F97316'];
function tagColorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// Normaliza las etiquetas del lead, agrega la auto-etiqueta de fuente (si
// aplica) y garantiza que todas existan en el catálogo lead_tags con color.
async function prepareTags(userId, clientId, tags, source) {
  const set = new Set((Array.isArray(tags) ? tags : []).map(normalizeTag).filter(t => t.length >= 2));
  let autoTag = null;
  if (source) {
    autoTag = normalizeTag(String(source).replace(/_/g, ' '));
    if (autoTag.length >= 2) set.add(autoTag);
  }
  const list = [...set].slice(0, 15);
  if (!list.length) return [];
  // Asegurar catálogo (fire-and-forget por etiqueta faltante)
  try {
    const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
    const exRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lead_tags?user_id=eq.${encodeURIComponent(userId)}${scope}&select=name`,
      { headers: sbHeaders() }
    );
    const existing = new Set(((await exRes.json()) || []).map(t => t.name));
    const missing = list.filter(t => !existing.has(t));
    if (missing.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/lead_tags`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(missing.map(t => ({
          user_id: userId, client_id: clientId, name: t, color: tagColorFor(t),
          kind: t === autoTag ? 'auto' : 'manual',
        }))),
      });
    }
  } catch {} // el catálogo es best-effort — las etiquetas del lead no se bloquean
  return list;
}

// Encola las automatizaciones que coincidan con el trigger (lead_created /
// stage_changed / tag_added). El motor las ejecuta en api/cron-automations.js.
// extra: la etapa nueva (stage_changed) o el array de etiquetas añadidas (tag_added).
async function enqueueAutomations(userId, lead, triggerType, extra) {
  try {
    const scope = lead.client_id ? `&client_id=eq.${lead.client_id}` : '&client_id=is.null';
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?user_id=eq.${userId}${scope}&active=eq.true&select=id,trigger`,
      { headers: sbHeaders() }
    );
    if (!r.ok) return;
    const autos = await r.json();
    let matching = (autos || []).filter(a => {
      if (a.trigger?.type !== triggerType) return false;
      if (triggerType === 'stage_changed') return !a.trigger.stage || a.trigger.stage === extra;
      if (triggerType === 'tag_added') return !a.trigger.tag || (extra || []).includes(a.trigger.tag);
      return true;
    });
    // tag_added: se dispara UNA sola vez por lead (dedupe con historial completo)
    // — evita bucles cuando una automatización etiqueta y otra reacciona a esa etiqueta
    if (triggerType === 'tag_added' && matching.length) {
      const checks = await Promise.all(matching.map(a =>
        fetch(`${SUPABASE_URL}/rest/v1/automation_jobs?automation_id=eq.${a.id}&lead_id=eq.${lead.id}&select=id&limit=1`, { headers: sbHeaders() })
          .then(res => res.json()).then(rows => ({ a, exists: !!rows?.length })).catch(() => ({ a, exists: true }))
      ));
      matching = checks.filter(c => !c.exists).map(c => c.a);
    }
    if (!matching.length) return;
    await fetch(`${SUPABASE_URL}/rest/v1/automation_jobs`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(matching.map(a => ({
        automation_id: a.id, user_id: userId, lead_id: lead.id,
        step_index: 0, status: 'pending', run_at: new Date().toISOString(),
      }))),
    });
  } catch (e) { console.error('enqueueAutomations:', e.message); }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: si soy miembro activo de un workspace, opero sobre los datos del dueño
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sbHeaders() });
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) userId = _tw.owner_user_id;
  } catch {}

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;

  // Build base filter: user_id + optional client_id + not deleted
  const scopeFilter = clientId
    ? `user_id=eq.${userId}&client_id=eq.${clientId}&deleted_at=is.null`
    : `user_id=eq.${userId}&deleted_at=is.null`;

  // GET — list leads
  if (req.method === 'GET' && !url.searchParams.get('id')) {
    const stage = url.searchParams.get('stage');
    let query = `${SUPABASE_URL}/rest/v1/leads?${scopeFilter}&select=*&order=stage_position.asc,created_at.desc`;
    if (stage) query += `&stage=eq.${encodeURIComponent(stage)}`;
    const res = await fetch(query, { headers: sbHeaders() });
    const rows = await res.json();
    return jsonResp({ leads: rows || [] });
  }

  // GET single lead
  if (req.method === 'GET' && url.searchParams.get('id')) {
    const id = url.searchParams.get('id');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}&deleted_at=is.null&select=*`,
      { headers: sbHeaders() }
    );
    const rows = await res.json();
    if (!rows?.[0]) return jsonResp({ error: 'No encontrado' }, 404);
    return jsonResp({ lead: rows[0] });
  }

  // POST ?action=import — importación masiva (CSV/pegado desde el wizard).
  // Dedupe por email en el scope, respeta el límite de plan y NO dispara
  // automatizaciones (una importación de miles no debe detonar flujos de
  // lead nuevo — para eso está la etiqueta de importación + campañas).
  if (req.method === 'POST' && url.searchParams.get('action') === 'import') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const rows = Array.isArray(body.leads) ? body.leads.slice(0, 300) : [];
    if (!rows.length) return jsonResp({ error: 'Sin filas para importar' }, 400);
    const opts = body.options || {};
    const dedupe = opts.dedupe === 'update' ? 'update' : 'skip';
    const stage = String(opts.stage || 'nuevo').slice(0, 40);
    const importTags = Array.isArray(opts.tags) ? opts.tags : [];

    // Límite de plan (mismo cálculo que la creación individual)
    let userPlan = 'free', leadsExtra = 0;
    try {
      const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      userPlan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
      leadsExtra = parseInt(payload.public_metadata?.leads_extra || payload.publicMetadata?.leads_extra || 0);
    } catch {}
    if (userPlan === 'free') {
      const meta = await clerkMeta(userId);
      if (meta.plan) userPlan = meta.plan;
      if (meta.leads_extra) leadsExtra = parseInt(meta.leads_extra) || 0;
    }
    const PLAN_LIMITS_IMP = { free: 50, pro: 1000, individual: 1000, trial: 1000, agency: 5000, agencia: 5000 };
    const planLimit = (PLAN_LIMITS_IMP[userPlan] || 10) + (leadsExtra * 1000);
    const countRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}&deleted_at=is.null&select=id&limit=0`, { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } });
    let currentCount = parseInt((countRes.headers.get('content-range') || '*/0').split('/')[1] || '0') || 0;

    // Emails existentes del scope para dedupe (una consulta por lote)
    const emails = rows.map(r => String(r.email || '').trim().toLowerCase()).filter(Boolean);
    const scope = clientId ? `&client_id=eq.${clientId}` : '&client_id=is.null';
    let existingByEmail = {};
    if (emails.length) {
      const exRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}${scope}&deleted_at=is.null&email=in.(${emails.map(e => '"' + e.replace(/"/g, '') + '"').join(',')})&select=id,email,tags`, { headers: sbHeaders() });
      ((await exRes.json()) || []).forEach(l => { existingByEmail[(l.email || '').toLowerCase()] = l; });
    }

    const result = { created: 0, updated: 0, skipped: 0, invalid: 0, limit_reached: false };
    const toInsert = [];
    const seenInBatch = new Set();
    for (const r of rows) {
      const name = String(r.name || '').trim().slice(0, 120);
      const email = String(r.email || '').trim().toLowerCase().slice(0, 200) || null;
      if (!name && !email) { result.invalid++; continue; }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { result.invalid++; continue; }
      if (email && seenInBatch.has(email)) { result.skipped++; continue; }
      if (email) seenInBatch.add(email);
      const rowTags = [...importTags, ...(Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(','))];
      const cleanTags = await prepareTags(userId, clientId, rowTags, null);

      const existing = email ? existingByEmail[email] : null;
      if (existing) {
        if (dedupe === 'skip') { result.skipped++; continue; }
        const mergedTags = [...new Set([...(existing.tags || []), ...cleanTags])].slice(0, 15);
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existing.id}&user_id=eq.${userId}`, {
          method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            ...(name ? { name } : {}),
            ...(r.phone ? { phone: String(r.phone).trim().slice(0, 40) } : {}),
            ...(r.company ? { company: String(r.company).trim().slice(0, 120) } : {}),
            ...(r.value ? { value: parseFloat(String(r.value).replace(/[^\d.]/g, '')) || null } : {}),
            tags: mergedTags, updated_at: new Date().toISOString(),
          }),
        });
        result.updated++;
        continue;
      }
      if (currentCount + toInsert.length >= planLimit) { result.limit_reached = true; result.skipped++; continue; }
      toInsert.push({
        user_id: userId, client_id: clientId,
        name: name || email, email,
        phone: r.phone ? String(r.phone).trim().slice(0, 40) : null,
        company: r.company ? String(r.company).trim().slice(0, 120) : null,
        value: r.value ? parseFloat(String(r.value).replace(/[^\d.]/g, '')) || null : null,
        notes: r.notes ? String(r.notes).trim().slice(0, 1000) : null,
        stage, stage_position: 0,
        source: 'importacion',
        tags: cleanTags,
        custom_fields: {},
      });
    }
    if (toInsert.length) {
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: 'POST', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(toInsert),
      });
      if (!insRes.ok) return jsonResp({ error: 'Error insertando: ' + (await insRes.text()).slice(0, 200) }, 500);
      result.created = toInsert.length;
    }
    return jsonResp({ ok: true, result, plan_limit: planLimit, current: currentCount + result.created });
  }

  // POST — create lead
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { name, email, phone, company, stage, notes, source, tags, custom_fields } = body;
    if (!name) return jsonResp({ error: 'El nombre es requerido' }, 400);

    // Etiquetas: normalizar + auto-tag por fuente + asegurar catálogo
    const leadTags = await prepareTags(userId, clientId, tags, source || 'manual');

    // Plan-based lead limit check
    let userPlan = 'free';
    let leadsExtra = 0;
    try {
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.replace('Bearer ', '');
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        userPlan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
        leadsExtra = parseInt(payload.public_metadata?.leads_extra || payload.publicMetadata?.leads_extra || 0);
      }
    } catch {}
    if (userPlan === 'free') {
      const meta = await clerkMeta(userId);
      if (meta.plan) userPlan = meta.plan;
      if (meta.leads_extra) leadsExtra = parseInt(meta.leads_extra) || 0;
    }
    const PLAN_LIMITS = { free: 50, pro: 1000, individual: 1000, trial: 1000, agency: 5000, agencia: 5000 };
    const planLimit = (PLAN_LIMITS[userPlan] || 10) + (leadsExtra * 1000);
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}&deleted_at=is.null&select=id&limit=0`,
      { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } }
    );
    const rawRange = countRes.headers.get('content-range') || '*/0';
    const currentCount = parseInt(rawRange.split('/')[1] || '0') || 0;
    if (currentCount >= planLimit) {
      return jsonResp({ error: 'Límite de leads alcanzado para tu plan.', limit_reached: true, current: currentCount, limit: planLimit }, 403);
    }

    // Get max position in target stage for ordering
    const posRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}&${clientId ? `client_id=eq.${clientId}` : 'client_id=is.null'}&deleted_at=is.null&stage=eq.${encodeURIComponent(stage || 'nuevo')}&select=stage_position&order=stage_position.desc&limit=1`,
      { headers: sbHeaders() }
    );
    const posRows = await posRes.json();
    const maxPos = posRows?.[0]?.stage_position ?? 0;

    const payload = {
      user_id: userId,
      client_id: clientId,
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      company: company?.trim() || null,
      stage: stage || 'nuevo',
      stage_position: maxPos + 1000,
      notes: notes?.trim() || null,
      source: source || 'manual',
      tags: leadTags,
      custom_fields: custom_fields || {},
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    // Triggers de automatizaciones: lead creado + etiquetas iniciales
    if (rows[0]) {
      await enqueueAutomations(userId, rows[0], 'lead_created');
      if (leadTags.length) await enqueueAutomations(userId, rows[0], 'tag_added', leadTags);
    }
    return jsonResp({ lead: rows[0] }, 201);
  }

  // PUT — update lead (including stage move)
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id, ...fields } = body;
    if (!id) return jsonResp({ error: 'Falta id' }, 400);

    // Only allow safe fields
    const allowed = ['name','email','phone','company','stage','stage_position','notes','source','tags','custom_fields','value','assigned_to','assigned_name','close_reason','close_currency','closed_at'];
    const update = {};
    for (const k of allowed) {
      if (fields[k] !== undefined) update[k] = fields[k];
    }
    // Etiquetas editadas: normalizar y asegurar catálogo (sin auto-tag de fuente)
    if (update.tags !== undefined) {
      update.tags = await prepareTags(userId, clientId, update.tags, null);
    }
    update.updated_at = new Date().toISOString();

    // Si cambia la etapa o las etiquetas, capturar el estado anterior para los triggers
    let prevStage = null;
    let prevTags = null;
    if (update.stage !== undefined || update.tags !== undefined) {
      try {
        const pre = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}&select=stage,tags`, { headers: sbHeaders() });
        const prev = (await pre.json())?.[0];
        prevStage = prev?.stage ?? null;
        prevTags = prev?.tags ?? [];
      } catch {}
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    // Trigger de automatizaciones: cambio de etapa real
    if (rows[0] && update.stage !== undefined && prevStage !== null && prevStage !== update.stage) {
      await enqueueAutomations(userId, rows[0], 'stage_changed', update.stage);
    }
    // Trigger: etiquetas añadidas en esta edición
    if (rows[0] && update.tags !== undefined && prevTags !== null) {
      const added = (update.tags || []).filter(t => !prevTags.includes(t));
      if (added.length) await enqueueAutomations(userId, rows[0], 'tag_added', added);
    }
    return jsonResp({ lead: rows[0] });
  }

  // DELETE — soft delete
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: sbHeaders(),
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
