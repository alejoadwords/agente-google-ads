// api/resend-webhook.js
// Recibe eventos de Resend (email.opened, email.clicked, email.bounced...)
// firmados con svix y los guarda en email_events. El motor de automatizaciones
// los consulta para la rama "¿Abrió el email?".
// Requiere: env RESEND_WEBHOOK_SECRET (signing secret del webhook en Resend)
// y tracking de aperturas activado en el dominio app.acuarius.app.

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Verificación svix: HMAC-SHA256 de "id.timestamp.payload" con el secret
// base64 (sin el prefijo whsec_). La cabecera trae "v1,<sig> v1,<sig2>...".
function verifySignature(raw, headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sig = headers['svix-signature'];
  if (!id || !ts || !sig) return false;
  // Tolerancia de 5 minutos contra replay
  if (Math.abs(Date.now() / 1000 - parseFloat(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return sig.split(' ').some(part => {
    const v = part.split(',')[1];
    return v && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const raw = await readRawBody(req);
  if (!verifySignature(raw, req.headers)) {
    return res.status(401).json({ error: 'Firma inválida' });
  }

  let evt;
  try { evt = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Payload inválido' }); }

  const type = String(evt.type || '');
  if (!type.startsWith('email.')) return res.status(200).json({ ok: true, skipped: type });

  const data = evt.data || {};
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/email_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        resend_id: data.email_id || null,
        event: type.replace('email.', ''), // opened | clicked | delivered | bounced | ...
        to_email: Array.isArray(data.to) ? data.to[0] : (data.to || null),
      }),
    });
    if (!r.ok) console.error('resend-webhook insert error:', r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.error('resend-webhook error:', e.message);
  }
  return res.status(200).json({ ok: true });
}
