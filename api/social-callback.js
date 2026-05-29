// api/social-callback.js
// Callback OAuth para publicación social
// Obtiene token long-lived, páginas FB y sus cuentas IG vinculadas
// Devuelve una página HTML intermedia que guarda los datos en sessionStorage
// y redirige al app — evita pasar tokens largos en la URL

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

    // 6. Devolver página HTML intermedia que:
    //    - Guarda los datos en sessionStorage (evita URL larga)
    //    - Redirige al app con solo los flags necesarios
    const payload = JSON.stringify({
      accounts: accountsFinal,
      network,
      clientId,
      userId,
    });

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Conectando…</title></head>
<body>
<script>
try {
  sessionStorage.setItem('acuarius_social_pending', ${JSON.stringify(payload)});
} catch(e) {}
window.location.replace('${REDIRECT_BASE}/?social_connected=true&social_network=${encodeURIComponent(network)}&social_client=${encodeURIComponent(clientId)}');
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:80px">Conectando red social… <a href="${REDIRECT_BASE}">volver al app</a></p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    console.error('social-callback error:', err);
    return res.redirect(`${REDIRECT_BASE}/?social_error=server_error`);
  }
}
