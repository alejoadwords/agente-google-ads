// api/novedades.js — qué novedades ha visto ya cada usuario.
//
//   GET  → { visto: '<id de la última novedad marcada>' | null }
//   PUT  → { visto }  guarda el marcador
//
// El contenido de las novedades NO vive aquí: está en public/novedades.json,
// versionado con el código, para que publicar una novedad sea parte del mismo
// commit que la trae. Aquí solo se guarda el marcador por usuario.
//
// Se usa user_profiles con un agent_key reservado porque no podemos crear
// tablas nuevas con la clave de servicio.

export const config = { runtime: 'edge' };

const CLAVE = '__novedades_vistas__';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  try {
    const [hB64, pB64, sB64] = auth.replace('Bearer ', '').split('.');
    if (!sB64) return null;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, new TextEncoder().encode(`${hB64}.${pB64}`)))) return null;
    const p = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p.sub || null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return json({ error: 'No autorizado' }, 401);
  const uid = encodeURIComponent(userId);

  if (req.method === 'GET') {
    try {
      const rows = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${uid}&agent_key=eq.${CLAVE}&select=profile_data&limit=1`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : []));
      return json({ visto: rows?.[0]?.profile_data?.visto || null });
    } catch { return json({ visto: null }); }
  }

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Body inválido' }, 400); }
    const visto = String(body?.visto || '').slice(0, 120);
    if (!visto) return json({ error: 'Falta visto' }, 400);

    // on_conflict obligatorio: sin él PostgREST infiere ON CONFLICT (id) y el
    // segundo guardado revienta contra el índice único (user_id, agent_key).
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
      method: 'POST',
      headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: userId, agent_key: CLAVE,
        profile_data: { visto, fecha: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      // 23503 = la fila de `users` aún no existe. Pasa en la PRIMERA carga de
      // un usuario recién registrado: llega aquí antes de que se cree su fila.
      // No es un fallo del servidor y en la siguiente carga funciona solo, así
      // que no se devuelve 500 — solo se pierde esta marca de «visto», que es
      // inofensivo. Queda en el log por si algún día deja de ser transitorio.
      if (txt.includes('23503')) {
        console.error('[novedades] usuario aún sin fila en users, marca de visto pospuesta:', userId);
        return json({ visto, pospuesto: true });
      }
      return json({ error: txt.slice(0, 200) }, 500);
    }
    return json({ visto });
  }

  return json({ error: 'Método no permitido' }, 405);
}
