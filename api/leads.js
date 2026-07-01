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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

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

  // POST — create lead
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { name, email, phone, company, stage, notes, source, tags, custom_fields } = body;
    if (!name) return jsonResp({ error: 'El nombre es requerido' }, 400);

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
    const PLAN_LIMITS = { free: 10, pro: 1000, agency: 5000 };
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
      tags: tags || [],
      custom_fields: custom_fields || {},
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ lead: rows[0] }, 201);
  }

  // PUT — update lead (including stage move)
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id, ...fields } = body;
    if (!id) return jsonResp({ error: 'Falta id' }, 400);

    // Only allow safe fields
    const allowed = ['name','email','phone','company','stage','stage_position','notes','source','tags','custom_fields','value'];
    const update = {};
    for (const k of allowed) {
      if (fields[k] !== undefined) update[k] = fields[k];
    }
    update.updated_at = new Date().toISOString();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
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
