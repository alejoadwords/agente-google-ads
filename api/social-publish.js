// api/social-publish.js — publica en Instagram y Facebook
//
// El token de la página NO llega en la petición: llega el id de la página y
// aquí se busca el token cifrado de esa cuenta. Antes lo mandaba el navegador,
// que es lo que convertía este endpoint en un proxy abierto a la API de
// Facebook —sin sesión, con cualquier token que le pasaran— y obligaba a tener
// el token guardado en `localStorage`.
//
// Va por pasos porque Instagram procesa el archivo antes de dejar publicarlo, y
// un reel puede tardar minutos: esperar aquí dentro chocaba con el límite de
// tiempo de la función y el navegador recibía un error a mitad de publicación,
// sin saber si había salido o no.
//
//   paso 'preparar'   Instagram: crea el contenedor y devuelve su id.
//                     Facebook: publica directamente y devuelve el post.
//   paso 'estado'     Instagram: en qué va el procesado del contenedor.
//   paso 'confirmar'  Instagram: publica el contenedor ya procesado.
//
// Formatos: imagen, carrusel (2-10 imágenes), reel (video), historia (solo
// Instagram; en Facebook se publica como post normal) y texto (solo Facebook).

import { cuentaDe, tokenDeCuenta, GRAPH, errorDeMeta } from './_social-cuentas.js';
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, alcanceDeCliente, clienteAjeno, exigeModulo } from './_perfiles.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Límites de Instagram: los comprobamos antes de llamar para que el error
// diga qué cambiar, en vez de un código de Meta.
const IG_MAX_CAPTION = 2200;
const IG_MAX_HASHTAGS = 30;

// Solo se publican archivos de nuestro almacenamiento: el navegador copia ahí
// todo antes de publicar (api/social-media-subida.js). Sin este filtro el
// endpoint publicaría cualquier URL de internet en la página del cliente, y
// las de los proveedores de video caducan en horas.
function urlPermitida(u) {
  try {
    const supa = new URL(process.env.SUPABASE_URL);
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === supa.hostname &&
      x.pathname.startsWith('/storage/v1/object/public/social-media/');
  } catch { return false; }
}

