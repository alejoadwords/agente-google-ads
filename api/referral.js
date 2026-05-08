// api/referral.js
// Sistema de referidos Acuarius
// GET  ?action=my-code&userId=X  → obtener o crear código de referido
// GET  ?action=stats&userId=X    → estadísticas del referrer
// POST {action:'register', refCode, referredEmail, referredUserId} → registrar referido

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const COMMISSION_USD = 4.75;

function generateCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default async function handler(req, res) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action || req.body?.action;

  // ── GET my-code ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'my-code') {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: existing } = await supabase
      .from('referral_codes')
      .select('code')
      .eq('user_id', userId)
      .single();

    if (existing) return res.json({ code: existing.code });

    // Crear código único con hasta 5 intentos
    let code, success = false;
    for (let i = 0; i < 5; i++) {
      code = generateCode();
      const { error } = await supabase
        .from('referral_codes')
        .insert({ user_id: userId, code });
      if (!error) { success = true; break; }
    }

    if (!success) return res.status(500).json({ error: 'No se pudo generar código único' });
    return res.json({ code });
  }

  // ── GET stats ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'stats') {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data: conversions } = await supabase
      .from('referral_conversions')
      .select('*')
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false });

    const list = conversions || [];
    const total   = list.length;
    const active  = list.filter(c => c.status === 'active').length;
    const earned  = list.reduce((s, c) => s + parseFloat(c.total_earned || 0), 0);
    const pending = active * COMMISSION_USD; // comisión del mes en curso

    return res.json({ referrals: list, total, active, earned, pending });
  }

  // ── POST register ────────────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'register') {
    const { refCode, referredEmail, referredUserId } = req.body || {};
    if (!refCode || !referredEmail) {
      return res.status(400).json({ error: 'Faltan campos: refCode, referredEmail' });
    }

    // Buscar el referrer
    const { data: codeRow } = await supabase
      .from('referral_codes')
      .select('user_id')
      .eq('code', refCode.toUpperCase().trim())
      .single();

    if (!codeRow) return res.status(404).json({ error: 'Código no encontrado' });

    // Prevenir auto-referido
    if (referredUserId && codeRow.user_id === referredUserId) {
      return res.status(400).json({ error: 'No puedes referirte a ti mismo' });
    }

    // Verificar si este email ya está registrado como referido
    const { data: existing } = await supabase
      .from('referral_conversions')
      .select('id')
      .eq('referred_email', referredEmail.toLowerCase())
      .single();

    if (existing) {
      return res.json({ ok: true, action: 'already_registered' });
    }

    const { error } = await supabase
      .from('referral_conversions')
      .insert({
        referrer_id:      codeRow.user_id,
        referred_email:   referredEmail.toLowerCase(),
        referred_user_id: referredUserId || null,
        ref_code:         refCode.toUpperCase().trim(),
        status:           'registered',
      });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, action: 'registered', referrerId: codeRow.user_id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
