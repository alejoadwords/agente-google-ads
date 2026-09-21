// api/social-publish.js — publica en Instagram y Facebook
//
// El token de la página NO llega en la petición: llega el id de la página y
// aquí se busca el token cifrado de esa cuenta. Antes lo mandaba el navegador,
// que es lo que convertía este endpoint en un proxy abierto a la API de
// Facebook —sin sesión, con cualquier token que le pasaran— y obligaba a tener
// el token guardado en `localStorage`.

import { cuentaDe, tokenDeCuenta } from './_social-cuentas.js';

async function usuarioDeLaSesion(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const [hB64, pB64, sB64] = auth.slice(7).split('.');
    if (!sB64) return null;
    const cabecera = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const llave = jwks.keys?.find(k => k.kid === cabecera.kid);
    if (!llave) return null;
    const ck = await crypto.subtle.importKey('jwk', llave, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const firma = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, firma, new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const cuerpo = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (cuerpo.exp && cuerpo.exp < Math.floor(Date.now() / 1000)) return null;
    return cuerpo.sub || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const quien = await usuarioDeLaSesion(req);
  if (!quien) return res.status(401).json({ error: 'No autorizado' });

  const {
    network,
    pageId: pageIdPedido,
    clientId,
    imageUrl,
    imageBase64,
    imageMediaType,
    videoUrl,
    caption        = '',
    isCarousel     = false,
    carouselImageUrls = [],
  } = req.body;

  if (!network) return res.status(400).json({ error: 'network requerido' });

  // El token sale de la base, nunca de la petición. Si la cuenta no es de
  // quien pide, aquí no aparece nada y se corta con un mensaje claro.
  const duena = await cuentaDe(quien);
  const cuenta = await tokenDeCuenta(duena, clientId || '', network, pageIdPedido || '');
  if (!cuenta || !cuenta.pageToken) {
    return res.status(400).json({ error: 'No hay una cuenta conectada para esa red. Vuelve a conectarla desde el Studio.' });
  }
  // La página y la cuenta de IG también salen de la base: si vinieran de la
  // petición podrían no corresponder al token y el fallo sería incomprensible.
  const pageToken = cuenta.pageToken;
  const pageId    = cuenta.pageId;
  const igUserId  = cuenta.igUserId;

  try {

    // ── INSTAGRAM ──────────────────────────────────────────────────────────────
    if (network === 'instagram') {
      if (!igUserId) return res.status(400).json({ error: 'igUserId requerido para Instagram' });

      // ── Carrusel ──
      if (isCarousel && carouselImageUrls.length > 1) {
        const childIds = [];

        for (const imgUrl of carouselImageUrls.slice(0, 10)) {
          const childRes  = await fetch(`${GRAPH}/${igUserId}/media`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url:        imgUrl,
              is_carousel_item: true,
              access_token:     pageToken,
            }),
          });
          const childData = await childRes.json();
          if (!childRes.ok || childData.error) {
            throw new Error('Error creando slide: ' + (childData.error?.message || imgUrl));
          }
          childIds.push(childData.id);
        }

        // Container principal carrusel
        const carRes  = await fetch(`${GRAPH}/${igUserId}/media`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media_type:   'CAROUSEL',
            children:     childIds.join(','),
            caption,
            access_token: pageToken,
          }),
        });
        const carData = await carRes.json();
        if (!carRes.ok || carData.error) {
          throw new Error('Error creando carrusel: ' + (carData.error?.message || JSON.stringify(carData).slice(0, 200)));
        }

        // Publicar
        const pubRes  = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: carData.id, access_token: pageToken }),
        });
        const pubData = await pubRes.json();
        if (!pubRes.ok || pubData.error) {
          throw new Error('Error publicando carrusel: ' + (pubData.error?.message || JSON.stringify(pubData).slice(0, 200)));
        }

        return res.json({ success: true, postId: pubData.id, network: 'instagram', type: 'carousel' });
      }

      // ── Post simple (imagen o reel) ──
      const mediaBody = { caption, access_token: pageToken };
      const isReel = !!videoUrl;

      if (isReel) {
        mediaBody.media_type = 'REELS';
        mediaBody.video_url  = videoUrl;
        mediaBody.share_to_feed = true;
      } else if (imageUrl) {
        mediaBody.image_url = imageUrl;
      } else {
        return res.status(400).json({ error: 'imageUrl o videoUrl requerido para Instagram' });
      }

      const mediaRes  = await fetch(`${GRAPH}/${igUserId}/media`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(mediaBody),
      });
      const mediaData = await mediaRes.json();
      if (!mediaRes.ok || mediaData.error) {
        throw new Error('Error creando media en IG: ' + (mediaData.error?.message || JSON.stringify(mediaData).slice(0, 200)));
      }

      // Si es video, esperar a que Meta procese el archivo
      if (isReel) {
        await waitForMediaReady(mediaData.id, pageToken);
      }

      const pubRes  = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ creation_id: mediaData.id, access_token: pageToken }),
      });
      const pubData = await pubRes.json();
      if (!pubRes.ok || pubData.error) {
        throw new Error('Error publicando en IG: ' + (pubData.error?.message || JSON.stringify(pubData).slice(0, 200)));
      }

      return res.json({ success: true, postId: pubData.id, network: 'instagram', type: isReel ? 'reel' : 'image' });
    }

    // ── FACEBOOK PAGE ──────────────────────────────────────────────────────────
    if (network === 'facebook') {
      if (!pageId) return res.status(400).json({ error: 'pageId requerido para Facebook' });

      if (imageBase64) {
        // Upload binario directo — más rápido que URL (no necesita CDN intermediario)
        const buffer   = Buffer.from(imageBase64, 'base64');
        const mimeType = imageMediaType || 'image/jpeg';
        const ext      = mimeType.includes('png') ? 'png' : 'jpg';
        const formData = new FormData();
        formData.append('source', new Blob([buffer], { type: mimeType }), 'photo.' + ext);
        formData.append('message',      caption);
        formData.append('access_token', pageToken);

        const photoRes  = await fetch(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: formData });
        const photoData = await photoRes.json();
        if (!photoRes.ok || photoData.error) {
          throw new Error('Error publicando foto en FB: ' + (photoData.error?.message || JSON.stringify(photoData).slice(0, 200)));
        }
        return res.json({ success: true, postId: photoData.post_id || photoData.id, network: 'facebook', type: 'photo' });
      }

      if (imageUrl) {
        // URL pública (cuando se publica en IG + FB simultáneamente)
        const photoRes  = await fetch(`${GRAPH}/${pageId}/photos`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: imageUrl, message: caption, access_token: pageToken }),
        });
        const photoData = await photoRes.json();
        if (!photoRes.ok || photoData.error) {
          throw new Error('Error publicando foto en FB: ' + (photoData.error?.message || JSON.stringify(photoData).slice(0, 200)));
        }
        return res.json({ success: true, postId: photoData.post_id || photoData.id, network: 'facebook', type: 'photo' });
      }

      // Video (Reel o video normal en página)
      if (videoUrl) {
        const videoRes  = await fetch(`${GRAPH}/${pageId}/videos`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_url: videoUrl, description: caption, access_token: pageToken }),
        });
        const videoData = await videoRes.json();
        if (!videoRes.ok || videoData.error) {
          throw new Error('Error publicando video en FB: ' + (videoData.error?.message || JSON.stringify(videoData).slice(0, 200)));
        }
        return res.json({ success: true, postId: videoData.id, network: 'facebook', type: 'video' });
      }

      // Post de texto solo
      const postRes  = await fetch(`${GRAPH}/${pageId}/feed`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: caption, access_token: pageToken }),
      });
      const postData = await postRes.json();
      if (!postRes.ok || postData.error) {
        throw new Error('Error publicando en FB: ' + (postData.error?.message || JSON.stringify(postData).slice(0, 200)));
      }
      return res.json({ success: true, postId: postData.id, network: 'facebook', type: 'text' });
    }

    return res.status(400).json({ error: 'Network no soportado: ' + network });

  } catch (err) {
    console.error('social-publish error:', err);
    return res.status(500).json({ error: err.message || 'Error publicando' });
  }
}
