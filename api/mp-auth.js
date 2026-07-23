// api/mp-auth.js
// Inicia el OAuth de MercadoPago: cada usuario conecta SU cuenta de MP y los
// cobros de propuestas van directo a él (Acuarius nunca toca el dinero).
// La conexión se guarda en platform_connections como 'mercadopago' —
// misma arquitectura que Google Ads / Google Calendar.

export default function handler(req, res) {
  const clientId = process.env.MP_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'MP_CLIENT_ID no configurado' });

  const userId = req.query.userId || '';
  const state = JSON.stringify({ nonce: 'mp_connect', userId });

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    platform_id:   'mp',
    redirect_uri:  'https://app.acuarius.app/api/oauth/mp-callback',
    state,
  });

  res.redirect(`https://auth.mercadopago.com/authorization?${params}`);
}
