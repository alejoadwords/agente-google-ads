// api/social-callback.js
// Callback OAuth para publicación social
// Obtiene token long-lived, páginas FB y sus cuentas IG vinculadas
//
// Los tokens de página se guardan CIFRADOS en `social_connections` y no salen
// de ahí. Antes esta función devolvía una página que los metía en el
// `sessionStorage` del navegador: quedaban a la vista de cualquier script, se
// perdían al cerrar la pestaña y el equipo no los compartía.
//
// Se guardan las DOS redes de una vez, sea cual sea el botón que se pulsó: las
// páginas como Facebook y, de las que tengan un Instagram profesional
// vinculado, ese Instagram. Antes se guardaba todo bajo la red pulsada, así que
// «Instagram» podía quedar apuntando a una página sin Instagram y publicar
// fallaba con «igUserId requerido».

import { abrirTicket, guardarCuentas, GRAPH, PERMISOS_PUBLICAR } from './_social-cuentas.js';

export const config = { runtime: 'edge' };

const APP = 'https://app.acuarius.app';
const ir = (q) => Response.redirect(`${APP}/?${q}`, 302);

// Hasta diez páginas: una agencia pequeña administra varias, y el selector del
// modal de publicar las ofrece todas.
const MAX_PAGINAS = 10;

export default async function handler(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error')) return ir('social_error=access_denied');
  if (!code) return ir('social_error=sin_codigo');

  let parsedState = {};
  try { parsedState = JSON.parse(url.searchParams.get('state') || '{}'); } catch {}

  // El ticket es lo único que dice de quién es esta conexión, y lo firmamos
  // nosotros. Sin él no se guarda nada: antes bastaba con editar la URL.
  const ticket = await abrirTicket(parsedState.t || '');
  if (!ticket) return ir('social_error=sesion');
  const { userId, clientId } = ticket;

  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return ir('social_error=config');

  try {
    // 1. Token corto
    const tokenData = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId, client_secret: appSecret,
      redirect_uri: `${APP}/api/social-callback`, code,
    })).then(r => r.json());
    if (tokenData.error || !tokenData.access_token) {
      console.error('[social-callback] token:', tokenData.error);
      return ir('social_error=token_failed');
    }

    // 2. Token largo. Los tokens de página que salen de uno largo no caducan;
    // los que salen de uno corto mueren en una hora.
    const longData = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret,
      fb_exchange_token: tokenData.access_token,
    })).then(r => r.json());
    const userToken = longData.access_token || tokenData.access_token;

    // 3. ¿Qué permisos dio de verdad? En el diálogo se pueden desmarcar.
    const perms = await fetch(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(userToken)}`)
      .then(r => r.json()).catch(() => ({}));
    const dados = new Set((perms.data || []).filter(p => p.status === 'granted').map(p => p.permission));
    const faltan = PERMISOS_PUBLICAR.filter(p => !dados.has(p));

    // 4. Páginas con su Instagram vinculado, en una sola llamada
    const pagesData = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,tasks,instagram_business_account{id,username}` +
      `&limit=100&access_token=${encodeURIComponent(userToken)}`
    ).then(r => r.json());
    if (pagesData.error) {
      console.error('[social-callback] páginas:', pagesData.error);
      return ir('social_error=paginas');
    }
    // Solo las páginas donde la persona puede crear contenido: en las demás
    // Meta rechaza cualquier publicación y solo serían una opción que falla.
    const paginas = (pagesData.data || [])
      .filter(p => p.access_token && (!Array.isArray(p.tasks) || p.tasks.includes('CREATE_CONTENT')))
      .slice(0, MAX_PAGINAS);
    if (!paginas.length) return ir('social_error=sin_paginas');

    const facebook = paginas.map(p => ({ pageId: p.id, pageName: p.name, pageToken: p.access_token }));
    const instagram = paginas
      .filter(p => p.instagram_business_account?.id)
      .map(p => ({
        pageId: p.id, pageName: p.name, pageToken: p.access_token,
        igUserId: p.instagram_business_account.id,
        igUsername: p.instagram_business_account.username || null,
      }));

    await guardarCuentas(userId, clientId, 'facebook', facebook);
    if (instagram.length) await guardarCuentas(userId, clientId, 'instagram', instagram);

    return ir(new URLSearchParams({
      social_connected: 'true',
      social_network: parsedState.network || 'instagram',
      social_client: clientId,
      fb: String(facebook.length), ig: String(instagram.length),
      ...(faltan.length ? { faltan: faltan.join(',') } : {}),
    }).toString());
  } catch (err) {
    console.error('[social-callback]', err);
    return ir('social_error=server_error');
  }
}
