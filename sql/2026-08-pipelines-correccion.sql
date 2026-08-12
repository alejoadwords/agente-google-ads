-- ════════════════════════════════════════════════════════════════════════════
-- Corrección de la migración de pipelines
-- Correr DESPUÉS de 2026-08-pipelines.sql. Idempotente.
--
-- Dos fallos que destapó la comprobación con datos reales:
--
--  1. client_id estaba declarado uuid, pero los identificadores de cliente de
--     Acuarius son texto ('pro_main', 'ac_1754...'). Estaba latente: habría
--     fallado la primera vez que alguien creara un pipeline dentro de un
--     cliente. Se arregla ahora que la columna aún está vacía.
--
--  2. El relleno partía de pipeline_stages, así que un usuario con leads pero
--     sin etapas se quedaba sin pipeline. Ahora se parte de los leads.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. El tipo correcto para client_id ──────────────────────────────────────
alter table pipelines alter column client_id type text using client_id::text;

-- ── 2. Un pipeline principal por cada ámbito que tenga leads sueltos ────────
-- 'is not distinct from' compara tratando NULL como un valor: sin eso, el
-- ámbito de cuenta (client_id null) nunca casaría consigo mismo.
insert into pipelines (user_id, client_id, name, is_default, position)
select distinct l.user_id, l.client_id, 'Principal', true, 1
from leads l
where l.pipeline_id is null
  and not exists (
    select 1 from pipelines p
    where p.user_id = l.user_id
      and p.client_id is not distinct from l.client_id
  );

-- ── 3. Sus siete etapas, con las tres claves protegidas ─────────────────────
insert into pipeline_stages (user_id, pipeline_id, key, label, color, position)
select p.user_id, p.id, v.key, v.label, v.color, v.position
from pipelines p
cross join (values
  ('nuevo',       'Nuevo',       '#6B7280', 1),
  ('contactado',  'Contactado',  '#3B82F6', 2),
  ('calificado',  'Calificado',  '#8B5CF6', 3),
  ('propuesta',   'Propuesta',   '#F59E0B', 4),
  ('negociacion', 'Negociación', '#EF4444', 5),
  ('ganado',      'Ganado',      '#10B981', 6),
  ('perdido',     'Perdido',     '#9CA3AF', 7)
) as v(key, label, color, position)
where not exists (select 1 from pipeline_stages s where s.pipeline_id = p.id);

-- ── 4. Colgar los leads que quedaban ────────────────────────────────────────
update leads l
set pipeline_id = p.id
from pipelines p
where l.pipeline_id is null
  and p.user_id = l.user_id
  and p.client_id is not distinct from l.client_id
  and p.is_default;

-- ── 5. Comprobación ─────────────────────────────────────────────────────────
-- Las dos primeras deben ser 0. 'leads_en_etapa_fantasma' cuenta leads cuya
-- etapa no existe en su pipeline: no se pintarían en ninguna columna.
select
  (select count(*) from pipeline_stages where pipeline_id is null) as etapas_sin_pipeline,
  (select count(*) from leads           where pipeline_id is null) as leads_sin_pipeline,
  (select count(*) from leads l
     where l.pipeline_id is not null
       and not exists (
         select 1 from pipeline_stages s
         where s.pipeline_id = l.pipeline_id and s.key = l.stage
       )) as leads_en_etapa_fantasma,
  (select count(*) from pipelines) as pipelines_totales;
