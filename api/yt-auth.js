// api/yt-auth.js
// Inicia el OAuth de YouTube para subir los videos de la Academia desde el
// script de producción. Scopes mínimos: subir, gestionar playlists y subtítulos.
// La conexión se guarda en platform_connections como 'youtube', igual que
// Google Calendar y Google Ads.

//
// Solo con enlace firmado (?c=). Un ?userId= suelto dejaba conectar un canal de
// YouTube ajeno a cualquier cuenta. El enlace lo saca, con la clave del
// servidor, `node tools/enlace-youtube.mjs <userId>`.

import { abrirEnlaceCuenta } from './_enlace-calendario.js';

export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurado' });

  const e = await abrirEnlaceCuenta(req.query.c, 'youtube');
  if (!e || e.caducado) {
    return res.status(e?.caducado ? 410 : 400).json({
      error: (e?.caducado ? 'Este enlace ya caducó.' : 'Hace falta un enlace firmado.') +
        ' Sácalo con: node tools/enlace-youtube.mjs <userId>',
    });
  }
  const state = JSON.stringify({ nonce: 'yt_connect', c: req.query.c });

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
