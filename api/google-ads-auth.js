// api/google-ads-auth.js
// Inicia el flujo OAuth 2.0 para conectar Google Ads
// Acepta ?userId= para asociar el token al usuario en Supabase

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurado' });

  const userId = req.query.userId || '';
  const state  = JSON.stringify({ nonce: 'google_ads_connect', userId });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  'https://app.acuarius.app/api/oauth/callback',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
