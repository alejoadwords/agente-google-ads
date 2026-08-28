// api/dashboard.js — Live client dashboard backend
// POST /api/dashboard             → create / update dashboard (auth required)
// GET  /api/dashboard?id=xxx      → fetch dashboard data (public, no auth)

export const config = { runtime: 'edge' };

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY       = process.env.ANTHROPIC_API_KEY;
const DEV_TOKEN           = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const MCC_ID              = process.env.GOOGLE_ADS_MCC_ID;
const META_BASE           = 'https://graph.facebook.com/v19.0';
const CACHE_TTL_MS        = 60 * 60 * 1000; // 60 minutes

import { registrarUso, cuentaDe } from './_uso-ia.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Clerk JWT verification ────────────────────────────────────────────────────
async function verifyClerkToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation',
  };
}

async function getDashboard(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/client_dashboards?id=eq.${id}&is_active=eq.true&select=*`,
    { headers: sbHeaders() }
  );
  const rows = await res.json();
  return rows?.[0] || null;
}

async function saveDashboard(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/client_dashboards`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(payload),
  });
  const rows = await res.json();
  return rows?.[0] || null;
}

async function patchDashboard(id, userId, patch) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/client_dashboards?id=eq.${id}&user_id=eq.${userId}`,
    { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(patch) }
  );
  const rows = await res.json();
  return rows?.[0] || null;
}

async function getConnection(userId, platform) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.${platform}&select=access_token,refresh_token,token_expires_at,account_id`,
    { headers: sbHeaders() }
  );
  const rows = await res.json();
  return rows?.[0] || null;
}

async function incrementViews(id) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/client_dashboards?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ views: 0 }),
    }
  ).catch(() => {});
  // Use RPC if available, otherwise just patch updated_at
}

// ── Google Ads helpers ────────────────────────────────────────────────────────
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

// Sondeo de versión de la API (las versiones se deprecan — mismo patrón que api/google-ads.js)
let _dashApiVersion = null;
async function getApiVersion(customerId, accessToken) {
  if (_dashApiVersion) return _dashApiVersion;
  const mccId = (MCC_ID || '').replace(/-/g, '');
  const loginId = mccId || customerId;
  for (const ver of [22, 21, 20, 19, 18]) {
    const h = { 'Authorization': `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN, 'Content-Type': 'application/json' };
    if (loginId) h['login-customer-id'] = loginId;
    try {
      const r = await fetch(
        `https://googleads.googleapis.com/v${ver}/customers/${customerId}/googleAds:search`,
        { method: 'POST', headers: h, body: JSON.stringify({ query: 'SELECT customer.id FROM customer LIMIT 1' }) }
      );
      const raw = await r.text();
      if (r.status === 404 || raw.startsWith('<!')) continue;
      if (r.status === 400 && raw.includes('UNSUPPORTED_VERSION')) continue;
      _dashApiVersion = ver;
      return ver;
    } catch { continue; }
  }
  return 19;
}

