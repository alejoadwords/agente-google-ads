// api/meta-callback.js
// Recibe el código de Meta y obtiene el access token de larga duración

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) return res.redirect('https://app.acuarius.app/?meta_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  try {
    // 1. Intercambiar código por short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        client_id:     appId,
        client_secret: appSecret,
        redirect_uri:  'https://app.acuarius.app/api/meta-callback',
        code,
      })
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('Meta token error:', tokenData);
      return res.redirect('https://app.acuarius.app/?meta_error=token_failed');
    }

    // 2. Intercambiar por long-lived token (60 días)
    const longRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type:        'fb_exchange_token',
        client_id:         appId,
        client_secret:     appSecret,
        fb_exchange_token: tokenData.access_token,
      })
    );
    const longData = await longRes.json();

    // 3. Obtener info del usuario
    const userRes  = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=${longData.access_token}`
    );
    const userInfo = await userRes.json();

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
