// api/quick-replies.js
// Respuestas rápidas del inbox: lo que un comercial escribe cien veces al día.
// Por cuenta y, si se quiere, por cliente — la respuesta de una inmobiliaria no
// le sirve a una clínica.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX = 60;

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
    return jsonResp({ error: 'Error con las respuestas rápidas: ' + (e?.message || 'desconocido') }, 500);
  }
}

async function manejar(req) {
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) userId = tw.owner_user_id;
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;
  const base = `${SUPABASE_URL}/rest/v1/quick_replies`;
  const mias = `user_id=eq.${encodeURIComponent(userId)}`;

  // ── Listar: las del cliente activo y las de toda la cuenta ────────────────
  if (req.method === 'GET') {
    const filtro = clientId
      ? `&or=(client_id.eq.${encodeURIComponent(clientId)},client_id.is.null)`
      : '&client_id=is.null';
    const res = await fetch(`${base}?${mias}${filtro}&select=*&order=usos.desc,titulo.asc`, { headers: sb() });
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    return jsonResp({ respuestas: await res.json() });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const titulo = String(body.titulo || '').trim().slice(0, 60);
    const texto = String(body.texto || '').trim().slice(0, 2000);
    if (!titulo || !texto) return jsonResp({ error: 'Hace falta un título y un texto' }, 400);

    const cuantas = await fetch(`${base}?${mias}&select=id`, { headers: { ...sb(), 'Prefer': 'count=exact', 'Range': '0-0' } })
      .then(r => parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10)).catch(() => 0);
    if (cuantas >= MAX) return jsonResp({ error: `Llegaste al máximo de ${MAX} respuestas rápidas.` }, 403);

    const res = await fetch(base, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({ user_id: userId, client_id: body.client_id || null, titulo, texto }),
    });
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    return jsonResp({ respuesta: (await res.json())?.[0] || null }, 201);
  }

  // ── PUT: editar, o sumar un uso para que las más usadas suban ─────────────
  if (req.method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    if (!body.id) return jsonResp({ error: 'Falta el id' }, 400);

    if (body.usar) {
      const fila = await fetch(`${base}?id=eq.${encodeURIComponent(body.id)}&${mias}&select=usos`, { headers: sb() })
        .then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
      if (!fila) return jsonResp({ error: 'No encontrada' }, 404);
      await fetch(`${base}?id=eq.${encodeURIComponent(body.id)}&${mias}`, {
        method: 'PATCH', headers: sb(), body: JSON.stringify({ usos: (fila.usos || 0) + 1 }),
      });
      return jsonResp({ ok: true });
    }

    const cambios = {};
    if (body.titulo !== undefined) cambios.titulo = String(body.titulo).trim().slice(0, 60);
    if (body.texto !== undefined) cambios.texto = String(body.texto).trim().slice(0, 2000);
    if (!cambios.titulo && !cambios.texto) return jsonResp({ error: 'Nada que cambiar' }, 400);
    const res = await fetch(`${base}?id=eq.${encodeURIComponent(body.id)}&${mias}`, {
      method: 'PATCH', headers: sb(), body: JSON.stringify(cambios),
    });
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    const filas = await res.json().catch(() => []);
    if (!filas.length) return jsonResp({ error: 'No encontrada' }, 404);
    return jsonResp({ respuesta: filas[0] });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta el id' }, 400);
    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&${mias}`, { method: 'DELETE', headers: sb() });
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    const filas = await res.json().catch(() => []);
    if (!filas.length) return jsonResp({ error: 'No encontrada' }, 404);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
