// api/geo-rank.js
// GEO (Generative Engine Optimization): consulta a las principales IAs con las
// preguntas que haría un usuario real y detecta si la marca/dominio aparece en
// las respuestas, en qué posición y qué competidores se mencionan.
// Motores: Claude (ANTHROPIC_API_KEY — siempre activo), Gemini (GEMINI_API_KEY),
// ChatGPT (OPENAI_API_KEY) y Perplexity (PERPLEXITY_API_KEY) si sus keys existen.
// POST { queries: [...], domain, brand, competitors: [], country }

const MAX_QUERIES = 10;

// ── Gate por plan (cada chequeo son llamadas reales a 4 IAs) ──
const PAID_PLANS = ['pro', 'agency', 'individual', 'agencia', 'trial'];
const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];

// ── Verificación real del token ──────────────────────────────────────────────
// Antes solo se decodificaba el contenido del JWT y se le creía. Un JWT no
// verificado no prueba nada: cualquiera se escribe uno que diga plan 'agency'
// y gasta nuestras consultas. Aquí se comprueba la FIRMA contra las claves
// públicas de Clerk, que se cachean diez minutos.
let _jwks = null, _jwksExp = 0;
async function verificarFirma(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const b64 = x => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const header = JSON.parse(b64(hB64).toString('utf8'));
    if (!_jwks || _jwksExp < Date.now()) {
      _jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
      _jwksExp = Date.now() + 600000;
    }
    const key = _jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, b64(sB64), new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const payload = JSON.parse(b64(pB64).toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

async function isPaidOrAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const payload = await verificarFirma(token);
  if (!payload) return { ok: false, plan: 'free' };
  const plan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
  if (PAID_PLANS.includes(plan)) return { ok: true, plan };
  // Bypass admin: verificar email real via Clerk (el JWT no siempre lo trae)
  if (payload.sub && process.env.CLERK_SECRET_KEY) {
    try {
      const r = await fetch('https://api.clerk.com/v1/users/' + payload.sub, {
        headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
      });
      const u = await r.json();
      // Clerk dejó de mandar public_metadata en el token de sesión (v2): el plan
      // real se lee aquí, si no todo usuario de pago quedaba como "free".
      const realPlan = u.public_metadata?.plan;
      if (PAID_PLANS.includes(realPlan)) return { ok: true, plan: realPlan };
      const email = (u.email_addresses?.[0]?.email_address || '').toLowerCase();
      if (ADMIN_EMAILS.includes(email)) return { ok: true, plan: 'admin' };
    } catch {}
  }
  return { ok: false, plan };
}

const ENGINES = {
  claude:     { label: 'Claude',     env: 'ANTHROPIC_API_KEY' },
  gemini:     { label: 'Gemini',     env: 'GEMINI_API_KEY' },
  chatgpt:    { label: 'ChatGPT',    env: 'OPENAI_API_KEY' },
  perplexity: { label: 'Perplexity', env: 'PERPLEXITY_API_KEY' },
};

const SYSTEM_PROMPT = (country) =>
  'Eres un asistente útil. Responde en español para un usuario de ' + (country || 'Latinoamérica') +
  '. Cuando la pregunta sea sobre productos, servicios, herramientas, plataformas o proveedores, ' +
  'recomienda opciones concretas con sus nombres reales, como lo harías normalmente.';

async function askClaude(query, country) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 700,
      system: SYSTEM_PROMPT(country),
      messages: [{ role: 'user', content: query }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Claude error');
  return (d.content || []).map(c => c.text || '').join(' ');
}

async function askGemini(query, country) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT(country) }] },
      contents: [{ parts: [{ text: query }] }],
      generationConfig: { maxOutputTokens: 700 },
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Gemini error');
  return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(' ');
}

async function askOpenAI(query, country) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      messages: [{ role: 'system', content: SYSTEM_PROMPT(country) }, { role: 'user', content: query }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'OpenAI error');
  return d.choices?.[0]?.message?.content || '';
}

async function askPerplexity(query, country) {
  const r = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.PERPLEXITY_API_KEY },
    body: JSON.stringify({
      model: 'sonar',
      max_tokens: 700,
      messages: [{ role: 'system', content: SYSTEM_PROMPT(country) }, { role: 'user', content: query }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Perplexity error');
  return d.choices?.[0]?.message?.content || '';
}

const ASK = { claude: askClaude, gemini: askGemini, chatgpt: askOpenAI, perplexity: askPerplexity };

function baseName(domainOrBrand) {
  return String(domainOrBrand || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('.')[0];
}

// Detecta menciones de la marca y competidores en la respuesta de la IA
function analyzeMention(text, domain, brand, competitors) {
  const t = (text || '').toLowerCase();
  const brandTerms = [...new Set([baseName(domain), (brand || '').toLowerCase().trim()].filter(s => s && s.length > 2))];
  const findFirst = (terms) => {
    let idx = -1;
    terms.forEach(term => {
      const i = t.indexOf(term);
      if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    });
    return idx;
  };
  const brandIdx = findFirst(brandTerms);
  const entities = [];
  if (brandIdx >= 0) entities.push({ who: 'brand', idx: brandIdx });
  const competitorsFound = [];
  (competitors || []).forEach(c => {
    const term = baseName(c);
    if (term.length > 2) {
      const i = t.indexOf(term);
      if (i >= 0) { entities.push({ who: c, idx: i }); competitorsFound.push(c); }
    }
  });
  entities.sort((a, b) => a.idx - b.idx);
  const rank = brandIdx >= 0 ? entities.findIndex(e => e.who === 'brand') + 1 : null;
  // Fragmento donde aparece la marca (contexto de la mención)
  let snippet = '';
  if (brandIdx >= 0) {
    const start = Math.max(0, brandIdx - 90);
    snippet = (start > 0 ? '…' : '') + (text || '').slice(start, brandIdx + 130).replace(/\n+/g, ' ').trim() + '…';
  }
  return { mentioned: brandIdx >= 0, rank, competitorsFound, snippet };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const gate = await isPaidOrAdmin(req);
  if (!gate.ok) {
    return res.status(403).json({
      error: 'El reporte GEO es parte del plan Pro.',
      upgrade: true,
    });
  }

  const { queries, domain, brand, competitors, country } = req.body || {};
  if (!Array.isArray(queries) || !queries.length) return res.status(400).json({ error: 'queries requeridas' });
  if (!domain) return res.status(400).json({ error: 'domain requerido' });

  const active = Object.keys(ENGINES).filter(k => !!process.env[ENGINES[k].env]);
  const enginesStatus = {};
  Object.keys(ENGINES).forEach(k => { enginesStatus[k] = { label: ENGINES[k].label, active: active.includes(k) }; });
  if (!active.length) return res.status(500).json({ error: 'Ningún motor de IA configurado', engines: enginesStatus });

  const batch = queries.slice(0, MAX_QUERIES).map(q => String(q).trim()).filter(Boolean);

  try {
    const tasks = [];
    batch.forEach(q => active.forEach(engine => {
      tasks.push(
        ASK[engine](q, country)
          .then(text => ({ query: q, engine, ...analyzeMention(text, domain, brand, competitors) }))
          .catch(e => ({ query: q, engine, error: String(e.message || e).slice(0, 200) }))
      );
    }));
    const results = await Promise.all(tasks);
    return res.json({
      results,
      engines: enginesStatus,
      truncated: queries.length > MAX_QUERIES ? queries.length - MAX_QUERIES : 0,
    });
  } catch (err) {
    console.error('geo-rank error:', err);
    return res.status(500).json({ error: 'Error consultando las IAs' });
  }
}
