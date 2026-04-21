// api/generate-image.js
// Genera imágenes de anuncios usando fal.ai
// Modo DESIGN: Ideogram V3 genera el anuncio COMPLETO con texto integrado (style: DESIGN)
// Modo PHOTO:  Flux 2 Pro para fondos lifestyle sin texto (cuando no hay hasDesign)
// Body: { prompt, format, variations, hasText, designMode, adCopy, brandColors, productImageBase64 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    prompt,
    format            = 'square',
    variations        = 1,
    hasText           = false,
    // Nuevo modo DESIGN: genera el anuncio completo con texto integrado
    designMode        = false,
    adCopy            = null,     // { headline, subheadline, cta, brand }
    brandColors       = null,     // { primary, secondary, overlay } hex strings
    // Modo remix legacy
    mode              = 'generate',
    referenceImage,
    imageWeight       = 0.5,
    remixCount        = 5,
    // Imagen de referencia para product shot
    productImageBase64 = null,
  } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

  const falKey = process.env.FAL_API_KEY;
  if (!falKey) return res.status(500).json({ error: 'FAL_API_KEY no configurado' });

  const formatSpecs = {
    square:   { w: 1080, h: 1080, imgSize: { width: 1080, height: 1080 }, label: 'Feed cuadrado · 1080×1080',   fluxRatio: '1:1',  ideogramRatio: '1:1'  },
    vertical: { w: 1080, h: 1350, imgSize: { width: 1080, height: 1350 }, label: 'Feed vertical · 1080×1350',   fluxRatio: '4:5',  ideogramRatio: '4:5'  },
    story:    { w: 1080, h: 1920, imgSize: { width: 1080, height: 1920 }, label: 'Stories / Reels · 1080×1920', fluxRatio: '9:16', ideogramRatio: '9:16' },
    carousel: { w: 1080, h: 1080, imgSize: { width: 1080, height: 1080 }, label: 'Carrusel · 1080×1080',        fluxRatio: '1:1',  ideogramRatio: '1:1'  },
  };

  const spec  = formatSpecs[format] || formatSpecs.square;
  const count = Math.min(Math.max(1, variations), 5);

  // ── MODO REMIX (legacy) ───────────────────────────────────────────────────
  if (mode === 'remix') {
    if (!referenceImage) return res.status(400).json({ error: 'referenceImage requerido para modo remix' });
    const totalVariations = Math.min(Math.max(5, remixCount), 10);
    const results = [];
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
            image_url: referenceImage, prompt, strength: imageWeight,
            num_images: numInBatch, image_size: spec.imgSize,
            rendering_speed: 'BALANCED', expand_prompt: false,
          }),
        })
      );
    }
    const batchResponses = await Promise.all(batchPromises);
    for (const remixRes of batchResponses) {
      const remixData = await remixRes.json();
      if (!remixRes.ok) return res.status(500).json({ error: remixData.detail?.[0]?.msg || remixData.error || 'Error en Ideogram Remix' });
      for (const imgObj of (remixData.images || [])) {
        if (!imgObj.url) continue;
        const imgRes = await fetch(imgObj.url);
        const imgBuffer = await imgRes.arrayBuffer();
        results.push({ index: results.length + 1, format: spec.label, size: `${spec.w}x${spec.h}`, base64: Buffer.from(imgBuffer).toString('base64'), mediaType: imgRes.headers.get('content-type') || 'image/jpeg', model: 'Ideogram V3 Remix', url: imgObj.url });
        if (results.length >= totalVariations) break;
      }
      if (results.length >= totalVariations) break;
    }
    return res.status(200).json({ images: results, format: spec, mode: 'remix' });
  }

  try {
    const results = [];

    for (let i = 0; i < count; i++) {
      let imageUrl, imageBase64, mediaType = 'image/jpeg';

      if (designMode) {
        // ── MODO DESIGN: Ideogram genera el anuncio completo con texto integrado ──
        // style: DESIGN es el modo de Ideogram optimizado para material gráfico publicitario
        const designPrompt = buildDesignPrompt(prompt, format, adCopy, brandColors, i);

        const body = {
          prompt:          designPrompt,
          image_size:      spec.imgSize,
          style:           'DESIGN',       // ← clave: modo diseño gráfico/publicidad
          rendering_speed: 'QUALITY',
          expand_prompt:   false,
          seed:            Math.floor(Math.random() * 999999),
        };

        // Si hay color_palette definido, pasarlo a Ideogram para control de colores
        if (brandColors?.primary) {
          const hexToRgb = h => {
            const r = parseInt(h.slice(1,3), 16);
            const g = parseInt(h.slice(3,5), 16);
            const b = parseInt(h.slice(5,7), 16);
            return { r, g, b };
          };
          const members = [];
          try {
            if (brandColors.primary   && brandColors.primary.startsWith('#'))   members.push({ rgb: hexToRgb(brandColors.primary),   color_weight: 0.5 });
            if (brandColors.secondary && brandColors.secondary.startsWith('#')) members.push({ rgb: hexToRgb(brandColors.secondary), color_weight: 0.35 });
            if (brandColors.overlay   && brandColors.overlay.startsWith('#'))   members.push({ rgb: hexToRgb(brandColors.overlay),   color_weight: 0.15 });
            if (members.length > 0) body.color_palette = { members };
          } catch(e) { /* ignorar si falla parseo de color */ }
        }

        // Si hay foto del producto, usar Remix sobre ella en lugar de text-to-image
        if (productImageBase64) {
          // Usar replace-background de Ideogram para mantener el producto real
          const replaceRes = await fetch('https://fal.run/fal-ai/ideogram/v3/replace-background', {
            method:  'POST',
            headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url:       productImageBase64,  // base64 data URI
              prompt:          designPrompt,
              image_size:      spec.imgSize,
              style:           'DESIGN',
              rendering_speed: 'QUALITY',
              expand_prompt:   false,
            }),
          });
          const replaceData = await replaceRes.json();
          if (!replaceRes.ok) {
            // Fallback a text-to-image si replace-background falla
            console.warn('replace-background failed, falling back to text-to-image:', replaceData);
            const fallbackRes = await fetch('https://fal.run/fal-ai/ideogram/v3', {
              method: 'POST', headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            const fallbackData = await fallbackRes.json();
            if (!fallbackRes.ok) throw new Error(fallbackData.detail?.[0]?.msg || fallbackData.error || 'Error en Ideogram DESIGN');
            imageUrl = fallbackData.images?.[0]?.url;
          } else {
            imageUrl = replaceData.images?.[0]?.url;
          }
        } else {
          const ideogramRes = await fetch('https://fal.run/fal-ai/ideogram/v3', {
            method:  'POST',
            headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
          });
          const ideogramData = await ideogramRes.json();
          if (!ideogramRes.ok) throw new Error(ideogramData.detail?.[0]?.msg || ideogramData.error || 'Error en Ideogram DESIGN');
          imageUrl = ideogramData.images?.[0]?.url;
        }

      } else if (hasText) {
        // ── MODO REALISTA CON TEXTO (legacy) ─────────────────────────────────
        const ideogramRes = await fetch('https://fal.run/fal-ai/ideogram/v3', {
          method:  'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt:          buildIdeogramPrompt(prompt, format),
            image_size:      spec.imgSize,
            style:           'REALISTIC',
            rendering_speed: 'QUALITY',
            expand_prompt:   false,
            seed:            Math.floor(Math.random() * 999999),
          }),
        });
        const ideogramData = await ideogramRes.json();
        if (!ideogramRes.ok) throw new Error(ideogramData.detail?.[0]?.msg || ideogramData.error || 'Error en Ideogram');
        imageUrl = ideogramData.images?.[0]?.url;

      } else {
        // ── MODO FOTO LIFESTYLE (Flux 2 Pro, sin texto) ───────────────────────
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
        model: designMode ? 'Ideogram V3 DESIGN' : (hasText ? 'Ideogram V3' : 'Flux 2 Pro'),
        url: imageUrl,
      });
    }

    return res.status(200).json({ images: results, format: spec });

  } catch (err) {
    console.error('generate-image error:', err);
    return res.status(500).json({ error: err.message || 'Error generando imágenes' });
  }
}

