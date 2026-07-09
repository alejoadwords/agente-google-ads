// api/gcal-auth.js
// Inicia el OAuth de Google Calendar (scope de eventos, separado del de Ads).
// La conexión se guarda en platform_connections como 'google_calendar' con
// refresh_token — misma arquitectura estable que Google Ads.

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurado' });

  const userId = req.query.userId || '';
  const state = JSON.stringify({ nonce: 'gcal_connect', userId });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  'https://app.acuarius.app/api/oauth/gcal-callback',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
