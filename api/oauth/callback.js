// api/oauth/callback.js
// Recibe el código de Google, obtiene tokens y los guarda en Supabase

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveGoogleConnection(userId, tokens, userInfo) {
  if (!userId || !SUPABASE_URL) return;
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/platform_connections`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id:          userId,
      platform:         'google_ads',
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token || null,
      token_expires_at: expiresAt,
      account_name:     userInfo.email || '',
      updated_at:       new Date().toISOString(),
    }),
  });
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
      // Guardar en Supabase — el token no viaja por la URL
      await saveGoogleConnection(userId, tokens, userInfo);
      return res.redirect(
        `https://app.acuarius.app/?ads_connected=true&platform=google_ads&ads_email=${encodeURIComponent(userInfo.email || '')}`
      );
    }

    // Fallback sin userId: enviar token en URL (backward compat para usuarios sin Clerk)
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
