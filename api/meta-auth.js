// api/meta-auth.js
// Inicia el flujo OAuth 2.0 con Meta (Facebook)
// Acepta ?userId= para asociar el token al usuario en Supabase

export default function handler(req, res) {
  const clientId = process.env.META_APP_ID;
  if (!clientId) return res.status(500).json({ error: 'META_APP_ID no configurado' });

  const userId = req.query.userId || '';
  const state  = JSON.stringify({ nonce: 'meta_ads_connect', userId });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  'https://app.acuarius.app/api/meta-callback',
    scope: [
      'ads_management',
      'ads_read',
      'business_management',
      'pages_read_engagement',
      'pages_show_list',
      'public_profile',
    ].join(','),
    response_type: 'code',
    state,
  });

  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
}
