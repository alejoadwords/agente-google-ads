// api/whatsapp-auth.js
// Arranca la conexión de WhatsApp por REDIRECCIÓN, igual que la de Meta Ads.
//
// La vía del SDK de JavaScript abre una ventana emergente, y en Safari no se
// abría ni permitiendo las ventanas emergentes. Redirigiendo la página entera no
// hay ventana que bloquear: se va a Facebook y se vuelve.
//
// El usuario viaja en 'state' porque al volver no hay sesión de Clerk en la
// petición — es el mismo mecanismo que usa api/meta-auth.js.

export default function handler(req, res) {
  // 'appId' y no 'clientId': clientId aquí es el cliente de Acuarius, y usar el
  // mismo nombre para el App ID de Meta hacía que uno pisara al otro.
  const appId    = process.env.META_APP_ID;
  const configId = process.env.META_WA_CONFIG_ID;
  if (!appId) return res.status(500).json({ error: 'META_APP_ID no configurado' });
  if (!configId) return res.status(500).json({ error: 'META_WA_CONFIG_ID no configurado' });

  const userId   = req.query.userId   || '';
  const agentId  = req.query.agentId  || '';
  const clientId = req.query.clientId || '';
  if (!userId) return res.status(400).json({ error: 'Falta userId' });

  const state = JSON.stringify({ nonce: 'whatsapp_connect', userId, agentId, clientId });

  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: 'https://app.acuarius.app/api/whatsapp-callback',
    config_id: configId,
    response_type: 'code',
    override_default_response_type: 'true',
    state,
  });

  res.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${p}`);
}
