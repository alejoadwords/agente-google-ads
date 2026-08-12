-- ════════════════════════════════════════════════════════════════════════════
-- Soltar la unicidad antigua de pipeline_stages
-- Correr en Supabase → SQL Editor. Idempotente.
--
-- Sin esto no se puede crear un segundo pipeline: cada pipeline necesita su
-- propia etapa 'nuevo', y la regla antigua exige que la clave sea única por
-- usuario, no por pipeline.
--
-- La migración original intentaba soltarla con:
--     drop index if exists pipeline_stages_user_key_idx;
-- y no servía por dos motivos a la vez:
--   1. El nombre real es 'pipeline_stages_user_key_unique'.
--   2. No es un índice suelto sino una RESTRICCIÓN, así que 'drop index' habría
--      fallado igualmente aunque el nombre fuese correcto: hay que soltarla con
--      'alter table ... drop constraint'.
-- El 'if exists' hacía que fallar fuese silencioso.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Soltar la restricción antigua ────────────────────────────────────────
alter table pipeline_stages drop constraint if exists pipeline_stages_user_key_unique;

-- Por si en alguna base quedó además como índice suelto con otro nombre
drop index if exists pipeline_stages_user_key_idx;

-- ── 2. Asegurar la unicidad correcta: por pipeline, no por usuario ──────────
create unique index if not exists pipeline_stages_pipeline_key_idx
  on pipeline_stages(pipeline_id, key) where pipeline_id is not null;

-- ── 3. Comprobación ─────────────────────────────────────────────────────────
-- Debe salir UNA sola fila: pipeline_stages_pipeline_key_idx.
-- Si aparece cualquier otra que mencione 'user_id, key', avísame.
select indexname, indexdef
from pg_indexes
where tablename = 'pipeline_stages'
  and indexdef ilike '%unique%'
order by indexname;
