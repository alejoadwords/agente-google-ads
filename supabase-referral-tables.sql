-- ══════════════════════════════════════════════════════════════
-- TABLAS DEL SISTEMA DE REFERIDOS — Acuarius
-- Ejecutar en Supabase > SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Códigos de referido (uno por usuario)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_codes (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    TEXT        NOT NULL UNIQUE,   -- Clerk user ID
  code       TEXT        NOT NULL UNIQUE,   -- ej: "JCPEREZ25"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_codes_user_id ON referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_ref_codes_code    ON referral_codes(code);

-- 2. Conversiones / referidos registrados
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_conversions (
  id               UUID           DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id      TEXT           NOT NULL,        -- Clerk user ID del que refirió
  referred_email   TEXT           NOT NULL UNIQUE, -- email del referido (único: 1 referido = 1 email)
  referred_user_id TEXT,                           -- Clerk user ID del referido (se rellena al activar)
  ref_code         TEXT           NOT NULL,        -- código usado para rastrear
  status           TEXT           DEFAULT 'registered' CHECK (status IN ('registered','active','cancelled')),
  activated_at     TIMESTAMPTZ,                    -- fecha en que el referido pagó por primera vez
  months_paid      INTEGER        DEFAULT 0,       -- meses activos acumulados
  total_earned     DECIMAL(10,2)  DEFAULT 0,       -- comisión total acumulada (USD)
  paid_out         DECIMAL(10,2)  DEFAULT 0,       -- monto ya liquidado al referrer
  last_paid_at     TIMESTAMPTZ,                    -- fecha de última liquidación
  created_at       TIMESTAMPTZ    DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_conv_referrer_id    ON referral_conversions(referrer_id);
CREATE INDEX IF NOT EXISTS idx_ref_conv_referred_email ON referral_conversions(referred_email);
CREATE INDEX IF NOT EXISTS idx_ref_conv_ref_code       ON referral_conversions(ref_code);
CREATE INDEX IF NOT EXISTS idx_ref_conv_status         ON referral_conversions(status);

-- ══════════════════════════════════════════════════════════════
-- VERIFICACIÓN — ejecutar para confirmar que las tablas existen
-- ══════════════════════════════════════════════════════════════
-- SELECT COUNT(*) FROM referral_codes;
-- SELECT COUNT(*) FROM referral_conversions;

-- ══════════════════════════════════════════════════════════════
-- LIQUIDACIÓN MANUAL (cuando pagas a un referrer)
-- Reemplaza 'USER_ID_DEL_REFERRER' por el Clerk ID real
-- ══════════════════════════════════════════════════════════════
/*
UPDATE referral_conversions
SET
  paid_out     = total_earned,
  last_paid_at = NOW(),
  updated_at   = NOW()
WHERE
  referrer_id = 'USER_ID_DEL_REFERRER'
  AND status  = 'active';
*/

-- ══════════════════════════════════════════════════════════════
-- CONSULTA ÚTIL — Ver resumen por referrer para liquidar
-- ══════════════════════════════════════════════════════════════
/*
SELECT
  rc.user_id             AS referrer_clerk_id,
  rc.code                AS codigo,
  COUNT(conv.id)         AS referidos_totales,
  SUM(CASE WHEN conv.status = 'active' THEN 1 ELSE 0 END) AS activos,
  SUM(conv.total_earned) AS ganado_total_usd,
  SUM(conv.paid_out)     AS ya_pagado_usd,
  SUM(conv.total_earned) - SUM(conv.paid_out) AS pendiente_usd
FROM referral_codes rc
LEFT JOIN referral_conversions conv ON conv.referrer_id = rc.user_id
GROUP BY rc.user_id, rc.code
ORDER BY pendiente_usd DESC;
*/
