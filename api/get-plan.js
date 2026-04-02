import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const { data: user } = await supabase
    .from('users').select('id').eq('email', email).single();

  if (!user) return res.json({ plan: 'free', active: false });

  const { data: billing } = await supabase
    .from('billing').select('plan, status, period_end')
    .eq('user_id', user.id).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).single();

  if (!billing) return res.json({ plan: 'free', active: false });

  const active = new Date(billing.period_end) > new Date();
  return res.json({ plan: billing.plan, active });
}
