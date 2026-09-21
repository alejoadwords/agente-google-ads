// api/refresh-meta-token.js
// Renueva el long-lived token de Meta ANTES de que expire (duran 60 días).
// Un long-lived token vigente puede intercambiarse por uno nuevo (fb_exchange_token),
// reiniciando el reloj de 60 días. Mientras el usuario visite la app al menos una
// vez cada 60 días, la conexión nunca muere.
// El frontend lo llama al iniciar sesión (ensureFreshTokens).

import { abrirConexion, cifrar } from './_cifrado.js';
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function getConnection(userId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads&select=access_token,token_expires_at`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const rows = await r.json();
  return await abrirConexion(rows?.[0] || null);
}

async function saveToken(userId, accessToken, expiresIn) {
  const expiresAt = new Date(Date.now() + (expiresIn || 5184000) * 1000).toISOString();
  await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads`,
    {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        access_token:     await cifrar(accessToken),
        token_expires_at: expiresAt,
        updated_at:       new Date().toISOString(),
      }),
    }
  );
  return expiresAt;
}


// ── Quién pregunta ──────────────────────────────────────────────────────────
//
// Esto faltaba, y era lo más grave del lote: el `userId` llegaba en la petición
// y el endpoint DEVOLVÍA el token de OAuth de esa persona, en claro y sin pedir
// sesión. Con ese token se opera contra la plataforma directamente, fuera de
// Acuarius. Ahora el usuario sale del token firmado y el de la petición se
// ignora. Repetido a mano porque esto es Node y no puede importar api/_*.js.
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

// La cuenta sobre la que se trabaja: la del dueño si quien pregunta es miembro.
async function usuarioAutenticado(req) {
  const payload = await verificarFirma((req.headers.authorization || '').replace('Bearer ', ''));
  if (!payload?.sub) return null;
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(payload.sub)}` +
      `&status=eq.active&select=owner_user_id&limit=1`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    if (!r.ok) return null;
    return (await r.json())?.[0]?.owner_user_id || payload.sub;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // El usuario sale del TOKEN FIRMADO; el de la petición se ignora.
  const userId = await usuarioAutenticado(req);
  if (!userId) return res.status(401).json({ error: 'No autorizado' });
  if (!SUPABASE_URL) return res.status(500).json({ error: 'Supabase no configurado' });

  try {
    const conn = await getConnection(userId);
    if (!conn || !conn.access_token) {
      return res.status(200).json({ error: 'Cuenta de Meta no conectada.', needsReconnect: true });
    }

    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    const remaining = expiresAt - Date.now();

    // Ya expiró — el exchange requiere un token vigente: reconexión inevitable
    if (expiresAt && remaining <= 0) {
      return res.status(200).json({ error: 'Token de Meta expirado. Reconecta tu cuenta.', needsReconnect: true });
    }

    // Le quedan más de 45 días — no hace falta renovar todavía
    if (remaining > 45 * 24 * 60 * 60 * 1000) {
      return res.status(200).json({ access_token: conn.access_token, expires_at: conn.token_expires_at, refreshed: false });
    }

    // Vigente pero con menos de 45 días — re-exchange para reiniciar los 60 días
    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      // Sin credenciales de app no se puede renovar — devolver el actual mientras viva
      return res.status(200).json({ access_token: conn.access_token, expires_at: conn.token_expires_at, refreshed: false });
    }

    const exRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type:        'fb_exchange_token',
        client_id:         appId,
        client_secret:     appSecret,
        fb_exchange_token: conn.access_token,
      })
    );
    const exData = await exRes.json();

    if (exData.error || !exData.access_token) {
      console.error('Meta re-exchange error:', exData.error);
      // El token actual sigue vigente — devolverlo; se reintentará en la próxima visita
      return res.status(200).json({ access_token: conn.access_token, expires_at: conn.token_expires_at, refreshed: false });
    }

    const newExpiresAt = await saveToken(userId, exData.access_token, exData.expires_in || 5184000);
    console.log('Meta token renewed for userId:', userId);
    return res.status(200).json({ access_token: exData.access_token, expires_at: newExpiresAt, refreshed: true });
  } catch (err) {
    console.error('refresh-meta-token error:', err);
    return res.status(500).json({ error: 'Error renovando token de Meta' });
  }
}
