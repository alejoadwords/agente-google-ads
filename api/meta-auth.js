// api/meta-auth.js
// Inicia el flujo OAuth 2.0 con Meta (Facebook)

export default function handler(req, res) {
  const clientId = process.env.META_APP_ID;
  if (!clientId) return res.status(500).json({ error: 'META_APP_ID no configurado' });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  'https://app.acuarius.app/api/meta-callback',
    scope: [
      'ads_management',       // Crear/editar campañas, ad sets, anuncios
      'ads_read',             // Leer métricas y configuración
      'business_management',  // Gestionar Business Manager
      'pages_read_engagement',// Leer páginas de Facebook
      'instagram_basic',      // Acceso básico a Instagram
    ].join(','),
    response_type: 'code',
    state: 'meta_ads_connect',
  });

  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
}
