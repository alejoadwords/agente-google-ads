// api/generate-image.js
// Genera imágenes de anuncios usando la API de Anthropic
// Recibe: { prompt, format, variations }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, format = 'square', variations = 1 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Dimensiones por formato
  const formatSpecs = {
    square:   { label: 'Feed cuadrado',   ratio: '1:1',  size: '1080x1080', desc: 'cuadrada, ideal para feed de Facebook e Instagram' },
    vertical: { label: 'Feed vertical',   ratio: '4:5',  size: '1080x1350', desc: 'vertical 4:5, optimizada para feed móvil' },
    story:    { label: 'Stories / Reels', ratio: '9:16', size: '1080x1920', desc: 'vertical completa 9:16 para Stories y Reels' },
    carousel: { label: 'Carrusel',        ratio: '1:1',  size: '1080x1080', desc: 'cuadrada para tarjeta de carrusel' },
  };

  const spec = formatSpecs[format] || formatSpecs.square;

  // Construir prompt optimizado para anuncios de Meta
  const enhancedPrompt = `
Crea una imagen profesional para un anuncio de Meta Ads (Facebook/Instagram).
Formato: ${spec.desc} (${spec.size}px).

BRIEFING DEL ANUNCIO:
${prompt}

REQUISITOS TÉCNICOS Y CREATIVOS:
- Composición ${spec.ratio} perfectamente equilibrada
- Estilo visual moderno, limpio y profesional
- Colores vibrantes y llamativos que destaquen en el feed
- Zona central despejada o con espacio para texto superpuesto
- Sin texto dentro de la imagen (el copy se agrega por separado en Meta)
- Iluminación natural y atractiva
- Calidad fotográfica o ilustración de alta gama
- Apropiado para audiencias latinoamericanas
- Optimizado para verse bien tanto en móvil como en desktop
`.trim();

  try {
    const results = [];

    for (let i = 0; i < Math.min(variations, 3); i++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'images-2025-04-01',
        },
        body: JSON.stringify({
          model:      'claude-opus-4-5',
          max_tokens: 1024,
          messages: [{
            role:    'user',
            content: [{
              type: 'image_generation',
              prompt: enhancedPrompt,
              output_format: 'base64',
            }],
          }],
        }),
      });

      const data = await response.json();

      if (data.error) {
        console.error('Image gen error:', data.error);
        // Si falla la generación, continuar con las siguientes
        continue;
      }

      // Extraer imagen base64 del response
      const imageBlock = data.content?.find(b => b.type === 'image' || b.type === 'image_generation');
      if (imageBlock) {
        results.push({
          index:    i + 1,
          format:   spec.label,
          size:     spec.size,
          base64:   imageBlock.source?.data || imageBlock.data || '',
          mediaType: imageBlock.source?.media_type || 'image/png',
        });
      }
    }

    if (results.length === 0) {
      return res.status(500).json({ error: 'No se pudieron generar imágenes. Intenta de nuevo.' });
    }

    return res.status(200).json({ images: results, format: spec });

  } catch (err) {
    console.error('generate-image error:', err);
    return res.status(500).json({ error: 'Error generando imágenes: ' + err.message });
  }
}
