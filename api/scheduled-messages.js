// api/scheduled-messages.js
// Programar, listar y cancelar mensajes de una conversación.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX_POR_CONV = 20;

function sb() {
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
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, data)) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    return await manejar(req);
  } catch (e) {
    return jsonResp({ error: 'Error con los mensajes programados: ' + (e?.message || 'desconocido') }, 500);
  }
}

async function manejar(req) {
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  const actorId = userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) userId = tw.owner_user_id;
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const url = new URL(req.url);
  const base = `${SUPABASE_URL}/rest/v1/scheduled_messages`;
  const mios = `user_id=eq.${encodeURIComponent(userId)}`;

  if (req.method === 'GET') {
    const convId = url.searchParams.get('conversation_id');
    if (!convId) return jsonResp({ error: 'Falta la conversación' }, 400);
    // Se devuelven también los fallidos: un mensaje que no salió tiene que
    // verse en la conversación, no desaparecer sin más.
    const res = await fetch(
      `${base}?${mios}&conversation_id=eq.${encodeURIComponent(convId)}` +
      `&estado=in.(pendiente,enviando,fallido)&select=*&order=enviar_at.asc`,
      { headers: sb() }
    );
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    return jsonResp({ programados: await res.json() });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const convId = body.conversation_id;
    const texto = String(body.texto || '').trim().slice(0, 4000);
    const adjunto = body.adjunto && body.adjunto.url ? body.adjunto : null;
    if (!convId) return jsonResp({ error: 'Falta la conversación' }, 400);
    if (!texto && !adjunto) return jsonResp({ error: 'Escribe el mensaje o adjunta un archivo' }, 400);

    const cuando = new Date(body.enviar_at || '');
    if (isNaN(cuando.getTime())) return jsonResp({ error: 'La fecha no es válida' }, 400);
    // Un minuto de margen: el reloj del navegador y el del servidor no son el
    // mismo, y programar «ahora» no debería fallar por dos segundos.
    if (cuando.getTime() < Date.now() - 60000) {
      return jsonResp({ error: 'Esa fecha ya pasó. Elige una futura.' }, 400);
    }
    if (cuando.getTime() > Date.now() + 365 * 24 * 3600 * 1000) {
      return jsonResp({ error: 'No se puede programar a más de un año.' }, 400);
    }

    const ck = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${encodeURIComponent(convId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (!ck?.[0]) return jsonResp({ error: 'No autorizado' }, 403);

    const cuantos = await fetch(
      `${base}?${mios}&conversation_id=eq.${encodeURIComponent(convId)}&estado=eq.pendiente&select=id`,
      { headers: { ...sb(), 'Prefer': 'count=exact', 'Range': '0-0' } }
    ).then(r => parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10)).catch(() => 0);
    if (cuantos >= MAX_POR_CONV) {
      return jsonResp({ error: `Ya hay ${MAX_POR_CONV} mensajes programados en esta conversación.` }, 403);
    }

    const res = await fetch(base, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({
        user_id: userId, author_user_id: actorId, conversation_id: convId,
        texto: texto || null, enviar_at: cuando.toISOString(),
        ...(adjunto ? {
          adjunto_url: adjunto.url, adjunto_tipo: adjunto.tipo || 'document',
          adjunto_nombre: String(adjunto.nombre || '').slice(0, 200), adjunto_mime: adjunto.mime || null,
        } : {}),
      }),
    });
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    return jsonResp({ programado: (await res.json())?.[0] || null }, 201);
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta el id' }, 400);
    // Solo se cancela lo que aún no salió. Un 'enviando' está en manos del
    // cron: cancelarlo ahí dejaría el estado mintiendo.
    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&${mios}&estado=in.(pendiente,fallido)`, {
      method: 'DELETE', headers: sb(),
    });
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    const filas = await res.json().catch(() => []);
    if (!filas.length) return jsonResp({ error: 'Ese mensaje ya salió o se está enviando ahora mismo.' }, 409);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
