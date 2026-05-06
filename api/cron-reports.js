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

// Configuración de métricas por plataforma
const PLATFORM_CONFIG = {
  google_ads: {
    name:    'Google Ads',
    color:   '#4285F4',
    colorDk: '#2563EB',
    colorBg: '#EFF6FF',
    logo:    'G',
    metrics: [
      { key: 'totalCost',   label: 'Inversión',     prefix: '$', lowerBetter: false },
      { key: 'clicks',      label: 'Clics',          lowerBetter: false },
      { key: 'impressions', label: 'Impresiones',    lowerBetter: false },
      { key: 'ctr',         label: 'CTR',            suffix: '%', lowerBetter: false },
      { key: 'avgCpc',      label: 'CPC Prom.',      prefix: '$', lowerBetter: true  },
      { key: 'conversions', label: 'Conversiones',   lowerBetter: false },
      { key: 'cpa',         label: 'CPA',            prefix: '$', lowerBetter: true  },
      { key: 'roas',        label: 'ROAS',           suffix: 'x', lowerBetter: false },
    ],
  },
  meta_ads: {
    name:    'Meta Ads',
    color:   '#1877F2',
    colorDk: '#1565C0',
    colorBg: '#EFF6FF',
    logo:    'f',
    metrics: [
      { key: 'spend',       label: 'Inversión',     prefix: '$', lowerBetter: false },
      { key: 'reach',       label: 'Alcance',        lowerBetter: false },
      { key: 'impressions', label: 'Impresiones',    lowerBetter: false },
      { key: 'clicks',      label: 'Clics',          lowerBetter: false },
      { key: 'ctr',         label: 'CTR',            suffix: '%', lowerBetter: false },
      { key: 'cpm',         label: 'CPM',            prefix: '$', lowerBetter: true  },
      { key: 'conversions', label: 'Conversiones',   lowerBetter: false },
      { key: 'cpa',         label: 'CPA',            prefix: '$', lowerBetter: true  },
    ],
  },
};

function trendBadge(val, prev, lowerBetter) {
  if (prev === undefined || prev === null || parseFloat(prev) === 0) return '';
  const v = parseFloat(val) || 0;
  const p = parseFloat(prev) || 0;
  const pct = (((v - p) / p) * 100).toFixed(1);
  const isGood = lowerBetter ? v <= p : v >= p;
  const color = isGood ? '#16a34a' : '#dc2626';
  const bg    = isGood ? '#f0fdf4' : '#fef2f2';
  const arrow = v >= p ? '&#9650;' : '&#9660;';
  return `<span style="display:inline-block;font-size:11px;font-weight:700;color:${color};background:${bg};border-radius:20px;padding:2px 7px;margin-top:4px">${arrow} ${Math.abs(pct)}%</span>`;
}

function buildMetricRows(platform, metrics, prevMetrics) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.google_ads;
  return cfg.metrics.map(m => {
    const val  = metrics[m.key];
    const prev = prevMetrics?.[m.key];
    if (val === undefined || val === null) return '';
    const display = `${m.prefix || ''}${val}${m.suffix || ''}`;
    const badge = trendBadge(val, prev, m.lowerBetter);
    return `
      <td width="25%" style="padding:12px 8px;text-align:center;vertical-align:top">
        <div style="background:#fff;border-radius:10px;padding:14px 10px;border:1px solid #e5e7eb">
          <div style="font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.5px">${display}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:3px;font-weight:500;text-transform:uppercase;letter-spacing:.5px">${m.label}</div>
          ${badge ? `<div style="margin-top:5px">${badge}</div>` : ''}
        </div>
      </td>`;
  }).filter(Boolean);
}

function buildMetricTable(platform, metrics, prevMetrics) {
  const rows = buildMetricRows(platform, metrics, prevMetrics);
  const chunks = [];
  for (let i = 0; i < rows.length; i += 4) chunks.push(rows.slice(i, i + 4));
  return chunks.map(chunk => `
    <tr>${chunk.join('')}${chunk.length < 4 ? '<td></td>'.repeat(4 - chunk.length) : ''}</tr>
  `).join('');
}

