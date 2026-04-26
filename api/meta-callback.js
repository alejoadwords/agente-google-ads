// api/meta-callback.js
// Recibe el código de Meta, obtiene long-lived token y lo guarda en Supabase

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveMetaConnection(userId, token, expiresIn, userInfo) {
  if (!userId || !SUPABASE_URL) return;
  const expiresAt = new Date(Date.now() + (expiresIn || 5184000) * 1000).toISOString(); // default 60 días
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
      platform:         'meta_ads',
      access_token:     token,
      refresh_token:    null,
      token_expires_at: expiresAt,
      account_name:     userInfo.name  || userInfo.email || '',
      extra_data:       { meta_user_id: userInfo.id, meta_email: userInfo.email || '' },
      updated_at:       new Date().toISOString(),
    }),
  });
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) return res.redirect('https://app.acuarius.app/?meta_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  let userId = '';
  try { userId = JSON.parse(state || '{}').userId || ''; } catch {}

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

    if (userId) {
      await saveMetaConnection(userId, longData.access_token, longData.expires_in, userInfo);
      return res.redirect(
        `https://app.acuarius.app/?meta_connected=true&platform=meta_ads&meta_name=${encodeURIComponent(userInfo.name || '')}`
      );
    }

    // Fallback sin userId: enviar token en URL (backward compat)
    const params = new URLSearchParams({
      meta_connected: 'true',
      meta_token:     longData.access_token,
      meta_name:      userInfo.name  || '',
      meta_email:     userInfo.email || '',
      meta_user_id:   userInfo.id    || '',
    });
    return res.redirect(`https://app.acuarius.app/?${params}`);

  } catch (err) {
    console.error('Meta callback error:', err);
    return res.redirect('https://app.acuarius.app/?meta_error=server_error');
  }
}
