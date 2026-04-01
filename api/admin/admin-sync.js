// api/admin/sync.js
// POST /api/admin/sync → sincroniza todos los usuarios de Clerk a Supabase

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-admin-secret,Cache-Control,Pragma',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Obtener todos los usuarios de Clerk
    let allClerkUsers = [];
    let offset = 0;
    while (true) {
      const r = await fetch(`https://api.clerk.com/v1/users?limit=100&offset=${offset}&order_by=-created_at`, {
        headers: { 'Authorization': `Bearer ${CLERK_SECRET}` }
      });
      const data = await r.json();
      const users = data.data || data || [];
      if (!users.length) break;
      allClerkUsers = allClerkUsers.concat(users);
      if (users.length < 100) break;
      offset += 100;
    }

    // Upsert cada usuario en Supabase
    let synced = 0;
    for (const u of allClerkUsers) {
      const email = u.email_addresses?.[0]?.email_address || '';
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
      const plan = u.public_metadata?.plan || 'free';
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
          id: u.id,
          email,
          name,
          plan,
          status,
          created_at: new Date(u.created_at).toISOString(),
          updated_at: new Date(u.updated_at).toISOString(),
        }),
      });
      synced++;
    }

    return res.json({ success: true, synced, total: allClerkUsers.length });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
