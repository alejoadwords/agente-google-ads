import { cifrar } from './_cifrado.js';
import { abrirEnlaceCuenta } from './_enlace-calendario.js';
// api/meta-callback.js
// Recibe el código de Meta, obtiene long-lived token y lo guarda en Supabase

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveMetaConnection(userId, token, expiresIn, userInfo) {
  if (!userId || !SUPABASE_URL) return false;
  const expiresAt = new Date(Date.now() + (expiresIn || 5184000) * 1000).toISOString();
  const payload = {
    user_id:          userId,
    platform:         'meta_ads',
    access_token:     await cifrar(token),
    refresh_token:    null,
    token_expires_at: expiresAt,
    account_name:     userInfo.name  || userInfo.email || '',
    extra_data:       { meta_user_id: userInfo.id, meta_email: userInfo.email || '' },
    updated_at:       new Date().toISOString(),
  };

  // Upsert: POST con on_conflict para manejar fila existente
  const saveRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`,
    {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!saveRes.ok) {
    const errText = await saveRes.text().catch(() => '');
    console.error('saveMetaConnection error:', saveRes.status, errText.slice(0, 300));
  }
  return saveRes.ok;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  // De quién es la conexión lo dice la FIRMA, nunca un userId del state: el
  // state viaja por el navegador y se puede cambiar entre Meta y nosotros.
  let firmado = '';
  try { firmado = JSON.parse(state || '{}').c || ''; } catch {}
  const firma = await abrirEnlaceCuenta(firmado, 'meta');
  if (!firma || firma.caducado) {
    return res.redirect('https://app.acuarius.app/?meta_error=' + (firma?.caducado ? 'enlace_caducado' : 'enlace_invalido'));
  }
  const userId = firma.userId;

  if (error) return res.redirect('https://app.acuarius.app/?meta_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  try {
    // 1. Short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: 'https://app.acuarius.app/api/meta-callback', code })
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.redirect('https://app.acuarius.app/?meta_error=token_failed');

    // 2. Long-lived token (60 días)
    const longRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: tokenData.access_token })
    );
    const longData = await longRes.json();

    // 3. Info del usuario
    const userRes  = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=${longData.access_token}`);
    const userInfo = await userRes.json();

    if (longData.error || !longData.access_token) {
      return res.redirect('https://app.acuarius.app/?meta_error=token_failed');
    }
    // El token se queda en el servidor. Antes, «por si fallaba Supabase», viajaba
    // en la URL de vuelta (?meta_token=…) y quedaba en el historial del navegador
    // y en los registros. Si no se puede guardar, se dice: fallar a la vista.
    const guardado = await saveMetaConnection(userId, longData.access_token, longData.expires_in, userInfo);
    if (!guardado) return res.redirect('https://app.acuarius.app/?meta_error=save_failed');

    const params = new URLSearchParams({
      meta_connected: 'true',
      meta_name:      userInfo.name  || '',
      platform:       'meta_ads',
    });
    return res.redirect(`https://app.acuarius.app/?${params}`);

  } catch (err) {
    console.error('Meta callback error:', err);
    return res.redirect('https://app.acuarius.app/?meta_error=server_error');
  }
}
