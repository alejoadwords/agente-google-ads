// api/admin.js
// Consolida: admin-metrics.js + admin-users.js + admin-sync.js
// Rutas:
//   GET  /api/admin?action=metrics
//   GET  /api/admin?action=users
//   GET  /api/admin?action=users&id=X
//   PUT  /api/admin?action=users
//   POST /api/admin?action=sync

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-admin-secret,Cache-Control,Pragma',
};

function authCheck(req) {
  return req.headers['x-admin-secret'] === ADMIN_SECRET;
}

async function supabaseReq(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function clerkGetUser(id) {
  const res = await fetch(`https://api.clerk.com/v1/users/${id}`, {
    headers: { 'Authorization': `Bearer ${CLERK_SECRET}` }
  });
  return res.json();
}

async function clerkUpdateMetadata(id, metadata) {
  const res = await fetch(`https://api.clerk.com/v1/users/${id}/metadata`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CLERK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ public_metadata: metadata }),
  });
  return res.json();
}

// ── METRICS ──────────────────────────────────────────────
async function handleMetrics(req, res) {
  const [allUsers, billingAll, logsRecent] = await Promise.all([
    supabaseReq('/users?select=id,plan,status,created_at,trial_ends_at'),
    supabaseReq('/billing?select=amount,plan,status,created_at&status=eq.paid'),
    supabaseReq('/activity_logs?select=action,created_at&order=created_at.desc&limit=200'),
  ]);

  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo  = new Date(now - 7  * 24 * 60 * 60 * 1000);

  const totalUsers      = allUsers.length;
  const activeUsers     = allUsers.filter(u => u.status === 'active').length;
  const suspended       = allUsers.filter(u => u.status === 'suspended').length;
  const trialUsers      = allUsers.filter(u => u.plan === 'free' && new Date(u.trial_ends_at) > now).length;
  const individualUsers = allUsers.filter(u => u.plan === 'individual').length;
  const agencyUsers     = allUsers.filter(u => u.plan === 'agency').length;
  const newLast30       = allUsers.filter(u => new Date(u.created_at) > thirtyDaysAgo).length;
  const newLast7        = allUsers.filter(u => new Date(u.created_at) > sevenDaysAgo).length;

  const mrr          = (individualUsers * 19) + (agencyUsers * 19);
  const totalRevenue = billingAll.reduce((s, b) => s + parseFloat(b.amount), 0);
  const revenueThisMonth = billingAll
    .filter(b => new Date(b.created_at) > thirtyDaysAgo)
    .reduce((s, b) => s + parseFloat(b.amount), 0);

  const messagesLast7 = logsRecent.filter(l => l.action === 'message_sent'     && new Date(l.created_at) > sevenDaysAgo).length;
  const imagesLast7   = logsRecent.filter(l => l.action === 'image_generated'  && new Date(l.created_at) > sevenDaysAgo).length;

  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const trialsExpiringSoon = allUsers.filter(u =>
    u.plan === 'free' && new Date(u.trial_ends_at) > now && new Date(u.trial_ends_at) < threeDaysFromNow
  ).length;

  return res.json({
    overview: { totalUsers, activeUsers, suspended, trialUsers, individualUsers, agencyUsers, newLast30, newLast7, trialsExpiringSoon },
    revenue:  { mrr, totalRevenue: parseFloat(totalRevenue.toFixed(2)), revenueThisMonth: parseFloat(revenueThisMonth.toFixed(2)) },
    activity: { messagesLast7, imagesLast7 },
  });
}

