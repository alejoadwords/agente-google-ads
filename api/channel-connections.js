export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
function sb() {
  return { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' };
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
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
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
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// El token de Meta vive en platform_connections desde que el usuario conectó
// Meta Ads. Antes se leía del almacenamiento del navegador, que se pierde al
// cambiar de equipo o abrir en incógnito — y entonces la app decía "conecta
// Meta primero" con Meta ya conectado.
async function metaTokenDe(userId) {
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads&select=access_token&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    return rows?.[0]?.access_token || null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);


  const url = new URL(req.url);

  // GET — list pages from Meta user token (to show which pages to connect)
  if (req.method === 'GET' && url.searchParams.get('action') === 'list_pages') {
    const metaToken = url.searchParams.get('token') || await metaTokenDe(userId);
    if (!metaToken) return jsonResp({ error: 'Conecta tu cuenta de Meta en Configuración → Integraciones → Meta Ads' }, 409);
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,picture,instagram_business_account{id,name,profile_picture_url}&access_token=${metaToken}`
    );
    const data = await res.json();
    return jsonResp({ pages: data.data || [] });
  }

  // GET ?all=1 — todas las conexiones del usuario (hub Fuentes de leads)
  if (req.method === 'GET' && url.searchParams.get('all')) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${userId}&select=id,channel,channel_name,external_id,avatar_url,is_active,agent_id,created_at&order=created_at.desc&limit=50`,
      { headers: sb() }
    );
    return jsonResp({ connections: (await res.json()) || [] });
  }

  // GET — list connections for an agent
  if (req.method === 'GET') {
    const agentId = url.searchParams.get('agent_id');
    if (!agentId) return jsonResp({ error: 'Falta agent_id' }, 400);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?agent_id=eq.${agentId}&user_id=eq.${userId}&select=id,channel,external_id,channel_name,avatar_url,is_active,created_at`,
      { headers: sb() }
    );
    const rows = await res.json();
    return jsonResp({ connections: rows || [] });
  }

  // POST ?action=connect_page — conecta Messenger o Instagram resolviendo en el
  // servidor el token de la página. Así el navegador nunca ve un token de Meta.
  if (req.method === 'POST' && url.searchParams.get('action') === 'connect_page') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { agent_id, channel, page_id } = body || {};
    if (!page_id || !['messenger', 'instagram'].includes(channel)) {
      return jsonResp({ error: 'Faltan campos' }, 400);
    }
    // Sin agente el canal se atiende a mano desde el inbox.
    if (agent_id) {
      const agente = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${encodeURIComponent(agent_id)}&user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      if (!agente?.length) return jsonResp({ error: 'Agente no encontrado' }, 404);
    }

    const metaToken = await metaTokenDe(userId);
    if (!metaToken) return jsonResp({ error: 'Conecta tu cuenta de Meta en Configuración → Integraciones → Meta Ads' }, 409);

    const pagina = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(page_id)}?fields=name,access_token,instagram_business_account%7Bid,username%7D&access_token=${metaToken}`
    ).then(r => r.json()).catch(() => null);
    if (!pagina?.access_token) {
      return jsonResp({ error: pagina?.error?.message || 'No se pudo obtener el acceso a la página' }, 400);
    }

    // Instagram cuelga de la página, pero el id que escucha el webhook es el de
    // la cuenta de Instagram, no el de la página.
    const ig = pagina.instagram_business_account;
    if (channel === 'instagram' && !ig?.id) {
      return jsonResp({ error: 'Esa página no tiene una cuenta de Instagram Business conectada' }, 400);
    }
    const externalId = channel === 'instagram' ? String(ig.id) : String(page_id);
    const nombre = channel === 'instagram' ? ('@' + (ig.username || pagina.name)) : pagina.name;

    // Suscribir la página a la app. Si esto falla, la conexión se ve bien en la
    // UI pero Meta no entrega ni un mensaje — así que no se puede tragar el
    // error: mejor no crear la conexión y decir por qué.
    const sub = await fetch(
      `https://graph.facebook.com/v19.0/${page_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${pagina.access_token}`,
      { method: 'POST' }
    ).then(r => r.json()).catch(e => ({ error: { message: String(e && e.message || e) } }));
    if (!sub?.success) {
      const msg = sub?.error?.message || 'No se pudo suscribir la página';
      return jsonResp({
        error: /pages_manage_metadata|pages_messaging/i.test(msg)
          ? 'Falta un permiso de Meta. Ve a Configuración → Integraciones → Meta Ads, desconecta y vuelve a conectar para aceptar los permisos nuevos.'
          : msg,
        detail: msg,
      }, 400);
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections`, {
      method: 'POST',
      headers: { ...sb(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        agent_id, user_id: userId, channel,
        external_id: externalId,
        access_token: pagina.access_token,
        channel_name: nombre,
        is_active: true,
      }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ connection: rows[0] }, 201);
  }

  // POST — create/connect a channel
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { agent_id, channel, external_id, access_token, channel_name, avatar_url } = body;
    // agent_id es opcional: un canal sin agente se atiende a mano desde el
    // inbox. Con agente, el agente contesta y escala cuando toca.
    if (!channel || !external_id) return jsonResp({ error: 'Faltan campos' }, 400);

    // Con agente, tiene que ser suyo. Sin agente, el canal es de gestión manual.
    if (agent_id) {
      const agentCheck = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${agent_id}&user_id=eq.${userId}&select=id`,
        { headers: sb() }
      );
      const agentRows = await agentCheck.json();
      if (!agentRows?.[0]) return jsonResp({ error: 'Agente no encontrado' }, 404);
    }

    // For Messenger/Instagram: subscribe page to webhook
    if ((channel === 'messenger' || channel === 'instagram') && access_token) {
      try {
        await fetch(`https://graph.facebook.com/v19.0/${external_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${access_token}`, {
          method: 'POST',
        });
      } catch(e) { console.error('webhook subscribe error', e); }
    }

    const payload = {
      agent_id: agent_id || null, user_id: userId, channel,
      external_id: String(external_id),
      access_token: access_token || null,
      channel_name: channel_name || null,
      avatar_url: avatar_url || null,
      is_active: true,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections`, {
      method: 'POST',
      headers: { ...sb(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detalle = await res.text();
      // La tabla tiene un CHECK con la lista de canales permitidos; un canal
      // nuevo necesita esa migración antes de poder conectarse.
      if (detalle.includes('23514')) {
        return jsonResp({
          error: `El canal ${channel} todavía no está habilitado en la base de datos.`,
          detail: 'Falta ampliar la restricción channel_connections_channel_check.',
        }, 409);
      }
      return jsonResp({ error: detalle }, 500);
    }
    const rows = await res.json();
    return jsonResp({ connection: rows[0] }, 201);
  }

  // DELETE — disconnect a channel
  // PUT — cambiar quién atiende el canal (un agente o el equipo) o pausarlo
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id } = body || {};
    if (!id) return jsonResp({ error: 'Falta el id del canal' }, 400);

    const cambios = {};
    if (body.agent_id !== undefined) {
      // null = pasa a gestión manual
      if (body.agent_id) {
        const agente = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${encodeURIComponent(body.agent_id)}&user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
          { headers: sb() }
        ).then(r => (r.ok ? r.json() : [])).catch(() => []);
        if (!agente?.length) return jsonResp({ error: 'Agente no encontrado' }, 404);
      }
      cambios.agent_id = body.agent_id || null;
    }
    if (body.is_active !== undefined) cambios.is_active = !!body.is_active;
    if (!Object.keys(cambios).length) return jsonResp({ error: 'Nada que cambiar' }, 400);

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: 'PATCH', headers: sb(), body: JSON.stringify(cambios) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const filas = await res.json().catch(() => []);
    if (!filas?.length) return jsonResp({ error: 'Canal no encontrado' }, 404);
    return jsonResp({ connection: filas[0] });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: sb() }
    );
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
