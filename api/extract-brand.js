// api/extract-brand.js
// Fetches a website URL and extracts brand/business info using Claude Haiku
// Input: { url: string }
// Output: structured JSON with brand fields

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const SYSTEM_PROMPT = `You are a marketing analyst. Given the text content of a website, extract brand and business information as JSON.

Respond ONLY with a valid JSON object. No markdown, no explanation, just JSON.

Required fields:
{
  "name": "Business name",
  "descripcion": "1-2 sentence description of what they do",
  "industria": "one of: E-commerce / Retail | Servicios profesionales | Salud / Bienestar | Educación / Cursos | Tecnología / SaaS | Inmobiliaria | Restaurantes / Food | Otro sector",
  "producto": "main product or service",
  "audiencia": "target audience description",
  "diferenciador": "main differentiator",
  "propuesta": "value proposition",
  "tono": "one of: Profesional | Cercano | Inspirador | Urgente | Educativo | Divertido",
  "competidores": "2-3 likely competitors if identifiable, empty string if not",
  "colores": "brand colors if identifiable from the page, empty string if not",
  "mercado": "geographic market if identifiable, empty string if not"
}`;

function stripHtml(html) {
  // Remove scripts and styles entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const { url } = body || {};
  if (!url || typeof url !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing url field' }), { status: 400, headers: CORS });
  }

  // Fetch the website with a 5-second timeout
  let siteText = '';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const siteRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Acuarius-BrandExtractor/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeoutId);

    if (!siteRes.ok) {
      return new Response(
        JSON.stringify({ error: `El sitio respondió con error ${siteRes.status}` }),
        { status: 200, headers: CORS }
      );
    }

    const html = await siteRes.text();
    siteText = stripHtml(html).slice(0, 3000);
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'El sitio tardó demasiado en responder (timeout 5s)'
      : `No se pudo acceder al sitio: ${err.message}`;
    return new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS });
  }

  if (!siteText) {
    return new Response(JSON.stringify({ error: 'El sitio no devolvió contenido legible' }), { status: 200, headers: CORS });
  }

  // Call Claude Haiku
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: CORS });
  }

  let claudeRes;
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Website URL: ${url}\n\nWebsite text content:\n${siteText}`,
          },
        ],
      }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Error al llamar a Claude: ${err.message}` }), { status: 200, headers: CORS });
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return new Response(JSON.stringify({ error: `Claude API error: ${claudeRes.status}` }), { status: 200, headers: CORS });
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData?.content?.[0]?.text || '';

  let parsed;
  try {
    // Extract JSON from the response (in case Claude adds any text around it)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return new Response(
      JSON.stringify({ error: 'Claude no pudo extraer la información del sitio' }),
      { status: 200, headers: CORS }
    );
  }

  return new Response(JSON.stringify(parsed), { status: 200, headers: CORS });
}
