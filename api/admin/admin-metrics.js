// api/admin/metrics.js
// GET /api/admin/metrics → métricas generales del dashboard

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-admin-secret,Cache-Control,Pragma',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function authCheck(req) {
  return req.headers['x-admin-secret'] === ADMIN_SECRET;
}

async function supabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!authCheck(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [allUsers, billingAll, logsRecent] = await Promise.all([
      supabase('/users?select=id,plan,status,created_at,trial_ends_at'),
      supabase('/billing?select=amount,plan,status,created_at&status=eq.paid'),
      supabase('/activity_logs?select=action,created_at&order=created_at.desc&limit=200'),
    ]);

    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // Totales
    const totalUsers = allUsers.length;
    const activeUsers = allUsers.filter(u => u.status === 'active').length;
    const suspended = allUsers.filter(u => u.status === 'suspended').length;
    const trialUsers = allUsers.filter(u => u.plan === 'free' && new Date(u.trial_ends_at) > now).length;
    const individualUsers = allUsers.filter(u => u.plan === 'individual').length;
    const agencyUsers = allUsers.filter(u => u.plan === 'agency').length;

    // Nuevos usuarios últimos 30 días
    const newLast30 = allUsers.filter(u => new Date(u.created_at) > thirtyDaysAgo).length;
    const newLast7 = allUsers.filter(u => new Date(u.created_at) > sevenDaysAgo).length;

    // MRR
    const mrr = (individualUsers * 19) + (agencyUsers * 19);

    // Facturación total
    const totalRevenue = billingAll.reduce((sum, b) => sum + parseFloat(b.amount), 0);
    const revenueThisMonth = billingAll
      .filter(b => new Date(b.created_at) > thirtyDaysAgo)
      .reduce((sum, b) => sum + parseFloat(b.amount), 0);

    // Actividad reciente
    const messagesLast7 = logsRecent.filter(l =>
      l.action === 'message_sent' && new Date(l.created_at) > sevenDaysAgo
    ).length;
    const imagesLast7 = logsRecent.filter(l =>
      l.action === 'image_generated' && new Date(l.created_at) > sevenDaysAgo
    ).length;

    // Trials expirando en 3 días
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const trialsExpiringSoon = allUsers.filter(u =>
      u.plan === 'free' &&
      new Date(u.trial_ends_at) > now &&
      new Date(u.trial_ends_at) < threeDaysFromNow
    ).length;

    return res.json({
      overview: {
        totalUsers,
        activeUsers,
        suspended,
        trialUsers,
        individualUsers,
        agencyUsers,
        newLast30,
        newLast7,
        trialsExpiringSoon,
      },
      revenue: {
        mrr,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        revenueThisMonth: parseFloat(revenueThisMonth.toFixed(2)),
      },
      activity: {
        messagesLast7,
        imagesLast7,
      },
    });
  } catch (err) {
    console.error('Admin metrics error:', err);
    return res.status(500).json({ error: err.message });
  }
}
