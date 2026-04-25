-- =============================================
-- ACUARIUS — SUPABASE SCHEMA
-- Ejecutar en Supabase SQL Editor
-- =============================================

-- Tabla principal de usuarios
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- Clerk user ID
  email TEXT NOT NULL,
  name TEXT,
  plan TEXT NOT NULL DEFAULT 'free', -- free | individual | agency
  status TEXT NOT NULL DEFAULT 'active', -- active | suspended | cancelled
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  plan_started_at TIMESTAMPTZ,
  plan_ends_at TIMESTAMPTZ,
  messages_used INT DEFAULT 0,
  messages_limit INT DEFAULT 99999, -- ilimitado en trial y planes pagos
  connected_accounts INT DEFAULT 0,
  accounts_limit INT DEFAULT 1,
  agency_extra_accounts INT DEFAULT 0, -- cuentas adicionales en plan agencia
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de logs de actividad
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- message_sent | account_connected | plan_changed | login | image_generated
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de facturación
CREATE TABLE IF NOT EXISTS billing (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  plan TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'paid', -- paid | pending | failed
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de métricas diarias (para dashboard)
CREATE TABLE IF NOT EXISTS daily_metrics (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  new_users INT DEFAULT 0,
  active_users INT DEFAULT 0,
  messages_sent INT DEFAULT 0,
  images_generated INT DEFAULT 0,
  new_paid INT DEFAULT 0,
  churned INT DEFAULT 0,
  mrr DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_billing_user ON billing(user_id);

-- Trigger para actualizar updated_at en users
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS desactivado para service_role (el backoffice usa service_role key)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;

-- Política: solo service_role puede acceder (el backoffice)
CREATE POLICY "service_role_only" ON users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON activity_logs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON billing FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON daily_metrics FOR ALL USING (auth.role() = 'service_role');
