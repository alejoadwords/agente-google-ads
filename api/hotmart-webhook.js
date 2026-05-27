// api/hotmart-webhook.js
// Sin dependencias externas — usa fetch nativo igual que referral.js

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const HOTMART_SECRET = process.env.HOTMART_WEBHOOK_SECRET;

// ── Helper REST Supabase (igual que referral.js) ──────────────────────────────
async function sb(path, method = 'GET', body = null, prefer = 'return=representation') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        prefer,
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── GET ?email=x → consulta plan activo ──────────────────────────────────
  if (req.method === 'GET') {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const { data: users } = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
    if (!users || users.length === 0) return res.json({ plan: 'free', active: false });
    const userId = users[0].id;

    const { data: billing } = await sb(
      `/billing?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=plan,status,period_end&order=created_at.desc&limit=1`
    );
    if (!billing || billing.length === 0) return res.json({ plan: 'free', active: false });

    const active = new Date(billing[0].period_end) > new Date();
    return res.json({ plan: billing[0].plan, active });
  }

  // ── POST → evento de Hotmart ──────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['x-hotmart-hottok'];
  if (!HOTMART_SECRET || signature !== HOTMART_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event     = req.body;
  const eventType = event?.event;
  const data      = event?.data;

  console.log('[hotmart-webhook]', JSON.stringify({
    eventType,
    email:       data?.buyer?.email,
    product:     data?.product?.name,
    transaction: data?.purchase?.transaction,
  }));

  // SUBSCRIPTION_PURCHASE = renovación mensual automática de Hotmart
  const eventosValidos     = ['PURCHASE_APPROVED','PURCHASE_COMPLETE','SUBSCRIPTION_REACTIVATED','SUBSCRIPTION_PURCHASE'];
  const eventosCancelacion = ['PURCHASE_REFUNDED','PURCHASE_CHARGEBACK','SUBSCRIPTION_CANCELLATION'];

  if (!eventosValidos.includes(eventType) && !eventosCancelacion.includes(eventType)) {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  const email          = data?.buyer?.email;
  const transactionId  = data?.purchase?.transaction;
  const subscriptionId = data?.subscription?.subscriber?.code || null;
  const productName    = (data?.product?.name || '').toLowerCase();

  if (!email) return res.status(400).json({ error: 'Missing email' });

  // Buscar usuario en Supabase
  const { data: users } = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=id,video_credits_extra&limit=1`);
  if (!users || users.length === 0) {
    return res.status(200).json({ received: true, action: 'user_not_found', email });
  }
  const usuario = users[0];

  // ── Compra de créditos de video ──────────────────────────────────────────
  if (productName.includes('video')) {
    if (eventosCancelacion.includes(eventType)) {
      return res.status(200).json({ received: true, action: 'video_credits_no_refund' });
    }
    const offerName  = (data?.purchase?.offer?.key || data?.purchase?.offer?.name || '').toLowerCase();
    const price      = data?.purchase?.price?.value || 0;
    let creditsToAdd = 0;
    if      (offerName.includes('10')) creditsToAdd = 10;
    else if (offerName.includes('5'))  creditsToAdd = 5;
    else if (price <= 12)              creditsToAdd = 5;
    else if (price <= 20)              creditsToAdd = 10;
    else                               creditsToAdd = 5;

    await sb(
      `/users?id=eq.${encodeURIComponent(usuario.id)}`,
      'PATCH',
      { video_credits_extra: (usuario.video_credits_extra || 0) + creditsToAdd },
      'return=minimal'
    );
    return res.status(200).json({ received: true, action: 'video_credits_added', credits: creditsToAdd, email });
  }

  // ── Suscripción / plan ──────────────────────────────────────────────────
  const plan = productName.includes('agencia') ? 'agencia' : 'individual';

  // Precios y comisiones por plan
  const PLAN_CONFIG = {
    agencia:    { amount: 49, commission: 10 },
    individual: { amount: 19, commission: 5  },
  };
  const { amount: planAmount, commission: planCommission } = PLAN_CONFIG[plan];

  if (eventosCancelacion.includes(eventType)) {
    await sb(`/billing?user_id=eq.${encodeURIComponent(usuario.id)}`, 'PATCH', { status: 'cancelled' }, 'return=minimal');
    return res.status(200).json({ received: true, action: 'cancelled' });
  }

  const ahora      = new Date();
  const vencimiento = new Date(ahora);
  vencimiento.setMonth(vencimiento.getMonth() + 1);

  // Resetear créditos mensuales de video al renovar
  await sb(
    `/users?id=eq.${encodeURIComponent(usuario.id)}`,
    'PATCH',
    { video_credits_used: 0, video_credits_reset_at: ahora.toISOString() },
    'return=minimal'
  );

  // Upsert billing
  await sb('/billing', 'POST', {
    user_id:                  usuario.id,
    plan,
    status:                   'active',
    amount:                   planAmount,
    currency:                 'USD',
    period_start:             ahora.toISOString(),
    period_end:               vencimiento.toISOString(),
    hotmart_transaction:      transactionId,
    hotmart_subscription_id:  subscriptionId,
    notes:                    `Activado via Hotmart - ${eventType}`,
  }, 'resolution=merge-duplicates,return=minimal');

  // ── Rastreo de referidos ────────────────────────────────────────────────
  try {
    const { data: refRows } = await sb(
      `/referral_conversions?referred_email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`
    );
    const refConversion = refRows?.[0];

    if (refConversion) {
      if (refConversion.status === 'registered') {
        await sb(
          `/referral_conversions?id=eq.${refConversion.id}`,
          'PATCH',
          {
            status:           'active',
            referred_user_id: usuario.id,
            activated_at:     ahora.toISOString(),
            months_paid:      1,
            total_earned:     planCommission,
            updated_at:       ahora.toISOString(),
          },
          'return=minimal'
        );
      } else if (refConversion.status === 'active') {
        await sb(
          `/referral_conversions?id=eq.${refConversion.id}`,
          'PATCH',
          {
            months_paid:  (refConversion.months_paid || 0) + 1,
            total_earned: parseFloat(refConversion.total_earned || 0) + planCommission,
            updated_at:   ahora.toISOString(),
          },
          'return=minimal'
        );
      }
    }
  } catch (refErr) {
    console.warn('[hotmart-webhook] Referral tracking error:', refErr.message);
  }

  return res.status(200).json({ received: true, action: 'activated', plan, amount: planAmount, commission: planCommission, email });
}
