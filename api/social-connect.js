// api/social-connect.js
// Inicia OAuth para publicación orgánica en redes sociales (Instagram + Facebook Pages)
// ?network=instagram|facebook&t=<ticket firmado por /api/social-connections>
//
// El `userId` ya NO viaja en la URL. Venía del navegador y volvía en el
// `state`, así que cambiándolo se le podía colgar una cuenta de Facebook a
// otra persona. Ahora el navegador pide primero un ticket con su sesión ya
// verificada y aquí solo se acepta ese ticket.
//
// Una sola conexión sirve para las dos redes: la cuenta de Instagram que se
// publica por API cuelga siempre de una página de Facebook, así que el
// callback guarda las páginas (Facebook) y sus Instagram de una vez.

import { abrirTicket, PERMISOS_PUBLICAR } from './_social-cuentas.js';

export const config = { runtime: 'edge' };

const APP = 'https://app.acuarius.app';

export default async function handler(req) {
  const url = new URL(req.url);
  const network = url.searchParams.get('network') === 'facebook' ? 'facebook' : 'instagram';

  const appId = process.env.META_APP_ID;
  if (!appId) return Response.redirect(`${APP}/?social_error=config`, 302);

  const ticket = await abrirTicket(url.searchParams.get('t') || '');
  if (!ticket) {
    // Se falla a la vista: si esto se quedara callado, el usuario acabaría en
    // Facebook, autorizaría y volvería sin que se guardara nada.
    return Response.redirect(`${APP}/?social_error=sesion`, 302);
  }

  // El ticket se reenvía tal cual: ya lleva quién es y para qué cliente, y va
  // firmado, así que Facebook puede devolvérnoslo sin que nadie lo toque.
  const state = JSON.stringify({ network, t: url.searchParams.get('t') });

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  `${APP}/api/social-callback`,
    response_type: 'code',
    // Vuelve a pedir lo que la persona desmarcó la vez anterior. Sin esto,
    // reconectar «para arreglar el permiso» no volvía a mostrarlo nunca.
    auth_type:     'rerequest',
    state,
  });

  // La app es de tipo negocio («Inicio de sesión con Facebook para empresas»):
  // a quien no tiene rol en la app, Meta solo le muestra el diálogo si va el
  // config_id de una configuración creada en el panel. Es otra configuración
  // que la de Meta Ads (META_LOGIN_CONFIG_ID): esa no pide permisos de publicar.
  const configId = process.env.META_SOCIAL_CONFIG_ID;
  if (configId) {
    params.set('config_id', configId);
    params.set('override_default_response_type', 'true');
  } else {
    // Sin configuración solo funciona para quien tenga rol en la app (pruebas).
    params.set('scope', ['public_profile', 'business_management', ...PERMISOS_PUBLICAR].join(','));
  }

  return Response.redirect(`https://www.facebook.com/v23.0/dialog/oauth?${params}`, 302);
}
