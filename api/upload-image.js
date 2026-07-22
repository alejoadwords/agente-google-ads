// api/upload-image.js
// Sube una imagen (base64) al bucket público campaign-images de Supabase
// Storage y devuelve la URL pública. La usa la cabecera del wizard de
// campañas; el bucket limita a 2MB y mime de imagen.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
  const ext = EXT[body.type];
  if (!ext) return jsonResp({ error: 'Formato no soportado (usa PNG, JPG, WebP o GIF)' }, 400);
  const b64 = String(body.data || '').replace(/^data:[^,]+,/, '');
  if (!b64 || b64.length > 2800000) return jsonResp({ error: 'La imagen supera el límite de 2MB' }, 400);

  let bytes;
  try { bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
  catch { return jsonResp({ error: 'Imagen inválida' }, 400); }

  const path = `${userId}/${Date.now()}.${ext}`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/campaign-images/${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY, 'Content-Type': body.type },
    body: bytes,
  });
  if (!up.ok) return jsonResp({ error: 'No se pudo subir: ' + (await up.text()).slice(0, 120) }, 500);
  return jsonResp({ url: `${SUPABASE_URL}/storage/v1/object/public/campaign-images/${path}` });
}
