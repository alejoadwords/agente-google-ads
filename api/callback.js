// api/oauth/callback.js
// Recibe el código de Google, obtiene access_token + refresh_token

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  // Si el usuario canceló
  if (error) {
    return res.redirect('https://app.acuarius.app/?ads_error=access_denied');
  }

  if (!code) {
    return res.status(400).json({ error: 'Código de autorización faltante' });
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  try {
    // Intercambiar código por tokens
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

    if (tokens.error) {
      console.error('Error obteniendo tokens:', tokens);
      return res.redirect('https://app.acuarius.app/?ads_error=token_failed');
    }

    // Obtener info del usuario de Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userRes.json();

    // Pasar tokens al frontend via query params (se guardan en sessionStorage)
    // En producción avanzada: guardar en DB asociado al userId de Clerk
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