async function graph(path, cuerpo, token) {
  const r = await fetch(`${GRAPH}/${path}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify({ ...cuerpo, access_token: token }) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) { const e = new Error('graph'); e.meta = d; throw e; }
  return d;
}
const leer = (path, token) => graph(`${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, null, token);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'social-publish'), 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Petición inválida' }, 400); }
  const { paso = 'preparar', network, pageId: pageIdPedido, clientId, creationId } = body;
  if (network !== 'instagram' && network !== 'facebook') return json({ error: 'Red no soportada' }, 400);

  // Un miembro acotado a un cliente no puede publicar en las cuentas de otro
  // cambiando el clientId del cuerpo. Mismo criterio que social-connections.
  let quien;
  try { quien = await quienPregunta(sesion.id); }
  catch (e) {
    if (e?.suspendida) return json({ error: e.message, suspendida: true }, 403);
    return json({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }
  const corte = exigeModulo(quien, 'marketing');
  if (corte) return corte;
  if (clienteAjeno(quien, clientId || null)) return json({ error: 'No tienes acceso a ese cliente.' }, 403);
  const cliente = alcanceDeCliente(quien, clientId || null) || '';

  // El token sale de la base, nunca de la petición.
  const duena = await cuentaDe(sesion.id);
  const cuenta = await tokenDeCuenta(duena, cliente, network, pageIdPedido || '');
  if (!cuenta || !cuenta.pageToken) {
    return json({ error: 'No hay una cuenta de ' + (network === 'instagram' ? 'Instagram' : 'Facebook') + ' conectada. Conéctala desde «Conectar redes».', reconectar: true }, 400);
  }
  const { pageToken, pageId, igUserId } = cuenta;

  try {
    if (network === 'instagram') {
      if (!igUserId) return json({ error: 'Esta página no tiene una cuenta de Instagram profesional vinculada.', reconectar: true }, 400);

      if (paso === 'estado') {
        if (!creationId) return json({ error: 'Falta el contenedor' }, 400);
        const d = await leer(`${creationId}?fields=status_code,status`, pageToken);
        return json({ estado: d.status_code || 'IN_PROGRESS', detalle: d.status || null });
      }

      if (paso === 'confirmar') {
        if (!creationId) return json({ error: 'Falta el contenedor' }, 400);
        const pub = await graph(`${igUserId}/media_publish`, { creation_id: creationId }, pageToken);
        let permalink = null;
        try { permalink = (await leer(`${pub.id}?fields=permalink`, pageToken)).permalink || null; } catch {}
        return json({ publicado: true, postId: pub.id, permalink });
      }

      // ── preparar ──
      const formato = String(body.formato || 'imagen');
      const caption = String(body.caption || '');
      if (caption.length > IG_MAX_CAPTION) return json({ error: `El texto tiene ${caption.length} caracteres e Instagram acepta hasta ${IG_MAX_CAPTION}. Acórtalo y reintenta.` }, 400);
      const hashtags = (caption.match(/#[\p{L}\p{N}_]+/gu) || []).length;
      if (hashtags > IG_MAX_HASHTAGS) return json({ error: `El texto lleva ${hashtags} hashtags e Instagram acepta hasta ${IG_MAX_HASHTAGS}. Quita algunos y reintenta.` }, 400);

      const imagenes = (Array.isArray(body.imageUrls) ? body.imageUrls : []).filter(Boolean);
      const video = body.videoUrl || null;
      for (const u of [...imagenes, video].filter(Boolean)) {
        if (!urlPermitida(u)) return json({ error: 'El archivo no está en el almacenamiento de Acuarius. Vuelve a subirlo desde el post.' }, 400);
      }

      let contenedor;
      if (formato === 'carrusel') {
        if (imagenes.length < 2) return json({ error: 'Un carrusel de Instagram necesita al menos 2 imágenes.' }, 400);
        const hijos = [];
        for (const u of imagenes.slice(0, 10)) {
          hijos.push((await graph(`${igUserId}/media`, { image_url: u, is_carousel_item: true }, pageToken)).id);
        }
        contenedor = await graph(`${igUserId}/media`, { media_type: 'CAROUSEL', children: hijos.join(','), caption }, pageToken);
      } else if (formato === 'historia') {
        if (!video && !imagenes[0]) return json({ error: 'Una historia necesita una imagen o un video.' }, 400);
        contenedor = await graph(`${igUserId}/media`, video
          ? { media_type: 'STORIES', video_url: video }
          : { media_type: 'STORIES', image_url: imagenes[0] }, pageToken);
      } else if (video) {
        contenedor = await graph(`${igUserId}/media`, { media_type: 'REELS', video_url: video, caption, share_to_feed: true }, pageToken);
      } else if (imagenes[0]) {
        contenedor = await graph(`${igUserId}/media`, { image_url: imagenes[0], caption }, pageToken);
      } else {
        return json({ error: 'Instagram no publica solo texto: este post necesita una imagen o un video.' }, 400);
      }
      return json({ creationId: contenedor.id, publicado: false });
    }

    // ── FACEBOOK ── (un solo paso: la página publica al momento)
    if (paso !== 'preparar') return json({ error: 'Paso no soportado en Facebook' }, 400);
    const caption = String(body.caption || '');
    const imagenes = (Array.isArray(body.imageUrls) ? body.imageUrls : []).filter(Boolean);
    const video = body.videoUrl || null;
    for (const u of [...imagenes, video].filter(Boolean)) {
      if (!urlPermitida(u)) return json({ error: 'El archivo no está en el almacenamiento de Acuarius. Vuelve a subirlo desde el post.' }, 400);
    }

    let postId, permalink = null;
    if (video) {
      const v = await graph(`${pageId}/videos`, { file_url: video, description: caption }, pageToken);
      postId = v.id;
      permalink = `https://www.facebook.com/${pageId}/videos/${v.id}`;
    } else if (imagenes.length > 1) {
      // Varias fotos en un solo post: se suben sin publicar y se adjuntan.
      const ids = [];
      for (const u of imagenes.slice(0, 10)) {
        ids.push((await graph(`${pageId}/photos`, { url: u, published: false }, pageToken)).id);
      }
      const p = await graph(`${pageId}/feed`, { message: caption, attached_media: ids.map(id => ({ media_fbid: id })) }, pageToken);
      postId = p.id;
    } else if (imagenes[0]) {
      const p = await graph(`${pageId}/photos`, { url: imagenes[0], message: caption }, pageToken);
      postId = p.post_id || p.id;
    } else {
      if (!caption.trim()) return json({ error: 'El post no tiene ni texto ni imagen.' }, 400);
      postId = (await graph(`${pageId}/feed`, { message: caption }, pageToken)).id;
    }
    if (!permalink) {
      try { permalink = (await leer(`${postId}?fields=permalink_url`, pageToken)).permalink_url || null; } catch {}
    }
    return json({ publicado: true, postId, permalink });

  } catch (err) {
    if (err.meta) {
      console.error('[social-publish] Meta:', network, paso, JSON.stringify(err.meta).slice(0, 400));
      return json(errorDeMeta(err.meta, network === 'instagram' ? 'Instagram' : 'Facebook'), 502);
    }
    console.error('[social-publish]', err);
    return json({ error: 'No se pudo publicar: ' + (err.message || 'error desconocido') }, 500);
  }
}
