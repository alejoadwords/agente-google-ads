// api/social-connect.js
// Inicia OAuth para publicación orgánica en redes sociales (Instagram + Facebook Pages)
// ?network=instagram|facebook&t=<ticket firmado por /api/social-connections>
//
// El `userId` ya NO viaja en la URL. Venía del navegador y volvía en el
// `state`, así que cambiándolo se le podía colgar una cuenta de Facebook a
// otra persona. Ahora el navegador pide primero un ticket con su sesión ya
// verificada y aquí solo se acepta ese ticket.

import { abrirTicket } from './_social-cuentas.js';

export default async function handler(req, res) {
  const { network = 'instagram', t = '' } = req.query;

  const appId = process.env.META_APP_ID;
  if (!appId) return res.status(500).json({ error: 'META_APP_ID no configurado' });

  const ticket = await abrirTicket(t);
  if (!ticket) {
    // Se falla a la vista: si esto se quedara callado, el usuario acabaría en
    // Facebook, autorizaría y volvería sin que se guardara nada.
    return res.redirect('https://app.acuarius.app/?social_error=sesion');
  }

  // El ticket se reenvía tal cual: ya lleva quién es y para qué cliente, y va
  // firmado, así que Facebook puede devolvérnoslo sin que nadie lo toque.
  const state = JSON.stringify({ network, t });

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
