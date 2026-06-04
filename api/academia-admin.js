// api/academia-admin.js
// CRUD de videos de Academia — tabla academia_videos en Supabase
// GET  /api/academia-admin          → lista todos (público)
// POST /api/academia-admin          → crea o actualiza (admin)
// DELETE /api/academia-admin?id=X   → elimina (admin)

export const config = { runtime: 'edge' };

const ADMIN_SECRET   = process.env.ADMIN_SECRET;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-admin-secret',
  'Content-Type': 'application/json',
};

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

function isAdmin(req) {
  return req.headers.get('x-admin-secret') === ADMIN_SECRET;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);

  // ── GET: público, no requiere auth ──────────────────────────────────────
  if (req.method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/academia_videos?select=*&order=category_order.asc,order_index.asc`,
      { headers: sbHeaders() }
    );
    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err }), { status: 500, headers: CORS });
    }
    const data = await res.json();
    return new Response(JSON.stringify(data), { status: 200, headers: CORS });
  }

  // ── Escritura: requiere admin ────────────────────────────────────────────
  if (!isAdmin(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  // ── POST: crear o actualizar ─────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }

    const { id, ...fields } = body;
    fields.updated_at = new Date().toISOString();

    if (id) {
      // Actualizar
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/academia_videos?id=eq.${id}`,
        { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(fields) }
      );
      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: err }), { status: 500, headers: CORS });
      }
      const data = await res.json();
      return new Response(JSON.stringify(data?.[0] || { id }), { status: 200, headers: CORS });
    } else {
      // Crear
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/academia_videos`,
        { method: 'POST', headers: sbHeaders(), body: JSON.stringify(fields) }
      );
      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: err }), { status: 500, headers: CORS });
      }
      const data = await res.json();
      return new Response(JSON.stringify(data?.[0] || {}), { status: 201, headers: CORS });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: CORS });

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/academia_videos?id=eq.${id}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err }), { status: 500, headers: CORS });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
}
