// api/social-callback.js
// Callback OAuth para publicación social
// Obtiene token long-lived, páginas FB y sus cuentas IG vinculadas
//
// Los tokens de página se guardan CIFRADOS en `social_connections` y no salen
// de ahí. Antes esta función devolvía una página que los metía en el
// `sessionStorage` del navegador: quedaban a la vista de cualquier script, se
// perdían al cerrar la pestaña y el equipo no los compartía.

import { abrirTicket, guardarCuentas } from './_social-cuentas.js';

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  const REDIRECT_BASE = 'https://app.acuarius.app';

  if (error) {
    return res.redirect(`${REDIRECT_BASE}/?social_error=access_denied`);
  }
  if (!code) {
    return res.status(400).json({ error: 'Código de autorización faltante' });
  }

  let parsedState = {};
  try { parsedState = JSON.parse(state || '{}'); } catch {}
  const { network = 'instagram', t = '' } = parsedState;

  // El ticket es lo único que dice de quién es esta conexión, y lo firmamos
  // nosotros. Sin él no se guarda nada: antes bastaba con editar la URL.
  const ticket = await abrirTicket(t);
  if (!ticket) {
    return res.redirect(`${REDIRECT_BASE}/?social_error=sesion`);
  }
  const { userId, clientId } = ticket;

  const appId     = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    return res.redirect(`${REDIRECT_BASE}/?social_error=config`);
  }

  try {
    // 1. Short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        client_id:     appId,
        client_secret: appSecret,
        redirect_uri:  `${REDIRECT_BASE}/api/social-callback`,
        code,
      })
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('social-callback token error:', tokenData.error);
      return res.redirect(`${REDIRECT_BASE}/?social_error=token_failed`);
    }

    // 2. Long-lived token (60 días)
    const longRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type:        'fb_exchange_token',
        client_id:         appId,
        client_secret:     appSecret,
        fb_exchange_token: tokenData.access_token,
      })
    );
    const longData = await longRes.json();
    const userToken = longData.access_token || tokenData.access_token;

    // 3. Obtener páginas de Facebook con sus cuentas IG vinculadas
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts` +
      `?fields=id,name,access_token,instagram_business_account` +
      `&access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    // Construir lista de cuentas (página FB + IG si existe)
    const accounts = pages.map(p => ({
      pageId:    p.id,
      pageName:  p.name,
      pageToken: p.access_token,
      igUserId:  p.instagram_business_account?.id || null,
    }));

    // 4. Para cada cuenta IG, obtener el nombre de usuario
    for (const account of accounts) {
      if (!account.igUserId) continue;
      try {
        const igRes = await fetch(
          `https://graph.facebook.com/v19.0/${account.igUserId}` +
          `?fields=username,name&access_token=${account.pageToken}`
        );
        const igData = await igRes.json();
        if (igData.username) account.igUsername = igData.username;
      } catch {}
    }

    // 5. Limitar a 5 cuentas
    const accountsFinal = accounts.slice(0, 5).map(a => ({
      pageId:     a.pageId,
      pageName:   a.pageName,
      pageToken:  a.pageToken,
      igUserId:   a.igUserId   || null,
      igUsername: a.igUsername || null,
    }));

    // 6. Guardar en la cuenta, con el token cifrado
    if (!accountsFinal.length) {
      return res.redirect(`${REDIRECT_BASE}/?social_error=sin_paginas`);
    }
    await guardarCuentas(userId, clientId, network, accountsFinal);

    return res.redirect(
      `${REDIRECT_BASE}/?social_connected=true` +
      `&social_network=${encodeURIComponent(network)}` +
      `&social_client=${encodeURIComponent(clientId)}`
    );

  } catch (err) {
    console.error('social-callback error:', err);
    return res.redirect(`${REDIRECT_BASE}/?social_error=server_error`);
  }
}
