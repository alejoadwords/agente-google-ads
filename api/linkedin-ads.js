// api/linkedin-ads.js
// Proxy para LinkedIn Campaign Manager API
// Maneja: list-accounts, get-campaigns, get-insights

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, accountId, action } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken requerido' });

  const headers = {
    Authorization:            `Bearer ${accessToken}`,
    'LinkedIn-Version':       '202406',
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type':           'application/json',
  };

  try {
    // ── Listar cuentas publicitarias ──────────────────────────
    if (action === 'list-accounts') {
      const url = 'https://api.linkedin.com/v2/adAccountsV2?q=search&search.status.values[0]=ACTIVE&count=50';
      const r   = await fetch(url, { headers });
      const data = await r.json();

      if (data.status === 401) {
        return res.status(401).json({ error: 'Token inválido o expirado. Vuelve a conectar tu cuenta de LinkedIn.' });
      }
      if (data.status === 403 || data.serviceErrorCode || (data.message && data.message.includes('Not enough permissions'))) {
        return res.status(403).json({ error: 'PENDING_APPROVAL' });
      }

      const elements = data.elements || [];
      const accounts = elements.map(acc => ({
        id:       String(acc.id),
        name:     acc.name || `Cuenta ${acc.id}`,
        currency: acc.currency || 'USD',
        status:   acc.status   || 'ACTIVE',
        type:     acc.type     || 'BUSINESS',
      }));

      return res.status(200).json({ accounts, total: accounts.length });
    }

    // ── Listar campañas de una cuenta ─────────────────────────
    if (action === 'get-campaigns') {
      if (!accountId) return res.status(400).json({ error: 'accountId requerido' });
      const urn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
      const url = `https://api.linkedin.com/v2/adCampaignsV2?q=search&search.account.values[0]=${urn}&search.status.values[0]=ACTIVE&count=20`;
      const r   = await fetch(url, { headers });
      const data = await r.json();

      const campaigns = (data.elements || []).map(c => ({
        id:            String(c.id),
        name:          c.name || `Campaña ${c.id}`,
        status:        c.status,
        objectiveType: c.objectiveType,
        costType:      c.costType,
        dailyBudget:   c.dailyBudget?.amount ? `${c.dailyBudget.amount} ${c.dailyBudget.currencyCode}` : null,
        totalBudget:   c.totalBudget?.amount  ? `${c.totalBudget.amount} ${c.totalBudget.currencyCode}` : null,
        startDate:     c.runSchedule?.start ? new Date(c.runSchedule.start).toISOString().slice(0, 10) : null,
        endDate:       c.runSchedule?.end   ? new Date(c.runSchedule.end).toISOString().slice(0, 10)   : null,
      }));

      return res.status(200).json({ campaigns });
    }

    // ── Métricas de rendimiento ───────────────────────────────
    if (action === 'get-insights') {
      if (!accountId) return res.status(400).json({ error: 'accountId requerido' });
      const { dateRange = 'LAST_30_DAYS' } = req.body;

      // Calcular fechas según rango
      const now   = new Date();
      const start = new Date(now);
      const days  = dateRange === 'LAST_7_DAYS' ? 7 : dateRange === 'LAST_14_DAYS' ? 14 : 30;
      start.setDate(now.getDate() - days);

      const fmt = d => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
      const urn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);

      const params = new URLSearchParams({
        q:                               'analytics',
        pivot:                           'ACCOUNT',
        'timeGranularity':               'ALL',
        'accounts[0]':                   `urn:li:sponsoredAccount:${accountId}`,
        'dateRange.start.year':          fmt(start).year,
        'dateRange.start.month':         fmt(start).month,
        'dateRange.start.day':           fmt(start).day,
        'dateRange.end.year':            fmt(now).year,
        'dateRange.end.month':           fmt(now).month,
        'dateRange.end.day':             fmt(now).day,
        'fields':                        'impressions,clicks,costInUsd,leads,externalWebsiteConversions,dateRange',
      });

      const r    = await fetch(`https://api.linkedin.com/v2/adAnalyticsV2?${params}`, { headers });
      const data = await r.json();

      const el = (data.elements || [])[0] || {};
      const insights = {
        impressions:   el.impressions   || 0,
        clicks:        el.clicks        || 0,
        spend:         el.costInUsd     ? parseFloat(el.costInUsd).toFixed(2) : '0.00',
        leads:         el.leads         || 0,
        conversions:   el.externalWebsiteConversions || 0,
        ctr:           el.impressions   ? ((el.clicks / el.impressions) * 100).toFixed(2) : '0.00',
        cpc:           el.clicks        ? (el.costInUsd / el.clicks).toFixed(2)           : '0.00',
        cpl:           el.leads         ? (el.costInUsd / el.leads).toFixed(2)            : '0.00',
      };

      return res.status(200).json({ insights, period: dateRange });
    }

    return res.status(400).json({ error: 'action no reconocido' });

  } catch (err) {
    console.error('linkedin-ads error:', err);
    return res.status(500).json({ error: 'Error consultando LinkedIn Ads API' });
  }
}
