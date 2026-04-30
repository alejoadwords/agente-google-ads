// api/meta-ads.js
// Proxy para Meta Marketing API con action router y token desde Supabase
// GET ?action=get-ad-accounts|get-campaigns|get-adsets|get-ads|get-account-overview
// POST sin action → legacy proxy para backward compat

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const META_BASE           = 'https://graph.facebook.com/v19.0';

// ── Supabase helper ──────────────────────────────────────────
async function getStoredToken(userId) {
  if (!userId || !SUPABASE_URL) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads&select=access_token,token_expires_at,account_id`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const rows = await res.json();
  return rows?.[0] || null;
}

// ── Meta API helpers ─────────────────────────────────────────
async function metaGet(endpoint, params, token) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${META_BASE}/${endpoint}?${qs}`);
  const data = await res.json();
  if (data.error) {
    if (data.error.code === 190) throw Object.assign(new Error('Token expirado'), { code: 190 });
    if (data.error.code === 613) throw Object.assign(new Error('Rate limit Meta API'), { code: 613 });
    throw new Error(data.error.message);
  }
  return data;
}

async function metaPost(endpoint, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${META_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (data.error) {
    if (data.error.code === 190) throw Object.assign(new Error('Token expirado'), { code: 190 });
    if (data.error.code === 613) throw Object.assign(new Error('Rate limit Meta API'), { code: 613 });
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data;
}

const OBJECTIVE_TO_GOAL = {
  OUTCOME_LEADS:       'LEAD_GENERATION',
  OUTCOME_TRAFFIC:     'LINK_CLICKS',
  OUTCOME_AWARENESS:   'REACH',
  OUTCOME_SALES:       'OFFSITE_CONVERSIONS',
  OUTCOME_ENGAGEMENT:  'POST_ENGAGEMENT',
};

// Mapeo nombre de país → código ISO para LatAm + ES/US
const COUNTRY_NAME_TO_CODE = {
  'colombia': 'CO', 'mexico': 'MX', 'méxico': 'MX', 'argentina': 'AR',
  'chile': 'CL', 'peru': 'PE', 'perú': 'PE', 'ecuador': 'EC',
  'venezuela': 'VE', 'bolivia': 'BO', 'uruguay': 'UY', 'paraguay': 'PY',
  'costa rica': 'CR', 'panama': 'PA', 'panamá': 'PA', 'guatemala': 'GT',
  'honduras': 'HN', 'el salvador': 'SV', 'nicaragua': 'NI',
  'republica dominicana': 'DO', 'república dominicana': 'DO', 'cuba': 'CU',
  'puerto rico': 'PR', 'españa': 'ES', 'spain': 'ES',
  'estados unidos': 'US', 'united states': 'US', 'usa': 'US',
};

function resolveCountryCode(input) {
  if (!input) return 'CO';
  const trimmed = input.trim();
  // Si ya es código ISO de 2 letras
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  return COUNTRY_NAME_TO_CODE[trimmed.toLowerCase()] || trimmed.toUpperCase().slice(0, 2);
}

// Agrega insights a una lista de objetos (campañas, ad sets, ads)
async function fetchInsights(ids, level, datePreset, token) {
  const insights = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const d = await metaGet(`${id}/insights`, {
        fields: 'impressions,clicks,ctr,cpc,cpm,reach,spend,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level,
      }, token);
      insights[id] = d.data?.[0] || {};
    } catch { insights[id] = {}; }
  }));
  return insights;
}

function parseActions(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const a = actions.find(x => x.action_type === type);
  return a ? parseFloat(a.value) : 0;
}