// ── USERS ─────────────────────────────────────────────────
async function handleUsers(req, res) {
  // GET ?action=users&id=X → detalle
  if (req.method === 'GET' && req.query.id) {
    const [clerkUser, dbRows] = await Promise.all([
      clerkGetUser(req.query.id),
      supabaseReq(`/users?id=eq.${req.query.id}&select=*`),
    ]);
    const logs    = await supabaseReq(`/activity_logs?user_id=eq.${req.query.id}&order=created_at.desc&limit=50`);
    const billing = await supabaseReq(`/billing?user_id=eq.${req.query.id}&order=created_at.desc`);
    return res.json({ user: dbRows?.[0] || null, clerk: clerkUser, logs: logs || [], billing: billing || [] });
  }

  // GET ?action=users → listar
  if (req.method === 'GET') {
    const { plan, status, page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;
    let query = `/users?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (plan   && plan   !== 'all') query += `&plan=eq.${plan}`;
    if (status && status !== 'all') query += `&status=eq.${status}`;

    let countQuery = `/users?select=id`;
    if (plan   && plan   !== 'all') countQuery += `&plan=eq.${plan}`;
    if (status && status !== 'all') countQuery += `&status=eq.${status}`;

    const [users, countRes] = await Promise.all([supabaseReq(query), supabaseReq(countQuery)]);
    return res.json({
      users: users || [],
      total: countRes?.length || 0,
      page: parseInt(page),
      pages: Math.ceil((countRes?.length || 0) / limit),
    });
  }

  // PUT ?action=users → actualizar
  if (req.method === 'PUT') {
    const { id, plan, status, messages_limit, accounts_limit, agency_extra_accounts, notes } = req.body;
    if (!id) return res.status(400).json({ error: 'id requerido' });

    const updates = {};
    if (plan                  !== undefined) updates.plan                  = plan;
    if (status                !== undefined) updates.status                = status;
    if (messages_limit        !== undefined) updates.messages_limit        = messages_limit;
    if (accounts_limit        !== undefined) updates.accounts_limit        = accounts_limit;
    if (agency_extra_accounts !== undefined) updates.agency_extra_accounts = agency_extra_accounts;

    const dbResult = await supabaseReq(`/users?id=eq.${id}`, 'PATCH', updates);
    if (plan !== undefined) await clerkUpdateMetadata(id, { plan, status: status || 'active' });
    await supabaseReq('/activity_logs', 'POST', {
      user_id: id, action: 'admin_update', details: { changes: updates, notes: notes || '' },
    });
    return res.json({ success: true, user: dbResult?.[0] || null });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── CREATE TEST USER ──────────────────────────────────────
async function handleCreateTestUser(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { email, name, password, plan, status, trial_days, messages_limit, accounts_limit, notes } = req.body;
  if (!email) return res.status(400).json({ error: 'email requerido' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  // 1. Crear usuario en Clerk con email + contraseña
  const firstName = name ? name.split(' ')[0] : 'Test';
  const lastName  = name ? name.split(' ').slice(1).join(' ') : 'User';

  const clerkRes = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLERK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_address: [email],
      password,
      first_name: firstName,
      last_name: lastName,
      public_metadata: { plan: plan || 'free', status: status || 'active', is_test_user: true },
      skip_password_checks: true,
    }),
  });

  const clerkData = await clerkRes.json();
  if (!clerkRes.ok) {
    const detail = clerkData.errors?.[0]?.message || JSON.stringify(clerkData);
    return res.status(400).json({ error: 'Error al crear en Clerk: ' + detail });
  }

  const clerkId = clerkData.id; // ID real de Clerk, ej: user_2abc...

  // 2. Verificar el email automáticamente (sin esto Clerk bloquea el login)
  const emailId = clerkData.email_addresses?.[0]?.id;
  if (emailId) {
    await fetch(`https://api.clerk.com/v1/email_addresses/${emailId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${CLERK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ verified: true }),
    });
  }

  // 3. Insertar en Supabase con el ID real de Clerk
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + (parseInt(trial_days) || 7));

  const userData = {
    id: clerkId,
    email,
    name: name || 'Usuario de prueba',
    plan: plan || 'free',
    status: status || 'active',
    trial_ends_at: trialEndsAt.toISOString(),
    messages_limit: parseInt(messages_limit) || 99999,
    accounts_limit: parseInt(accounts_limit) || 1,
    messages_used: 0,
    connected_accounts: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const result = await supabaseReq('/users', 'POST', userData);

  // 4. Log
  await supabaseReq('/activity_logs', 'POST', {
    user_id: clerkId,
    action: 'admin_create_test',
    details: { notes: notes || 'Usuario de prueba creado desde admin', plan, created_by: 'admin' },
  });

  return res.json({
    success: true,
    user: result?.[0] || userData,
    id: clerkId,
    clerk_id: clerkId,
    login_url: 'https://app.acuarius.app',
  });
}

