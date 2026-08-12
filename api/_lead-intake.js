// api/_lead-intake.js
// Ingesta compartida de leads desde fuentes externas (formularios web,
// webhook genérico, Meta Lead Ads). El guion bajo evita que sea endpoint.
// Reglas iguales al resto de la app: normalización de etiquetas, catálogo
// con color por hash, dedupe por email (merge de tags/nota) y disparo de
// automatizaciones lead_created + tag_added (anti-bucle: una vez por lead).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

export function normTag(t) {
  return String(t || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
}

export function pick(body, ...keys) {
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

// Detección de payloads conocidos de plataformas externas.
// Hotmart: {event:'PURCHASE_APPROVED', data:{buyer:{name,email,checkout_phone},
// product:{name}, purchase:{price:{value}}}} — compra aprobada entra como Ganado.
export function mapExternalPayload(body) {
  const d = body && body.data;
  const ev = String(body?.event || '');
  if (d && (d.buyer || /^(PURCHASE|SUBSCRIPTION|CART|CLUB)/.test(ev))) {
    const buyer = d.buyer || {};
    const product = d.product || {};
    const price = (d.purchase && d.purchase.price) || {};
    const won = /APPROVED|COMPLETE/.test(ev);
    return {
      name: buyer.name || null,
      email: buyer.email || null,
      phone: buyer.checkout_phone || buyer.phone || null,
      value: price.value || null,
      source: 'hotmart',
      sourceLabel: 'Hotmart',
      note: [ev.replace(/_/g, ' ').toLowerCase() || null, product.name || null].filter(Boolean).join(' · ') || null,
      tags: ['hotmart', ...(product.name ? [String(product.name)] : [])],
      stage: won ? 'ganado' : 'nuevo',
    };
  }
  return null;
}

// Los leads que entran por formulario, webhook o inbox tienen que caer en un
// pipeline concreto; si no, no se verian en ningun tablero. Devuelve null si la
// tabla 'pipelines' aun no existe (migracion pendiente) y entonces se crea el
// lead sin pipeline, como antes.
export async function pipelinePrincipal(userId, clientId) {
  try {
    const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
    const filas = await sb(`/pipelines?user_id=eq.${encodeURIComponent(userId)}${scope}&select=id,is_default&order=position.asc`);
    if (!Array.isArray(filas) || !filas.length) return null;
    return (filas.find(p => p.is_default) || filas[0]).id;
  } catch { return null; }
}

const TAG_PALETTE = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EC4899','#14B8A6','#EF4444','#6366F1','#84CC16','#F97316'];
function colorFor(n) { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return TAG_PALETTE[h % TAG_PALETTE.length]; }

export async function ensureCatalog(userId, clientId, tags, autoTag) {
  if (!tags.length) return;
  try {
    const scope = clientId ? `&client_id=eq.${clientId}` : '&client_id=is.null';
    const existing = new Set(((await sb(`/lead_tags?user_id=eq.${encodeURIComponent(userId)}${scope}&select=name`)) || []).map(t => t.name));
    const missing = tags.filter(t => !existing.has(t));
    if (missing.length) {
      await sb('/lead_tags', 'POST', missing.map(t => ({
        user_id: userId, client_id: clientId, name: t, color: colorFor(t),
        kind: t === autoTag ? 'auto' : 'manual',
      })), 'return=minimal');
    }
  } catch {}
}

export async function enqueueAutomations(userId, lead, triggerType, extra) {
  try {
    const scope = lead.client_id ? `&client_id=eq.${lead.client_id}` : '&client_id=is.null';
    const autos = await sb(`/automations?user_id=eq.${encodeURIComponent(userId)}${scope}&active=eq.true&select=id,trigger`);
    let matching = (autos || []).filter(a => {
      if (a.trigger?.type !== triggerType) return false;
      if (triggerType === 'tag_added') return !a.trigger.tag || (extra || []).includes(a.trigger.tag);
      return true;
    });
    if (triggerType === 'tag_added' && matching.length) {
      const checks = await Promise.all(matching.map(a =>
        sb(`/automation_jobs?automation_id=eq.${a.id}&lead_id=eq.${lead.id}&select=id&limit=1`)
          .then(rows => ({ a, exists: !!rows?.length })).catch(() => ({ a, exists: true }))
      ));
      matching = checks.filter(c => !c.exists).map(c => c.a);
    }
    if (!matching.length) return;
    await sb('/automation_jobs', 'POST', matching.map(a => ({
      automation_id: a.id, user_id: userId, lead_id: lead.id,
      step_index: 0, status: 'pending', run_at: new Date().toISOString(),
    })), 'return=minimal');
  } catch (e) { console.error('[intake] enqueue:', e.message); }
}

// Crea o mergea un lead. data: {name, email, phone, company, value, note, source, sourceLabel, tags[], stage}
// Devuelve {lead, created}.
export async function intakeLead(userId, clientId, data) {
  const tagSet = new Set((data.tags || []).map(normTag).filter(t => t.length >= 2));
  const autoTag = normTag(String(data.source || '').replace(/_/g, ' '));
  if (autoTag.length >= 2) tagSet.add(autoTag);
  const leadTags = [...tagSet].slice(0, 15);
  await ensureCatalog(userId, clientId, leadTags, autoTag);

  const scope = clientId ? `&client_id=eq.${clientId}` : '&client_id=is.null';
  let lead = null;
  if (data.email) {
    const found = await sb(`/leads?user_id=eq.${encodeURIComponent(userId)}${scope}&email=eq.${encodeURIComponent(data.email)}&deleted_at=is.null&select=*&limit=1`);
    lead = found?.[0] || null;
  }
  if (!lead && data.phone) {
    const digits = String(data.phone).replace(/\D/g, '');
    if (digits.length >= 7) {
      const found = await sb(`/leads?user_id=eq.${encodeURIComponent(userId)}${scope}&deleted_at=is.null&phone=not.is.null&select=*&order=created_at.desc&limit=500`);
      lead = (found || []).find(l => String(l.phone).replace(/\D/g, '').endsWith(digits.slice(-10))) || null;
    }
  }

  const noteLine = data.note ? `📥 [${data.sourceLabel || 'Fuente externa'}] ` + String(data.note).slice(0, 600) : null;

  if (!lead) {
    const pipeline = await pipelinePrincipal(userId, clientId);
    const rows = await sb('/leads', 'POST', {
      user_id: userId, client_id: clientId,
      name: data.name || 'Lead sin nombre',
      email: data.email || null, phone: data.phone || null, company: data.company || null,
      value: data.value ? parseFloat(String(data.value).replace(/[^\d.]/g, '')) || null : null,
      stage: data.stage || 'nuevo',
      stage_position: Date.now(),
      source: data.source || 'externa',
      tags: leadTags,
      notes: noteLine,
      ...(pipeline ? { pipeline_id: pipeline } : {}),
    });
    const created = rows[0];
    // Reparto entre comerciales antes de disparar automatizaciones, para que
    // un flujo que notifique al responsable ya lo encuentre asignado.
    try {
      const { asignarLead } = await import('./_assign.js');
      await asignarLead(userId, created, created.source);
    } catch (e) { console.error('asignar en intake:', e); }
    await enqueueAutomations(userId, created, 'lead_created');
    if (leadTags.length) await enqueueAutomations(userId, created, 'tag_added', leadTags);
    return { lead: created, created: true };
  }

  const patch = { updated_at: new Date().toISOString() };
  if (noteLine) patch.notes = (lead.notes ? lead.notes + '\n' : '') + noteLine;
  if (data.name && (!lead.name || lead.name === 'Lead sin nombre')) patch.name = data.name;
  if (data.phone && !lead.phone) patch.phone = data.phone;
  if (data.email && !lead.email) patch.email = data.email;
  if (data.company && !lead.company) patch.company = data.company;
  const mergedTags = [...new Set([...(lead.tags || []), ...leadTags])].slice(0, 15);
  const added = mergedTags.filter(t => !(lead.tags || []).includes(t));
  if (added.length) patch.tags = mergedTags;
  await sb(`/leads?id=eq.${lead.id}`, 'PATCH', patch, 'return=minimal');
  if (added.length) await enqueueAutomations(userId, { ...lead, tags: mergedTags }, 'tag_added', added);
  return { lead: { ...lead, ...patch }, created: false };
}