// ── Handler principal ────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── Legacy proxy (backward compat) ──────────────────────────
  if (!action) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { accessToken, adAccountId, endpoint, method = 'GET', params = {} } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'accessToken requerido' });
    if (!endpoint)    return res.status(400).json({ error: 'endpoint requerido' });
    try {
      let url, fetchOpts;
      if (method === 'GET') {
        const qs = new URLSearchParams({ ...params, access_token: accessToken });
        url = `${META_BASE}/${endpoint}?${qs}`;
        fetchOpts = { method: 'GET' };
      } else {
        url = `${META_BASE}/${endpoint}`;
        fetchOpts = { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, access_token: accessToken }) };
      }
      const apiRes  = await fetch(url, fetchOpts);
      const apiData = await apiRes.json();
      if (apiData.error) return res.status(400).json({ error: apiData.error.message, code: apiData.error.code });
      return res.status(200).json(apiData);
    } catch (err) {
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  // ── New action-based routes ──────────────────────────────────
  const userId      = req.query.userId     || (req.body && req.body.userId) || '';
  const adAccountId = req.query.adAccountId || (req.body && req.body.adAccountId) || '';
  const datePreset  = req.query.datePreset  || 'last_30d';

  try {
    let token = req.query.accessToken || (req.body && req.body.accessToken) || '';
    if (!token && userId) {
      const conn = await getStoredToken(userId);
      token = conn?.access_token || '';
    }
    if (!token) return res.status(401).json({ error: 'No hay token. Conecta tu cuenta de Meta Ads.', needsConnect: true });

    // ── get-ad-accounts ──────────────────────────────────────
    if (action === 'get-ad-accounts') {
      const data = await metaGet('me/adaccounts', {
        fields: 'id,name,currency,account_status,amount_spent,business',
      }, token);
      const accounts = (data.data || []).map(a => ({
        id:       a.id,
        name:     a.name,
        currency: a.currency,
        status:   a.account_status === 1 ? 'Activa' : 'Inactiva',
        spent:    parseFloat(a.amount_spent || 0) / 100,
        business: a.business?.name || '',
      }));
      return res.json({ accounts });
    }

    if (!adAccountId) return res.status(400).json({ error: 'adAccountId requerido' });

    // ── get-account-overview ─────────────────────────────────
    if (action === 'get-account-overview') {
      const data = await metaGet(`${adAccountId}/insights`, {
        fields: 'impressions,clicks,ctr,cpc,cpm,reach,spend,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level: 'account',
      }, token);
      const d = data.data?.[0] || {};
      const conversions = parseActions(d.actions, 'lead') || parseActions(d.actions, 'purchase') || parseActions(d.actions, 'offsite_conversion.fb_pixel_purchase');
      return res.json({
        reach:       parseInt(d.reach || 0),
        impressions: parseInt(d.impressions || 0),
        clicks:      parseInt(d.clicks || 0),
        ctr:         parseFloat(d.ctr || 0).toFixed(2),
        cpc:         parseFloat(d.cpc || 0).toFixed(2),
        cpm:         parseFloat(d.cpm || 0).toFixed(2),
        spend:       parseFloat(d.spend || 0).toFixed(2),
        frequency:   parseFloat(d.frequency || 0).toFixed(2),
        conversions: Math.round(conversions),
        cpa:         conversions > 0 ? (parseFloat(d.spend || 0) / conversions).toFixed(2) : '0.00',
      });
    }

    // ── get-campaigns ────────────────────────────────────────
    if (action === 'get-campaigns') {
      const data = await metaGet(`${adAccountId}/campaigns`, {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget',
        limit: 50,
      }, token);
      const campaigns = data.data || [];
      const ids = campaigns.map(c => c.id);
      const insights = await fetchInsights(ids, 'campaign', datePreset, token);

      return res.json({
        campaigns: campaigns.map(c => {
          const ins = insights[c.id] || {};
          const conversions = parseActions(ins.actions, 'lead') || parseActions(ins.actions, 'purchase') || 0;
          return {
            id:          c.id,
            name:        c.name,
            status:      c.status,
            objective:   c.objective,
            dailyBudget: c.daily_budget ? (parseInt(c.daily_budget) / 100).toFixed(2) : null,
            impressions: parseInt(ins.impressions || 0),
            clicks:      parseInt(ins.clicks || 0),
            ctr:         parseFloat(ins.ctr || 0).toFixed(2),
            cpc:         parseFloat(ins.cpc || 0).toFixed(2),
            reach:       parseInt(ins.reach || 0),
            frequency:   parseFloat(ins.frequency || 0).toFixed(2),
            spend:       parseFloat(ins.spend || 0).toFixed(2),
            conversions: Math.round(conversions),
            cpa:         conversions > 0 ? (parseFloat(ins.spend || 0) / conversions).toFixed(2) : '0.00',
          };
        }),
      });
    }

    // ── get-adsets ───────────────────────────────────────────
    if (action === 'get-adsets') {
      const campaignId = req.query.campaignId || '';
      const endpoint = campaignId ? `${campaignId}/adsets` : `${adAccountId}/adsets`;
      const data = await metaGet(endpoint, {
        fields: 'id,name,status,daily_budget,targeting',
        limit: 50,
      }, token);
      const adsets = data.data || [];
      const ids = adsets.map(a => a.id);
      const insights = await fetchInsights(ids, 'adset', datePreset, token);

      return res.json({
        adsets: adsets.map(a => {
          const ins = insights[a.id] || {};
          return {
            id:          a.id,
            name:        a.name,
            status:      a.status,
            dailyBudget: a.daily_budget ? (parseInt(a.daily_budget) / 100).toFixed(2) : null,
            ageMin:      a.targeting?.age_min,
            ageMax:      a.targeting?.age_max,
            impressions: parseInt(ins.impressions || 0),
            clicks:      parseInt(ins.clicks || 0),
            ctr:         parseFloat(ins.ctr || 0).toFixed(2),
            cpc:         parseFloat(ins.cpc || 0).toFixed(2),
            reach:       parseInt(ins.reach || 0),
            frequency:   parseFloat(ins.frequency || 0).toFixed(2),
            spend:       parseFloat(ins.spend || 0).toFixed(2),
          };
        }),
      });
    }

    // ── get-ads ──────────────────────────────────────────────
    if (action === 'get-ads') {
      const campaignId = req.query.campaignId || '';
      const endpoint = campaignId ? `${campaignId}/ads` : `${adAccountId}/ads`;
      const data = await metaGet(endpoint, {
        fields: 'id,name,status,creative{title,body,image_url}',
        limit: 30,
      }, token);
      const ads = data.data || [];
      const ids = ads.map(a => a.id);
      const insights = await fetchInsights(ids, 'ad', datePreset, token);

      return res.json({
        ads: ads.map(a => {
          const ins = insights[a.id] || {};
          return {
            id:          a.id,
            name:        a.name,
            status:      a.status,
            title:       a.creative?.title,
            body:        a.creative?.body,
            imageUrl:    a.creative?.image_url,
            impressions: parseInt(ins.impressions || 0),
            clicks:      parseInt(ins.clicks || 0),
            ctr:         parseFloat(ins.ctr || 0).toFixed(2),
            cpc:         parseFloat(ins.cpc || 0).toFixed(2),
            spend:       parseFloat(ins.spend || 0).toFixed(2),
          };
        }),
      });
    }

    // ── create-campaign ──────────────────────────────────────
    if (action === 'create-campaign') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST requerido' });
      const {
        name        = 'Nueva campaña',
        objective   = 'OUTCOME_LEADS',
        budgetUSD   = 10,
        durationDays,          // null / undefined = sin fecha fin
        country     = 'MX',
        city,                  // optional string
        ageMin      = 18,
        ageMax      = 65,
        gender,                // 'male' | 'female' | 'all' | undefined
      } = req.body || {};

      if (!adAccountId) return res.status(400).json({ error: 'adAccountId requerido' });

      // 1. Crear campaña
      const campaign = await metaPost(`${adAccountId}/campaigns`, {
        name,
        objective,
        status:               'PAUSED',
        special_ad_categories: '[]',
      }, token);

      const campaignId = campaign.id;
      if (!campaignId) throw new Error('Meta no devolvió un campaign id');

      // 2. Construir targeting
      const countryCode = resolveCountryCode(country);
      const geoLocations = { countries: [countryCode] };

      const targeting = {
        age_min:       parseInt(ageMin) || 18,
        age_max:       parseInt(ageMax) || 65,
        geo_locations: geoLocations,
      };
      // gender: 1 = hombres, 2 = mujeres, 0/undefined = todos
      const genderNum = parseInt(gender);
      if (genderNum === 1) targeting.genders = [1];
      if (genderNum === 2) targeting.genders = [2];

      // 3. Fechas
      const nowUnix = Math.floor(Date.now() / 1000);
      const adsetParams = {
        name:               `${name} — AdSet`,
        campaign_id:        campaignId,
        daily_budget:       String(Math.round(parseFloat(budgetUSD) * 100)), // cents
        billing_event:      'IMPRESSIONS',
        optimization_goal:  OBJECTIVE_TO_GOAL[objective] || 'LINK_CLICKS',
        targeting:          JSON.stringify(targeting),
        status:             'PAUSED',
        start_time:         String(nowUnix + 3600), // comienza en 1h
      };
      if (durationDays && parseInt(durationDays) > 0) {
        adsetParams.end_time = String(nowUnix + parseInt(durationDays) * 86400);
      }

      const adset = await metaPost(`${adAccountId}/adsets`, adsetParams, token);
      const adsetId = adset.id;
      if (!adsetId) throw new Error('Meta no devolvió un adset id');

      return res.json({ campaignId, adsetId });
    }

    // ── update-campaign ──────────────────────────────────────
    // Cambia el estado (ACTIVE/PAUSED) y/o el presupuesto diario de una campaña
    if (action === 'update-campaign') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST requerido' });
      const {
        campaignId,
        status,         // 'ACTIVE' | 'PAUSED'
        budgetUSD,      // nuevo presupuesto diario en USD (opcional)
        adsetId,        // si se pasa, también actualiza el adset
      } = req.body || {};

      if (!campaignId) return res.status(400).json({ error: 'campaignId requerido' });

      // Actualizar campaña
      const campaignParams = {};
      if (status) campaignParams.status = status;

      if (Object.keys(campaignParams).length) {
        await metaPost(campaignId, campaignParams, token);
      }

      // Actualizar presupuesto del adset si se pide
      if (budgetUSD && adsetId) {
        await metaPost(adsetId, {
          daily_budget: String(Math.round(parseFloat(budgetUSD) * 100)),
        }, token);
      }

      return res.json({ ok: true, campaignId, status: status || 'unchanged' });
    }

    return res.status(400).json({ error: 'action no reconocido' });

  } catch (err) {
    if (err.code === 613) return res.status(429).json({ error: 'Rate limit de Meta API. Intenta de nuevo en 60 segundos.', retryAfter: 60 });
    if (err.code === 190) return res.status(401).json({ error: 'Token de Meta expirado. Reconecta tu cuenta.', needsConnect: true });
    console.error('meta-ads action error:', err);
    return res.status(500).json({ error: err.message });
  }
}