async function gaqlFetch(customerId, query, accessToken) {
  const h = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (MCC_ID) h['login-customer-id'] = MCC_ID.replace(/-/g, '');
  const ver = await getApiVersion(customerId, accessToken);
  const res = await fetch(
    `https://googleads.googleapis.com/v${ver}/customers/${customerId}/googleAds:search`,
    { method: 'POST', headers: h, body: JSON.stringify({ query }) }
  );
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error(`Google Ads ${res.status}: ${errTxt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.results || [];
}

async function fetchGoogleAdsData(userId, customerId, dateFrom, dateTo) {
  if (!customerId) { console.error('[dashboard] google_ads sin cuenta configurada'); return null; }
  const conn = await getConnection(userId, 'google_ads');
  if (!conn) return null;

  let token = conn.access_token;
  // Refresh if expired or near expiry
  if (conn.refresh_token && conn.token_expires_at) {
    const exp = new Date(conn.token_expires_at).getTime();
    if (exp - Date.now() < 5 * 60 * 1000) {
      const fresh = await refreshGoogleToken(conn.refresh_token);
      if (fresh.access_token) token = fresh.access_token;
    }
  }

  const cid = customerId.replace(/-/g, '');

  // Overview totals
  const overviewQuery = `
    SELECT
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM customer
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  `;

  // Daily spend for line chart
  const dailyQuery = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM customer
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
    ORDER BY segments.date ASC
  `;

  // Campaign breakdown
  const campaignQuery = `
    SELECT
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 10
  `;

  // Si el token guardado ya no sirve (401), refrescar una vez y reintentar
  const safeFetch = async (q) => {
    try { return await gaqlFetch(cid, q, token); }
    catch (e) {
      if (String(e.message).includes('401') && conn.refresh_token) {
        const fresh = await refreshGoogleToken(conn.refresh_token);
        if (fresh.access_token) {
          token = fresh.access_token;
          try { return await gaqlFetch(cid, q, token); }
          catch (e2) { console.error('[dashboard] gaql retry error:', e2.message); return []; }
        }
      }
      console.error('[dashboard] gaql error:', e.message);
      return [];
    }
  };
  const overviewRows = await safeFetch(overviewQuery);
  const [dailyRows, campaignRows] = await Promise.all([safeFetch(dailyQuery), safeFetch(campaignQuery)]);

  const ov = overviewRows[0]?.metrics || {};
  const spend = (ov.costMicros || 0) / 1e6;
  const conversionsValue = ov.conversionsValue || 0;

  return {
    platform: 'google_ads',
    spend: spend,
    clicks: ov.clicks || 0,
    impressions: ov.impressions || 0,
    conversions: ov.conversions || 0,
    ctr: ov.ctr || 0,
    cpc: (ov.averageCpc || 0) / 1e6,
    cpa: ov.conversions > 0 ? spend / ov.conversions : 0,
    roas: spend > 0 ? conversionsValue / spend : 0,
    daily: dailyRows.map(r => ({
      date: r.segments?.date,
      spend: (r.metrics?.costMicros || 0) / 1e6,
      clicks: r.metrics?.clicks || 0,
      conversions: r.metrics?.conversions || 0,
    })),
    campaigns: campaignRows.map(r => ({
      name: r.campaign?.name,
      status: r.campaign?.status,
      spend: (r.metrics?.costMicros || 0) / 1e6,
      clicks: r.metrics?.clicks || 0,
      impressions: r.metrics?.impressions || 0,
      conversions: r.metrics?.conversions || 0,
      ctr: r.metrics?.ctr || 0,
      cpc: (r.metrics?.averageCpc || 0) / 1e6,
    })),
  };
}

// ── Meta Ads helpers ──────────────────────────────────────────────────────────
async function fetchMetaAdsData(userId, accountId, dateFrom, dateTo) {
  const conn = await getConnection(userId, 'meta_ads');
  if (!conn) return null;
  const token = conn.access_token;
  const actId = accountId || conn.account_id;
  if (!actId) return null;

  const fields = 'spend,clicks,impressions,actions,action_values,ctr,cpc,cpp';
  const params = new URLSearchParams({
    access_token: token,
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    fields,
    level: 'account',
  });

  const dailyParams = new URLSearchParams({
    access_token: token,
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    fields: 'spend,clicks,impressions,actions',
    time_increment: '1',
    level: 'account',
  });

  const campaignParams = new URLSearchParams({
    access_token: token,
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    fields: 'campaign_name,spend,clicks,impressions,actions,ctr,cpc',
    level: 'campaign',
    sort: 'spend_descending',
    limit: '10',
  });

  const [ovRes, dailyRes, campRes] = await Promise.all([
    fetch(`${META_BASE}/act_${actId}/insights?${params}`).then(r => r.json()).catch(() => ({})),
    fetch(`${META_BASE}/act_${actId}/insights?${dailyParams}`).then(r => r.json()).catch(() => ({})),
    fetch(`${META_BASE}/act_${actId}/insights?${campaignParams}`).then(r => r.json()).catch(() => ({})),
  ]);

  const ov = ovRes.data?.[0] || {};
  const getAction = (actions, type) => {
    const a = (actions || []).find(x => x.action_type === type);
    return parseFloat(a?.value || 0);
  };
  const conversions = getAction(ov.actions, 'offsite_conversion.fb_pixel_purchase')
    || getAction(ov.actions, 'lead')
    || getAction(ov.actions, 'omni_purchase');
  const convValue = getAction(ov.action_values, 'offsite_conversion.fb_pixel_purchase')
    || getAction(ov.action_values, 'omni_purchase');
  const spend = parseFloat(ov.spend || 0);

  return {
    platform: 'meta_ads',
    spend,
    clicks: parseInt(ov.clicks || 0),
    impressions: parseInt(ov.impressions || 0),
    conversions,
    ctr: parseFloat(ov.ctr || 0),
    cpc: parseFloat(ov.cpc || 0),
    cpa: conversions > 0 ? spend / conversions : 0,
    roas: spend > 0 ? convValue / spend : 0,
    daily: (dailyRes.data || []).map(r => {
      const rConv = getAction(r.actions, 'offsite_conversion.fb_pixel_purchase')
        || getAction(r.actions, 'lead')
        || getAction(r.actions, 'omni_purchase');
      return {
        date: r.date_start,
        spend: parseFloat(r.spend || 0),
        clicks: parseInt(r.clicks || 0),
        conversions: rConv,
      };
    }),
    campaigns: (campRes.data || []).map(r => {
      const rConv = getAction(r.actions, 'offsite_conversion.fb_pixel_purchase')
        || getAction(r.actions, 'lead')
        || getAction(r.actions, 'omni_purchase');
      return {
        name: r.campaign_name,
        spend: parseFloat(r.spend || 0),
        clicks: parseInt(r.clicks || 0),
        impressions: parseInt(r.impressions || 0),
        conversions: rConv,
        ctr: parseFloat(r.ctr || 0),
        cpc: parseFloat(r.cpc || 0),
      };
    }),
  };
}

// ── AI Insights ───────────────────────────────────────────────────────────────
async function generateInsights(platformsData, period, clientName, userId) {
  if (!ANTHROPIC_KEY) return null;

  const summary = platformsData.map(p => {
    const pName = p.platform === 'google_ads' ? 'Google Ads' : p.platform === 'meta_ads' ? 'Meta Ads' : p.platform;
    return `${pName}: $${p.spend.toFixed(0)} invertidos, ${p.clicks} clics, ${p.conversions.toFixed(0)} conversiones, ROAS ${p.roas.toFixed(2)}x, CPA $${p.cpa.toFixed(0)}`;
  }).join('\n');

  const prompt = `Eres un analista experto en marketing digital. Analiza estos datos de rendimiento de campañas para "${clientName}" en los últimos ${period}:

${summary}

Responde en formato JSON con esta estructura exacta:
{
  "observaciones": ["obs1", "obs2", "obs3"],
  "alertas": ["alerta1", "alerta2"],
  "recomendaciones": ["rec1", "rec2", "rec3"]
}

Sé específico, usa los números reales. Máximo 2 oraciones por punto.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.usage && userId) {
    await registrarUso({ userId: await cuentaDe(userId), actorId: userId, origen: 'dashboard',
      agente: 'insights', modelo: 'claude-haiku-4-5-20251001', uso: data.usage });
  }
  const text = data.content?.[0]?.text || '';
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function periodToDates(period, dateFrom, dateTo) {
  if (dateFrom && dateTo) return { from: dateFrom, to: dateTo };
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const d = new Date(today);
  const days = period === '7d' ? 7 : period === '14d' ? 14 : period === '90d' ? 90 : 30;
  d.setDate(d.getDate() - days);
  return { from: d.toISOString().slice(0, 10), to };
}

// ── POST handler — create/update dashboard ────────────────────────────────────
async function handlePost(req) {
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const userId = token ? await verifyClerkToken(token) : null;
  if (!userId) return json({ error: 'No autorizado' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Body inválido' }, 400); }

  const { action, dashboardId } = body;

  // Update existing dashboard settings
  if (action === 'update' && dashboardId) {
    const allowed = ['client_name', 'agency_name', 'agency_color', 'period', 'date_from', 'date_to', 'platforms', 'manual_data', 'is_active', 'google_ads_account', 'meta_ads_account'];
    const patch = {};
    for (const k of allowed) { if (body[k] !== undefined) patch[k] = body[k]; }
    patch.updated_at = new Date().toISOString();
    patch.cached_at = null; // configuración nueva → invalidar caché de datos
    const updated = await patchDashboard(dashboardId, userId, patch);
    if (!updated) return json({ error: 'No encontrado' }, 404);
    return json({ ok: true, id: dashboardId });
  }

  // Delete
  if (action === 'delete' && dashboardId) {
    await patchDashboard(dashboardId, userId, { is_active: false, updated_at: new Date().toISOString() });
    return json({ ok: true });
  }

  // Create new dashboard
  const { client_name, agency_name, agency_color, period, date_from, date_to, platforms, manual_data, google_ads_account, meta_ads_account } = body;
  if (!client_name) return json({ error: 'client_name es requerido' }, 400);

  const payload = {
    user_id: userId,
    client_name,
    agency_name: agency_name || null,
    agency_color: agency_color || '#1E2BCC',
    period: period || '30d',
    date_from: date_from || null,
    date_to: date_to || null,
    platforms: platforms || [],
    manual_data: manual_data || {},
    google_ads_account: google_ads_account || null,
    meta_ads_account: meta_ads_account || null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const created = await saveDashboard(payload);
  if (!created?.id) return json({ error: 'Error al crear dashboard' }, 500);

  return json({ id: created.id, url: `/dashboard.html?id=${created.id}` }, 201);
}

// ── GET handler — serve dashboard data ───────────────────────────────────────
async function handleGet(url) {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);

  const dash = await getDashboard(id);
  if (!dash) return json({ error: 'Dashboard no encontrado' }, 404);

  // Increment view count async (fire and forget)
  fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_dashboard_views`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ dashboard_id: id }),
  }).catch(() => {});

  // Check cache freshness
  const cacheAge = dash.cached_at ? Date.now() - new Date(dash.cached_at).getTime() : Infinity;
  const insightsAge = dash.insights_at ? Date.now() - new Date(dash.insights_at).getTime() : Infinity;
  const needsRefresh = cacheAge > CACHE_TTL_MS;

  let platformsData = dash.cached_data?.platforms || [];
  let insights = dash.insights || null;

  if (needsRefresh && dash.user_id && dash.platforms?.length > 0) {
    const { from, to } = periodToDates(dash.period, dash.date_from, dash.date_to);
    const fetches = [];

    if (dash.platforms.includes('google_ads')) {
      fetches.push(
        fetchGoogleAdsData(dash.user_id, dash.google_ads_account, from, to)
          .catch(() => null)
      );
    }
    if (dash.platforms.includes('meta_ads')) {
      fetches.push(
        fetchMetaAdsData(dash.user_id, dash.meta_ads_account, from, to)
          .catch(() => null)
      );
    }

    const results = await Promise.all(fetches);
    platformsData = results.filter(Boolean);

    // Generate insights if platforms have data
    if (platformsData.length > 0 && insightsAge > CACHE_TTL_MS) {
      insights = await generateInsights(platformsData, dash.period, dash.client_name, dash.user_id).catch(() => null);
    }

    // Save to cache
    const cachePatch = {
      cached_data: { platforms: platformsData },
      cached_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (insights) {
      cachePatch.insights = insights;
      cachePatch.insights_at = new Date().toISOString();
    }
    await fetch(
      `${SUPABASE_URL}/rest/v1/client_dashboards?id=eq.${id}`,
      { method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' }, body: JSON.stringify(cachePatch) }
    ).catch(() => {});
  }

  const { from, to } = periodToDates(dash.period, dash.date_from, dash.date_to);

  return json({
    id: dash.id,
    client_name: dash.client_name,
    agency_name: dash.agency_name,
    agency_color: dash.agency_color,
    period: dash.period,
    date_from: from,
    date_to: to,
    platforms: platformsData,
    manual_data: dash.manual_data || {},
    insights,
    cached_at: dash.cached_at,
    views: dash.views || 0,
  });
}

// ── List handler — get user's dashboards ──────────────────────────────────────
async function handleList(req) {
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const userId = token ? await verifyClerkToken(token) : null;
  if (!userId) return json({ error: 'No autorizado' }, 401);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/client_dashboards?user_id=eq.${userId}&is_active=eq.true&select=id,client_name,agency_name,period,platforms,views,created_at,updated_at&order=updated_at.desc&limit=50`,
    { headers: sbHeaders() }
  );
  const rows = await res.json();
  return json({ dashboards: rows || [] });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);

  if (req.method === 'POST') return handlePost(req);
  if (req.method === 'GET' && url.searchParams.get('action') === 'list') return handleList(req);
  if (req.method === 'GET') return handleGet(url);

  return json({ error: 'Método no permitido' }, 405);
}