// ── RESET TEST USER PASSWORD ─────────────────────────────
async function handleResetTestPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { id, password } = req.body;
  if (!id || !password) return res.status(400).json({ error: 'id y password requeridos' });
  if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });

  if (id.startsWith('test_')) {
    return res.status(400).json({ error: 'Este usuario fue creado con el sistema anterior (sin Clerk). Elimínalo y crea uno nuevo con el formulario actual.' });
  }

  const r = await fetch(`https://api.clerk.com/v1/users/${id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CLERK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      password,
      skip_password_checks: true,
    }),
  });

  const data = await r.json();
  if (!r.ok) {
    const detail = data.errors?.[0]?.message || JSON.stringify(data);
    return res.status(400).json({ error: 'Error Clerk: ' + detail });
  }

  return res.json({ success: true, id });
}

// ── DELETE TEST USER ─────────────────────────────────────
async function handleDeleteTestUser(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE only' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id requerido' });

  // IDs con prefijo test_ son usuarios legacy sin Clerk — solo borrar de Supabase
  if (id.startsWith('test_')) {
    await supabaseReq(`/activity_logs?user_id=eq.${id}`, 'DELETE');
    await supabaseReq(`/users?id=eq.${id}`, 'DELETE');
    return res.json({ success: true, id, note: 'legacy test user removed from Supabase only' });
  }

  // Usuarios reales: verificar que sea test en Clerk antes de borrar
  let clerkUser;
  try { clerkUser = await clerkGetUser(id); } catch(e) { clerkUser = null; }

  if (clerkUser && !clerkUser?.public_metadata?.is_test_user) {
    return res.status(400).json({ error: 'Solo se pueden eliminar usuarios marcados como is_test_user' });
  }

  // 1. Eliminar logs (FK constraint)
  await supabaseReq(`/activity_logs?user_id=eq.${id}`, 'DELETE');
  // 2. Eliminar de Supabase
  await supabaseReq(`/users?id=eq.${id}`, 'DELETE');
  // 3. Eliminar de Clerk (si existe)
  if (clerkUser?.id) {
    await fetch(`https://api.clerk.com/v1/users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${CLERK_SECRET}` },
    });
  }

  return res.json({ success: true, id });
}

// ── SYNC ──────────────────────────────────────────────────
async function handleSync(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let allClerkUsers = [];
  let offset = 0;
  let clerkDebug = null;

  while (true) {
    const r = await fetch(`https://api.clerk.com/v1/users?limit=100&offset=${offset}&order_by=-created_at`, {
      headers: { 'Authorization': `Bearer ${CLERK_SECRET}` }
    });
    const data = await r.json();
    clerkDebug = { status: r.status, keys: Object.keys(data), hasData: !!data.data, isArray: Array.isArray(data) };
    if (!r.ok) return res.status(500).json({ error: 'Clerk API error', status: r.status, detail: data });
    const users = Array.isArray(data) ? data : (data.data || []);
    if (!users.length) break;
    allClerkUsers = allClerkUsers.concat(users);
    if (users.length < 100) break;
    offset += 100;
  }

  let synced = 0;
  for (const u of allClerkUsers) {
    const email  = u.email_addresses?.[0]?.email_address || '';
    const name   = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    const plan   = u.public_metadata?.plan   || 'free';
    const status = u.public_metadata?.status || 'active';

    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: u.id, email, name, plan, status,
        created_at: new Date(u.created_at).toISOString(),
        updated_at: new Date(u.updated_at).toISOString(),
      }),
    });
    synced++;
  }

  return res.json({ success: true, synced, total: allClerkUsers.length, clerkDebug });
}

// ── RECOMMENDATIONS ───────────────────────────────────────
/*
SQL para Supabase (ejecutar una vez):
CREATE TABLE recommendations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_recommendations_user_id ON recommendations(user_id);
CREATE INDEX idx_recommendations_agent ON recommendations(agent);
*/
async function handleSaveRecommendation(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId, agent, content } = req.body || {};
  if (!userId || !agent || !content) return res.status(400).json({ error: 'userId, agent, content requeridos' });
  const result = await supabaseReq('/recommendations', 'POST', { user_id: userId, agent, content });
  return res.json({ id: result?.[0]?.id, created_at: result?.[0]?.created_at });
}

async function handleGetRecommendations(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { userId, agent } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  let query = `/recommendations?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=50&select=id,agent,content,status,created_at`;
  if (agent) query += `&agent=eq.${encodeURIComponent(agent)}`;
  const result = await supabaseReq(query);
  return res.json(result || []);
}

