// api/seo-rank.js
// Consulta posiciones reales en Google via Serper.dev (SERP API).
// POST { keywords: ['kw', ...], domain: 'ejemplo.com', gl: 'co', hl: 'es' }
// → { results: [{ keyword, position, url, topResults: [...] }], creditsUsed }
// Env: SERPER_API_KEY (serper.dev — 2.500 créditos gratis, luego ~$0.3-1 USD/1.000)

const SERPER_KEY = process.env.SERPER_API_KEY;
const MAX_KEYWORDS = 30; // tope por request para acotar costo

function normalizeDomain(d) {
  return String(d || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
}

async function rankOne(keyword, domain, gl, hl) {
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: keyword, gl: gl || 'co', hl: hl || 'es', num: 100 }),
  });
  const data = await r.json();
  if (data.error || !Array.isArray(data.organic)) {
    return { keyword, error: data.error || data.message || 'Sin resultados' };
  }
  const target = normalizeDomain(domain);
  let position = null;
  let url = null;
  data.organic.forEach((res, i) => {
    if (position !== null) return;
    if (normalizeDomain(res.link) === target) {
      position = res.position || i + 1;
      url = res.link;
    }
  });
  return {
    keyword,
    position,          // null = fuera del top 100
    url,
    topResults: data.organic.slice(0, 5).map(res => ({
      position: res.position,
      title:    res.title,
      link:     res.link,
      domain:   normalizeDomain(res.link),
    })),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SERPER_KEY) {
    return res.status(500).json({ error: 'SERPER_API_KEY no configurada en Vercel.', needsSetup: true });
  }

  const { keywords, domain, gl, hl } = req.body || {};
  if (!Array.isArray(keywords) || !keywords.length) return res.status(400).json({ error: 'keywords requeridas' });
  if (!domain) return res.status(400).json({ error: 'domain requerido' });

  const batch = keywords.slice(0, MAX_KEYWORDS).map(k => String(k).trim()).filter(Boolean);

  try {
    const results = await Promise.all(batch.map(k =>
      rankOne(k, domain, gl, hl).catch(e => ({ keyword: k, error: String(e.message || e) }))
    ));
    return res.json({
      results,
      creditsUsed: batch.length * 2, // num=100 cuesta 2 créditos en Serper
      truncated: keywords.length > MAX_KEYWORDS ? keywords.length - MAX_KEYWORDS : 0,
    });
  } catch (err) {
    console.error('seo-rank error:', err);
    return res.status(500).json({ error: 'Error consultando posiciones' });
  }
}
