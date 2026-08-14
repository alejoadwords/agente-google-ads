-- ════════════════════════════════════════════════════════════════════════════
-- Ejecutivo fijo por formulario o conector + aviso de conector en silencio
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- A quién se le asignan los leads de esta fuente. Vacío = reparto por turnos.
alter table lead_forms add column if not exists assigned_to text;

-- Marca de "ya avisamos de este silencio". Se borra sola en cuanto vuelve a
-- entrar un lead, para que un segundo apagón sí vuelva a avisar.
alter table lead_forms add column if not exists aviso_silencio_at timestamptz;

-- Comprobación: debe dar 2.
select count(*) as columnas
from information_schema.columns
where table_name = 'lead_forms' and column_name in ('assigned_to','aviso_silencio_at');
