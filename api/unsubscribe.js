// api/unsubscribe.js
// Baja de emails de campaña: el link firmado (HMAC con CRON_SECRET) del footer
// añade la etiqueta 'no-email' al lead — las campañas de email lo excluyen
// automáticamente (filtro en api/campaigns.js y doble chequeo en el motor).
// Soporta GET (clic del usuario) y POST (List-Unsubscribe One-Click).

import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

function page(title, body, ok) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">' +
    '<div style="background:#fff;border-radius:16px;padding:40px 44px;max-width:420px;text-align:center;box-shadow:0 8px 30px rgba(30,43,204,.08)">' +
    '<div style="font-size:42px;margin-bottom:12px">' + (ok ? '✓' : '✕') + '</div>' +
    '<h2 style="margin:0 0 10px;color:#1a1a2e">' + title + '</h2>' +
    '<p style="color:#666;margin:0;line-height:1.6">' + body + '</p></div></body></html>';
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
