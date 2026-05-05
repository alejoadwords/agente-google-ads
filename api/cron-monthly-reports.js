// api/cron-monthly-reports.js
// Genera y envía reportes mensuales el día 1 de cada mes a las 8am UTC
// Incluye comparativa mes actual vs mes anterior y análisis estratégico más profundo

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

function getMonthLabel() {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return lastMonth.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
}

function getPlatformName(platform) {
  const names = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', linkedin_ads: 'LinkedIn Ads' };
  return names[platform] || platform;
}

async function generateMonthlyAnalysis(platform, current, previous) {
  if (!ANTHROPIC_API_KEY) return { summary: 'Análisis no disponible.', highlights: [], recommendations: [], alerts: [] };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          ANTHROPIC_API_KEY,
        'anthropic-version':  '2023-06-01',
        'Content-Type':       'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{
          role:    'user',
          content: `Eres un consultor senior de marketing digital en Latinoamérica.
Analiza el rendimiento mensual de ${platform} y genera un reporte ejecutivo estratégico.

MES ANALIZADO: ${getMonthLabel()}

Métricas del mes:
${JSON.stringify(current, null, 2)}

Métricas del mes anterior:
${JSON.stringify(previous, null, 2)}

Genera un análisis en español. Responde en formato JSON exacto:
{
  "summary": "Resumen ejecutivo en 4-5 oraciones. Menciona los números más importantes y la tendencia general.",
  "highlights": ["logro1 con número específico", "logro2 con número específico"],
  "recommendations": ["acción estratégica 1 para el próximo mes", "acción estratégica 2", "acción estratégica 3", "acción estratégica 4", "acción estratégica 5"],
  "alerts": ["alerta si alguna métrica bajó más de 20% vs mes anterior — vacío si todo está bien"]
}`,
        }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return {
      summary:         parsed.summary         || 'Ver métricas adjuntas.',
      highlights:      parsed.highlights       || [],
      recommendations: parsed.recommendations  || [],
      alerts:          parsed.alerts           || [],
    };
  } catch (e) {
    console.error('generateMonthlyAnalysis error:', e.message);
    return { summary: 'Análisis no disponible.', highlights: [], recommendations: [], alerts: [] };
  }
}

function pctChange(current, prev) {
  if (!prev || prev === 0) return null;
  const pct = (((current - prev) / prev) * 100).toFixed(1);
  return parseFloat(pct);
}

function trendBadge(current, prev, lowerIsBetter = false) {
  const pct = pctChange(parseFloat(current), parseFloat(prev));
  if (pct === null) return '';
  const improved = lowerIsBetter ? pct < 0 : pct > 0;
  const color  = improved ? '#16a34a' : '#dc2626';
  const arrow  = pct > 0 ? '▲' : '▼';
  return `<span style="color:${color};font-size:11px;font-weight:600">${arrow} ${Math.abs(pct)}%</span>`;
}

function buildMonthlyMetricRow(label, current, prev, prefix = '', suffix = '', lowerIsBetter = false) {
  if (current === undefined || current === null) return '';
  return `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6">${label}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;text-align:right">${prefix}${current}${suffix}</td>
      <td style="padding:8px 12px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;text-align:right">${prefix}${prev ?? '—'}${suffix}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right">${trendBadge(current, prev, lowerIsBetter)}</td>
    </tr>`;
}

