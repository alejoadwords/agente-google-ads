// api/admin/users.js
// GET  /api/admin/users        → listar usuarios (con filtros)
// GET  /api/admin/users?id=X   → detalle de un usuario
// PUT  /api/admin/users        → actualizar usuario (plan, status, límites)

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-admin-secret,Cache-Control,Pragma',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;

function authCheck(req) {
  const auth = req.headers['x-admin-secret'];
  return auth === ADMIN_SECRET;
}

async function supabase(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation',
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

async function clerkGetUsers() {
  const res = await fetch('https://api.clerk.com/v1/users?limit=100&order_by=-created_at', {
    headers: { 'Authorization': `Bearer ${CLERK_SECRET}` }
  });
  const data = await res.json();
  return data.data || data || [];
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

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));
  
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!authCheck(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // GET /api/admin/users?id=X → detalle
    if (req.method === 'GET' && req.query.id) {
      const [clerkUser, dbRows] = await Promise.all([
        clerkGetUser(req.query.id),
        supabase(`/users?id=eq.${req.query.id}&select=*`),
      ]);
      const logs = await supabase(`/activity_logs?user_id=eq.${req.query.id}&order=created_at.desc&limit=50`);
      const billing = await supabase(`/billing?user_id=eq.${req.query.id}&order=created_at.desc`);
      return res.json({ user: dbRows?.[0] || null, clerk: clerkUser, logs: logs || [], billing: billing || [] });
    }

    // GET /api/admin/users → listar
    if (req.method === 'GET') {
      const { plan, status, search, page = 1 } = req.query;
      const limit = 20;
      const offset = (page - 1) * limit;

      let query = `/users?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
      if (plan && plan !== 'all') query += `&plan=eq.${plan}`;
      if (status && status !== 'all') query += `&status=eq.${status}`;

      const [users, countRes] = await Promise.all([
        supabase(query),
        supabase(`/users?select=id${plan && plan !== 'all' ? `&plan=eq.${plan}` : ''}${status && status !== 'all' ? `&status=eq.${status}` : ''}`),
      ]);

      return res.json({
        users: users || [],
        total: countRes?.length || 0,
        page: parseInt(page),
        pages: Math.ceil((countRes?.length || 0) / limit),
      });
    }

    // PUT /api/admin/users → actualizar
    if (req.method === 'PUT') {
      const { id, plan, status, messages_limit, accounts_limit, agency_extra_accounts, notes } = req.body;
      if (!id) return res.status(400).json({ error: 'id requerido' });

      const updates = {};
      if (plan !== undefined) updates.plan = plan;
      if (status !== undefined) updates.status = status;
      if (messages_limit !== undefined) updates.messages_limit = messages_limit;
      if (accounts_limit !== undefined) updates.accounts_limit = accounts_limit;
      if (agency_extra_accounts !== undefined) updates.agency_extra_accounts = agency_extra_accounts;

      // Actualizar Supabase
      const dbResult = await supabase(`/users?id=eq.${id}`, 'PATCH', updates);

      // Sincronizar plan a Clerk publicMetadata
      if (plan !== undefined) {
        await clerkUpdateMetadata(id, { plan, status: status || 'active' });
      }

      // Log de actividad
      await supabase('/activity_logs', 'POST', {
        user_id: id,
        action: 'admin_update',
        details: { changes: updates, notes: notes || '' },
      });

      return res.json({ success: true, user: dbResult?.[0] || null });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin users error:', err);
    return res.status(500).json({ error: err.message });
  }
}
