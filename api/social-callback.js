// api/social-callback.js
// Callback OAuth para publicación social
// Obtiene token long-lived, páginas FB y sus cuentas IG vinculadas

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
  const { network = 'instagram', clientId = '', userId = '' } = parsedState;

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
        client_id:    appId,
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
        grant_type:      'fb_exchange_token',
        client_id:       appId,
        client_secret:   appSecret,
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
      pageToken: p.access_token,   // token de página (permanente si la página es tuya)
      igUserId:  p.instagram_business_account?.id || null,
    }));

    // 4. Para cada cuenta IG, obtener el nombre de usuario
    const igIds = accounts.filter(a => a.igUserId).map(a => a.igUserId);
    if (igIds.length > 0) {
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
    }

    // 5. Redirigir al app con los datos (JSON en URL — cuidado con el tamaño)
    // Limitamos a 5 cuentas para no exceder límites de URL
    const accountsSliced = accounts.slice(0, 5).map(a => ({
      pageId:     a.pageId,
      pageName:   a.pageName,
      pageToken:  a.pageToken,
      igUserId:   a.igUserId,
      igUsername: a.igUsername || null,
    }));

    const params = new URLSearchParams({
      social_connected: 'true',
      social_network:   network,
      social_client:    clientId,
      social_user:      userId,
      social_accounts:  JSON.stringify(accountsSliced),
    });

    return res.redirect(`${REDIRECT_BASE}/?${params}`);

  } catch (err) {
    console.error('social-callback error:', err);
    return res.redirect(`${REDIRECT_BASE}/?social_error=server_error`);
  }
}
