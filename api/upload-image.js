// api/upload-image.js
// Sube una imagen (base64) al bucket público campaign-images de Supabase
// Storage y devuelve la URL pública. La usa la cabecera del wizard de
// campañas; el bucket limita a 2MB y mime de imagen.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  const userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'upload-image'), 401);

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
