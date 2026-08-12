// api/meta-auth.js
// Inicia el flujo OAuth 2.0 con Meta (Facebook)
// Acepta ?userId= para asociar el token al usuario en Supabase

export default function handler(req, res) {
  const clientId = process.env.META_APP_ID;
  if (!clientId) return res.status(500).json({ error: 'META_APP_ID no configurado' });

  const userId = req.query.userId || '';
  const state  = JSON.stringify({ nonce: 'meta_ads_connect', userId });

  // La app usa "Inicio de sesión con Facebook para empresas": ahí los permisos
  // no viajan en 'scope', salen de una configuración creada en el panel. Sin
  // mandar su config_id, a cualquiera que no tenga un rol en la app Meta le
  // responde "función no disponible" — que es lo que veía el cliente.
  const configId = process.env.META_LOGIN_CONFIG_ID;
  if (configId) {
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://app.acuarius.app/api/meta-callback',
      config_id: configId,
      response_type: 'code',
      override_default_response_type: 'true',
      state,
    });
    return res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${p}`);
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  'https://app.acuarius.app/api/meta-callback',
    scope: [
      'ads_management',
      'ads_read',
      'business_management',
      'pages_read_engagement',
      'pages_show_list',
      // Sin este permiso falla la suscripción de la página a la app y los
      // mensajes de Messenger e Instagram nunca llegan al webhook.
      'pages_manage_metadata',
      'pages_messaging',
      'public_profile',
    ].join(','),
    response_type: 'code',
    state,
  });

  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
}
