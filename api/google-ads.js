// api/google-ads.js
// Proxy para Google Ads API con soporte de action router y refresh de tokens
// GET  ?action=get-campaigns|get-keywords|get-account-overview|get-ads  (nuevas acciones)
// POST sin action → legacy GAQL proxy para backward compat

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DEV_TOKEN           = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const MCC_ID              = process.env.GOOGLE_ADS_MCC_ID;

// ── Supabase helpers ─────────────────────────────────────────
async function getStoredToken(userId) {
  if (!userId || !SUPABASE_URL) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_ads&select=access_token,refresh_token,token_expires_at`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const rows = await res.json();
  return rows?.[0] || null;
}

async function refreshGoogleToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  return res.json();
}

async function updateStoredToken(userId, accessToken, expiresIn) {
  if (!SUPABASE_URL) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_ads`,
    {
      method: 'PATCH',
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        access_token:     accessToken,
        token_expires_at: new Date(Date.now() + (expiresIn || 3600) * 1000).toISOString(),
        updated_at:       new Date().toISOString(),
      }),
    }
  );
}

// ── Google Ads API request con auto-refresh ──────────────────
async function gaqlRequest(customerId, query, accessToken, userId) {
  const makeHeaders = (token) => {
    const h = {
      'Authorization': `Bearer ${token}`,
      'developer-token': DEV_TOKEN,
      'Content-Type': 'application/json',
    };
    if (MCC_ID) h['login-customer-id'] = MCC_ID.replace(/-/g, '');
    return h;
  };

  const doRequest = (token) =>
    fetch(`https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers: makeHeaders(token),
      body: JSON.stringify({ query }),
    });

  let res = await doRequest(accessToken);

  // Si es 401, intentar refresh
  if (res.status === 401 && userId) {
    const conn = await getStoredToken(userId);
    if (conn?.refresh_token) {
      const refreshed = await refreshGoogleToken(conn.refresh_token);
      if (refreshed.access_token) {
        await updateStoredToken(userId, refreshed.access_token, refreshed.expires_in);
        res = await doRequest(refreshed.access_token);
      }
    }
  }

  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────
function formatCost(micros) { return parseFloat((Number(micros || 0) / 1000000).toFixed(2)); }

function isTestAccessError(data) {
  const s = JSON.stringify(data);
  return s.includes('DEVELOPER_TOKEN_NOT_APPROVED') || s.includes('TEST_ACCOUNT_CANNOT') || s.includes('test account');
}

// ── Handler principal ────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── Legacy GAQL proxy (backward compat) ─────────────────────
  if (!action) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { customerId, query, accessToken } = req.body;
    if (!customerId || !query || !accessToken) return res.status(400).json({ error: 'customerId, query y accessToken requeridos' });
    try {
      const headers = {
        'Authorization':   `Bearer ${accessToken}`,
        'developer-token': DEV_TOKEN,
        'Content-Type':    'application/json',
      };
      if (MCC_ID) headers['login-customer-id'] = MCC_ID.replace(/-/g, '');
      const r = await fetch(
        `https://googleads.googleapis.com/v18/customers/${customerId.replace(/-/g, '')}/googleAds:searchStream`,
        { method: 'POST', headers, body: JSON.stringify({ query }) }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: 'Error en Google Ads API', details: data });
      return res.status(200).json({ results: data });
    } catch (err) {
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  // ── New action-based routes ──────────────────────────────────
  const userId     = req.query.userId     || (req.body && req.body.userId) || '';
  const customerId = (req.query.customerId || (req.body && req.body.customerId) || '').replace(/-/g, '');
  const dateRange  = req.query.dateRange  || 'LAST_30_DAYS';

  try {
    // Obtener token de Supabase (o del body como fallback)
    let token = req.query.accessToken || (req.body && req.body.accessToken) || '';
    if (!token && userId) {
      const conn = await getStoredToken(userId);
      token = conn?.access_token || '';
    }
    if (!token) return res.status(401).json({ error: 'No hay token. Conecta tu cuenta de Google Ads.', needsConnect: true });
    if (!customerId) return res.status(400).json({ error: 'customerId requerido' });

    // ── get-account-overview ───────────────────────────────────
    if (action === 'get-account-overview') {
      const query = `
        SELECT metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
          metrics.conversions, metrics.cost_per_conversion, metrics.cost_micros, campaign.status
        FROM campaign
        WHERE segments.date DURING ${dateRange}
      `;
      const data = await gaqlRequest(customerId, query, token, userId);
      if (isTestAccessError(data)) return res.json({ testAccess: true });

      const rows = data.results || [];
      const totals = rows.reduce((acc, r) => {
        const m = r.metrics || {};
        acc.impressions += parseInt(m.impressions || 0);
        acc.clicks      += parseInt(m.clicks || 0);
        acc.conversions += parseFloat(m.conversions || 0);
        acc.costMicros  += parseInt(m.costMicros || 0);
        return acc;
      }, { impressions: 0, clicks: 0, conversions: 0, costMicros: 0 });

      return res.json({
        impressions:     totals.impressions,
        clicks:          totals.clicks,
        ctr:             totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0.00',
        avgCpc:          formatCost(totals.clicks > 0 ? totals.costMicros / totals.clicks : 0),
        conversions:     Math.round(totals.conversions),
        cpa:             formatCost(totals.conversions > 0 ? totals.costMicros / totals.conversions : 0),
        totalCost:       formatCost(totals.costMicros),
        activeCampaigns: rows.filter(r => r.campaign?.status === 'ENABLED').length,
        pausedCampaigns: rows.filter(r => r.campaign?.status === 'PAUSED').length,
      });
    }

    // ── get-campaigns ─────────────────────────────────────────
    if (action === 'get-campaigns') {
      const query = `
        SELECT campaign.id, campaign.name, campaign.status,
          campaign.advertising_channel_type, campaign.bidding_strategy_type,
          metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
          metrics.conversions, metrics.cost_per_conversion, metrics.cost_micros
        FROM campaign
        WHERE segments.date DURING ${dateRange}
        ORDER BY metrics.cost_micros DESC
      `;
      const data = await gaqlRequest(customerId, query, token, userId);
      if (isTestAccessError(data)) return res.json({ testAccess: true, campaigns: [] });

      const campaigns = (data.results || []).map(r => ({
        id:              r.campaign?.id,
        name:            r.campaign?.name,
        status:          r.campaign?.status,
        channelType:     r.campaign?.advertisingChannelType,
        biddingStrategy: r.campaign?.biddingStrategyType,
        impressions:     parseInt(r.metrics?.impressions || 0),
        clicks:          parseInt(r.metrics?.clicks || 0),
        ctr:             parseFloat(r.metrics?.ctr || 0).toFixed(2),
        avgCpc:          formatCost(r.metrics?.averageCpc || 0),
        conversions:     parseFloat(r.metrics?.conversions || 0).toFixed(1),
        cpa:             formatCost(r.metrics?.costPerConversion || 0),
        cost:            formatCost(r.metrics?.costMicros || 0),
      }));

      return res.json({ campaigns });
    }

    // ── get-keywords ─────────────────────────────────────────
    if (action === 'get-keywords') {
      const campaignId = req.query.campaignId || '';
      const query = `
        SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
          ad_group_criterion.status, metrics.impressions, metrics.clicks, metrics.ctr,
          metrics.average_cpc, metrics.conversions, metrics.cost_micros,
          campaign.name, ad_group.name
        FROM keyword_view
        WHERE segments.date DURING ${dateRange}
        ${campaignId ? `AND campaign.id = ${campaignId}` : ''}
        ORDER BY metrics.cost_micros DESC LIMIT 50
      `;
      const data = await gaqlRequest(customerId, query, token, userId);
      if (isTestAccessError(data)) return res.json({ testAccess: true, keywords: [] });

      const keywords = (data.results || []).map(r => ({
        text:      r.adGroupCriterion?.keyword?.text,
        matchType: r.adGroupCriterion?.keyword?.matchType,
        status:    r.adGroupCriterion?.status,
        campaign:  r.campaign?.name,
        adGroup:   r.adGroup?.name,
        impressions: parseInt(r.metrics?.impressions || 0),
        clicks:      parseInt(r.metrics?.clicks || 0),
        ctr:         parseFloat(r.metrics?.ctr || 0).toFixed(2),
        avgCpc:      formatCost(r.metrics?.averageCpc || 0),
        conversions: parseFloat(r.metrics?.conversions || 0).toFixed(1),
        cost:        formatCost(r.metrics?.costMicros || 0),
      }));

      return res.json({ keywords });
    }

    // ── get-ads ──────────────────────────────────────────────
    if (action === 'get-ads') {
      const campaignId = req.query.campaignId || '';
      const query = `
        SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
          ad_group_ad.ad.final_urls, metrics.impressions, metrics.clicks, metrics.ctr,
          metrics.conversions, metrics.cost_micros, campaign.name, ad_group.name
        FROM ad_group_ad
        WHERE segments.date DURING ${dateRange}
        ${campaignId ? `AND campaign.id = ${campaignId}` : ''}
        ORDER BY metrics.cost_micros DESC LIMIT 30
      `;
      const data = await gaqlRequest(customerId, query, token, userId);
      if (isTestAccessError(data)) return res.json({ testAccess: true, ads: [] });

      const ads = (data.results || []).map(r => ({
        id:          r.adGroupAd?.ad?.id,
        name:        r.adGroupAd?.ad?.name,
        status:      r.adGroupAd?.status,
        finalUrls:   r.adGroupAd?.ad?.finalUrls,
        campaign:    r.campaign?.name,
        adGroup:     r.adGroup?.name,
        impressions: parseInt(r.metrics?.impressions || 0),
        clicks:      parseInt(r.metrics?.clicks || 0),
        ctr:         parseFloat(r.metrics?.ctr || 0).toFixed(2),
        conversions: parseFloat(r.metrics?.conversions || 0).toFixed(1),
        cost:        formatCost(r.metrics?.costMicros || 0),
      }));

      return res.json({ ads });
    }

    // ── update-campaign-status ─────────────────────────────
    if (action === 'update-campaign-status') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { campaignId, status, confirm } = req.body || {};
      if (!confirm) return res.status(400).json({ error: 'confirm: true requerido' });
      if (!campaignId || !status) return res.status(400).json({ error: 'campaignId y status requeridos' });
      if (!['ENABLED', 'PAUSED'].includes(status)) return res.status(400).json({ error: 'status debe ser ENABLED o PAUSED' });

      // Verify customerId belongs to this user
      const conn = await getStoredToken(userId);
      if (!conn || (conn.account_id && conn.account_id.replace(/-/g, '') !== customerId)) {
        return res.status(403).json({ error: 'customerId no autorizado para este usuario' });
      }

      const mutateRes = await fetch(
        `https://googleads.googleapis.com/v18/customers/${customerId}/campaigns:mutate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'developer-token': DEV_TOKEN,
            'Content-Type': 'application/json',
            ...(MCC_ID ? { 'login-customer-id': MCC_ID.replace(/-/g, '') } : {}),
          },
          body: JSON.stringify({
            operations: [{
              updateMask: 'status',
              update: { resourceName: `customers/${customerId}/campaigns/${campaignId}`, status },
            }],
          }),
        }
      );
      const mutateData = await mutateRes.json();
      if (!mutateRes.ok) return res.status(mutateRes.status).json({ error: 'Error Google Ads API', details: mutateData });

      // Get campaign name for audit log
      const nameQuery = `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id = ${campaignId}`;
      const nameData = await gaqlRequest(customerId, nameQuery, token, userId).catch(() => ({}));
      const campaignName = nameData.results?.[0]?.campaign?.name || campaignId;

      return res.json({ ok: true, campaignName, newStatus: status });
    }

    // ── update-campaign-budget ─────────────────────────────
    if (action === 'update-campaign-budget') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { campaignBudgetId, newDailyBudgetMicros, confirm } = req.body || {};
      if (!confirm) return res.status(400).json({ error: 'confirm: true requerido' });
      if (!campaignBudgetId || !newDailyBudgetMicros) return res.status(400).json({ error: 'campaignBudgetId y newDailyBudgetMicros requeridos' });

      const conn = await getStoredToken(userId);
      if (!conn || (conn.account_id && conn.account_id.replace(/-/g, '') !== customerId)) {
        return res.status(403).json({ error: 'customerId no autorizado para este usuario' });
      }

      // Get old budget first
      const budgetQuery = `SELECT campaign_budget.amount_micros FROM campaign_budget WHERE campaign_budget.id = ${campaignBudgetId}`;
      const budgetData = await gaqlRequest(customerId, budgetQuery, token, userId).catch(() => ({}));
      const oldBudget = formatCost(budgetData.results?.[0]?.campaignBudget?.amountMicros || 0);

      const mutateRes = await fetch(
        `https://googleads.googleapis.com/v18/customers/${customerId}/campaignBudgets:mutate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'developer-token': DEV_TOKEN,
            'Content-Type': 'application/json',
            ...(MCC_ID ? { 'login-customer-id': MCC_ID.replace(/-/g, '') } : {}),
          },
          body: JSON.stringify({
            operations: [{
              updateMask: 'amount_micros',
              update: {
                resourceName: `customers/${customerId}/campaignBudgets/${campaignBudgetId}`,
                amountMicros: String(newDailyBudgetMicros),
              },
            }],
          }),
        }
      );
      const mutateData = await mutateRes.json();
      if (!mutateRes.ok) return res.status(mutateRes.status).json({ error: 'Error Google Ads API', details: mutateData });

      return res.json({ ok: true, oldBudget, newBudget: formatCost(newDailyBudgetMicros) });
    }

    // ── update-keyword-bid ─────────────────────────────────
    if (action === 'update-keyword-bid') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { adGroupId, criterionId, newCpcBidMicros, confirm } = req.body || {};
      if (!confirm) return res.status(400).json({ error: 'confirm: true requerido' });
      if (!adGroupId || !criterionId || !newCpcBidMicros) return res.status(400).json({ error: 'adGroupId, criterionId y newCpcBidMicros requeridos' });

      const conn = await getStoredToken(userId);
      if (!conn || (conn.account_id && conn.account_id.replace(/-/g, '') !== customerId)) {
        return res.status(403).json({ error: 'customerId no autorizado para este usuario' });
      }

      // Get old bid and keyword text
      const kwQuery = `
        SELECT ad_group_criterion.keyword.text, ad_group_criterion.cpc_bid_micros
        FROM ad_group_criterion
        WHERE ad_group_criterion.ad_group = 'customers/${customerId}/adGroups/${adGroupId}'
        AND ad_group_criterion.criterion_id = ${criterionId}
      `;
      const kwData = await gaqlRequest(customerId, kwQuery, token, userId).catch(() => ({}));
      const kwRow = kwData.results?.[0]?.adGroupCriterion || {};
      const keywordText = kwRow.keyword?.text || criterionId;
      const oldBid = formatCost(kwRow.cpcBidMicros || 0);

      const mutateRes = await fetch(
        `https://googleads.googleapis.com/v18/customers/${customerId}/adGroupCriteria:mutate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'developer-token': DEV_TOKEN,
            'Content-Type': 'application/json',
            ...(MCC_ID ? { 'login-customer-id': MCC_ID.replace(/-/g, '') } : {}),
          },
          body: JSON.stringify({
            operations: [{
              updateMask: 'cpc_bid_micros',
              update: {
                resourceName: `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`,
                cpcBidMicros: String(newCpcBidMicros),
              },
            }],
          }),
        }
      );
      const mutateData = await mutateRes.json();
      if (!mutateRes.ok) return res.status(mutateRes.status).json({ error: 'Error Google Ads API', details: mutateData });

      return res.json({ ok: true, keywordText, oldBid, newBid: formatCost(newCpcBidMicros) });
    }

    // ── update-adgroup-status ──────────────────────────────
    if (action === 'update-adgroup-status') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { adGroupId, status, confirm } = req.body || {};
      if (!confirm) return res.status(400).json({ error: 'confirm: true requerido' });
      if (!adGroupId || !status) return res.status(400).json({ error: 'adGroupId y status requeridos' });
      if (!['ENABLED', 'PAUSED'].includes(status)) return res.status(400).json({ error: 'status debe ser ENABLED o PAUSED' });

      const conn = await getStoredToken(userId);
      if (!conn || (conn.account_id && conn.account_id.replace(/-/g, '') !== customerId)) {
        return res.status(403).json({ error: 'customerId no autorizado para este usuario' });
      }

      const mutateRes = await fetch(
        `https://googleads.googleapis.com/v18/customers/${customerId}/adGroups:mutate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'developer-token': DEV_TOKEN,
            'Content-Type': 'application/json',
            ...(MCC_ID ? { 'login-customer-id': MCC_ID.replace(/-/g, '') } : {}),
          },
          body: JSON.stringify({
            operations: [{
              updateMask: 'status',
              update: { resourceName: `customers/${customerId}/adGroups/${adGroupId}`, status },
            }],
          }),
        }
      );
      const mutateData = await mutateRes.json();
      if (!mutateRes.ok) return res.status(mutateRes.status).json({ error: 'Error Google Ads API', details: mutateData });

      const nameQuery = `SELECT ad_group.id, ad_group.name FROM ad_group WHERE ad_group.id = ${adGroupId}`;
      const nameData = await gaqlRequest(customerId, nameQuery, token, userId).catch(() => ({}));
      const adGroupName = nameData.results?.[0]?.adGroup?.name || adGroupId;

      return res.json({ ok: true, adGroupName, newStatus: status });
    }

    return res.status(400).json({ error: 'action no reconocido' });

  } catch (err) {
    console.error('google-ads action error:', err);
    return res.status(500).json({ error: err.message });
  }
}
