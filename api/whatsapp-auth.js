// api/whatsapp-auth.js
// Arranca la conexión de WhatsApp por REDIRECCIÓN, igual que la de Meta Ads.
//
// La vía del SDK de JavaScript abre una ventana emergente, y en Safari no se
// abría ni permitiendo las ventanas emergentes. Redirigiendo la página entera no
// hay ventana que bloquear: se va a Facebook y se vuelve.
//
// Quién conecta, a qué agente y a qué cliente viajan FIRMADOS en el state (lo
// firma api/gcal-enlace.js?para=whatsapp según la sesión). Antes iban sueltos
// en la URL y el servidor se los creía: cambiándolos se colgaba un número en la
// cuenta de otro.

import { abrirEnlaceWhatsapp } from './_enlace-calendario.js';

export default async function handler(req, res) {
  // 'appId' y no 'clientId': clientId aquí es el cliente de Acuarius, y usar el
  // mismo nombre para el App ID de Meta hacía que uno pisara al otro.
  const appId    = process.env.META_APP_ID;
  const configId = process.env.META_WA_CONFIG_ID;
  if (!appId) return res.status(500).json({ error: 'META_APP_ID no configurado' });
  if (!configId) return res.status(500).json({ error: 'META_WA_CONFIG_ID no configurado' });

  const e = await abrirEnlaceWhatsapp(req.query.c);
  if (!e || e.caducado) {
    return res.redirect('https://app.acuarius.app/?wa_error=' + encodeURIComponent(e?.caducado
      ? 'El enlace para conectar WhatsApp caducó. Vuelve a pulsar «Conectar».'
      : 'Ese enlace para conectar WhatsApp no es válido. Vuelve a pulsar «Conectar» desde la app.'));
  }
  const state = JSON.stringify({ nonce: 'whatsapp_connect', c: req.query.c });

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