async function handleUpdateRecommendation(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH only' });
  const { id, status } = req.body || {};
  if (!id || !status) return res.status(400).json({ error: 'id y status requeridos' });
  await supabaseReq(`/recommendations?id=eq.${id}`, 'PATCH', { status, updated_at: new Date().toISOString() });
  return res.json({ ok: true });
}

// ── PERFORMANCE SNAPSHOTS ────────────────────────────────
/*
SQL para Supabase (ejecutar una vez):
CREATE TABLE performance_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  period_label TEXT NOT NULL,
  period_type TEXT NOT NULL,
  metrics JSONB NOT NULL,
  analysis TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_snapshots_user_agent ON performance_snapshots(user_id, agent);
*/
async function handleSaveSnapshot(req, res) {
  if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'POST/PATCH only' });
  if (req.method === 'PATCH') {
    const { id, analysis } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requerido' });
    await supabaseReq(`/performance_snapshots?id=eq.${id}`, 'PATCH', { analysis });
    return res.json({ ok: true });
  }
  const { userId, agent, period_label, period_type, metrics, analysis } = req.body || {};
  if (!userId || !agent || !period_label || !period_type || !metrics) return res.status(400).json({ error: 'Campos requeridos faltantes' });
  const result = await supabaseReq('/performance_snapshots', 'POST', { user_id: userId, agent, period_label, period_type, metrics, analysis: analysis || null });
  return res.json({ id: result?.[0]?.id });
}

async function handleGetSnapshots(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { userId, agent, limit = 10 } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  let query = `/performance_snapshots?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`;
  if (agent) query += `&agent=eq.${encodeURIComponent(agent)}`;
  const result = await supabaseReq(query);
  return res.json(result || []);
}

// ── PLATFORM CONNECTIONS ─────────────────────────────────
/*
SQL para Supabase (ejecutar una vez):
CREATE TABLE platform_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('google_ads', 'meta_ads', 'tiktok_ads', 'linkedin_ads')),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  account_id TEXT,
  account_name TEXT,
  extra_data JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);
CREATE INDEX idx_connections_user ON platform_connections(user_id);

CREATE TABLE campaign_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  message TEXT NOT NULL,
  metric_value NUMERIC,
  threshold_value NUMERIC,
  is_read BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_alerts_user_unread ON campaign_alerts(user_id, is_read, is_dismissed);

CREATE TABLE agency_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_user_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_industry TEXT,
  monthly_budget NUMERIC,
  notes TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'churned')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_clients_agency ON agency_clients(agency_user_id);
*/

async function handleGetConnection(req, res) {
  const { userId, platform } = req.query;
  if (!userId || !platform) return res.status(400).json({ error: 'userId y platform requeridos' });
  let rows;
  try {
    rows = await supabaseReq(
      `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.${platform}&select=platform,access_token,account_id,account_name,token_expires_at,connected_at,extra_data`
    );
  } catch (err) {
    console.error('handleGetConnection Supabase error:', err.message);
    return res.json({ connected: false });
  }
  if (!rows?.length) return res.json({ connected: false });
  const c = rows[0];
  return res.json({
    connected:       true,
    access_token:    c.access_token,
    account_id:      c.account_id,
    account_name:    c.account_name,
    token_expires_at: c.token_expires_at,
    connected_at:    c.connected_at,
    extra_data:      c.extra_data || {},
  });
}

async function handleDisconnectPlatform(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'POST/DELETE only' });
  const { userId, platform } = req.body || {};
  if (!userId || !platform) return res.status(400).json({ error: 'userId y platform requeridos' });
  await supabaseReq(`/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.${encodeURIComponent(platform)}`, 'DELETE');
  return res.json({ ok: true });
}

// ── ALERTAS ───────────────────────────────────────────────

