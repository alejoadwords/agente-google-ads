// api/seo-rank.js
// Consulta posiciones reales en Google via Serper.dev (SERP API).
// POST { keywords: ['kw', ...], domain: 'ejemplo.com', gl: 'co', hl: 'es' }
// → { results: [{ keyword, position, url, topResults: [...] }], creditsUsed }
// Env: SERPER_API_KEY (serper.dev — 2.500 créditos gratis, luego ~$0.3-1 USD/1.000)

const SERPER_KEY = process.env.SERPER_API_KEY;
const MAX_KEYWORDS = 30; // tope por request para acotar costo

// ── Gate por plan (las consultas SERP cuestan dinero real) ──
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SERPER_KEY) {
    return res.status(500).json({ error: 'SERPER_API_KEY no configurada en Vercel.', needsSetup: true });
  }

  const gate = await isPaidOrAdmin(req);
  if (!gate.ok) {
    return res.status(403).json({
      error: 'El seguimiento de posiciones es parte del plan Pro.',
      upgrade: true,
    });
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
