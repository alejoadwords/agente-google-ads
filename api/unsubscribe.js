// api/unsubscribe.js
// Baja de emails de campaña: el link firmado (HMAC con CRON_SECRET) del footer
// añade la etiqueta 'no-email' al lead — las campañas de email lo excluyen
// automáticamente (filtro en api/campaigns.js y doble chequeo en el motor).
// Soporta GET (clic del usuario) y POST (List-Unsubscribe One-Click).

import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

const LOGO_SVG =
  '<span style="display:inline-flex;align-items:center;gap:2px">' +
  '<svg width="34" height="34" viewBox="0 0 75 75" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path fill="#1E2BCC" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/>' +
  '<path fill="#1E2BCC" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/>' +
  '<circle fill="#1E2BCC" cx="60.13" cy="10.7" r="5.3"/></svg>' +
  '<span style="font-size:23px;font-weight:800;color:#0b0b14;letter-spacing:-.5px">cuarius</span></span>';

const SOCIAL_ICON_STYLE = 'display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;background:#f0f1f7;color:#555;text-decoration:none';
const SOCIALS_HTML =
  '<div style="display:flex;justify-content:center;gap:12px;margin-top:26px">' +
  '<a href="https://www.facebook.com/AcuariusAI" target="_blank" rel="noopener" title="Facebook" style="' + SOCIAL_ICON_STYLE + '">' +
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg></a>' +
  '<a href="https://www.instagram.com/acuariusai/" target="_blank" rel="noopener" title="Instagram" style="' + SOCIAL_ICON_STYLE + '">' +
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg></a>' +
  '<a href="https://www.youtube.com/@Acuarius-ai" target="_blank" rel="noopener" title="YouTube" style="' + SOCIAL_ICON_STYLE + '">' +
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.85-.49-5.69a2.98 2.98 0 0 0-2.1-2.11C18.57 3.7 12 3.7 12 3.7s-6.57 0-8.41.5a2.98 2.98 0 0 0-2.1 2.11C1 8.15 1 12 1 12s0 3.85.49 5.69a2.98 2.98 0 0 0 2.1 2.11c1.84.5 8.41.5 8.41.5s6.57 0 8.41-.5a2.98 2.98 0 0 0 2.1-2.11C23 15.85 23 12 23 12zM9.75 15.5v-7L15.5 12l-5.75 3.5z"/></svg></a>' +
  '<a href="https://www.tiktok.com/@acuarius.ai" target="_blank" rel="noopener" title="TikTok" style="' + SOCIAL_ICON_STYLE + '">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg></a>' +
  '</div>';

function page(title, body, ok) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">' +
    '<div style="background:#fff;border-radius:16px;padding:44px 46px;max-width:440px;text-align:center;box-shadow:0 8px 30px rgba(30,43,204,.08)">' +
    '<div style="margin-bottom:22px">' + LOGO_SVG + '</div>' +
    '<div style="font-size:38px;margin-bottom:10px;color:' + (ok ? '#10B981' : '#EF4444') + '">' + (ok ? '✓' : '✕') + '</div>' +
    '<h2 style="margin:0 0 10px;color:#1a1a2e">' + title + '</h2>' +
    '<p style="color:#666;margin:0;line-height:1.6">' + body + '</p>' +
    SOCIALS_HTML +
    '</div></body></html>';
}

export default async function handler(req, res) {
  const { l, s } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!l || !s) return res.status(400).send(page('Enlace inválido', 'Faltan parámetros.', false));
  const expected = crypto.createHmac('sha256', CRON_SECRET).update('unsub:' + l).digest('hex').slice(0, 32);
  const a = Buffer.from(String(s)), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).send(page('Enlace inválido', 'La firma del enlace no es válida.', false));
  }
  try {
    const H = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${l}&select=id,tags`, { headers: H }).then(r => r.json());
    const lead = rows?.[0];
    if (!lead) return res.status(404).send(page('No encontrado', 'Este contacto ya no existe.', false));
    if (!(lead.tags || []).includes('no-email')) {
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${l}`, {
        method: 'PATCH', headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ tags: [...(lead.tags || []), 'no-email'].slice(0, 15), updated_at: new Date().toISOString() }),
      });
    }
    return res.status(200).send(page('Listo, quedaste fuera de la lista', 'No volverás a recibir correos de campañas. Si fue un error, responde cualquier correo anterior y te reactivan.', true));
  } catch (e) {
    return res.status(500).send(page('Error', 'No se pudo procesar la baja. Intenta de nuevo.', false));
  }
}
