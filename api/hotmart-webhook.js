import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const HOTMART_SECRET = process.env.HOTMART_WEBHOOK_SECRET;

export default async function handler(req, res) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return res.status(204).set(cors).end();

  // ── GET /api/hotmart-webhook?email=x → consulta plan ──
  if (req.method === 'GET') {
    Object.entries(cors).forEach(([k,v]) => res.setHeader(k, v));
    const email = req.query.email;
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

  // ── POST /api/hotmart-webhook → evento de Hotmart ──
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['x-hotmart-hottok'];
  if (HOTMART_SECRET && signature !== HOTMART_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.body;
  const eventType = event?.event;
  const data = event?.data;

  const eventosValidos = ['PURCHASE_APPROVED','PURCHASE_COMPLETE','SUBSCRIPTION_REACTIVATED'];
  const eventosCancelacion = ['PURCHASE_REFUNDED','PURCHASE_CHARGEBACK','SUBSCRIPTION_CANCELLATION'];

  if (!eventosValidos.includes(eventType) && !eventosCancelacion.includes(eventType)) {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  const email = data?.buyer?.email;
  const transactionId = data?.purchase?.transaction;
  const subscriptionId = data?.subscription?.subscriber?.code || null;
  const productName = data?.product?.name || '';

  if (!email) return res.status(400).json({ error: 'Missing email' });

  let plan = 'individual';
  if (productName.toLowerCase().includes('agencia')) plan = 'agencia';

  const { data: usuario } = await supabase
    .from('users').select('id').eq('email', email).single();

  if (!usuario) return res.status(200).json({ received: true, action: 'user_not_found', email });

  if (eventosCancelacion.includes(eventType)) {
    await supabase.from('billing').update({ status: 'cancelled' }).eq('user_id', usuario.id);
    return res.status(200).json({ received: true, action: 'cancelled' });
  }

  const ahora = new Date();
  const vencimiento = new Date(ahora);
  vencimiento.setMonth(vencimiento.getMonth() + 1);

  await supabase.from('billing').upsert({
    user_id: usuario.id,
    plan,
    status: 'active',
    amount: 19,
    currency: 'USD',
    period_start: ahora.toISOString(),
    period_end: vencimiento.toISOString(),
    hotmart_transaction: transactionId,
    hotmart_subscription_id: subscriptionId,
    notes: `Activado via Hotmart - ${eventType}`
  }, { onConflict: 'user_id' });

  return res.status(200).json({ received: true, action: 'activated', plan, email });
}
