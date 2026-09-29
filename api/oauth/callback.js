// api/oauth/callback.js
// Recibe el código de Google, obtiene tokens y los guarda en Supabase

import { cifrar } from '../_cifrado.js';
import { abrirEnlaceCuenta } from '../_enlace-calendario.js';
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Guarda la conexión en Supabase. Retorna true si fue exitoso.
async function saveGoogleConnection(userId, tokens, userInfo) {
  if (!userId || !SUPABASE_URL) return false;
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  try {
    // on_conflict es OBLIGATORIO: sin él, el upsert resuelve contra la PK (id)
    // y el índice único (user_id, platform) hace fallar el insert en silencio
    const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      // IMPORTANTE: solo incluir refresh_token si Google lo devolvió.
      // Google solo devuelve refresh_token en la primera autorización.
      // Si se incluye null, sobreescribe el refresh_token válido existente.
      body: JSON.stringify({
        user_id:          userId,
        platform:         'google_ads',
        access_token:     await cifrar(tokens.access_token),
        ...(tokens.refresh_token ? { refresh_token: await cifrar(tokens.refresh_token) } : {}),
        token_expires_at: expiresAt,
        account_name:     userInfo.email || '',
        updated_at:       new Date().toISOString(),
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('saveGoogleConnection Supabase error:', r.status, errText.slice(0, 300));
    }
    return r.ok;
  } catch (e) {
    console.error('saveGoogleConnection error:', e.message);
    return false;
  }
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  // De quién es la conexión lo dice la FIRMA, nunca un userId del state: el
  // state viaja por el navegador y se puede cambiar entre Google y nosotros.
  let firmado = '';
  try { firmado = JSON.parse(state || '{}').c || ''; } catch {}
  const firma = await abrirEnlaceCuenta(firmado, 'google');
  if (!firma || firma.caducado) {
    return res.redirect('https://app.acuarius.app/?ads_error=' + (firma?.caducado ? 'enlace_caducado' : 'enlace_invalido'));
  }
  const userId = firma.userId;

  if (error) return res.redirect('https://app.acuarius.app/?ads_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  'https://app.acuarius.app/api/oauth/callback',
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.redirect('https://app.acuarius.app/?ads_error=token_failed');

    const userRes  = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userRes.json().catch(() => ({}));

    // El token se queda en el servidor. Antes volvía en la URL —incluido el
    // refresh_token, que no caduca— y acababa en el historial del navegador,
    // en los registros de Vercel y en sessionStorage. Si no se guarda, se dice:
    // antes el navegador tiraba del token de la URL y la conexión «funcionaba»
    // hasta la siguiente sesión.
    const guardado = await saveGoogleConnection(userId, tokens, userInfo);
    if (!guardado) return res.redirect('https://app.acuarius.app/?ads_error=save_failed');

    return res.redirect(
      `https://app.acuarius.app/?ads_connected=true&platform=google_ads` +
      `&ads_email=${encodeURIComponent(userInfo.email || '')}`
    );
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.redirect('https://app.acuarius.app/?ads_error=server_error');
  }
}
