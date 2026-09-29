// api/linkedin-auth.js
// Inicia el flujo OAuth 2.0 con LinkedIn.
//
// SOLO con enlace firmado (?c=), que da api/gcal-enlace.js?para=linkedin según
// la sesión. Antes se fiaba de un ?userId= de la URL, y con él cualquiera podía
// hacer que el LinkedIn de otro quedara guardado en su cuenta. El callback
// vuelve a comprobar la firma.

import { abrirEnlaceCuenta } from './_enlace-calendario.js';

export default async function handler(req, res) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'LINKEDIN_CLIENT_ID no configurado' });

  const e = await abrirEnlaceCuenta(req.query.c, 'linkedin');
  if (!e || e.caducado) {
    return res.redirect('https://app.acuarius.app/?linkedin_error=' + (e?.caducado ? 'enlace_caducado' : 'enlace_invalido'));
  }
  const state = JSON.stringify({ nonce: 'linkedin_ads_connect', c: req.query.c });

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
