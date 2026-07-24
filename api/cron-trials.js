// api/cron-trials.js
// Ciclo de vida de la prueba Pro de 7 días (corre 1 vez al día, vercel.json):
// - trial vencido → plan 'free' + email de cierre con CTA a Pro
// - trial a ≤48h de vencer → email recordatorio (una sola vez: trial_reminded)
// Recorre los usuarios de Clerk por páginas (base pequeña; tope de cordura 10 págs).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET    = process.env.CRON_SECRET;
const CK             = process.env.CLERK_SECRET_KEY;

const PRO_CHECKOUT = 'https://pay.hotmart.com/G105202218G';

async function sendMail(to, subject, html) {
  if (!RESEND_API_KEY) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Acuarius <notificaciones@app.acuarius.app>', to: [to], subject, html }),
  });
  return r.ok;
}

function wrap(inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' + inner + '</div>';
}

async function setMeta(userId, obj) {
  const r = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + CK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_metadata: obj }),
  });
  return r.ok;
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });

  let expired = 0, reminded = 0, scanned = 0;
  try {
    for (let page = 0; page < 10; page++) {
      const users = await fetch(`https://api.clerk.com/v1/users?limit=100&offset=${page * 100}&order_by=-created_at`, {
        headers: { Authorization: 'Bearer ' + CK },
      }).then(r => r.json());
      if (!Array.isArray(users) || !users.length) break;
      scanned += users.length;

      for (const u of users) {
        const meta = u.public_metadata || {};
        if (meta.plan !== 'trial' || !meta.trial_until) continue;
        const email = u.email_addresses?.[0]?.email_address;
        const until = new Date(meta.trial_until);
        const now = new Date();
        const msLeft = until.getTime() - now.getTime();

        if (msLeft <= 0) {
          await setMeta(u.id, { plan: 'free' });
          expired++;
          if (email) {
            await sendMail(email, 'Tu prueba de Acuarius Pro terminó — así sigues',
              wrap('<p>Tu semana con <b>Acuarius Pro</b> terminó y tu cuenta volvió al plan gratuito (tus datos siguen intactos).</p>' +
                '<p>Si los agentes, el CRM o las campañas te sirvieron, continúa donde quedaste:</p>' +
                '<p style="margin:20px 0"><a href="' + PRO_CHECKOUT + '" style="background:#1E2BCC;color:#fff;padding:12px 26px;border-radius:9px;text-decoration:none;font-weight:bold">Activar Pro — $39/mes</a></p>' +
                '<p style="font-size:13px;color:#888">Todo lo que creaste en la prueba (flujos, campañas, formularios) queda guardado y se reactiva al instante.</p>')).catch(() => {});
          }
        } else if (msLeft <= 48 * 3600000 && !meta.trial_reminded) {
          await setMeta(u.id, { trial_reminded: true });
          reminded++;
          if (email) {
            const days = Math.ceil(msLeft / 86400000);
            await sendMail(email, '⏳ Te queda' + (days === 1 ? '' : 'n') + ' ' + days + ' día' + (days === 1 ? '' : 's') + ' de Acuarius Pro',
              wrap('<p>Tu prueba de <b>Acuarius Pro</b> termina pronto.</p>' +
                '<p>Después volverás al plan gratuito: los agentes con búsqueda web, las campañas masivas, las automatizaciones y las propuestas quedan en pausa (tus datos no se pierden).</p>' +
                '<p style="margin:20px 0"><a href="' + PRO_CHECKOUT + '" style="background:#1E2BCC;color:#fff;padding:12px 26px;border-radius:9px;text-decoration:none;font-weight:bold">Continuar con Pro — $39/mes</a></p>')).catch(() => {});
          }
        }
      }
      if (users.length < 100) break;
    }
    console.log('[cron-trials] scanned:', scanned, 'expired:', expired, 'reminded:', reminded);
    return res.status(200).json({ ok: true, scanned, expired, reminded });
  } catch (e) {
    console.error('[cron-trials] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
