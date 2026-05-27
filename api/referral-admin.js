// api/referral-admin.js
// Endpoints de administración del sistema de referidos
// PROTEGIDO — requiere ADMIN_SECRET en header Authorization: Bearer <secret>
//
// GET  ?action=summary            → resumen de todos los referrers con saldo pendiente
// GET  ?action=detail&userId=X    → detalle de un referrer específico
// POST { action:'pay', userId }   → marcar como pagado el saldo pendiente de un referrer
// POST { action:'webhook-test', email, eventType } → simular evento de Hotmart (solo dev)

export const config = { runtime: 'nodejs' };

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET    = process.env.ADMIN_SECRET;
const HOTMART_SECRET  = process.env.HOTMART_WEBHOOK_SECRET;

async function sb(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── Autenticación admin ──
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = req.query.action || req.body?.action;

  // ── GET summary — todos los referrers con saldo pendiente ──
  if (req.method === 'GET' && action === 'summary') {
    const { data: conversions } = await sb(
      '/referral_conversions?select=referrer_id,status,total_earned,paid_out,referred_email,months_paid,activated_at,last_paid_at&order=total_earned.desc'
    );
    const list = conversions || [];

    // Agrupar por referrer_id
    const byReferrer = {};
    for (const c of list) {
      if (!byReferrer[c.referrer_id]) {
        byReferrer[c.referrer_id] = { referrer_id: c.referrer_id, total: 0, active: 0, earned: 0, paid_out: 0, referrals: [] };
      }
      const r = byReferrer[c.referrer_id];
      r.total++;
      if (c.status === 'active') r.active++;
      r.earned   += parseFloat(c.total_earned || 0);
      r.paid_out += parseFloat(c.paid_out     || 0);
      r.referrals.push(c);
    }

    const summary = Object.values(byReferrer).map(r => ({
      ...r,
      pending: Math.max(0, r.earned - r.paid_out),
    })).filter(r => r.pending > 0).sort((a, b) => b.pending - a.pending);

    return res.json({ ok: true, summary, total_referrers: summary.length, total_pending_usd: summary.reduce((s, r) => s + r.pending, 0) });
  }

  // ── GET detail — detalle de un referrer ──
  if (req.method === 'GET' && action === 'detail') {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: code } = await sb(`/referral_codes?user_id=eq.${encodeURIComponent(userId)}&select=code&limit=1`);
    const { data: convs } = await sb(`/referral_conversions?referrer_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);

    const list    = convs || [];
    const earned  = list.reduce((s, c) => s + parseFloat(c.total_earned || 0), 0);
    const paidOut = list.reduce((s, c) => s + parseFloat(c.paid_out     || 0), 0);

    return res.json({
      ok: true,
      referrer_id: userId,
      code: code?.[0]?.code || null,
      total:   list.length,
      active:  list.filter(c => c.status === 'active').length,
      earned,
      paid_out: paidOut,
      pending: Math.max(0, earned - paidOut),
      referrals: list,
    });
  }

  // ── POST pay — marcar como pagado ──
  if (req.method === 'POST' && action === 'pay') {
    const { userId, note } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Obtener conversiones activas con saldo pendiente
    const { data: convs } = await sb(
      `/referral_conversions?referrer_id=eq.${encodeURIComponent(userId)}&status=eq.active`
    );
    const list = (convs || []).filter(c => parseFloat(c.total_earned || 0) > parseFloat(c.paid_out || 0));

    if (list.length === 0) {
      return res.json({ ok: true, message: 'Sin saldo pendiente', paid: 0 });
    }

    const now = new Date().toISOString();
    let totalPaid = 0;

    for (const c of list) {
      const earned  = parseFloat(c.total_earned || 0);
      const paidOut = parseFloat(c.paid_out     || 0);
      const toPay   = earned - paidOut;
      if (toPay <= 0) continue;

      await sb(
        `/referral_conversions?id=eq.${c.id}`,
        'PATCH',
        { paid_out: earned, last_paid_at: now, updated_at: now }
      );
      totalPaid += toPay;
    }

    console.log(`[referral-admin] Liquidación registrada: userId=${userId}, monto=$${totalPaid.toFixed(2)}, note=${note || '—'}`);

    return res.json({ ok: true, message: `Liquidación registrada`, paid_usd: totalPaid.toFixed(2), referrals_paid: list.length });
  }

  // ── POST webhook-test — simular evento de Hotmart (solo para testing) ──
  if (req.method === 'POST' && action === 'webhook-test') {
    const { email, eventType = 'PURCHASE_APPROVED', plan = 'individual' } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Missing email' });

    if (!HOTMART_SECRET) {
      return res.status(500).json({ error: 'HOTMART_WEBHOOK_SECRET no configurado' });
    }

    // Construir payload igual que Hotmart
    const productName = plan === 'agencia' ? 'Plan Agencia Acuarius' : 'Plan Individual Acuarius';
    const fakePayload = {
      event: eventType,
      data: {
        buyer:    { email },
        product:  { name: productName },
        purchase: { transaction: 'TEST-' + Date.now() },
      },
    };

    // URL interna — usar dominio de producción si está disponible
    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

    try {
      const r = await fetch(`${baseUrl}/api/hotmart-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'x-hotmart-hottok': HOTMART_SECRET,
        },
        body: JSON.stringify(fakePayload),
      });

      let result;
      const text = await r.text();
      try { result = JSON.parse(text); } catch { result = { raw: text }; }

      return res.json({ ok: true, simulated_event: eventType, plan, email, status: r.status, webhook_response: result });
    } catch (fetchErr) {
      return res.status(500).json({ error: 'Error al llamar webhook internamente', detail: fetchErr.message, baseUrl });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
