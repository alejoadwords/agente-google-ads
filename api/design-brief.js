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
- Food/restaurant: dark brown + orange (#2d1a0e, #fff7ed, accent: #f97316, alt_primary: #1a0d00, alt_bg: #fff3e0)
- Technology: electric blue + light (#1e2bcc, #f0f4ff, accent: #6366f1, alt_primary: #0d1a99, alt_bg: #e8ecff)
- Beauty/spa: purple + pink (#4a1a4a, #fdf2f8, accent: #ec4899, alt_primary: #2d0a2d, alt_bg: #fce8f6)
- Education: navy + yellow (#1a2f5a, #fefce8, accent: #eab308, alt_primary: #0d1a3d, alt_bg: #fef9c3)
- Retail: emerald + white (#065f46, #f0fdf4, accent: #10b981, alt_primary: #033d2e, alt_bg: #dcfce7)
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
}`;

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

  const { prompt, format = 'feed' } = body;
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400, headers: CORS });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), { status: 500, headers: CORS });
  }

  const userMessage = `Business description: ${prompt}\nAd format: ${format}\n\nExtract the design brief as JSON.`;

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
