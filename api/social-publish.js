// api/social-publish.js
// Publica posts en Instagram y Facebook Pages via Meta Graph API
//
// Body:
// {
//   network: 'instagram' | 'facebook',
//   pageToken: string,           — token de la página (page-scoped, permanente)
//   pageId: string,              — ID de la página de Facebook
//   igUserId: string,            — ID cuenta Instagram Business (solo para IG)
//   imageUrl: string,            — URL pública de la imagen (requerida para IG, opcional para FB)
//   videoUrl: string,            — URL pública del video (para reels)
//   caption: string,             — Caption / descripción del post
//   isCarousel: boolean,         — Si es carrusel con múltiples imágenes
//   carouselImageUrls: string[], — URLs de cada slide del carrusel
// }

const GRAPH = 'https://graph.facebook.com/v19.0';

// Espera hasta que el media container de IG esté listo (para videos)
async function waitForMediaReady(creationId, pageToken, maxAttempts = 12, delayMs = 5000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, delayMs));
    const statusRes  = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${pageToken}`);
    const statusData = await statusRes.json();
    if (statusData.status_code === 'FINISHED') return true;
    if (statusData.status_code === 'ERROR')    throw new Error('Error procesando media en Instagram');
  }
  throw new Error('Tiempo de espera agotado procesando media en Instagram');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    network,
    pageToken,
    pageId,
    igUserId,
    imageUrl,
    imageBase64,
    imageMediaType,
    videoUrl,
    caption        = '',
    isCarousel     = false,
    carouselImageUrls = [],
  } = req.body;

  if (!network)    return res.status(400).json({ error: 'network requerido' });
  if (!pageToken)  return res.status(400).json({ error: 'pageToken requerido' });

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
