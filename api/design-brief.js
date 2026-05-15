// api/design-brief.js
// Extrae un design brief estructurado de un prompt libre usando Claude
// Input: { prompt: string, format: string }
// Output: structured JSON with headlines, colors, features, CTA, photo query

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const SYSTEM_PROMPT = `You are a professional advertising creative director. Given a business description and campaign goal, extract a structured design brief as JSON.

Pick brand colors based on the industry type:
- Travel/tourism: dark green + beige (#1a3d1a, #f5f0e8, accent: #4ade80, alt_primary: #2d4a1a, alt_bg: #f0ede0)
- Fitness/gym: black + red (#111111, #fee2e2, accent: #ef4444, alt_primary: #1a0000, alt_bg: #fff0f0)
- Fashion/luxury: black + gold (#1a1a1a, #fdf8f0, accent: #d4af37, alt_primary: #2a2000, alt_bg: #fffbf0)
- Health/wellness: dark blue + cream (#1e3a5f, #f0f9ff, accent: #38bdf8, alt_primary: #0f2040, alt_bg: #e8f4fd)
- Yoga/mindfulness: sage green + warm white (#2d4a3e, #f7f5f0, accent: #7fb069, alt_primary: #1a2e26, alt_bg: #eef4ea)
- Food/restaurant: dark brown + orange (#2d1a0e, #fff7ed, accent: #f97316, alt_primary: #1a0d00, alt_bg: #fff3e0)
- Technology: electric blue + light (#1e2bcc, #f0f4ff, accent: #6366f1, alt_primary: #0d1a99, alt_bg: #e8ecff)
- Beauty/spa: purple + pink (#4a1a4a, #fdf2f8, accent: #ec4899, alt_primary: #2d0a2d, alt_bg: #fce8f6)
- Education: navy + yellow (#1a2f5a, #fefce8, accent: #eab308, alt_primary: #0d1a3d, alt_bg: #fef9c3)
- Retail/e-commerce: emerald + white (#065f46, #f0fdf4, accent: #10b981, alt_primary: #033d2e, alt_bg: #dcfce7)
- Fashion/clothing: warm charcoal + cream (#2c2420, #faf8f5, accent: #c4a882, alt_primary: #1a1410, alt_bg: #f5f2ed)
- Services: corporate blue + gray (#1e40af, #f8fafc, accent: #3b82f6, alt_primary: #0f2a7a, alt_bg: #eff6ff)

Respond ONLY with a valid JSON object. No markdown, no explanation, just JSON.

Required fields:
{
  "headline": "2-word bold uppercase headline",
  "subheadline": "emotional italic phrase 3-4 words",
  "category": "BUSINESS CATEGORY BADGE",
  "divider": "BRAND OR DESTINATION NAME",
  "description": "1-2 sentence description max 130 chars",
  "features": ["feature 1", "feature 2", "feature 3", "feature 4"],
  "cta_title": "CTA BUTTON TEXT",
  "cta_sub": "secondary cta text",
  "primary_color": "#hex",
  "bg_color": "#hex",
  "accent_color": "#hex",
  "alt_primary": "#hex",
  "alt_bg": "#hex",
  "photo_query": "english keywords for background photo, 5 words max"
}

IMPORTANT: Output ALL text fields (headline, subheadline, category, divider, description, features[], cta_title, cta_sub) in the SAME LANGUAGE as the business description. If the description is in Spanish, ALL fields must be in Spanish. If in English, respond in English. Never mix languages.`;

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
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const { prompt, format = 'feed', category = 'general' } = body;
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400, headers: CORS });
  }

  // Category-specific color overrides injected into the user message
  const CATEGORY_HINTS = {
    yoga:        'IMPORTANT: This is yoga/mindfulness/wellness. Use exclusively the Yoga/mindfulness palette: primary_color:#2d4a3e, bg_color:#f7f5f0, accent_color:#7fb069, alt_primary:#1a2e26, alt_bg:#eef4ea. Photo should be serene, natural, calm — yoga poses, nature, soft light.',
    fitness:     'IMPORTANT: This is fitness/gym. Use the Fitness/gym palette: primary_color:#111111, bg_color:#fee2e2, accent_color:#ef4444. Photo should be energetic, athletic, motivational.',
    ecommerce:   'IMPORTANT: This is e-commerce/retail. Use the Retail palette: primary_color:#065f46, bg_color:#f0fdf4, accent_color:#10b981. Photo should show the product cleanly.',
    restaurante: 'IMPORTANT: This is food/restaurant. Use the Food palette: primary_color:#2d1a0e, bg_color:#fff7ed, accent_color:#f97316. Photo should be appetizing food photography.',
    belleza:     'IMPORTANT: This is beauty/spa. Use the Beauty palette: primary_color:#4a1a4a, bg_color:#fdf2f8, accent_color:#ec4899. Photo should feel luxurious and elegant.',
    educacion:   'IMPORTANT: This is education. Use the Education palette: primary_color:#1a2f5a, bg_color:#fefce8, accent_color:#eab308. Photo should feel inspiring and professional.',
    tecnologia:  'IMPORTANT: This is technology/SaaS. Use the Technology palette: primary_color:#1e2bcc, bg_color:#f0f4ff, accent_color:#6366f1. Photo should feel modern and digital.',
    turismo:     'IMPORTANT: This is travel/tourism. Use the Travel palette: primary_color:#1a3d1a, bg_color:#f5f0e8, accent_color:#4ade80. Photo should be a beautiful destination.',
    moda:        'IMPORTANT: This is fashion/clothing. Use the Fashion palette: primary_color:#2c2420, bg_color:#faf8f5, accent_color:#c4a882. Photo should be editorial fashion style.',
  };
  const categoryHint = CATEGORY_HINTS[category] || '';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), { status: 500, headers: CORS });
  }

  const userMessage = `Business description: ${prompt}\nAd format: ${format}\nCategory: ${category}\n${categoryHint}\n\nExtract the design brief as JSON.`;

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Claude API request failed: ' + e.message }), { status: 502, headers: CORS });
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return new Response(JSON.stringify({ error: 'Claude API error: ' + errText }), { status: 502, headers: CORS });
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData.content?.[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return new Response(JSON.stringify({ error: 'Could not parse JSON from Claude response', raw: rawText }), { status: 502, headers: CORS });
  }

  let brief;
  try {
    brief = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in Claude response', raw: rawText }), { status: 502, headers: CORS });
  }

  return new Response(JSON.stringify(brief), { status: 200, headers: CORS });
}
