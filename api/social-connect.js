// api/social-connect.js
// Inicia OAuth para publicación orgánica en redes sociales (Instagram + Facebook Pages)
// ?network=instagram|facebook&clientId=xxx&userId=xxx

export default function handler(req, res) {
  const { network = 'instagram', clientId = '', userId = '' } = req.query;

  const appId = process.env.META_APP_ID;
  if (!appId) return res.status(500).json({ error: 'META_APP_ID no configurado' });

  const state = JSON.stringify({
    network,
    clientId,
    userId,
    nonce: 'social_pub_' + Date.now(),
  });

  // Scopes para publicación orgánica en Instagram Business + Facebook Pages
  const scopes = [
    'public_profile',
    'pages_show_list',            // listar páginas del usuario
    'pages_read_engagement',      // leer info de la página
    'pages_manage_posts',         // publicar en página de Facebook
    'instagram_basic',            // info básica cuenta IG
    'instagram_content_publish',  // publicar en Instagram Business
  ].join(',');

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  'https://app.acuarius.app/api/social-callback',
    scope:         scopes,
    response_type: 'code',
    state,
  });

  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
}
