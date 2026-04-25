export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// Verificar sesión Clerk
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    // Decodificar JWT sin verificar (la verificación real la hace Clerk en api/chat.js)
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub || null;
  } catch {
    return null;
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type'); // 'profile' | 'history'
  const agentKey = url.searchParams.get('agent');

  if (!type || !agentKey) {
    return new Response(JSON.stringify({ error: 'Faltan parámetros type y agent' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const table = type === 'profile' ? 'user_profiles' : 'chat_history';
  const dataField = type === 'profile' ? 'profile_data' : 'messages';

  // GET — leer datos
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

  // POST — guardar datos (upsert)
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
