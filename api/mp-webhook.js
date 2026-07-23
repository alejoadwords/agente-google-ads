// api/mp-webhook.js
// Notificaciones de pago de MercadoPago (Checkout Pro de propuestas).
// MP avisa {action, type:'payment', data:{id}, user_id: collector} → buscamos
// la conexión del dueño por collector id, consultamos el pago con SU token y,
// si está aprobado, marcamos la propuesta pagada (external_reference) y el
// lead pasa a Ganado — el mismo efecto que el mark_paid manual.
// Siempre respondemos 200 (MP reintenta ante errores).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': prefer || 'return=representation',
  };
}

async function refreshMpToken(conn) {
  try {
    const r = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.MP_CLIENT_ID,
        client_secret: process.env.MP_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: conn.refresh_token,
      }),
    });
    const t = await r.json();
    if (!t.access_token) return null;
    await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(conn.user_id)}&platform=eq.mercadopago`, {
      method: 'PATCH', headers: sbHeaders('return=minimal'),
      body: JSON.stringify({
        access_token: t.access_token,
        ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
        token_expires_at: new Date(Date.now() + (t.expires_in || 15552000) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    return t.access_token;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const body = (typeof req.body === 'object' && req.body) || {};
  const type = body.type || body.topic || req.query.type || req.query.topic || '';
  const paymentId = body?.data?.id || req.query['data.id'] || req.query.id || null;
  const collectorId = body.user_id ? String(body.user_id) : null;

  if (!/payment/.test(String(type)) || !paymentId || !collectorId) {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  try {
    // 1. Conexión del dueño por collector id
    const conns = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?platform=eq.mercadopago&account_id=eq.${encodeURIComponent(collectorId)}&select=*&limit=1`, { headers: sbHeaders() }).then(r => r.json());
    const conn = conns?.[0];
    if (!conn) return res.status(200).json({ received: true, action: 'connection_not_found' });

    // 2. Consultar el pago con el token del dueño (refresh en 401)
    let token = conn.access_token;
    let pr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (pr.status === 401 && conn.refresh_token) {
      token = await refreshMpToken(conn);
      if (token) pr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!pr.ok) return res.status(200).json({ received: true, action: 'payment_fetch_failed', status: pr.status });
    const payment = await pr.json();

    if (payment.status !== 'approved') {
      return res.status(200).json({ received: true, action: 'not_approved', status: payment.status });
    }
    const proposalId = payment.external_reference;
    if (!proposalId) return res.status(200).json({ received: true, action: 'no_reference' });

    // 3. Propuesta → pagada (idempotente) + lead a Ganado
    const props = await fetch(`${SUPABASE_URL}/rest/v1/proposals?id=eq.${encodeURIComponent(proposalId)}&user_id=eq.${encodeURIComponent(conn.user_id)}&select=*&limit=1`, { headers: sbHeaders() }).then(r => r.json());
    const p = props?.[0];
    if (!p) return res.status(200).json({ received: true, action: 'proposal_not_found' });
    if (p.status === 'paid') return res.status(200).json({ received: true, action: 'already_paid' });

    await fetch(`${SUPABASE_URL}/rest/v1/proposals?id=eq.${p.id}`, {
      method: 'PATCH', headers: sbHeaders('return=minimal'),
      body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    if (p.lead_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${p.lead_id}&user_id=eq.${encodeURIComponent(conn.user_id)}`, {
        method: 'PATCH', headers: sbHeaders('return=minimal'),
        body: JSON.stringify({ stage: 'ganado', ...(p.amount ? { value: p.amount } : {}), updated_at: new Date().toISOString() }),
      }).catch(() => {});
    }
    console.log('[mp-webhook] propuesta pagada:', p.id, 'pago:', paymentId);
    return res.status(200).json({ received: true, action: 'proposal_paid', proposal: p.id });
  } catch (e) {
    console.error('[mp-webhook] error:', e.message);
    return res.status(200).json({ received: true, action: 'error' });
  }
}
