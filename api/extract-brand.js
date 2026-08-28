// api/extract-brand.js
// Fetches a website URL and extracts brand/business info using Claude Haiku
// Input: { url: string }
// Output: structured JSON with brand fields

export const config = { runtime: 'edge' };

import { registrarUso, cuentaDe } from './_uso-ia.js';

// Este endpoint llamaba a Claude sin pedir credenciales de ninguna clase.
async function usuarioDelToken(req) {
  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const bin = x => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const txt = x => new TextDecoder().decode(bin(x));
    const header = JSON.parse(txt(hB64));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, bin(sB64), new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const payload = JSON.parse(txt(pB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

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

  const actorId = await usuarioDelToken(req);
  if (!actorId) {
    return new Response(JSON.stringify({ error: 'No autorizado.' }), { status: 401, headers: CORS });
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

  // Fetch directo con headers de navegador real (muchos sitios devuelven 403
  // a cualquier User-Agent que parezca bot). Si el firewall igual lo bloquea,
  // fallback con el scraper de Serper (misma key del módulo SEO).
  async function fetchDirect() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const siteRes = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
        },
      });
      if (!siteRes.ok) return { error: siteRes.status };
      const html = await siteRes.text();
      return { text: stripHtml(html).slice(0, 3000) };
    } catch (err) {
      return { error: err.name === 'AbortError' ? 'timeout' : err.message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function fetchViaSerper() {
    const key = process.env.SERPER_API_KEY;
    if (!key) return null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const r = await fetch('https://scrape.serper.dev', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      clearTimeout(timeoutId);
      if (!r.ok) return null;
      const d = await r.json();
      const text = d.text || stripHtml(d.html || '') || '';
      return text ? text.slice(0, 3000) : null;
    } catch { return null; }
  }

  let siteText = '';
  const direct = await fetchDirect();
  if (direct.text) {
    siteText = direct.text;
  } else {
    siteText = (await fetchViaSerper()) || '';
    if (!siteText) {
      const detail = direct.error === 'timeout'
        ? 'El sitio tardó demasiado en responder'
        : typeof direct.error === 'number'
          ? `El sitio respondió con error ${direct.error} y también bloqueó el lector alternativo`
          : `No se pudo acceder al sitio: ${direct.error}`;
      return new Response(JSON.stringify({ error: detail + '. Puedes completar el brief manualmente.' }), { status: 200, headers: CORS });
    }
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
        model: 'claude-haiku-4-5',
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
  if (claudeData.usage) {
    await registrarUso({ userId: await cuentaDe(actorId), actorId, origen: 'extract-brand',
      agente: 'extract-brand', modelo: 'claude-haiku-4-5', uso: claudeData.usage });
  }
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
