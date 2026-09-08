// api/cron-trials.js
// Ciclo de vida de los planes con fecha (corre 1 vez al día, vercel.json).
//
// Dos caminos, y el segundo nació de un agujero caro:
//
// 1. PRUEBA: plan 'trial' + trial_until. Vencida → 'free' + correo. A ≤48h,
//    recordatorio (una sola vez, trial_reminded).
//
// 2. PLAN CON FECHA: cualquier plan de pago con `hasta`. Se creó porque la
//    condición de arriba exige que el plan sea LITERALMENTE 'trial': una cuenta
//    a la que se le pone 'pro' a mano para que pruebe no la caducaba nadie,
//    nunca. Había seis así, una con 179 leads y 58 días de Pro regalado.
//
// `origen` dice por qué tiene el plan: 'hotmart' | 'externo' | 'cortesia'.
// Una cuenta de pago SIN `hasta` no se toca —no sabemos hasta cuándo vale— pero
// se cuenta y se reporta, para que no vuelva a esconderse.
//
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
    body: JSON.stringify({ from: 'Acuarius <notificaciones@app.acuarius.app>', reply_to: 'ceo@acuarius.app', to: [to], subject, html }),
  });
  return r.ok;
}

function wrap(inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' + inner + '</div>';
}

// Refresca el espejo de la tabla `users`. La verdad es Clerk; esto es para que
// la radiografía de soporte no siga enseñando un plan que ya se caducó.
async function espejo(userId, campos) {
  if (!process.env.SUPABASE_URL) return;
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(campos),
  }).catch((e) => console.error('[cron-trials] espejo no actualizado:', userId, e.message));
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

  let expired = 0, reminded = 0, scanned = 0, vencidos = 0, avisados = 0;
  const sinFecha = [];   // planes de pago sin fecha de fin: no se tocan, se reportan
  try {
    for (let page = 0; page < 10; page++) {
      const users = await fetch(`https://api.clerk.com/v1/users?limit=100&offset=${page * 100}&order_by=-created_at`, {
        headers: { Authorization: 'Bearer ' + CK },
      }).then(r => r.json());
      if (!Array.isArray(users) || !users.length) break;
      scanned += users.length;

      for (const u of users) {
        const meta = u.public_metadata || {};
        const email = u.email_addresses?.[0]?.email_address;
        const dePago = ['pro', 'agency', 'agencia', 'individual'].includes(meta.plan);

        // ── Camino 2: plan de pago o cortesía con fecha de fin ──────────────
        if (dePago) {
          if (!meta.hasta) { sinFecha.push(email || u.id); continue; }
          const fin = new Date(meta.hasta);
          if (isNaN(fin)) { sinFecha.push(email || u.id); continue; }
          const restan = fin.getTime() - Date.now();
          if (restan <= 0) {
            await setMeta(u.id, { plan: 'free', hasta: null, vencido_el: new Date().toISOString() });
            await espejo(u.id, { plan: 'free', plan_ends_at: null });
            vencidos++;
            if (email) {
              const esCortesia = meta.origen === 'cortesia';
              await sendMail(email,
                esCortesia ? 'Tu acceso a Acuarius Pro terminó' : 'Tu plan de Acuarius venció',
                wrap('<p>' + (esCortesia
                    ? 'El acceso de cortesía a <b>Acuarius Pro</b> terminó y tu cuenta volvió al plan gratuito.'
                    : 'Tu plan de <b>Acuarius</b> llegó a su fecha de renovación y la cuenta volvió al plan gratuito.') +
                  ' Tus datos siguen intactos.</p>' +
                  '<p style="margin:20px 0"><a href="' + PRO_CHECKOUT + '" style="background:#1E2BCC;color:#fff;padding:12px 26px;border-radius:9px;text-decoration:none;font-weight:bold">Activar Pro — $39/mes</a></p>' +
                  '<p style="font-size:13px;color:#888">Si ya pagaste o crees que es un error, respóndenos a este correo y lo revisamos.</p>')).catch(() => {});
            }
          } else if (restan <= 3 * 86400000 && !meta.aviso_fin) {
            await setMeta(u.id, { aviso_fin: true });
            avisados++;
            if (email) {
              const dias = Math.max(1, Math.ceil(restan / 86400000));
              await sendMail(email, 'Tu plan de Acuarius vence en ' + dias + ' día' + (dias === 1 ? '' : 's'),
                wrap('<p>Tu plan de <b>Acuarius</b> vence el ' + fin.toISOString().slice(0, 10) + '.</p>' +
                  '<p>Después la cuenta vuelve al plan gratuito: los agentes, las campañas masivas y las automatizaciones quedan en pausa. Tus datos no se pierden.</p>' +
                  '<p style="margin:20px 0"><a href="' + PRO_CHECKOUT + '" style="background:#1E2BCC;color:#fff;padding:12px 26px;border-radius:9px;text-decoration:none;font-weight:bold">Renovar — $39/mes</a></p>')).catch(() => {});
            }
          }
          continue;
        }

        // ── Camino 1: la prueba de siempre ─────────────────────────────────
        if (meta.plan !== 'trial' || !meta.trial_until) continue;
        const until = new Date(meta.trial_until);
        const now = new Date();
        const msLeft = until.getTime() - now.getTime();

        if (msLeft <= 0) {
          await setMeta(u.id, { plan: 'free' });
          await espejo(u.id, { plan: 'free' });
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
    // Se registra a propósito: una cuenta de pago sin fecha es exactamente el
    // agujero que este cron vino a tapar, y callarlo lo dejaría abierto otra vez.
    if (sinFecha.length) console.error('[cron-trials] planes de pago SIN fecha de fin:', sinFecha.join(', '));
    console.log('[cron-trials] revisadas:', scanned, '· pruebas vencidas:', expired, '· recordadas:', reminded,
                '· planes vencidos:', vencidos, '· avisados:', avisados, '· sin fecha:', sinFecha.length);
    return res.status(200).json({ ok: true, scanned, expired, reminded, vencidos, avisados, sin_fecha: sinFecha });
  } catch (e) {
    console.error('[cron-trials] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
