// api/oauth/yt-callback.js
// Recibe el código de YouTube, guarda tokens en platform_connections
// (platform 'youtube') y avisa en pantalla. El script de subida de la Academia
// lee esa fila y refresca el token cuando hace falta.

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveYtConnection(userId, tokens, email) {
  if (!userId || !SUPABASE_URL) return false;
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      platform: 'youtube',
      access_token: tokens.access_token,
      // Sin refresh_token la subida deja de funcionar en una hora: solo se
      // escribe si Google lo devolvió, para no pisarlo con null.
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_expires_at: expiresAt,
      account_name: email || '',
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) console.error('saveYtConnection:', r.status, (await r.text().catch(() => '')).slice(0, 300));
  return r.ok;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  if (error) return res.redirect('https://app.acuarius.app/?yt_error=access_denied');
  if (!code) return res.status(400).json({ error: 'Código de autorización faltante' });

  let userId = '';
  try { userId = JSON.parse(state || '{}').userId || ''; } catch {}

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://app.acuarius.app/api/oauth/yt-callback',
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) {
      console.error('yt token:', JSON.stringify(tokens).slice(0, 300));
      return res.redirect('https://app.acuarius.app/?yt_error=token_failed');
    }

    const userInfo = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then(r => r.json()).catch(() => ({}));

    const saved = await saveYtConnection(userId, tokens, userInfo.email);
    return res.redirect(
      `https://app.acuarius.app/?yt_connected=${saved ? 'true' : 'partial'}&yt_email=${encodeURIComponent(userInfo.email || '')}`
    );
  } catch (err) {
    console.error('yt-callback:', err);
    return res.redirect('https://app.acuarius.app/?yt_error=server_error');
  }
}
