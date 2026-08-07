export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
// agent_key reservado para guardar la cartera de clientes en user_profiles
const AGENCY_CLIENTS_KEY = '__agency_clients__';
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

  let userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Modo soporte. Sin esto el panel mostraba la cartera del ADMINISTRADOR
  // mientras el banner decía que estabas en la cuenta del cliente, que es
  // exactamente la confusión que el banner existe para evitar.
  try {
    const { resolverSoporte } = await import('./_soporte.js');
    const r = await resolverSoporte(req, userId, { escribe: req.method !== 'GET' });
    const err = (m, c) => new Response(JSON.stringify({ error: m }), { status: c, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (r.bloqueado) return err(r.bloqueado, 403);
    if (r.invalido) return err('La sesión de soporte caducó o no es válida. Vuelve a entrar a la cuenta.', 401);
    if (r.soporte) userId = r.userId;
  } catch {}

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
  // Se guardan en user_profiles con un agent_key reservado. Antes esto
  // apuntaba a una tabla dedicada agency_clients que nunca existió en
  // Supabase, así que todo guardado fallaba en silencio y la cartera vivía
  // sólo en localStorage. Reutilizamos user_profiles porque ya está creada
  // y tiene el upsert por (user_id, agent_key).
  if (type === 'agency_clients') {
    if (req.method === 'GET') {
      const res = await fetch(
        // (user_id, agent_key) tiene índice único verificado, así que nunca hay
        // más de una fila; el order queda como red de seguridad barata.
        `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${userId}&agent_key=eq.${AGENCY_CLIENTS_KEY}&select=profile_data&order=updated_at.desc&limit=1`,
        { headers: sbHeaders() }
      );
      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: err }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      const rows = await res.json();
      const stored = rows?.[0]?.profile_data;
      const data = Array.isArray(stored?.clients) ? stored.clients
                 : Array.isArray(stored)          ? stored
                 : [];
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
      if (!Array.isArray(body?.data)) {
        return new Response(JSON.stringify({ error: 'data debe ser un array' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      const payload = {
        user_id: userId,
        agent_key: AGENCY_CLIENTS_KEY,
        profile_data: { clients: body.data },
        updated_at: new Date().toISOString(),
      };
      // on_conflict es obligatorio: sin él PostgREST infiere ON CONFLICT (id)
      // — la PK — y como nunca choca, hace un INSERT plano que revienta contra
      // el índice único (user_id, agent_key) con 409 en el segundo guardado.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
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
    // Mismo caso que arriba: user_profiles y chat_history tienen índice único
    // en (user_id, agent_key), que no es la PK. Sin on_conflict, todo guardado
    // posterior al primero fallaba con 409 y el servidor quedaba desactualizado.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=user_id,agent_key`, {
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
