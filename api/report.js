// api/report.js — Reporte de campañas: guardar y leer públicamente
// POST /api/report        → guarda reporte, devuelve { id }
// GET  /api/report?id=xxx → devuelve datos del reporte (público, sin auth)

// Acceso a Supabase por su API REST, como el resto de api/. Este fichero usaba
// el SDK @supabase/supabase-js, que NUNCA estuvo instalado: package.json no
// tiene dependencias. La función reventaba al cargar (FUNCTION_INVOCATION_FAILED)
// y la ruta llevaba caída desde abril de 2026 sin que nada lo dijera.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbCab = (extra) => ({
  'Content-Type': 'application/json',
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  ...(extra || {}),
});
async function sbSelect(tabla, query) {
  const r = await fetch(`${SB_URL}/rest/v1/${tabla}?${query}`, { headers: sbCab() });
  if (!r.ok) return { data: null, error: await r.text() };
  const filas = await r.json();
  return { data: filas, error: null };
}
async function sbUpdate(tabla, query, cambios) {
  const r = await fetch(`${SB_URL}/rest/v1/${tabla}?${query}`, {
    method: 'PATCH', headers: sbCab({ Prefer: 'return=minimal' }), body: JSON.stringify(cambios),
  });
  return r.ok ? { error: null } : { error: await r.text() };
}
async function sbInsert(tabla, fila) {
  const r = await fetch(`${SB_URL}/rest/v1/${tabla}`, {
    method: 'POST', headers: sbCab({ Prefer: 'return=minimal' }), body: JSON.stringify(fila),
  });
  return r.ok ? { error: null } : { error: await r.text() };
}

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: leer reporte público por ID ────────────────────────────────────────
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data: filas } = await sbSelect('agency_reports', `id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    const data = filas && filas[0];
    if (!data) return res.status(404).json({ error: 'Report not found' });

    // Incrementar contador de vistas
    await sbUpdate('agency_reports', `id=eq.${encodeURIComponent(id)}`, { views: (data.views || 0) + 1 });

    return res.status(200).json({ report: data });
  }

  // ── POST: guardar nuevo reporte ──────────────────────────────────────────────
  if (req.method === 'POST') {
    // Verificar autenticación (solo la agencia puede guardar)
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // Sesión de Clerk, con la firma comprobada. Antes se intentaba primero
    // con supabase.auth (que aquí no autentica a nadie: los usuarios viven en
    // Clerk) y, al fallar, se aceptaba el 'sub' de un token sin verificar.
    const payload = await verificarFirma(token);
    if (!payload?.sub) return res.status(401).json({ error: 'Invalid token' });
    const userId = payload.sub;

    const body = req.body;
    const {
      clientId, clientName, agencyName,
      platforms, kpis, metrics,
      period, dateFrom, dateTo,
      summary, // texto generado por IA
    } = body;

    if (!clientId || !platforms || !metrics) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generar ID único
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: insertError } = await sbInsert('agency_reports', {
        id,
        user_id:     userId,
        client_id:   clientId,
        client_name: clientName || 'Cliente',
        agency_name: agencyName || null,
        platforms,          // array de strings: ['google','meta']
        kpis,               // objeto: { google: ['inversion','clics',...], meta: [...] }
        metrics,            // objeto: { google: { inversion: '1200', clics: '850' }, meta: {...} }
        period,             // 'semana' | 'mes' | 'trimestre' | 'custom'
        date_from:   dateFrom || null,
        date_to:     dateTo   || null,
        summary,            // texto WhatsApp generado por IA
        views:       0,
        created_at:  now,
      });

    if (insertError) {
      console.error('report insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save report' });
    }

    const reportUrl = `https://app.acuarius.app/report.html?id=${id}`;
    return res.status(200).json({ id, url: reportUrl });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
