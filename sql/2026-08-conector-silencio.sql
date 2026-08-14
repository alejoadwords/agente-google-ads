-- ════════════════════════════════════════════════════════════════════════════
-- Aviso cuando un conector deja de recoger leads
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- Marca de "ya avisamos de este silencio". Se borra sola en cuanto vuelve a
-- entrar un lead, para que un segundo apagón sí vuelva a avisar.
alter table lead_forms add column if not exists aviso_silencio_at timestamptz;

-- Comprobación: debe salir 1.
select count(*) as columna
from information_schema.columns
where table_name = 'lead_forms' and column_name = 'aviso_silencio_at';
