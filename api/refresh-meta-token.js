// api/refresh-meta-token.js
// Renueva el long-lived token de Meta ANTES de que expire (duran 60 días).
// Un long-lived token vigente puede intercambiarse por uno nuevo (fb_exchange_token),
// reiniciando el reloj de 60 días. Mientras el usuario visite la app al menos una
// vez cada 60 días, la conexión nunca muere.
// El frontend lo llama al iniciar sesión (ensureFreshTokens).

import { abrirConexion, cifrar } from './_cifrado.js';
// La sesión se verifica con el módulo común, que lee las cabeceras de las
// dos formas: `Headers` en edge y objeto plano en Node.
import { verificarSesion, anotarSesion } from './_sesion.js';
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


// La cuenta sobre la que se trabaja: la del dueño si quien pregunta es miembro.
async function usuarioAutenticado(req) {
  const sesion = await verificarSesion(req);
  // Este envoltorio devuelve `null` y responde quien lo llama, así que el
  // motivo se anota aquí o se pierde.
  if (!sesion.id) { await anotarSesion(sesion, 'refresh-meta-token'); return null; }
  const payload = sesion.datos;
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

// Renueva el token de Meta EN EL SERVIDOR. Ya no lo devuelve: el navegador no
// lo necesita —api/meta-ads.js usa el guardado— y tenerlo allí era dejarlo en
// localStorage al alcance de cualquier script de la página.
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
      return res.status(200).json({ ok: true, expires_at: conn.token_expires_at, refreshed: false });
    }

    // Vigente pero con menos de 45 días — re-exchange para reiniciar los 60 días
    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      // Sin credenciales de app no se puede renovar — devolver el actual mientras viva
      return res.status(200).json({ ok: true, expires_at: conn.token_expires_at, refreshed: false });
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
      return res.status(200).json({ ok: true, expires_at: conn.token_expires_at, refreshed: false });
    }

    const newExpiresAt = await saveToken(userId, exData.access_token, exData.expires_in || 5184000);
    console.log('Meta token renewed for userId:', userId);
    return res.status(200).json({ ok: true, expires_at: newExpiresAt, refreshed: true });
  } catch (err) {
    console.error('refresh-meta-token error:', err);
    return res.status(500).json({ error: 'Error renovando token de Meta' });
  }
}
