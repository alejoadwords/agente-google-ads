// api/hotmart-webhook.js
// Sin dependencias externas — usa fetch nativo igual que referral.js

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const HOTMART_SECRET = process.env.HOTMART_WEBHOOK_SECRET;
const CLERK_SECRET  = process.env.CLERK_SECRET_KEY;

// ── Clerk: la app lee el plan de publicMetadata.plan — actualizarlo es lo que
// realmente activa/desactiva el plan para el usuario ─────────────────────────
async function clerkFindUserByEmail(email) {
  const r = await fetch('https://api.clerk.com/v1/users?email_address=' + encodeURIComponent(email) + '&limit=1', {
    headers: { Authorization: `Bearer ${CLERK_SECRET}` },
  });
  const users = await r.json();
  return Array.isArray(users) && users.length ? users[0] : null;
}

async function clerkSetPlan(clerkUserId, plan) {
  return clerkMergeMetadata(clerkUserId, { plan });
}

// El endpoint /metadata de Clerk hace MERGE — no pisa leads_extra/emails_extra/seats_extra
async function clerkMergeMetadata(clerkUserId, obj) {
  const r = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}/metadata`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${CLERK_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_metadata: obj }),
  });
  return r.ok;
}

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

  // Buscar usuario en Supabase (best-effort: billing y referidos; la activación
  // real del plan pasa por Clerk más abajo y no depende de esta tabla)
  const { data: users } = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=id,video_credits_extra&limit=1`);
  const usuario = (users && users.length) ? users[0] : null;

  // ── Compra de créditos de video ──────────────────────────────────────────
  if (productName.includes('video')) {
    if (!usuario) return res.status(200).json({ received: true, action: 'user_not_found', email });
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

  // ── Paquetes de emails de campaña (suscripción mensual) ──────────────────
  // Producto con 'email' en el nombre. Paquetes de 2.000 emails/mes: la
  // oferta lleva el volumen en el nombre ('2k' → 1 paquete, '4k' → 2,
  // '6k' → 3, '10k' → 5...). Fallback por precio (~$4 por paquete).
  // emails_extra se FIJA con el total de paquetes de la oferta comprada —
  // idempotente ante renovaciones. Cancelación → 0.
  if (productName.includes('email')) {
    let clerkOk = false;
    try {
      const clerkUser = await clerkFindUserByEmail(email);
      if (!clerkUser) return res.status(200).json({ received: true, action: 'user_not_found', email });
      if (eventosCancelacion.includes(eventType)) {
        clerkOk = await clerkMergeMetadata(clerkUser.id, { emails_extra: 0 });
        return res.status(200).json({ received: true, action: 'email_pack_cancelled', clerkUpdated: clerkOk });
      }
      const offerName = (data?.purchase?.offer?.key || data?.purchase?.offer?.name || '').toLowerCase();
      const price = data?.purchase?.price?.value || 0;
      let packs = 1;
      const kMatch = offerName.match(/(\d+)\s*k/); // '4k emails' → 4.000 → 2 paquetes
      if (kMatch) packs = Math.max(1, Math.round(parseInt(kMatch[1]) / 2));
      else if (price > 0) {
        // Fallback alineado a los precios reales de Hotmart: $4→2k, $8→4k, $22→10k
        if (price <= 5) packs = 1;
        else if (price <= 9) packs = 2;
        else if (price <= 13) packs = 3;
        else if (price <= 17) packs = 4;
        else if (price <= 23) packs = 5;
        else packs = Math.round(price / 4);
      }
      packs = Math.min(packs, 50); // tope de cordura: 100.000 emails extra
      clerkOk = await clerkMergeMetadata(clerkUser.id, { emails_extra: packs });
      return res.status(200).json({ received: true, action: 'email_pack_set', packs, emails: packs * 2000, clerkUpdated: clerkOk });
    } catch (e) {
      console.error('[hotmart-webhook] email pack error:', e.message);
      return res.status(200).json({ received: true, action: 'email_pack_error' });
    }
  }

  // ── Usuarios adicionales de equipo (suscripción mensual) ─────────────────
  // Producto con 'usuario', 'asiento' o 'seat' en el nombre. La oferta lleva la cantidad
  // ('1 asiento' → 1, '2 asientos' → 2...). Fallback por precio (~$10/asiento).
  // seats_extra se FIJA con la cantidad de la oferta comprada — idempotente
  // ante renovaciones. Cancelación → 0. api/team.js lo suma al cupo del plan.
  if (productName.includes('asiento') || productName.includes('seat') || productName.includes('usuario')) {
    let clerkOk = false;
    try {
      const clerkUser = await clerkFindUserByEmail(email);
      if (!clerkUser) return res.status(200).json({ received: true, action: 'user_not_found', email });
      if (eventosCancelacion.includes(eventType)) {
        clerkOk = await clerkMergeMetadata(clerkUser.id, { seats_extra: 0 });
        return res.status(200).json({ received: true, action: 'seats_cancelled', clerkUpdated: clerkOk });
      }
      const offerName = (data?.purchase?.offer?.key || data?.purchase?.offer?.name || '').toLowerCase();
      const price = data?.purchase?.price?.value || 0;
      let seats = 1;
      const nMatch = offerName.match(/(\d+)/);
      if (nMatch) seats = Math.max(1, parseInt(nMatch[1]));
      else if (price > 0) seats = Math.max(1, Math.round(price / 10));
      seats = Math.min(seats, 20); // tope de cordura
      clerkOk = await clerkMergeMetadata(clerkUser.id, { seats_extra: seats });
      return res.status(200).json({ received: true, action: 'seats_set', seats, clerkUpdated: clerkOk });
    } catch (e) {
      console.error('[hotmart-webhook] seats error:', e.message);
      return res.status(200).json({ received: true, action: 'seats_error' });
    }
  }

  // ── Suscripción / plan ──────────────────────────────────────────────────
  // Modelo actual: Pro $39 / Agency $99. 'agenc' cubre "Agency" y "Agencia".
  const plan = productName.includes('agenc') ? 'agency' : 'pro';

  // Precios y comisiones de referido por plan
  const PLAN_CONFIG = {
    agency: { amount: 99, commission: 10 },
    pro:    { amount: 39, commission: 5  },
  };
  const { amount: planAmount, commission: planCommission } = PLAN_CONFIG[plan];

  // ── Cancelación: desactivar en Clerk (fuente de verdad de la app) ────────
  if (eventosCancelacion.includes(eventType)) {
    let clerkOk = false;
    try {
      const clerkUser = await clerkFindUserByEmail(email);
      if (clerkUser) clerkOk = await clerkSetPlan(clerkUser.id, 'free');
    } catch (e) { console.error('[hotmart-webhook] Clerk cancel error:', e.message); }
    if (usuario) await sb(`/billing?user_id=eq.${encodeURIComponent(usuario.id)}`, 'PATCH', { status: 'cancelled' }, 'return=minimal');
    return res.status(200).json({ received: true, action: 'cancelled', clerkUpdated: clerkOk });
  }

  // ── Activación: Clerk publicMetadata.plan es lo que la app lee ───────────
  let clerkOk = false;
  try {
    const clerkUser = await clerkFindUserByEmail(email);
    if (clerkUser) clerkOk = await clerkSetPlan(clerkUser.id, plan);
    else console.error('[hotmart-webhook] Usuario no encontrado en Clerk:', email);
  } catch (e) { console.error('[hotmart-webhook] Clerk activate error:', e.message); }

  const ahora      = new Date();
  const vencimiento = new Date(ahora);
  vencimiento.setMonth(vencimiento.getMonth() + 1);

  if (usuario) {
    // Resetear créditos mensuales de video al renovar
    await sb(
      `/users?id=eq.${encodeURIComponent(usuario.id)}`,
      'PATCH',
      { video_credits_used: 0, video_credits_reset_at: ahora.toISOString() },
      'return=minimal'
    );

    // Upsert billing (histórico de facturación y sistema de referidos)
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
  }

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
            referred_user_id: usuario ? usuario.id : null,
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

  return res.status(200).json({ received: true, action: 'activated', plan, amount: planAmount, commission: planCommission, clerkUpdated: clerkOk, email });
}