// ── DESIGN PROMPT: le dice a Ideogram que genere el anuncio completo ─────────
// Ideogram V3 con style:DESIGN puede renderizar texto como elemento visual integrado
function buildDesignPrompt(userPrompt, format, adCopy, brandColors, variantIndex) {
  const formatGuide = {
    square:   'Square 1:1 social media ad, balanced split composition',
    vertical: 'Vertical 4:5 Instagram feed ad, mobile-optimized layout',
    story:    'Vertical 9:16 Instagram Stories ad, full-screen immersive',
    carousel: 'Square 1:1 carousel card, clean centered composition',
  }[format] || 'Square social media advertisement';

  // Variaciones de layout para diversidad visual entre conceptos
  const layouts = [
    'Text block on left third, product/image on right two thirds. Dark gradient overlay on text side.',
    'Large bold headline centered top half, product centered bottom half on dark background.',
    'Full bleed background image, text in bottom third with semi-transparent dark band.',
    'Product top center, text block below on solid brand color background.',
    'Split design: solid color left panel with text, product image right panel.',
  ];
  const layout = layouts[variantIndex % layouts.length];

  // Construir el bloque de texto si hay adCopy
  let textBlock = '';
  if (adCopy) {
    const brand      = adCopy.brand      ? `Brand name: "${adCopy.brand}" as logo text top left` : '';
    const headline   = adCopy.headline   ? `Main headline: "${adCopy.headline}" — large bold impactful typography` : '';
    const sub        = adCopy.subheadline? `Subheadline: "${adCopy.subheadline}" — smaller supporting text` : '';
    const cta        = adCopy.cta        ? `CTA button with text: "${adCopy.cta}" — high contrast pill button` : '';
    textBlock = [brand, headline, sub, cta].filter(Boolean).join('. ');
  }

  // Colores
  const colorGuide = brandColors?.primary
    ? `Primary color: ${brandColors.primary}. Secondary: ${brandColors.secondary || '#FFFFFF'}.`
    : 'Rich contrasting brand colors for high visibility.';

  return `Professional advertising creative for Meta Ads, Latin American market. ${formatGuide}. Layout: ${layout}

${userPrompt}

${textBlock ? 'Typography requirements: ' + textBlock + '.' : ''}

Design style: Premium agency-quality ad creative. ${colorGuide} High contrast text always fully legible. Bold modern typography. Strong visual hierarchy. All text in Spanish. Clean professional finish. No watermarks.

Quality: Commercial advertising photography + graphic design hybrid. Ready to publish on Meta Ads. Conversion-optimized layout.`;
}

function buildIdeogramPrompt(userPrompt, format) {
  const notes = {
    square:   'square 1:1 composition, balanced layout',
    vertical: 'vertical 4:5 composition optimized for mobile feed',
    story:    'full vertical 9:16 immersive story format',
    carousel: 'clean square composition',
  };
  return `Professional Meta Ads creative for Latin American market. ${userPrompt}. Format: ${notes[format] || notes.vertical}. High contrast bold readable typography in Spanish, vibrant brand colors, strong CTA visually prominent, modern advertising design optimized for mobile conversion, photorealistic premium quality, agency-level composition.`;
}

function buildFluxPrompt(userPrompt, format) {
  const notes = {
    square:   'perfect square 1:1 composition',
    vertical: 'vertical 4:5 mobile-optimized',
    story:    'full vertical 9:16 immersive',
    carousel: 'clean square composition',
  };
  return `Professional advertising photograph for Meta Ads. ${userPrompt}. ${notes[format] || notes.vertical}. Commercial photography quality, studio lighting, vibrant colors that pop in social media feed, authentic Latin American aesthetic, no text overlays, sharp focus, high-converting visual style optimized for mobile.`;
}
