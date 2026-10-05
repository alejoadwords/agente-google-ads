// api/google-ads-auth.js
// Inicia el flujo OAuth 2.0 para conectar Google Ads.
//
// SOLO con enlace firmado (?c=), que da api/gcal-enlace.js?para=google según la
// sesión. Antes se fiaba de un ?userId= de la URL: bastaba mandarle a alguien
// un enlace con el userId propio para que, al conectar SU Google Ads, el token
// —que gasta dinero en campañas— quedara en la cuenta de quien mandó el
// enlace. El callback vuelve a comprobar la firma.

import { abrirEnlaceCuenta } from './_enlace-calendario.js';

export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurado' });

  const e = await abrirEnlaceCuenta(req.query.c, 'google');
  if (!e || e.caducado) {
    return res.redirect('https://app.acuarius.app/?ads_error=' + (e?.caducado ? 'enlace_caducado' : 'enlace_invalido'));
  }
  // ?audiencias=1: además pide el permiso de la Data Manager API, la única vía
  // para subir audiencias de clientes (Customer Match) desde abril de 2026
  // (api/_audiencias.js). `include_granted_scopes` conserva el de Google Ads.
  const audiencias = req.query.audiencias === '1';
  const state = JSON.stringify({ nonce: 'google_ads_connect', c: req.query.c, audiencias });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  'https://app.acuarius.app/api/oauth/callback',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/userinfo.email',
      ...(audiencias ? ['https://www.googleapis.com/auth/datamanager'] : []),
    ].join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
