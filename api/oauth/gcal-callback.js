// api/oauth/gcal-callback.js
// Recibe el código de Google Calendar, guarda tokens en platform_connections
// (con on_conflict — lección aprendida del callback de Ads) y redirige a la app.

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveGcalConnection(userId, tokens, email) {
  if (!userId || !SUPABASE_URL) return false;
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id:          userId,
      platform:         'google_calendar',
      access_token:     tokens.access_token,
      // Solo incluir refresh_token si Google lo devolvió (no sobreescribir con null)
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_expires_at: expiresAt,
      account_name:     email || '',
      updated_at:       new Date().toISOString(),
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error('saveGcalConnection error:', r.status, errText.slice(0, 300));
  }
  return r.ok;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  if (error) return res.redirect('https://app.acuarius.app/?gcal_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  let userId = '';
  try { userId = JSON.parse(state || '{}').userId || ''; } catch {}

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  'https://app.acuarius.app/api/oauth/gcal-callback',
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.redirect('https://app.acuarius.app/?gcal_error=token_failed');

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userRes.json();

    const saved = await saveGcalConnection(userId, tokens, userInfo.email);
    return res.redirect(
      `https://app.acuarius.app/?gcal_connected=${saved ? 'true' : 'partial'}&gcal_email=${encodeURIComponent(userInfo.email || '')}`
    );
  } catch (err) {
    console.error('gcal-callback error:', err);
    return res.redirect('https://app.acuarius.app/?gcal_error=server_error');
  }
}
