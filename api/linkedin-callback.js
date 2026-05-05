// api/linkedin-callback.js
// Recibe el código de LinkedIn, obtiene access token y lo guarda en Supabase

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveLinkedInConnection(userId, token, expiresIn, userInfo) {
  if (!userId || !SUPABASE_URL) return;
  const expiresAt = new Date(Date.now() + (expiresIn || 5184000) * 1000).toISOString();
  const payload = {
    user_id:          userId,
    platform:         'linkedin_ads',
    access_token:     token,
    refresh_token:    null,
    token_expires_at: expiresAt,
    account_name:     userInfo.name || userInfo.email || '',
    extra_data:       { linkedin_id: userInfo.id || '', linkedin_email: userInfo.email || '' },
    updated_at:       new Date().toISOString(),
  };

  const saveRes = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`,
    {
      method:  'POST',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!saveRes.ok) {
    const errText = await saveRes.text().catch(() => '');
    console.error('saveLinkedInConnection error:', saveRes.status, errText.slice(0, 300));
  }
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) return res.redirect('https://app.acuarius.app/?linkedin_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  let userId = '';
  try { userId = JSON.parse(state || '{}').userId || ''; } catch {}

  const clientId     = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  try {
    // 1. Obtener access token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  'https://app.acuarius.app/api/linkedin-callback',
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error || !tokenData.access_token) {
      console.error('LinkedIn token error:', tokenData);
      return res.redirect('https://app.acuarius.app/?linkedin_error=token_failed');
    }

    const accessToken = tokenData.access_token;

    // 2. Info del usuario (OpenID Connect userinfo endpoint)
    const userRes  = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = await userRes.json();

    const name  = [userInfo.given_name, userInfo.family_name].filter(Boolean).join(' ') || userInfo.name || '';
    const email = userInfo.email || '';
    const id    = userInfo.sub   || '';

    // 3. Guardar en Supabase si hay userId
    if (userId) {
      await saveLinkedInConnection(userId, accessToken, tokenData.expires_in, { name, email, id });
      const redirectParams = new URLSearchParams({
        linkedin_connected: 'true',
        platform:           'linkedin_ads',
        linkedin_name:      name,
        linkedin_email:     email,
      });
      return res.redirect(`https://app.acuarius.app/?${redirectParams}`);
    }

    // Fallback sin userId: token en URL
    const params = new URLSearchParams({
      linkedin_connected: 'true',
      linkedin_token:     accessToken,
      linkedin_name:      name,
      linkedin_email:     email,
    });
    return res.redirect(`https://app.acuarius.app/?${params}`);

  } catch (err) {
    console.error('LinkedIn callback error:', err);
    return res.redirect('https://app.acuarius.app/?linkedin_error=server_error');
  }
}
