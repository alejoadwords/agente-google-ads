// api/linkedin-auth.js
// Inicia el flujo OAuth 2.0 con LinkedIn
// Acepta ?userId= para asociar el token al usuario en Supabase

export default function handler(req, res) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'LINKEDIN_CLIENT_ID no configurado' });

  const userId = req.query.userId || '';
  const state  = JSON.stringify({ nonce: 'linkedin_ads_connect', userId });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  'https://app.acuarius.app/api/linkedin-callback',
    state,
    scope: [
      'openid',
      'profile',
      'email',
    ].join(' '),
  });

  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
}
