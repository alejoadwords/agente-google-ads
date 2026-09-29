// api/gcal-auth.js
// Inicia el OAuth de Google Calendar (scope de eventos, separado del de Ads).
// La conexión se guarda en platform_connections como 'google_calendar' con
// refresh_token — misma arquitectura estable que Google Ads.
//
// Con ?r=<enlace firmado> conecta el calendario de UNA persona de las reservas
// (ver api/_enlace-calendario.js). Ese camino no se fía de nada de la URL salvo
// de la firma, y se comprueba aquí ANTES de mandar a Google: quien abre un
// enlace caducado tiene que enterarse ahora, no después de dar permisos.

import { abrirEnlaceCalendario } from './_enlace-calendario.js';
import { paginaCalendario } from './_pagina-calendario.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurado' });

  let state;
  const enlace = req.query.r;
  if (enlace) {
    const e = await abrirEnlaceCalendario(enlace);
    if (!e || e.caducado) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(e?.caducado ? 410 : 400).send(paginaCalendario({
        ok: false,
        titulo: e?.caducado ? 'Este enlace ya caducó' : 'Este enlace no es válido',
        texto: 'Pídele a quien te lo mandó que saque uno nuevo desde Reservas → Quién atiende. Dura una semana.',
      }));
    }
    state = JSON.stringify({ nonce: 'gcal_recurso', r: enlace });
  } else {
    const userId = req.query.userId || '';
    state = JSON.stringify({ nonce: 'gcal_connect', userId });
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  'https://app.acuarius.app/api/oauth/gcal-callback',
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