async function handleCheckAlerts(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });

  const connections = await supabaseReq(
    `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&select=platform,access_token,account_id`
  ).catch(() => []);

  const newAlerts = [];
  const today = new Date().toISOString().split('T')[0];

  for (const conn of connections || []) {
    if (!conn.access_token) continue;
    try {
      if (conn.platform === 'google_ads' && conn.account_id) {
        const gRes = await fetch(
          `${SUPABASE_URL ? '' : 'https://app.acuarius.app'}/api/google-ads?action=get-campaigns&userId=${encodeURIComponent(userId)}&customerId=${conn.account_id.replace(/-/g, '')}&dateRange=LAST_7_DAYS`,
          { headers: { 'Content-Type': 'application/json' } }
        );
        const gData = await gRes.json().catch(() => ({}));
        const campaigns = gData.campaigns || [];

        for (const c of campaigns) {
          if (c.status !== 'ENABLED') continue;
          // zero_conversions: gasto > $20 y 0 conversiones
          if (parseFloat(c.cost) > 20 && parseFloat(c.conversions) === 0) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.zero_conversions&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const alert = {
                user_id: userId, platform: 'google_ads', account_id: conn.account_id,
                campaign_id: String(c.id), campaign_name: c.name,
                alert_type: 'zero_conversions', severity: 'warning',
                message: `Campaña "${c.name}" tiene $${c.cost} gastado en 7 días y 0 conversiones.`,
                metric_value: 0, threshold_value: 1,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
          // ctr_drop: CTR < 0.5%
          if (parseFloat(c.ctr) < 0.5 && parseInt(c.impressions) > 1000) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.ctr_drop&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const alert = {
                user_id: userId, platform: 'google_ads', account_id: conn.account_id,
                campaign_id: String(c.id), campaign_name: c.name,
                alert_type: 'ctr_drop', severity: 'warning',
                message: `CTR bajo en "${c.name}": ${c.ctr}% (benchmark mínimo 0.5%).`,
                metric_value: parseFloat(c.ctr), threshold_value: 0.5,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
        }
      }

      if (conn.platform === 'meta_ads' && conn.account_id) {
        const mRes = await fetch(
          `${SUPABASE_URL ? '' : 'https://app.acuarius.app'}/api/meta-ads?action=get-campaigns&userId=${encodeURIComponent(userId)}&adAccountId=${conn.account_id}&datePreset=last_7d`
        );
        const mData = await mRes.json().catch(() => ({}));
        const campaigns = mData.campaigns || [];

        for (const c of campaigns) {
          if (c.status !== 'ACTIVE') continue;
          // high_frequency: frecuencia > 3.5
          if (parseFloat(c.frequency) > 3.5) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.high_frequency&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const alert = {
                user_id: userId, platform: 'meta_ads', account_id: conn.account_id,
                campaign_id: c.id, campaign_name: c.name,
                alert_type: 'high_frequency', severity: 'warning',
                message: `Frecuencia alta en "${c.name}": ${c.frequency} (límite recomendado: 3.5). Audiencia posiblemente saturada.`,
                metric_value: parseFloat(c.frequency), threshold_value: 3.5,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
          // zero_conversions Meta
          if (parseFloat(c.spend) > 20 && c.conversions === 0) {
            const exists = await supabaseReq(
              `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&campaign_id=eq.${c.id}&alert_type=eq.zero_conversions&created_at=gte.${today}T00:00:00Z`
            );
            if (!exists?.length) {
              const alert = {
                user_id: userId, platform: 'meta_ads', account_id: conn.account_id,
                campaign_id: c.id, campaign_name: c.name,
                alert_type: 'zero_conversions', severity: 'warning',
                message: `"${c.name}" tiene $${c.spend} gastado y 0 conversiones en 7 días.`,
                metric_value: 0, threshold_value: 1,
              };
              await supabaseReq('/campaign_alerts', 'POST', alert);
              newAlerts.push(alert);
            }
          }
        }
      }
    } catch (e) {
      console.error(`check-alerts error for ${conn.platform}:`, e.message);
    }
  }

  return res.json({ alerts: newAlerts, count: newAlerts.length });
}

async function handleGetAlerts(req, res) {
  const { userId, platform, unreadOnly } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  let query = `/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&is_dismissed=eq.false&order=created_at.desc&limit=50`;
  if (platform && platform !== 'all') query += `&platform=eq.${encodeURIComponent(platform)}`;
  if (unreadOnly === 'true') query += `&is_read=eq.false`;
  const alerts = await supabaseReq(query);
  return res.json(alerts || []);
}

async function handleMarkAlertsRead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  await supabaseReq(`/campaign_alerts?user_id=eq.${encodeURIComponent(userId)}&is_read=eq.false`, 'PATCH', { is_read: true });
  return res.json({ ok: true });
}

async function handleDismissAlert(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id requerido' });
  await supabaseReq(`/campaign_alerts?id=eq.${id}`, 'PATCH', { is_dismissed: true });
  return res.json({ ok: true });
}

// ── META TOKEN REFRESH ────────────────────────────────────

async function handleRefreshMetaToken(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });

  const rows = await supabaseReq(
    `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads&select=access_token,token_expires_at`
  );
  if (!rows?.length || !rows[0].access_token) return res.status(404).json({ error: 'No hay token de Meta para este usuario' });

  const conn = rows[0];
  const expiresAt = new Date(conn.token_expires_at);
  const daysLeft = (expiresAt - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysLeft > 7) return res.json({ ok: true, refreshed: false, daysLeft: Math.round(daysLeft) });

  const refreshRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    new URLSearchParams({
      grant_type:        'fb_exchange_token',
      client_id:         process.env.META_APP_ID,
      client_secret:     process.env.META_APP_SECRET,
      fb_exchange_token: conn.access_token,
    })
  );
  const data = await refreshRes.json();
  if (data.error || !data.access_token) return res.status(400).json({ error: 'No se pudo renovar el token de Meta' });

  const newExpires = new Date(Date.now() + (data.expires_in || 5184000) * 1000).toISOString();
  await supabaseReq(
    `/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads`,
    'PATCH',
    { access_token: data.access_token, token_expires_at: newExpires, updated_at: new Date().toISOString() }
  );

  return res.json({ ok: true, refreshed: true, daysLeft: Math.round((data.expires_in || 5184000) / 86400) });
}

