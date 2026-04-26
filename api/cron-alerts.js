// api/cron-alerts.js
// Ejecuta a las 9am, 2pm y 6pm UTC (lunes a viernes) — ver vercel.json
// Verifica alertas de campañas para todos los usuarios con plataformas conectadas

export const config = { runtime: 'nodejs' };

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET         = process.env.CRON_SECRET;
const RESEND_API_KEY      = process.env.RESEND_API_KEY;

async function supabaseReq(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sendAlertEmail(userEmail, alerts) {
  if (!RESEND_API_KEY || !userEmail) return;

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  if (!criticalAlerts.length) return;

  const alertItems = criticalAlerts.map(a => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">
        <strong>${a.campaign_name || 'Cuenta'}</strong><br>
        <span style="color:#666;font-size:13px">${a.message}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">
        <span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:12px">CRÍTICO</span>
      </td>
    </tr>
  `).join('');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'alertas@acuarius.app',
      to: userEmail,
      subject: `⚠️ ${criticalAlerts.length} alerta${criticalAlerts.length > 1 ? 's' : ''} crítica${criticalAlerts.length > 1 ? 's' : ''} en tus campañas — Acuarius`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#111">Alertas de campañas</h2>
          <p style="color:#444">Se detectaron las siguientes alertas críticas en tus campañas:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <thead><tr style="background:#f5f5f5">
              <th style="padding:8px 12px;text-align:left">Alerta</th>
              <th style="padding:8px 12px;text-align:center">Severidad</th>
            </tr></thead>
            <tbody>${alertItems}</tbody>
          </table>
          <p><a href="https://app.acuarius.app" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Ver en Acuarius</a></p>
          <p style="color:#999;font-size:12px;margin-top:24px">Acuarius — Plataforma de marketing con IA para LatAm</p>
        </div>
      `,
    }),
  });
}

export default async function handler(req, res) {
  // Verificar que viene de Vercel Cron
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Obtener usuarios Pro/Agency/Admin con conexiones activas
    // Free users no reciben alertas automáticas (feature de plan pagado)
    const [connections, paidUsers] = await Promise.all([
      supabaseReq('/platform_connections?select=user_id&order=user_id'),
      supabaseReq('/users?plan=in.(pro,agency,admin)&select=id'),
    ]);

    if (!connections?.length) return res.json({ ok: true, usersChecked: 0, alertsCreated: 0 });

    const paidUserIds = new Set((paidUsers || []).map(u => u.id));

    // Solo usuarios con plan pagado que tengan cuentas conectadas
    const uniqueUserIds = [...new Set(
      connections.map(c => c.user_id).filter(id => paidUserIds.has(id))
    )];

    let totalAlerts = 0;

    for (const userId of uniqueUserIds) {
      try {
        // Llamar al check-alerts interno
        const checkRes = await fetch(
          `https://app.acuarius.app/api/admin?action=check-alerts`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
          }
        );
        const result = await checkRes.json();
        const newAlerts = result.alerts || [];
        totalAlerts += newAlerts.length;

        // Enviar email si hay alertas críticas
        if (newAlerts.some(a => a.severity === 'critical')) {
          const userRows = await supabaseReq(`/users?id=eq.${encodeURIComponent(userId)}&select=email`);
          const email = userRows?.[0]?.email;
          if (email) await sendAlertEmail(email, newAlerts);
        }

        // Pequeña pausa para no sobrecargar la API
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error(`cron-alerts error for user ${userId}:`, e.message);
      }
    }

    return res.json({ ok: true, usersChecked: uniqueUserIds.length, alertsCreated: totalAlerts });

  } catch (err) {
    console.error('cron-alerts error:', err);
    return res.status(500).json({ error: err.message });
  }
}
