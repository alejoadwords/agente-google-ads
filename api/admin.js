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

  // 2. Insertar en Supabase con el ID real de Clerk
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

  // 3. Log
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

// ── ROUTER PRINCIPAL ──────────────────────────────────────
export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!authCheck(req)) return res.status(401).json({ error: 'Unauthorized' });

  const action = req.query.action;

  try {
    if (action === 'metrics')          return await handleMetrics(req, res);
    if (action === 'users')            return await handleUsers(req, res);
    if (action === 'create-test-user') return await handleCreateTestUser(req, res);
    if (action === 'delete-test-user')   return await handleDeleteTestUser(req, res);
    if (action === 'reset-test-password') return await handleResetTestPassword(req, res);
    if (action === 'sync')             return await handleSync(req, res);
    return res.status(400).json({ error: 'action requerido: metrics | users | create-test-user | sync' });
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message });
  }
}
