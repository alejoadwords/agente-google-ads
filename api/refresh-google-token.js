// api/refresh-google-token.js
// Refresca el access_token de Google Ads usando el refresh_token almacenado en Supabase.
// El frontend lo llama al iniciar sesión para garantizar un token fresco sin pedir
// al usuario que se reconecte.

import { abrirConexion, cifrar } from './_cifrado.js';
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function getConnection(userId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_ads&select=access_token,refresh_token,token_expires_at`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const rows = await r.json();
  return await abrirConexion(rows?.[0] || null);
}

async function doRefresh(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  return r.json();
}

async function saveToken(userId, accessToken, expiresIn) {
  const expiresAt = new Date(Date.now() + (expiresIn || 3600) * 1000).toISOString();
  await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_ads`,
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // El usuario sale del TOKEN FIRMADO; el de la petición se ignora.
  const userId = await usuarioAutenticado(req);
  if (!userId) return res.status(401).json({ error: 'No autorizado' });
  if (!SUPABASE_URL) return res.status(500).json({ error: 'Supabase no configurado' });

  try {
    const conn = await getConnection(userId);
    if (!conn) return res.status(404).json({ error: 'Cuenta de Google Ads no conectada. Ve a Configuración → Conexiones.' });

    // Si el token aún es válido (tiene más de 5 min de vida), devolverlo directo
    if (conn.token_expires_at) {
      const expiresAt = new Date(conn.token_expires_at).getTime();
      const now = Date.now();
      const remaining = expiresAt - now;
      if (remaining > 5 * 60 * 1000) {
        // Token todavía válido — devolver el actual sin refrescar
        return res.status(200).json({
          access_token: conn.access_token,
          expires_at:   conn.token_expires_at,
          refreshed:    false,
        });
      }
    }

    // Token expirado o próximo a expirar — refrescar
    if (!conn.refresh_token) {
      return res.status(200).json({
        error: 'No hay refresh_token guardado. Reconecta tu cuenta de Google Ads.',
        needsReconnect: true,
      });
    }

    const refreshed = await doRefresh(conn.refresh_token);

    if (refreshed.error) {
      console.error('Google refresh error:', refreshed.error, refreshed.error_description);
      return res.status(200).json({
        error: `Google rechazó el refresh: ${refreshed.error_description || refreshed.error}. Reconecta tu cuenta.`,
        needsReconnect: true,
        googleError: refreshed.error,
      });
    }

    if (!refreshed.access_token) {
      return res.status(200).json({
        error: 'No se recibió access_token. Reconecta tu cuenta de Google Ads.',
        needsReconnect: true,
      });
    }

    const expiresAt = await saveToken(userId, refreshed.access_token, refreshed.expires_in || 3600);

    console.log('Google token refreshed for userId:', userId);
    return res.status(200).json({
      access_token: refreshed.access_token,
      expires_at:   expiresAt,
      refreshed:    true,
    });

  } catch (err) {
    console.error('refresh-google-token error:', err.message);
    return res.status(500).json({ error: `Error interno: ${err.message}` });
  }
}
