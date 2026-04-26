// api/cron-reports.js
// Genera y envía reportes semanales automáticos todos los lunes a las 8am UTC

export const config = { runtime: 'nodejs' };

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET          = process.env.CRON_SECRET;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;
const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;

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

function getWeekLabel() {
  const now = new Date();
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - now.getDay() - 6);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  return `${fmt(lastMonday)} – ${fmt(lastSunday)}`;
}

async function generateWeeklyAnalysis(platform, metrics, prevMetrics) {
  if (!ANTHROPIC_API_KEY) return { summary: 'Análisis no disponible.', recommendations: [] };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `Eres un analista de marketing digital experto.
Analiza estas métricas semanales de ${platform} y genera un resumen ejecutivo breve (máximo 4 oraciones) y 3 recomendaciones concretas para la siguiente semana.

Semana actual:
${JSON.stringify(metrics, null, 2)}

Semana anterior:
${JSON.stringify(prevMetrics, null, 2)}

Responde en español. Sé específico con números. Formato JSON exacto:
{"summary": "...", "recommendations": ["rec1", "rec2", "rec3"]}`,
        }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return {
      summary: parsed.summary || 'Ver métricas adjuntas.',
      recommendations: parsed.recommendations || [],
    };
  } catch (e) {
    console.error('generateWeeklyAnalysis error:', e.message);
    return { summary: 'Análisis no disponible.', recommendations: [] };
  }
}

function buildMetricCards(metrics) {
  const cards = [];
  const entries = [
    { key: 'clicks',      label: 'Clicks',        prev: 'prevClicks' },
    { key: 'impressions', label: 'Impresiones',    prev: 'prevImpressions' },
    { key: 'ctr',         label: 'CTR',            prev: 'prevCtr',   suffix: '%' },
    { key: 'conversions', label: 'Conversiones',   prev: 'prevConversions' },
    { key: 'totalCost',   label: 'Gasto total',    prev: 'prevCost',  prefix: '$' },
    { key: 'cpa',         label: 'CPA',            prev: 'prevCpa',   prefix: '$' },
  ];
  for (const e of entries) {
    if (metrics[e.key] === undefined) continue;
    const val = metrics[e.key];
    const prev = metrics[e.prev];
    let changeHtml = '';
    if (prev !== undefined && prev > 0) {
      const pct = (((val - prev) / prev) * 100).toFixed(1);
      const dir = val >= prev ? 'up' : 'down';
      changeHtml = `<div class="metric-change ${dir}">${val >= prev ? '▲' : '▼'} ${Math.abs(pct)}%</div>`;
    }
    cards.push(`
      <div class="metric-card">
        <div class="metric-value">${e.prefix || ''}${val}${e.suffix || ''}</div>
        <div class="metric-label">${e.label}</div>
        ${changeHtml}
      </div>`);
  }
  return cards.join('');
}

