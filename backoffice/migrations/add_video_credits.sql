-- Migración: sistema de créditos de video
-- Ejecutar en Supabase → SQL Editor

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS video_credits_used      INT          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_credits_extra     INT          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_credits_reset_at  TIMESTAMPTZ  DEFAULT NULL;

-- Comentarios para documentación
COMMENT ON COLUMN users.video_credits_used     IS 'Videos generados en el período actual (se resetea mensualmente en planes de pago)';
COMMENT ON COLUMN users.video_credits_extra    IS 'Créditos extra comprados via Hotmart (no expiran)';
COMMENT ON COLUMN users.video_credits_reset_at IS 'Inicio del período mensual actual';