function buildMetricsTable(platform, current, previous) {
  let rows = '';
  if (platform === 'google_ads') {
    rows += buildMonthlyMetricRow('Inversión total',  current.totalCost,    previous.totalCost,    '$');
    rows += buildMonthlyMetricRow('Impresiones',      current.impressions,  previous.impressions);
    rows += buildMonthlyMetricRow('Clics',            current.clicks,       previous.clicks);
    rows += buildMonthlyMetricRow('CTR',              current.ctr,          previous.ctr,          '', '%');
    rows += buildMonthlyMetricRow('CPC promedio',     current.avgCpc,       previous.avgCpc,       '$', '', true);
    rows += buildMonthlyMetricRow('Conversiones',     current.conversions,  previous.conversions);
    rows += buildMonthlyMetricRow('CPA',              current.cpa,          previous.cpa,          '$', '', true);
    if (current.roas) rows += buildMonthlyMetricRow('ROAS', current.roas, previous.roas, '', 'x');
  } else if (platform === 'meta_ads') {
    rows += buildMonthlyMetricRow('Inversión total',  current.spend,        previous.spend,        '$');
    rows += buildMonthlyMetricRow('Alcance',          current.reach,        previous.reach);
    rows += buildMonthlyMetricRow('Impresiones',      current.impressions,  previous.impressions);
    rows += buildMonthlyMetricRow('Frecuencia',       current.frequency,    previous.frequency,    '', '', true);
    rows += buildMonthlyMetricRow('CPM',              current.cpm,          previous.cpm,          '$', '', true);
    rows += buildMonthlyMetricRow('Clics',            current.clicks,       previous.clicks);
    rows += buildMonthlyMetricRow('CTR',              current.ctr,          previous.ctr,          '', '%');
    rows += buildMonthlyMetricRow('Conversiones',     current.conversions,  previous.conversions);
    rows += buildMonthlyMetricRow('CPA',              current.cpa,          previous.cpa,          '$', '', true);
  }
  return `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Métrica</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Este mes</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Mes anterior</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Variación</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const PLATFORM_COLORS = {
  google_ads:   { bg: '#E8F0FE', accent: '#4285F4', name: 'Google Ads' },
  meta_ads:     { bg: '#EEF2FF', accent: '#1877F2', name: 'Meta Ads' },
  linkedin_ads: { bg: '#EFF6FF', accent: '#0A66C2', name: 'LinkedIn Ads' },
};

function buildMonthlyEmail(platform, current, previous, analysis) {
  const month  = getMonthLabel();
  const colors = PLATFORM_COLORS[platform] || { bg: '#F3F4F6', accent: '#1E2BCC', name: platform };

  const alertsHtml = analysis.alerts?.length
    ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:16px;margin:12px 0">
        <div style="font-size:13px;font-weight:600;color:#991B1B;margin-bottom:8px">⚠️ Alertas del mes</div>
        ${analysis.alerts.map(a => `<div style="font-size:13px;color:#7F1D1D;padding:3px 0">• ${a}</div>`).join('')}
      </div>` : '';

  const highlightsHtml = analysis.highlights?.length
    ? `<div style="background:${colors.bg};border-radius:8px;padding:16px;margin:12px 0">
        <div style="font-size:13px;font-weight:600;color:${colors.accent};margin-bottom:8px">✨ Destacados del mes</div>
        ${analysis.highlights.map(h => `<div style="font-size:13px;color:#374151;padding:3px 0">• ${h}</div>`).join('')}
      </div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:620px;margin:0 auto;background:#f8fafc;padding:0">

  <!-- Header -->
  <div style="background:${colors.accent};padding:28px 28px 20px;border-radius:12px 12px 0 0">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
      <span style="font-size:22px">📊</span>
      <div>
        <div style="color:white;font-size:18px;font-weight:700">Reporte mensual · ${colors.name}</div>
        <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:2px">${month.charAt(0).toUpperCase() + month.slice(1)} · generado por Acuarius</div>
      </div>
    </div>
  </div>

  <!-- Body -->
  <div style="background:white;padding:24px 28px">

    <!-- Resumen ejecutivo -->
    <div style="background:#F9FAFB;border-left:3px solid ${colors.accent};border-radius:0 8px 8px 0;padding:16px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Resumen ejecutivo</div>
      <p style="font-size:14px;line-height:1.65;color:#374151;margin:0">${analysis.summary}</p>
    </div>

    ${alertsHtml}
    ${highlightsHtml}

    <!-- Tabla de métricas -->
    <div style="margin:20px 0">
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px">Comparativa mes a mes</div>
      <div style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden">
        ${buildMetricsTable(platform, current, previous)}
      </div>
    </div>

    <!-- Recomendaciones -->
    ${analysis.recommendations?.length ? `
    <div style="margin:20px 0">
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px">🎯 Plan de acción para el próximo mes</div>
      <div style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden">
        ${analysis.recommendations.map((r, i) => `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;${i < analysis.recommendations.length - 1 ? 'border-bottom:1px solid #F3F4F6' : ''}">
            <span style="width:22px;height:22px;border-radius:50%;background:${colors.bg};color:${colors.accent};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i + 1}</span>
            <span style="font-size:13px;color:#374151;line-height:1.5">${r}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center;padding:20px 0 8px">
      <a href="https://app.acuarius.app" style="display:inline-block;background:${colors.accent};color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">
        Ver análisis completo en Acuarius →
      </a>
    </div>

  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:20px;font-size:12px;color:#9CA3AF;border-radius:0 0 12px 12px">
    Acuarius · <a href="https://acuarius.app" style="color:#9CA3AF">acuarius.app</a> ·
    <a href="https://app.acuarius.app/?action=unsubscribe-reports" style="color:#9CA3AF">Cancelar reportes</a>
  </div>

</body>
</html>`;
}

async function fetchMonthlyMetrics(userId, platform, connection) {
  try {
    if (platform === 'google_ads') {
      const [current, previous] = await Promise.all([
        fetch(`https://app.acuarius.app/api/google-ads?action=get-account-overview&userId=${encodeURIComponent(userId)}&customerId=${connection.account_id?.replace(/-/g, '')}&dateRange=LAST_30_DAYS`).then(r => r.json()),
        fetch(`https://app.acuarius.app/api/google-ads?action=get-account-overview&userId=${encodeURIComponent(userId)}&customerId=${connection.account_id?.replace(/-/g, '')}&dateRange=LAST_60_DAYS`).then(r => r.json()),
      ]);
      // LAST_60_DAYS acumula los 2 meses — aproximamos el mes anterior restando
      if (current && previous && !current.error && !previous.error) {
        const prev = {
          totalCost:    ((parseFloat(previous.totalCost || 0) - parseFloat(current.totalCost || 0))).toFixed(2),
          impressions:  Math.max(0, (previous.impressions || 0) - (current.impressions || 0)),
          clicks:       Math.max(0, (previous.clicks || 0) - (current.clicks || 0)),
          conversions:  Math.max(0, (previous.conversions || 0) - (current.conversions || 0)),
          ctr:          previous.ctr || '0.00',
          avgCpc:       previous.avgCpc || '0.00',
          cpa:          previous.cpa || '0.00',
        };
        return { current, previous: prev };
      }
    }
    if (platform === 'meta_ads') {
      const [current, previous] = await Promise.all([
        fetch(`https://app.acuarius.app/api/meta-ads?action=get-account-overview&userId=${encodeURIComponent(userId)}&adAccountId=${connection.account_id}&datePreset=last_month`).then(r => r.json()),
        fetch(`https://app.acuarius.app/api/meta-ads?action=get-account-overview&userId=${encodeURIComponent(userId)}&adAccountId=${connection.account_id}&datePreset=last_28d`).then(r => r.json()),
      ]);
      if (current && !current.error) {
        return { current, previous: previous?.error ? {} : previous };
      }
    }
  } catch (e) {
    console.error(`fetchMonthlyMetrics error ${platform}:`, e.message);
  }
  return null;
}

async function processUser(userId) {
  const [connections, userRow] = await Promise.all([
    supabaseReq(`/platform_connections?user_id=eq.${encodeURIComponent(userId)}&select=platform,account_id,account_name`).catch(() => []),
    supabaseReq(`/users?id=eq.${encodeURIComponent(userId)}&select=email,email_reports`).catch(() => []),
  ]);

  if (!connections?.length) return 0;
  const userEmail   = userRow?.[0]?.email;
  const emailReports = userRow?.[0]?.email_reports !== false;

  let saved = 0;
  for (const conn of connections) {
    if (!conn.account_id) continue;
    if (!['google_ads', 'meta_ads'].includes(conn.platform)) continue;

    try {
      const result = await fetchMonthlyMetrics(userId, conn.platform, conn);
      if (!result) continue;
      const { current, previous } = result;

      const analysis = await generateMonthlyAnalysis(getPlatformName(conn.platform), current, previous);

      // Guardar snapshot mensual
      await supabaseReq('/performance_snapshots', 'POST', {
        user_id:      userId,
        agent:        conn.platform,
        period_label: getMonthLabel(),
        period_type:  'monthly',
        metrics:      { current, previous },
        analysis:     `${analysis.summary}\n\nPlan de acción:\n${analysis.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
      }).catch(() => {});
      saved++;

      // Enviar email
      if (RESEND_API_KEY && userEmail && emailReports) {
        const html = buildMonthlyEmail(conn.platform, current, previous, analysis);
        const monthCap = getMonthLabel().charAt(0).toUpperCase() + getMonthLabel().slice(1);
        await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            from:    'reportes@app.acuarius.app',
            to:      userEmail,
            subject: `📊 Reporte mensual ${getPlatformName(conn.platform)} — ${monthCap}`,
            html,
          }),
        }).catch(e => console.error('Monthly email error:', e.message));
      }
    } catch (e) {
      console.error(`processUser monthly error ${userId}/${conn.platform}:`, e.message);
    }
  }
  return saved;
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) return res.status(401).end();

  try {
    const [connections, paidUsers] = await Promise.all([
      supabaseReq('/platform_connections?select=user_id&order=user_id'),
      supabaseReq('/users?plan=in.(pro,agency,admin)&select=id'),
    ]);

    if (!connections?.length) return res.json({ ok: true, processed: 0, snapshots: 0 });

    const paidIds     = new Set((paidUsers || []).map(u => u.id));
    const uniqueUsers = [...new Set(connections.map(c => c.user_id).filter(id => paidIds.has(id)))];

    let totalSnapshots = 0;
    for (const userId of uniqueUsers) {
      try {
        totalSnapshots += await processUser(userId);
      } catch (e) {
        console.error('cron-monthly error:', userId, e.message);
      }
      await new Promise(r => setTimeout(r, 600));
    }

    return res.json({ ok: true, processed: uniqueUsers.length, snapshots: totalSnapshots, type: 'monthly' });
  } catch (err) {
    console.error('cron-monthly-reports error:', err);
    return res.status(500).json({ error: err.message });
  }
}