function buildWeeklyReportEmail(userEmail, platform, metrics, analysis) {
  const weekLabel = getWeekLabel();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body{font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a}
    .header{background:#2563eb;color:white;padding:24px;border-radius:8px 8px 0 0}
    .header h1{margin:0;font-size:20px}
    .header p{margin:4px 0 0;opacity:.85;font-size:14px}
    .body{background:#f8fafc;padding:24px}
    .metrics-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
    .metric-card{background:white;border-radius:8px;padding:16px;text-align:center}
    .metric-value{font-size:22px;font-weight:600}
    .metric-label{font-size:12px;color:#6b7280;margin-top:4px}
    .metric-change.up{color:#16a34a}
    .metric-change.down{color:#dc2626}
    .section{background:white;border-radius:8px;padding:20px;margin:12px 0}
    .section h3{margin:0 0 12px;font-size:15px;color:#374151}
    .rec-item{padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px}
    .footer{text-align:center;padding:20px;font-size:12px;color:#9ca3af}
    .cta-btn{display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;margin-top:16px}
  </style>
</head>
<body>
  <div class="header">
    <h1>Reporte semanal · ${platform}</h1>
    <p>${weekLabel} · generado por Acuarius</p>
  </div>
  <div class="body">
    <div class="metrics-grid">${buildMetricCards(metrics)}</div>
    <div class="section">
      <h3>📊 Resumen de la semana</h3>
      <p style="font-size:14px;line-height:1.6;color:#374151">${analysis.summary}</p>
    </div>
    <div class="section">
      <h3>🎯 Recomendaciones para esta semana</h3>
      ${analysis.recommendations.map((r, i) => `<div class="rec-item">${i + 1}. ${r}</div>`).join('')}
    </div>
    <div style="text-align:center;padding:20px 0">
      <a href="https://app.acuarius.app" class="cta-btn">Ver análisis completo →</a>
    </div>
  </div>
  <div class="footer">
    Acuarius · <a href="https://acuarius.app">acuarius.app</a> ·
    <a href="https://app.acuarius.app/?action=unsubscribe-reports&userId=unsubscribe">Cancelar suscripción de reportes</a>
  </div>
</body>
</html>`;
}

async function fetchMetricsForPlatform(userId, platform, connection, dateRange) {
  try {
    if (platform === 'google_ads') {
      const r = await fetch(
        `https://app.acuarius.app/api/google-ads?action=get-account-overview&userId=${encodeURIComponent(userId)}&customerId=${connection.account_id?.replace(/-/g, '')}&dateRange=${dateRange}`
      );
      return await r.json();
    }
    if (platform === 'meta_ads') {
      const preset = dateRange === 'LAST_7_DAYS' ? 'last_7d' : 'last_14d';
      const r = await fetch(
        `https://app.acuarius.app/api/meta-ads?action=get-account-overview&userId=${encodeURIComponent(userId)}&adAccountId=${connection.account_id}&datePreset=${preset}`
      );
      return await r.json();
    }
  } catch (e) {
    console.error(`fetchMetrics error for ${platform}:`, e.message);
  }
  return null;
}

async function processUser(user) {
  const connections = await supabaseReq(
    `/platform_connections?user_id=eq.${encodeURIComponent(user.id)}&select=platform,account_id,account_name`
  ).catch(() => []);

  if (!connections?.length) return 0;

  // Check if user has opted out of email reports
  const userRow = await supabaseReq(`/users?id=eq.${encodeURIComponent(user.id)}&select=email,email_reports`);
  const userEmail = userRow?.[0]?.email;
  const emailReports = userRow?.[0]?.email_reports !== false; // default true

  let snapshotsSaved = 0;

  for (const conn of connections) {
    if (!conn.account_id) continue;
    try {
      const [currentMetrics, prevMetrics] = await Promise.all([
        fetchMetricsForPlatform(user.id, conn.platform, conn, 'LAST_7_DAYS'),
        fetchMetricsForPlatform(user.id, conn.platform, conn, 'LAST_14_DAYS'),
      ]);

      if (!currentMetrics || currentMetrics.error) continue;

      const analysis = await generateWeeklyAnalysis(conn.platform, currentMetrics, prevMetrics || {});

      // Save snapshot
      await supabaseReq('/performance_snapshots', 'POST', {
        user_id:      user.id,
        agent:        conn.platform,
        period_label: getWeekLabel(),
        period_type:  'weekly',
        metrics:      { ...currentMetrics, prev: prevMetrics || {} },
        analysis:     `${analysis.summary}\n\n${analysis.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
      });
      snapshotsSaved++;

      // Send email if user has reports enabled
      if (RESEND_API_KEY && userEmail && emailReports) {
        const html = buildWeeklyReportEmail(userEmail, conn.platform === 'google_ads' ? 'Google Ads' : 'Meta Ads', currentMetrics, analysis);
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'reportes@acuarius.app',
            to: userEmail,
            subject: `📊 Reporte semanal ${conn.platform === 'google_ads' ? 'Google Ads' : 'Meta Ads'} — ${getWeekLabel()}`,
            html,
          }),
        }).catch(e => console.error('Email send error:', e.message));
      }
    } catch (e) {
      console.error(`processUser error for ${user.id} / ${conn.platform}:`, e.message);
    }
  }

  return snapshotsSaved;
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).end();
  }

  try {
    // Get all paid users
    const [connections, paidUsers] = await Promise.all([
      supabaseReq('/platform_connections?select=user_id&order=user_id'),
      supabaseReq('/users?plan=in.(pro,agency,admin)&select=id'),
    ]);

    if (!connections?.length) return res.json({ ok: true, processed: 0, snapshots: 0 });

    const paidUserIds = new Set((paidUsers || []).map(u => u.id));
    const uniqueUserIds = [...new Set(
      connections.map(c => c.user_id).filter(id => paidUserIds.has(id))
    )];

    let totalSnapshots = 0;

    for (const userId of uniqueUserIds) {
      try {
        const saved = await processUser({ id: userId });
        totalSnapshots += saved;
      } catch (e) {
        console.error(`cron-reports error for ${userId}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    return res.json({ ok: true, processed: uniqueUserIds.length, snapshots: totalSnapshots });
  } catch (err) {
    console.error('cron-reports error:', err);
    return res.status(500).json({ error: err.message });
  }
}
