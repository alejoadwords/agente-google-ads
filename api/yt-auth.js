// api/yt-auth.js
// Inicia el OAuth de YouTube para subir los videos de la Academia desde el
// script de producción. Scopes mínimos: subir, gestionar playlists y subtítulos.
// La conexión se guarda en platform_connections como 'youtube', igual que
// Google Calendar y Google Ads.

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurado' });

  const userId = req.query.userId || '';
  const state = JSON.stringify({ nonce: 'yt_connect', userId });

  const params = new URLSearchParams({
    client_id:     clientId,
    // Se reutiliza el redirect de Calendar porque es el que está registrado en
    // Google Cloud; el flujo se distingue por el nonce del state.
    redirect_uri:  'https://app.acuarius.app/api/oauth/gcal-callback',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',          // playlists
      'https://www.googleapis.com/auth/youtube.force-ssl', // subtítulos
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