function buildWeeklyReportEmail(userEmail, platformKey, metrics, analysis, prevMetrics) {
  const weekLabel = getWeekLabel();
  const cfg = PLATFORM_CONFIG[platformKey] || PLATFORM_CONFIG.google_ads;
  const platformName = cfg.name;
  const color   = cfg.color;
  const colorDk = cfg.colorDk;

  const recColors = ['#4285F4', '#7C3AED', '#059669'];

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reporte Semanal ${platformName}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:28px 16px">

      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

        <!-- ── HEADER ─────────────────────────────────── -->
        <tr>
          <td style="background:linear-gradient(135deg,${color} 0%,${colorDk} 100%);border-radius:14px 14px 0 0;padding:28px 32px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">Acuarius · Reporte Semanal</div>
                  <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.5px">${platformName}</div>
                  <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:4px">${weekLabel}</div>
                </td>
                <td align="right">
                  <div style="width:48px;height:48px;background:rgba(255,255,255,.2);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;color:white;line-height:48px;text-align:center">${cfg.logo}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── MÉTRICAS ────────────────────────────────── -->
        <tr>
          <td style="background:#f8fafc;padding:20px 16px 8px">
            <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;padding:0 8px;margin-bottom:4px">Métricas de la semana</div>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:0 16px 16px">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${buildMetricTable(platformKey, metrics, prevMetrics)}
            </table>
          </td>
        </tr>

        <!-- ── RESUMEN IA ──────────────────────────────── -->
        <tr>
          <td style="background:#f8fafc;padding:0 16px 12px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#fff;border-radius:12px;padding:20px 24px;border-left:4px solid ${color}">
                  <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">&#128202; Análisis de la semana</div>
                  <div style="font-size:14px;line-height:1.7;color:#4b5563">${analysis.summary}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── RECOMENDACIONES ────────────────────────── -->
        ${analysis.recommendations?.length ? `
        <tr>
          <td style="background:#f8fafc;padding:0 16px 12px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#fff;border-radius:12px;padding:20px 24px">
                  <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px">&#127919; Acciones para esta semana</div>
                  ${analysis.recommendations.map((r, i) => `
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${i < analysis.recommendations.length - 1 ? '12px' : '0'}">
                    <tr>
                      <td width="28" valign="top">
                        <div style="width:24px;height:24px;background:${recColors[i] || color};border-radius:6px;text-align:center;line-height:24px;font-size:12px;font-weight:800;color:white">${i + 1}</div>
                      </td>
                      <td style="padding-left:10px;font-size:14px;line-height:1.6;color:#374151;vertical-align:top">${r}</td>
                    </tr>
                  </table>`).join('')}
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ''}

        <!-- ── CTA ────────────────────────────────────── -->
        <tr>
          <td style="background:#f8fafc;padding:4px 16px 24px;text-align:center">
            <a href="https://app.acuarius.app" style="display:inline-block;background:${color};color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:8px;letter-spacing:.2px">Ver análisis completo &rarr;</a>
          </td>
        </tr>

        <!-- ── FOOTER ─────────────────────────────────── -->
        <tr>
          <td style="background:#e2e8f0;border-radius:0 0 14px 14px;padding:16px 24px;text-align:center">
            <div style="font-size:12px;color:#94a3b8">
              <strong style="color:#64748b">Acuarius</strong> &middot; Reportes automáticos de marketing &middot;
              <a href="https://app.acuarius.app/?action=unsubscribe-reports" style="color:#94a3b8">Cancelar suscripción</a>
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
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
        const html = buildWeeklyReportEmail(userEmail, conn.platform, currentMetrics, analysis, prevMetrics || {});
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'reportes@app.acuarius.app',
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
