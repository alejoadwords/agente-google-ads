// api/oauth/callback.js
// Recibe el código de Google, obtiene tokens y los guarda en Supabase

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Guarda la conexión en Supabase. Retorna true si fue exitoso.
async function saveGoogleConnection(userId, tokens, userInfo) {
  if (!userId || !SUPABASE_URL) return false;
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections`, {
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
        access_token:     tokens.access_token,
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        token_expires_at: expiresAt,
        account_name:     userInfo.email || '',
        updated_at:       new Date().toISOString(),
      }),
    });
    return r.ok;
  } catch (e) {
    console.error('saveGoogleConnection error:', e.message);
    return false;
  }
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) return res.redirect('https://app.acuarius.app/?ads_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  let userId = '';
  try { userId = JSON.parse(state || '{}').userId || ''; } catch {}

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
    const userInfo = await userRes.json();

    if (userId) {
      // Intentar guardar en Supabase
      await saveGoogleConnection(userId, tokens, userInfo);
      // Pasar el token en la URL también — el frontend lo guarda en sessionStorage
      // inmediatamente sin depender de la lectura de Supabase.
      // El token es de corta duración (1h) y la URL se limpia con replaceState.
      return res.redirect(
        `https://app.acuarius.app/?ads_connected=true&platform=google_ads` +
        `&ads_email=${encodeURIComponent(userInfo.email || '')}` +
        `&ads_token=${encodeURIComponent(tokens.access_token)}` +
        `&ads_refresh=${encodeURIComponent(tokens.refresh_token || '')}` +
        `&uid=${encodeURIComponent(userId)}`
      );
    }

    // Fallback sin userId
    const params = new URLSearchParams({
      ads_connected: 'true',
      ads_email:     userInfo.email || '',
      ads_token:     tokens.access_token,
      ads_refresh:   tokens.refresh_token || '',
    });
    return res.redirect(`https://app.acuarius.app/?${params}`);

  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.redirect('https://app.acuarius.app/?ads_error=server_error');
  }
}
