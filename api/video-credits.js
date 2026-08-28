// api/video-credits.js
// GET  → devuelve créditos disponibles del usuario autenticado
// POST action=deduct → descuenta 1 crédito (después de generación exitosa)

// Acceso a Supabase por su API REST, como el resto de api/. Este fichero usaba
// el SDK oficial, que NUNCA estuvo instalado: package.json no tiene
// dependencias. La función reventaba al cargar y la ruta llevaba caída desde
// abril de 2026 — o sea que el cupo de videos no ha existido nunca.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbCab = (extra) => ({
  'Content-Type': 'application/json',
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  ...(extra || {}),
});
async function sbUsuario(userId, campos) {
  const r = await fetch(
    `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=${campos}&limit=1`,
    { headers: sbCab() });
  if (!r.ok) return null;
  return (await r.json())?.[0] || null;
}
async function sbActualizaUsuario(userId, cambios) {
  await fetch(`${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH', headers: sbCab({ Prefer: 'return=minimal' }), body: JSON.stringify(cambios),
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Límites mensuales por plan
const PLAN_LIMITS = {
  free:       1,   // lifetime (no se resetea)
  individual: 5,   // por mes
  pro:        5,   // alias de individual
  trial:      5,   // la prueba de 7 dias se comporta como Pro
  agencia:    15,  // por mes
  agency:     15,
};

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

async function getUserIdFromReq(req) {
  const auth = req.headers['authorization'] || '';
  const payload = await verificarFirma(auth.replace('Bearer ', ''));
  return payload?.sub || null;
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  const userId = await getUserIdFromReq(req);
  if (!userId) return res.status(401).json({ error: 'No autorizado' });

  // ── Obtener datos del usuario ──────────────────────────────────────────────
  const user = await sbUsuario(userId, 'id,plan,video_credits_used,video_credits_extra,video_credits_reset_at');

  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const plan      = user.plan || 'free';
  const isFree    = plan === 'free';
  const limit     = PLAN_LIMITS[plan] || 1;
  const extra     = user.video_credits_extra || 0;
  let   used      = user.video_credits_used  || 0;
  let   resetAt   = user.video_credits_reset_at ? new Date(user.video_credits_reset_at) : null;

  // ── Reset mensual automático (solo planes de pago) ─────────────────────────
  let needsReset = false;
  if (!isFree) {
    if (!resetAt) {
      // Primera vez → inicializar período
      needsReset = true;
    } else {
      const daysSince = (Date.now() - resetAt.getTime()) / 86_400_000;
      if (daysSince >= 30) { needsReset = true; used = 0; }
    }
  }

  if (needsReset) {
    await sbActualizaUsuario(userId, {
      video_credits_used:     used,
      video_credits_reset_at: new Date().toISOString(),
    });
    resetAt = new Date();
  }

  const monthlyAvailable = Math.max(0, limit - used);
  const totalAvailable   = monthlyAvailable + extra;

  // ── GET: consultar créditos ────────────────────────────────────────────────
  if (req.method === 'GET') {
    return res.json({
      available:         totalAvailable,
      monthly_used:      used,
      monthly_limit:     limit,
      monthly_available: monthlyAvailable,
      extra,
      plan,
      is_free:           isFree,
      reset_at:          resetAt?.toISOString() || null,
    });
  }

  // ── POST: descontar 1 crédito ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action !== 'deduct') return res.status(400).json({ error: 'Acción inválida' });

    if (totalAvailable <= 0) {
      return res.status(402).json({ error: 'Sin créditos disponibles', available: 0 });
    }

    const updates = {};
    if (monthlyAvailable > 0) {
      updates.video_credits_used = used + 1;
    } else {
      updates.video_credits_extra = extra - 1;
    }
    await sbActualizaUsuario(userId, updates);

    return res.json({
      ok:        true,
      available: totalAvailable - 1,
      monthly_used: updates.video_credits_used ?? used,
      extra:        updates.video_credits_extra ?? extra,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
