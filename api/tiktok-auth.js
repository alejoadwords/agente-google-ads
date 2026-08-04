// api/tiktok-auth.js
// Inicia la conexión de una cuenta de TikTok Business para mensajería directa.
// El agente que va a atender el canal viaja en el state, porque una conexión
// siempre cuelga de un agente (channel_connections.agent_id es obligatorio).
//
// Los endpoints de TikTok se pueden sobreescribir por variable de entorno: la
// Business Messaging API todavía cambia de ruta entre versiones y así se ajusta
// sin tocar código cuando aprueben la app.

const AUTH_URL = process.env.TIKTOK_AUTH_URL || 'https://business-api.tiktok.com/portal/auth';
const SCOPES = process.env.TIKTOK_SCOPES || 'user.info.basic,biz.message.manage';
const REDIRECT = 'https://app.acuarius.app/api/oauth/tiktok-callback';

export default function handler(req, res) {
  const appId = process.env.TIKTOK_CLIENT_KEY;
  if (!appId) {
    return res.status(503).json({
      error: 'TikTok no está configurado todavía',
      detail: 'Falta TIKTOK_CLIENT_KEY. Se obtiene al crear la app en TikTok for Business y pedir el permiso de Business Messaging.',
    });
  }

  const userId = req.query.userId || '';
  const agentId = req.query.agentId || '';
  if (!userId || !agentId) return res.status(400).json({ error: 'Faltan userId y agentId' });

  const state = Buffer.from(JSON.stringify({ userId, agentId, n: 'tt' })).toString('base64url');
  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: REDIRECT,
    scope: SCOPES,
    response_type: 'code',
    state,
  });

  res.redirect(`${AUTH_URL}?${params}`);
}