// ── AGENCY CLIENTS ────────────────────────────────────────

async function handleCreateClient(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { agencyUserId, clientName, clientEmail, clientIndustry, monthlyBudget, notes } = req.body || {};
  if (!agencyUserId || !clientName) return res.status(400).json({ error: 'agencyUserId y clientName requeridos' });
  const result = await supabaseReq('/agency_clients', 'POST', {
    agency_user_id: agencyUserId, client_name: clientName,
    client_email: clientEmail || null, client_industry: clientIndustry || null,
    monthly_budget: monthlyBudget || null, notes: notes || null,
  });
  return res.json({ id: result?.[0]?.id, client: result?.[0] });
}

async function handleGetClients(req, res) {
  const { agencyUserId } = req.query;
  if (!agencyUserId) return res.status(400).json({ error: 'agencyUserId requerido' });
  const clients = await supabaseReq(
    `/agency_clients?agency_user_id=eq.${encodeURIComponent(agencyUserId)}&status=neq.churned&order=created_at.desc`
  );
  return res.json(clients || []);
}

async function handleUpdateClient(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH only' });
  const { id, clientName, clientEmail, clientIndustry, monthlyBudget, notes, status } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id requerido' });
  const updates = {};
  if (clientName     !== undefined) updates.client_name     = clientName;
  if (clientEmail    !== undefined) updates.client_email    = clientEmail;
  if (clientIndustry !== undefined) updates.client_industry = clientIndustry;
  if (monthlyBudget  !== undefined) updates.monthly_budget  = monthlyBudget;
  if (notes          !== undefined) updates.notes           = notes;
  if (status         !== undefined) updates.status          = status;
  await supabaseReq(`/agency_clients?id=eq.${id}`, 'PATCH', updates);
  return res.json({ ok: true });
}

async function handleArchiveClient(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH only' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id requerido' });
  await supabaseReq(`/agency_clients?id=eq.${id}`, 'PATCH', { status: 'churned' });
  return res.json({ ok: true });
}

// ── API ACTION LOGS ───────────────────────────────────────
/*
SQL para Supabase (ejecutar una vez):
CREATE TABLE api_action_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_id TEXT,
  entity_name TEXT,
  old_value JSONB,
  new_value JSONB,
  confirmed BOOLEAN NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_action_logs_user ON api_action_logs(user_id, executed_at DESC);
*/

async function handleLogApiAction(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId, platform, actionType, entityId, entityName, oldValue, newValue, confirmed } = req.body || {};
  if (!userId || !platform || !actionType || confirmed === undefined) {
    return res.status(400).json({ error: 'userId, platform, actionType, confirmed requeridos' });
  }
  const result = await supabaseReq('/api_action_logs', 'POST', {
    user_id: userId, platform, action_type: actionType,
    entity_id: entityId || null, entity_name: entityName || null,
    old_value: oldValue || null, new_value: newValue || null,
    confirmed: !!confirmed,
  });
  return res.json({ id: result?.[0]?.id, ok: true });
}

