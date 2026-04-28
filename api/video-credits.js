// api/video-credits.js
// GET  → devuelve créditos disponibles del usuario autenticado
// POST action=deduct → descuenta 1 crédito (después de generación exitosa)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Límites mensuales por plan
const PLAN_LIMITS = {
  free:       1,   // lifetime (no se resetea)
  individual: 5,   // por mes
  pro:        5,   // alias de individual
  agencia:    15,  // por mes
  agency:     15,
};

function getUserIdFromReq(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  const userId = getUserIdFromReq(req);
  if (!userId) return res.status(401).json({ error: 'No autorizado' });

  // ── Obtener datos del usuario ──────────────────────────────────────────────
  const { data: user } = await supabase
    .from('users')
    .select('id, plan, video_credits_used, video_credits_extra, video_credits_reset_at')
    .eq('id', userId)
    .single();

  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const plan      = user.plan || 'free';
  const isFree    = plan === 'free';
  const limit     = PLAN_LIMITS[plan] || 1;
  const extra     = user.video_credits_extra || 0;
  let   used      = user.video_credits_used  || 0;
  let   resetAt   = user.video_credits_reset_at ? new Date(user.video_credits_reset_at) : null;

  // ── Reset mensual automático (solo planes de pago) ─────────────────────────
  let needsReset = false;
  if (!isFree) {
    if (!resetAt) {
      // Primera vez → inicializar período
      needsReset = true;
    } else {
      const daysSince = (Date.now() - resetAt.getTime()) / 86_400_000;
      if (daysSince >= 30) { needsReset = true; used = 0; }
    }
  }

  if (needsReset) {
    await supabase.from('users').update({
      video_credits_used:     used,
      video_credits_reset_at: new Date().toISOString(),
    }).eq('id', userId);
    resetAt = new Date();
  }

  const monthlyAvailable = Math.max(0, limit - used);
  const totalAvailable   = monthlyAvailable + extra;

  // ── GET: consultar créditos ────────────────────────────────────────────────
  if (req.method === 'GET') {
    return res.json({
      available:         totalAvailable,
      monthly_used:      used,
      monthly_limit:     limit,
      monthly_available: monthlyAvailable,
      extra,
      plan,
      is_free:           isFree,
      reset_at:          resetAt?.toISOString() || null,
    });
  }

  // ── POST: descontar 1 crédito ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action !== 'deduct') return res.status(400).json({ error: 'Acción inválida' });

    if (totalAvailable <= 0) {
      return res.status(402).json({ error: 'Sin créditos disponibles', available: 0 });
    }

    const updates = {};
    if (monthlyAvailable > 0) {
      updates.video_credits_used = used + 1;
    } else {
      updates.video_credits_extra = extra - 1;
    }
    await supabase.from('users').update(updates).eq('id', userId);

    return res.json({
      ok:        true,
      available: totalAvailable - 1,
      monthly_used: updates.video_credits_used ?? used,
      extra:        updates.video_credits_extra ?? extra,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
