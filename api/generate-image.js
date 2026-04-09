// api/generate-image.js
// Genera imágenes de anuncios usando fal.ai
// Modelos: Ideogram V3 (anuncios con texto) | Flux 2 Pro (lifestyle/producto sin texto)
// Body: { prompt, format, variations, hasText }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    prompt,
    format        = 'square',
    variations    = 1,
    hasText       = false,
    // Modo remix: genera variaciones a partir de imagen de referencia
    mode          = 'generate',   // 'generate' | 'remix'
    referenceImage,               // base64 data URI de la imagen de referencia
    imageWeight   = 0.5,          // 0.1=libre … 0.9=muy fiel al original
    remixCount    = 5,            // cuántas variaciones generar (5–10)
  } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

  const falKey = process.env.FAL_API_KEY;
  if (!falKey) return res.status(500).json({ error: 'FAL_API_KEY no configurado' });

  const formatSpecs = {
    square:   { w: 1080, h: 1080, ratio: '1:1',  label: 'Feed cuadrado · 1080×1080',   fluxRatio: '1:1'  },
    vertical: { w: 1080, h: 1350, ratio: '4:5',  label: 'Feed vertical · 1080×1350',   fluxRatio: '4:5'  },
    story:    { w: 1080, h: 1920, ratio: '9:16', label: 'Stories / Reels · 1080×1920', fluxRatio: '9:16' },
    carousel: { w: 1080, h: 1080, ratio: '1:1',  label: 'Carrusel · 1080×1080',        fluxRatio: '1:1'  },
  };

  const spec  = formatSpecs[format] || formatSpecs.square;
  const count = Math.min(Math.max(1, variations), 5);
  const useIdeogram = hasText;

  // ── MODO REMIX ────────────────────────────────────────────────────────────
  if (mode === 'remix') {
    if (!referenceImage) return res.status(400).json({ error: 'referenceImage requerido para modo remix' });

    const totalVariations = Math.min(Math.max(5, remixCount), 10);
    const results = [];

    // Ideogram V3 Remix – hasta 4 imágenes por llamada; hacemos lotes paralelos
    const batchSize = 4;
    const batches = Math.ceil(totalVariations / batchSize);
    const batchPromises = [];

    for (let b = 0; b < batches; b++) {
      const numInBatch = Math.min(batchSize, totalVariations - b * batchSize);
      batchPromises.push(
        fetch('https://fal.run/fal-ai/ideogram/v3/remix', {
          method: 'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url:        referenceImage,
            prompt:           prompt,
            image_weight:     imageWeight,
            num_images:       numInBatch,
            aspect_ratio:     spec.ratio,
            rendering_speed:  'BALANCED',
            expand_prompt:    false,
          }),
        })
      );
    }

    const batchResponses = await Promise.all(batchPromises);

    for (const remixRes of batchResponses) {
      const remixData = await remixRes.json();
      if (!remixRes.ok) {
        const errMsg = remixData.detail?.[0]?.msg || remixData.error || 'Error en Ideogram Remix';
        return res.status(500).json({ error: errMsg });
      }

      const images = remixData.images || [];
      for (const imgObj of images) {
        const imgUrl = imgObj.url;
        if (!imgUrl) continue;
        const imgRes    = await fetch(imgUrl);
        const imgBuffer = await imgRes.arrayBuffer();
        const base64    = Buffer.from(imgBuffer).toString('base64');
        const mediaType = imgRes.headers.get('content-type') || 'image/jpeg';
        results.push({
          index:     results.length + 1,
          format:    spec.label,
          size:      `${spec.w}x${spec.h}`,
          base64,
          mediaType,
          model:     'Ideogram V3 Remix',
          url:       imgUrl,
        });
        if (results.length >= totalVariations) break;
      }
      if (results.length >= totalVariations) break;
    }

    return res.status(200).json({ images: results, format: spec, mode: 'remix' });
  }
  // ── FIN MODO REMIX ────────────────────────────────────────────────────────

  try {
    const results = [];

    for (let i = 0; i < count; i++) {
      let imageUrl, imageBase64, mediaType = 'image/jpeg';

      if (useIdeogram) {
        // IDEOGRAM V3 — mejor para texto legible en imagen
        const ideogramRes = await fetch('https://fal.run/fal-ai/ideogram/v3', {
          method:  'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt:       buildIdeogramPrompt(prompt, format),
            aspect_ratio: spec.ratio,
            style:        'REALISTIC',
            magic_prompt: 'AUTO',
            seed:         Math.floor(Math.random() * 999999),
          }),
        });
        const ideogramData = await ideogramRes.json();
        if (!ideogramRes.ok) throw new Error(ideogramData.detail?.[0]?.msg || ideogramData.error || 'Error en Ideogram');
        imageUrl = ideogramData.images?.[0]?.url;

      } else {
        // FLUX 2 PRO — mejor para fotografía lifestyle
        const fluxRes = await fetch('https://fal.run/fal-ai/flux-pro/v1.1', {
          method:  'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt:           buildFluxPrompt(prompt, format),
            aspect_ratio:     spec.fluxRatio,
            output_format:    'jpeg',
            output_quality:   95,
            safety_tolerance: '2',
            seed:             Math.floor(Math.random() * 999999),
          }),
        });
        const fluxData = await fluxRes.json();
        if (!fluxRes.ok) throw new Error(fluxData.detail?.[0]?.msg || fluxData.error || 'Error en Flux');
        imageUrl = fluxData.images?.[0]?.url;
      }

      if (!imageUrl) throw new Error('No se recibió URL de imagen');

      const imgRes    = await fetch(imageUrl);
      const imgBuffer = await imgRes.arrayBuffer();
      imageBase64     = Buffer.from(imgBuffer).toString('base64');
      mediaType       = imgRes.headers.get('content-type') || 'image/jpeg';

      results.push({
        index: i + 1, format: spec.label, size: `${spec.w}x${spec.h}`,
        base64: imageBase64, mediaType,
        model: useIdeogram ? 'Ideogram V3' : 'Flux 2 Pro',
        url: imageUrl,
      });
    }

    return res.status(200).json({ images: results, format: spec });

  } catch (err) {
    console.error('generate-image error:', err);
    return res.status(500).json({ error: err.message || 'Error generando imágenes' });
  }
}

function buildIdeogramPrompt(userPrompt, format) {
  const notes = {
    square:   'square 1:1 composition, balanced layout with space for text overlays',
    vertical: 'vertical 4:5 composition, text zones at top and bottom thirds',
    story:    'full vertical 9:16 immersive, text in upper and lower safe zones',
    carousel: 'clean square composition, well-distributed text elements',
  };
  return `Professional Meta Ads creative for Latin American market. ${userPrompt}.
Format: ${notes[format] || notes.square}.
Requirements: High contrast text, bold readable typography in Spanish, vibrant colors for mobile feed, strong call-to-action visually prominent, modern advertising design that converts, photorealistic premium quality. All text must be in Spanish and clearly legible.`;
}

function buildFluxPrompt(userPrompt, format) {
  const notes = {
    square:   'perfect square 1:1 composition',
    vertical: 'vertical 4:5 mobile-optimized',
    story:    'full vertical 9:16 immersive',
    carousel: 'clean square composition',
  };
  return `Professional advertising photograph for Meta Ads. ${userPrompt}.
${notes[format] || notes.square}. Commercial photography quality, studio lighting, vibrant colors that pop in social media feed, authentic Latin American aesthetic, no text overlays, sharp focus, high-converting visual style optimized for mobile.`;
}
