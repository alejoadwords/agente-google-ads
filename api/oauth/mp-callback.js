// api/oauth/mp-callback.js
// Recibe el código de MercadoPago, canjea los tokens y guarda la conexión en
// platform_connections (platform 'mercadopago', account_id = collector id).
// El access_token de MP dura ~6 meses; se refresca con refresh_token en 401.

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveMpConnection(userId, tokens) {
  if (!userId || !SUPABASE_URL) return false;
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 15552000) * 1000).toISOString();
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
      platform:         'mercadopago',
      access_token:     tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_expires_at: expiresAt,
      account_id:       String(tokens.user_id || ''),
      account_name:     'MercadoPago ' + (tokens.user_id || ''),
      updated_at:       new Date().toISOString(),
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error('saveMpConnection error:', r.status, errText.slice(0, 300));
  }
  return r.ok;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  if (error) return res.redirect('https://app.acuarius.app/?mp_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  let userId = '';
  try { userId = JSON.parse(state || '{}').userId || ''; } catch {}
  if (!userId) return res.redirect('https://app.acuarius.app/?mp_error=missing_user');

  try {
    const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     process.env.MP_CLIENT_ID,
        client_secret: process.env.MP_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  'https://app.acuarius.app/api/oauth/mp-callback',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      console.error('mp-callback token error:', JSON.stringify(tokens).slice(0, 300));
      return res.redirect('https://app.acuarius.app/?mp_error=token_failed');
    }
    const ok = await saveMpConnection(userId, tokens);
    return res.redirect('https://app.acuarius.app/?mp_connected=' + (ok ? '1' : '0'));
  } catch (e) {
    console.error('mp-callback:', e.message);
    return res.redirect('https://app.acuarius.app/?mp_error=exception');
  }
}