// ── ASSIGN CONNECTION TO CLIENT ───────────────────────────

async function handleAssignConnection(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH only' });
  const { connectionId, clientId, label } = req.body || {};
  if (!connectionId) return res.status(400).json({ error: 'connectionId requerido' });
  const updates = {};
  if (clientId !== undefined) updates.client_id = clientId;
  if (label    !== undefined) updates.label = label;
  await supabaseReq(`/platform_connections?id=eq.${encodeURIComponent(connectionId)}`, 'PATCH', updates);
  return res.json({ ok: true });
}

// ── COMPETITIVE SEARCH ────────────────────────────────────

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

async function braveSearch(query, count = 10) {
  if (!BRAVE_API_KEY) throw new Error('BRAVE_SEARCH_API_KEY no configurada');
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=co&search_lang=es`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Brave API error: ${res.status}`);
  return res.json();
}

async function handleCompetitiveSearch(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { query, type = 'serp' } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query requerido' });

  try {
    let searchQuery = query;
    if (type === 'ads') searchQuery = `${query} precio comprar`;
    if (type === 'keywords') searchQuery = `${query} Colombia precio comprar vs`;

    const data = await braveSearch(searchQuery);
    const webResults = data.web?.results || [];

    const results = webResults.map(r => ({
      title:       r.title,
      url:         r.url,
      description: r.description,
      isAd:        r.url?.includes('gad_source') || r.url?.includes('gclid') || false,
    }));

    return res.json({ results, query: searchQuery, type, total: results.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── UPDATE USER PREFERENCES ───────────────────────────────

async function handleUpdatePreferences(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { userId, email_reports } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  await supabaseReq(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', {
    email_reports: !!email_reports,
    updated_at: new Date().toISOString(),
  });
  return res.json({ ok: true });
}

// ── ROUTER PRINCIPAL ──────────────────────────────────────
export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // Rutas públicas de usuario (sin admin secret)
  try {
    if (action === 'save-recommendation')   return await handleSaveRecommendation(req, res);
    if (action === 'get-recommendations')   return await handleGetRecommendations(req, res);
    if (action === 'update-recommendation') return await handleUpdateRecommendation(req, res);
    if (action === 'save-snapshot')         return await handleSaveSnapshot(req, res);
    if (action === 'get-snapshots')         return await handleGetSnapshots(req, res);
    // Platform connections
    if (action === 'get-connection')        return await handleGetConnection(req, res);
    if (action === 'disconnect-platform')   return await handleDisconnectPlatform(req, res);
    // Alertas
    if (action === 'check-alerts')          return await handleCheckAlerts(req, res);
    if (action === 'get-alerts')            return await handleGetAlerts(req, res);
    if (action === 'mark-alerts-read')      return await handleMarkAlertsRead(req, res);
    if (action === 'dismiss-alert')         return await handleDismissAlert(req, res);
    // Meta token refresh
    if (action === 'refresh-meta-token')    return await handleRefreshMetaToken(req, res);
    // Agency clients
    if (action === 'create-client')         return await handleCreateClient(req, res);
    if (action === 'get-clients')           return await handleGetClients(req, res);
    if (action === 'update-client')         return await handleUpdateClient(req, res);
    if (action === 'archive-client')        return await handleArchiveClient(req, res);
    // Sprint 3
    if (action === 'log-api-action')        return await handleLogApiAction(req, res);
    if (action === 'assign-connection')     return await handleAssignConnection(req, res);
    if (action === 'competitive-search')    return await handleCompetitiveSearch(req, res);
    if (action === 'update-preferences')    return await handleUpdatePreferences(req, res);
  } catch (err) {
    console.error('Admin user-action error:', err);
    return res.status(500).json({ error: err.message });
  }

  // Rutas de administrador
  if (!authCheck(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (action === 'metrics')          return await handleMetrics(req, res);
    if (action === 'users')            return await handleUsers(req, res);
    if (action === 'create-test-user') return await handleCreateTestUser(req, res);
    if (action === 'delete-test-user')   return await handleDeleteTestUser(req, res);
    if (action === 'reset-test-password') return await handleResetTestPassword(req, res);
    if (action === 'sync')             return await handleSync(req, res);
    return res.status(400).json({ error: 'action requerido' });
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message });
  }
}
