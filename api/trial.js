// api/trial.js
// Prueba Pro de 14 días para cuentas free: una sola vez por usuario.
// POST autenticado → si el plan es free y nunca usó trial, fija en Clerk
// {plan:'trial', trial_until:+14d, trial_used:true}. Los gates del server
// aceptan 'trial' como plan pago y api/cron-trials.js lo expira a 'free'.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const CK = process.env.CLERK_SECRET_KEY;
  const u = await fetch('https://api.clerk.com/v1/users/' + userId, { headers: { Authorization: 'Bearer ' + CK } }).then(r => r.json()).catch(() => null);
  if (!u) return jsonResp({ error: 'Usuario no encontrado' }, 404);
  const meta = u.public_metadata || {};
  const plan = meta.plan || 'free';

  // Trial vigente → devolver estado
  if (plan === 'trial' && meta.trial_until) {
    return jsonResp({ ok: true, active: new Date(meta.trial_until) > new Date(), trial_until: meta.trial_until });
  }
  if (plan !== 'free') return jsonResp({ ok: false, reason: 'plan_activo', plan });
  if (meta.trial_used) return jsonResp({ ok: false, reason: 'trial_usado' });

  const trialUntil = new Date(Date.now() + 14 * 86400000).toISOString();
  const r = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + CK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_metadata: { plan: 'trial', trial_until: trialUntil, trial_used: true } }),
  });
  if (!r.ok) return jsonResp({ error: 'No se pudo activar la prueba' }, 500);
  return jsonResp({ ok: true, active: true, trial_until: trialUntil, started: true });
}
