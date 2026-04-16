export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub || null;
  } catch {
    return null;
  }
}

// ── CONVERSATIONS helpers ────────────────────────────────────────────────────

async function convSave(userId, body) {
  const { agent, messages, conversationId } = body;
  if (!agent || !Array.isArray(messages) || messages.length === 0)
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const firstUser = messages.find(m => m.role === 'user');
  const rawTitle = typeof firstUser?.content === 'string'
    ? firstUser.content
    : (firstUser?.content?.find?.(c => c.type === 'text')?.text || 'Conversación');
  const title = rawTitle.slice(0, 80);
  const message_count = messages.filter(m => m.role === 'user').length;

  if (conversationId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/conversations?id=eq.${conversationId}&user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify({ messages, title, message_count, updated_at: new Date().toISOString() }),
      }
    );
    const rows = await res.json();
    return new Response(JSON.stringify({ id: rows?.[0]?.id || conversationId }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } else {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
      body: JSON.stringify({ user_id: userId, agent, title, messages, message_count }),
    });
    const rows = await res.json();
    return new Response(JSON.stringify({ id: rows?.[0]?.id }), { status: 201, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}

async function convList(userId, url) {
  const agent = url.searchParams.get('agent');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '15'), 50);
  let query = `${SUPABASE_URL}/rest/v1/conversations?user_id=eq.${userId}&select=id,agent,title,message_count,created_at,updated_at&order=updated_at.desc&limit=${limit}`;
  if (agent) query += `&agent=eq.${agent}`;
  const res = await fetch(query, { headers: sbHeaders() });
  const rows = await res.json();
  return new Response(JSON.stringify({ conversations: rows || [] }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function convGet(userId, url) {
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/conversations?id=eq.${id}&user_id=eq.${userId}&select=*`,
    { headers: sbHeaders() }
  );
  const rows = await res.json();
  if (!rows?.[0]) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ conversation: rows[0] }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function convDelete(userId, url) {
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  await fetch(
    `${SUPABASE_URL}/rest/v1/conversations?id=eq.${id}&user_id=eq.${userId}`,
    { method: 'DELETE', headers: sbHeaders() }
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type');

  // ── CONVERSATIONS ─────────────────────────────────────────────────────────
  if (type === 'conversations') {
    const action = url.searchParams.get('action');
    if (req.method === 'POST'   && action === 'save')   return convSave(userId, await req.json());
    if (req.method === 'GET'    && action === 'list')   return convList(userId, url);
    if (req.method === 'GET'    && action === 'get')    return convGet(userId, url);
    if (req.method === 'DELETE' && action === 'delete') return convDelete(userId, url);
    return new Response(JSON.stringify({ error: 'Acción no válida' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // ── AGENCY CLIENTS ───────────────────────────────────────────────────────
  if (type === 'agency_clients') {
    if (req.method === 'GET') {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/agency_clients?user_id=eq.${userId}&select=clients_data&limit=1`,
        { headers: sbHeaders() }
      );
      const rows = await res.json();
      const data = rows?.[0]?.clients_data ?? [];
      return new Response(JSON.stringify({ data }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch {
        return new Response(JSON.stringify({ error: 'Body inválido' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      const payload = {
        user_id: userId,
        clients_data: body.data,
        updated_at: new Date().toISOString(),
      };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/agency_clients`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: err }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // ── PROFILE / HISTORY ─────────────────────────────────────────────────────
  const agentKey = url.searchParams.get('agent');
  if (!type || !agentKey) {
    return new Response(JSON.stringify({ error: 'Faltan parámetros type y agent' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const table     = type === 'profile' ? 'user_profiles' : 'chat_history';
  const dataField = type === 'profile' ? 'profile_data'  : 'messages';

  if (req.method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${userId}&agent_key=eq.${agentKey}&select=${dataField}`,
      { headers: sbHeaders() }
    );
    const rows = await res.json();
    const data = rows?.[0]?.[dataField] ?? (type === 'profile' ? {} : []);
    return new Response(JSON.stringify({ data }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Body inválido' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
    const payload = {
      user_id: userId,
      agent_key: agentKey,
      [dataField]: body.data,
      updated_at: new Date().toISOString(),
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS });
}
