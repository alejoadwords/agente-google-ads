// api/forms.js
// CRUD de formularios de captura de leads. Cada formulario tiene un token
// público: página alojada en /form/<token>, envío via api/form-public.js
// y conector para formularios existentes (public/f.js).
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
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'select'];
// Campos con destino fijo en el lead; cualquier otro va a la nota
const FIELD_KEYS = ['name', 'email', 'phone', 'company', 'custom'];

function sanitizeFields(fields) {
  if (!Array.isArray(fields)) return null;
  const out = [];
  for (const f of fields.slice(0, 12)) {
    const key = FIELD_KEYS.includes(f.key) ? f.key : 'custom';
    out.push({
      key,
      label: String(f.label || '').slice(0, 60) || 'Campo',
      type: FIELD_TYPES.includes(f.type) ? f.type : 'text',
      required: !!f.required,
      options: f.type === 'select' && Array.isArray(f.options) ? f.options.map(o => String(o).slice(0, 60)).slice(0, 12) : undefined,
    });
  }
  return out.length ? out : null;
}

function sanitize(body) {
  const out = {};
  if ('name' in body) out.name = String(body.name || '').trim().slice(0, 100);
  if ('title' in body) out.title = String(body.title || '').trim().slice(0, 120) || null;
  if ('description' in body) out.description = String(body.description || '').trim().slice(0, 400) || null;
  if ('button_text' in body) out.button_text = String(body.button_text || '').trim().slice(0, 40) || null;
  if ('success_message' in body) out.success_message = String(body.success_message || '').trim().slice(0, 300) || null;
  if ('redirect_url' in body) out.redirect_url = (body.redirect_url && /^https?:\/\//i.test(body.redirect_url)) ? String(body.redirect_url).slice(0, 500) : null;
  if ('accent_color' in body) out.accent_color = /^#[0-9a-fA-F]{6}$/.test(body.accent_color || '') ? body.accent_color : null;
  if ('tags' in body) out.tags = Array.isArray(body.tags) ? body.tags.map(t => String(t).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30)).filter(t => t.length >= 2).slice(0, 10) : [];
  if ('fields' in body) {
    const f = sanitizeFields(body.fields);
    if (f) out.fields = f;
  }
  if ('active' in body) out.active = body.active !== false;
  // 'conector' = el script que se pega en una web ajena para recoger los envíos
  // de un formulario que ya existe. No tiene campos ni página propia.
  if ('tipo' in body) out.tipo = body.tipo === 'conector' ? 'conector' : 'formulario';
  if ('origen_url' in body) out.origen_url = (body.origen_url && /^https?:\/\//i.test(body.origen_url)) ? String(body.origen_url).slice(0, 300) : null;
  return out;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: miembros operan sobre los formularios del dueño
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sbHeaders() });
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) userId = _tw.owner_user_id;
  } catch {}


  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;
  const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';

  if (req.method === 'GET') {
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?user_id=eq.${encodeURIComponent(userId)}${scope}&select=*&order=created_at.desc&limit=50`, { headers: sbHeaders() }).then(r => r.json());
    return jsonResp({ forms: rows || [] });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const s = sanitize(body);
    if (!s.name) return jsonResp({ error: 'El formulario necesita un nombre' }, 400);
    // Un conector recoge lo que ya haya en el formulario ajeno: los campos los
    // decide esa web, no nosotros.
    if (s.tipo === 'conector') s.fields = [];
    else if (!s.fields) s.fields = [
      { key: 'name', label: 'Nombre', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'phone', label: 'Teléfono / WhatsApp', type: 'tel', required: false },
    ];
    const token = crypto.randomUUID().replace(/-/g, '');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_forms`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({ user_id: userId, client_id: clientId, token, active: true, submissions: 0, ...s }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ form: rows[0] }, 201);
  }

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.id) return jsonResp({ error: 'Falta id' }, 400);
    const s = sanitize(body);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(s),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    if (!rows.length) return jsonResp({ error: 'Formulario no encontrado' }, 404);
    return jsonResp({ form: rows[0] });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: sbHeaders() });
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
