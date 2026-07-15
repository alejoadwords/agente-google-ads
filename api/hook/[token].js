// api/hook/[token].js
// Trigger por webhook externo: cada automatización con lanzador "webhook"
// tiene una URL única https://app.acuarius.app/api/hook/<token>.
// Un POST con los datos del lead (JSON o form-urlencoded) crea el lead
// (o reutiliza el existente por email) y encola el flujo.
// Pensado para formularios de landing, Zapier, Make, Meta Lead Ads, etc.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

// Campos aceptados con alias en español/inglés (formularios variados)
function pick(body, ...keys) {
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, hint: 'Envía un POST con los datos del lead (name, email, phone, company, value, source)' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const token = String(req.query.token || '');
  if (!/^[a-f0-9]{24,64}$/i.test(token)) return res.status(404).json({ error: 'Webhook no encontrado' });

  try {
    // 1. Automatización activa dueña de este token
    const autos = await sb(`/automations?trigger->>type=eq.webhook&trigger->>token=eq.${encodeURIComponent(token)}&active=eq.true&select=*&limit=1`);
    const auto = autos?.[0];
    if (!auto) return res.status(404).json({ error: 'Webhook no encontrado o automatización inactiva' });

    // 2. Datos del lead (req.body ya viene parseado por Vercel para JSON y form-urlencoded)
    const body = (typeof req.body === 'object' && req.body) || {};
    const name = pick(body, 'name', 'nombre', 'full_name', 'fullname') || 'Lead sin nombre';
    const email = pick(body, 'email', 'correo', 'mail');
    const phone = pick(body, 'phone', 'telefono', 'teléfono', 'tel', 'whatsapp');
    const company = pick(body, 'company', 'empresa', 'negocio');
    const value = pick(body, 'value', 'valor', 'budget', 'presupuesto');
    const source = pick(body, 'source', 'fuente', 'utm_source') || 'webhook';
    const note = pick(body, 'note', 'nota', 'message', 'mensaje', 'comentario');
    // Etiquetas: las del payload (array o string separado por comas) + auto por fuente
    const normTag = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
    const rawTags = Array.isArray(body.tags || body.etiquetas)
      ? (body.tags || body.etiquetas)
      : String(body.tags || body.etiquetas || '').split(',');
    const tagSet = new Set(rawTags.map(normTag).filter(t => t.length >= 2));
    const autoTag = normTag(source.replace(/_/g, ' '));
    if (autoTag.length >= 2) tagSet.add(autoTag);
    const leadTags = [...tagSet].slice(0, 15);

    // 3. Reutilizar lead existente por email (mismo usuario y scope de cliente)
    let lead = null;
    if (email) {
      const scope = auto.client_id ? `&client_id=eq.${auto.client_id}` : '&client_id=is.null';
      const found = await sb(`/leads?user_id=eq.${encodeURIComponent(auto.user_id)}${scope}&email=eq.${encodeURIComponent(email)}&deleted_at=is.null&select=*&limit=1`);
      lead = found?.[0] || null;
    }

    // 4. Crear el lead si no existe
    if (!lead) {
      const rows = await sb('/leads', 'POST', {
        user_id: auto.user_id,
        client_id: auto.client_id,
        name, email, phone, company,
        value: value ? parseFloat(String(value).replace(/[^\d.]/g, '')) || null : null,
        stage: 'nuevo',
        source,
        tags: leadTags,
        notes: note ? '📥 [Webhook] ' + note.slice(0, 500) : null,
      });
      lead = rows[0];
    } else {
      // Lead existente: sumar nota y/o etiquetas nuevas sin duplicar
      const patch = { updated_at: new Date().toISOString() };
      if (note) patch.notes = (lead.notes ? lead.notes + '\n' : '') + '📥 [Webhook] ' + note.slice(0, 500);
      const mergedTags = [...new Set([...(lead.tags || []), ...leadTags])].slice(0, 15);
      if (mergedTags.length !== (lead.tags || []).length) patch.tags = mergedTags;
      if (note || patch.tags) await sb(`/leads?id=eq.${lead.id}`, 'PATCH', patch, 'return=minimal');
    }

    // 5. Encolar el flujo (dedupe: si ya hay un job pendiente de esta automatización para este lead, no duplicar)
    const pend = await sb(`/automation_jobs?automation_id=eq.${auto.id}&lead_id=eq.${lead.id}&status=eq.pending&select=id&limit=1`);
    if (!pend?.length) {
      await sb('/automation_jobs', 'POST', {
        automation_id: auto.id, user_id: auto.user_id, lead_id: lead.id,
        step_index: 0, status: 'pending', run_at: new Date().toISOString(),
      }, 'return=minimal');
      await sb('/automation_logs', 'POST', {
        automation_id: auto.id, user_id: auto.user_id, lead_id: lead.id,
        step_index: 0, action: 'trigger', result: 'enqueued', detail: 'Webhook externo · ' + name + (email ? ' · ' + email : ''),
      }, 'return=minimal').catch(() => {});
    }

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (e) {
    console.error('[hook] error:', e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
}
