// api/oauth/tiktok-callback.js
// Canjea el código de TikTok por un token y deja la cuenta conectada como canal
// del agente (channel_connections, channel='tiktok'). A partir de ahí los DMs
// entran por api/webhooks/tiktok.js igual que los de Meta.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TOKEN_URL = process.env.TIKTOK_TOKEN_URL || 'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/';
const ME_URL = process.env.TIKTOK_ME_URL || 'https://business-api.tiktok.com/open_api/v1.3/business/get/';

function sbHeaders(prefer) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: prefer || 'return=representation',
  };
}

// TikTok responde { code:0, data:{...} } o el objeto plano según endpoint
function unwrap(json) {
  if (json && typeof json === 'object' && json.data && typeof json.data === 'object') return json.data;
  return json || {};
}

async function saveConnection({ userId, agentId, accessToken, refreshToken, openId, displayName }) {
  // Una cuenta de TikTok por agente: si ya estaba, se actualiza el token
  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${encodeURIComponent(userId)}&channel=eq.tiktok&external_id=eq.${encodeURIComponent(openId)}&select=id&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);

  const row = {
    user_id: userId,
    agent_id: agentId,
    channel: 'tiktok',
    external_id: openId,
    channel_name: displayName || 'TikTok',
    access_token: accessToken,
    is_active: true,
  };
  if (refreshToken) row.refresh_token = refreshToken;

  if (existing?.[0]?.id) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${existing[0].id}`, {
      method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(row),
    });
    return r.ok;
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify(row),
  });
  if (!r.ok) {
    // refresh_token puede no existir como columna: reintentar sin ella
    delete row.refresh_token;
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections`, {
      method: 'POST', headers: sbHeaders(), body: JSON.stringify(row),
    });
    if (!r2.ok) console.error('tiktok saveConnection', await r2.text().catch(() => ''));
    return r2.ok;
  }
  return true;
}

export default async function handler(req, res) {
  const { code, state, auth_code, error } = req.query;
  const authCode = code || auth_code; // TikTok usa auth_code en algunos flujos
  if (error) return res.redirect('https://app.acuarius.app/conversaciones?tiktok_error=access_denied');
  if (!authCode) return res.redirect('https://app.acuarius.app/conversaciones?tiktok_error=missing_code');

  let userId = '', agentId = '';
  try {
    const s = JSON.parse(Buffer.from(String(state || ''), 'base64url').toString('utf8'));
    userId = s.userId || ''; agentId = s.agentId || '';
  } catch {}
  if (!userId || !agentId) return res.redirect('https://app.acuarius.app/conversaciones?tiktok_error=missing_state');

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: process.env.TIKTOK_CLIENT_KEY,
        secret: process.env.TIKTOK_CLIENT_SECRET,
        auth_code: authCode,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = unwrap(await tokenRes.json());
    const accessToken = tokens.access_token;
    if (!accessToken) {
      console.error('tiktok token error', JSON.stringify(tokens).slice(0, 300));
      return res.redirect('https://app.acuarius.app/conversaciones?tiktok_error=token');
    }

    // Identificador de la cuenta: es la clave con la que el webhook encuentra
    // la conexión, así que si TikTok no lo devuelve no se puede continuar.
    let openId = tokens.open_id || tokens.tt_user_id || (Array.isArray(tokens.open_id_list) ? tokens.open_id_list[0] : null);
    let displayName = tokens.display_name || null;
    if (!displayName || !openId) {
      const me = await fetch(`${ME_URL}?business_id=${encodeURIComponent(openId || '')}`, {
        headers: { 'Access-Token': accessToken },
      }).then(r => r.json()).then(unwrap).catch(() => ({}));
      openId = openId || me.business_id || me.open_id || null;
      displayName = displayName || me.display_name || me.username || null;
    }
    if (!openId) return res.redirect('https://app.acuarius.app/conversaciones?tiktok_error=sin_cuenta');

    const ok = await saveConnection({
      userId, agentId, accessToken,
      refreshToken: tokens.refresh_token || null,
      openId: String(openId),
      displayName: displayName ? String(displayName) : null,
    });
    return res.redirect(`https://app.acuarius.app/conversaciones?tiktok=${ok ? 'ok' : 'error'}`);
  } catch (e) {
    console.error('tiktok callback', e);
    return res.redirect('https://app.acuarius.app/conversaciones?tiktok_error=fallo');
  }
}
