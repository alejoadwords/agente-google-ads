// api/referral.js
// Sistema de referidos Acuarius — usa fetch REST de Supabase (sin SDK)
// GET  ?action=my-code&userId=X  → obtener o crear código de referido
// GET  ?action=stats&userId=X    → estadísticas del referrer
// POST {action:'register', refCode, referredEmail, referredUserId} → registrar referido

export const config = { runtime: 'nodejs' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const COMMISSION   = 5;

// ── Helper REST Supabase ──────────────────────────────────────────────────────
async function sb(path, method = 'GET', body = null, extra = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...extra,
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function generateCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default async function handler(req, res) {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action || req.body?.action;

  // ── GET my-code ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'my-code') {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Buscar código existente
    const { data: existing } = await sb(
      `/referral_codes?user_id=eq.${encodeURIComponent(userId)}&select=code&limit=1`
    );
    if (existing && existing.length > 0) return res.json({ code: existing[0].code });

    // Crear código único (hasta 5 intentos)
    for (let i = 0; i < 5; i++) {
      const code = generateCode();
      const { status } = await sb('/referral_codes', 'POST', { user_id: userId, code });
      if (status === 201) return res.json({ code });
    }
    return res.status(500).json({ error: 'No se pudo generar código único' });
  }

  // ── GET stats ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'stats') {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: conversions } = await sb(
      `/referral_conversions?referrer_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`
    );
    const list    = conversions || [];
    const total   = list.length;
    const active  = list.filter(c => c.status === 'active').length;
    const earned  = list.reduce((s, c) => s + parseFloat(c.total_earned || 0), 0);
    // pending = comisión acumulada no pagada aún (earned - paid_out)
    const paidOut = list.reduce((s, c) => s + parseFloat(c.paid_out || 0), 0);
    const pending = Math.max(0, earned - paidOut);

    return res.json({ referrals: list, total, active, earned, pending });
  }

  // ── POST register ────────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'register') {
    const { refCode, referredEmail, referredUserId } = req.body || {};
    if (!refCode || !referredEmail) {
      return res.status(400).json({ error: 'Faltan campos: refCode, referredEmail' });
    }

    // Buscar el referrer por código
    const code = refCode.toUpperCase().trim();
    const { data: codeRows } = await sb(
      `/referral_codes?code=eq.${encodeURIComponent(code)}&select=user_id&limit=1`
    );
    if (!codeRows || codeRows.length === 0) {
      return res.status(404).json({ error: 'Código no encontrado' });
    }
    const referrerId = codeRows[0].user_id;

    // Prevenir auto-referido
    if (referredUserId && referrerId === referredUserId) {
      return res.status(400).json({ error: 'No puedes referirte a ti mismo' });
    }

    // Verificar si ya está registrado
    const email = referredEmail.toLowerCase();
    const { data: existing } = await sb(
      `/referral_conversions?referred_email=eq.${encodeURIComponent(email)}&select=id&limit=1`
    );
    if (existing && existing.length > 0) {
      return res.json({ ok: true, action: 'already_registered' });
    }

    const { status } = await sb('/referral_conversions', 'POST', {
      referrer_id:      referrerId,
      referred_email:   email,
      referred_user_id: referredUserId || null,
      ref_code:         code,
      status:           'registered',
    });

    if (status !== 201) return res.status(500).json({ error: 'Error al registrar referido' });
    return res.json({ ok: true, action: 'registered', referrerId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
