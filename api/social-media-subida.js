// api/social-media-subida.js — deja un archivo en nuestro almacenamiento para publicarlo
//
//   POST { type, size }        → { subida, url }  URL firmada para que el
//                                navegador suba el archivo directo a Supabase
//   POST { copiarDe }          → { url }          copia aquí una imagen o video
//                                generado por un proveedor
//
// Instagram descarga el archivo desde una URL pública en el momento de crear el
// contenedor, así que el archivo tiene que estar en un sitio que dure. Antes:
//   · un video subido a mano quedaba como `blob:` del navegador —moría al
//     recargar— y para publicarlo se mandaba en base64 por el cuerpo, que en
//     Vercel corta en 4,5 MB: cualquier reel real fallaba;
//   · los videos generados se publicaban desde la URL del proveedor, que
//     caduca en horas.
// La subida firmada va directo del navegador a Supabase, sin pasar el archivo
// por la función, y el bucket `social-media` acepta hasta 50 MB.

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { cuentaDe } from './_social-cuentas.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'social-media';
const MAX = 50 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

// De dónde se puede copiar. Una lista cerrada: si aceptara cualquier URL, esta
// función serviría para que el servidor descargara lo que le pidan.
function origenPermitido(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return false;
    const h = x.hostname;
    return h === new URL(SUPABASE_URL).hostname ||
      /(^|\.)fal\.(media|run|ai)$/.test(h) ||
      /(^|\.)(bytepluses|volces|byteplus)\.com$/.test(h) ||
      /(^|\.)ideogram\.ai$/.test(h);
  } catch { return false; }
}

const ruta = (cuenta, ext) => `${cuenta}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
const publica = (path) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'social-media-subida'), 401);
  const cuenta = await cuentaDe(sesion.id);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Petición inválida' }, 400); }

  try {
    if (body.copiarDe) {
      if (!origenPermitido(body.copiarDe)) return json({ error: 'Ese archivo no viene de un origen que podamos copiar.' }, 400);
      const r = await fetch(body.copiarDe);
      if (!r.ok) return json({ error: 'El archivo original ya no está disponible (HTTP ' + r.status + '). Vuelve a generarlo o súbelo a mano.' }, 410);
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      const ext = EXT[type];
      if (!ext) return json({ error: 'Formato no soportado para publicar: ' + (type || 'desconocido') }, 415);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength > MAX) return json({ error: 'El archivo pesa más de 50 MB.' }, 413);
      const path = ruta(cuenta, ext);
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': type },
        body: bytes,
      });
      if (!up.ok) return json({ error: 'No se pudo guardar el archivo: ' + (await up.text()).slice(0, 160) }, 502);
      return json({ url: publica(path), type });
    }

    const type = String(body.type || '');
    const ext = EXT[type];
    if (!ext) return json({ error: 'Formato no soportado. Usa JPG, PNG, WebP, MP4 o MOV.' }, 415);
    if (Number(body.size) > MAX) return json({ error: 'El archivo pesa más de 50 MB, que es lo máximo para publicar.' }, 413);
    const path = ruta(cuenta, ext);
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) return json({ error: 'No se pudo preparar la subida: ' + (d.message || d.error || r.status) }, 502);
    return json({ subida: `${SUPABASE_URL}/storage/v1${d.url}`, url: publica(path) });
  } catch (e) {
    console.error('[social-media-subida]', e);
    return json({ error: 'No se pudo subir el archivo: ' + (e.message || 'error desconocido') }, 500);
  }
}
