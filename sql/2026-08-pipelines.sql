-- ════════════════════════════════════════════════════════════════════════════
-- Varios pipelines por cuenta — Acuarius
-- Correr en Supabase → SQL Editor. Es idempotente: se puede repetir sin daño.
--
-- Idea del diseño: cada pipeline trae SUS PROPIAS etapas con las claves
-- protegidas 'nuevo', 'ganado' y 'perdido'. Gracias a eso, los seis módulos que
-- comparan contra esas claves (entrada de leads, automatizaciones, MercadoPago,
-- propuestas, campañas y listas) siguen funcionando sin cambios: un lead en
-- 'ganado' es un lead ganado, esté en el pipeline que esté.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tabla de pipelines ───────────────────────────────────────────────────
create table if not exists pipelines (
  id          uuid primary key default gen_random_uuid(),
  user_id     text        not null,
  client_id   uuid,                        -- null = pipeline de la cuenta
  name        text        not null,
  is_default  boolean     not null default false,
  position    int         not null default 1,
  created_at  timestamptz not null default now()
);

create index if not exists pipelines_user_idx   on pipelines(user_id);
create index if not exists pipelines_scope_idx  on pipelines(user_id, client_id);

-- Un solo pipeline principal por ámbito (cuenta o cliente).
-- Dos índices porque en Postgres NULL nunca es igual a NULL: sin el segundo,
-- una cuenta podría acabar con varios principales de ámbito cuenta.
create unique index if not exists pipelines_default_cliente_idx
  on pipelines(user_id, client_id) where is_default and client_id is not null;
create unique index if not exists pipelines_default_cuenta_idx
  on pipelines(user_id) where is_default and client_id is null;

-- ── 2. Enganchar etapas y leads a un pipeline ───────────────────────────────
alter table pipeline_stages add column if not exists pipeline_id uuid;
alter table leads           add column if not exists pipeline_id uuid;

create index if not exists pipeline_stages_pipeline_idx on pipeline_stages(pipeline_id);
create index if not exists leads_pipeline_idx           on leads(pipeline_id);

-- Las claves de etapa dejan de ser únicas por usuario para serlo por pipeline:
-- cada pipeline necesita su propio 'ganado'.
drop index if exists pipeline_stages_user_key_idx;
create unique index if not exists pipeline_stages_pipeline_key_idx
  on pipeline_stages(pipeline_id, key) where pipeline_id is not null;

-- ── 3. Relleno: un pipeline "Principal" por usuario que ya tenga etapas ─────
insert into pipelines (user_id, client_id, name, is_default, position)
select distinct s.user_id, null::uuid, 'Principal', true, 1
from pipeline_stages s
where s.pipeline_id is null
  and not exists (
    select 1 from pipelines p
    where p.user_id = s.user_id and p.client_id is null and p.is_default
  );

-- Colgar las etapas huérfanas de ese pipeline
update pipeline_stages s
set pipeline_id = p.id
from pipelines p
where s.pipeline_id is null
  and p.user_id = s.user_id
  and p.client_id is null
  and p.is_default;

-- Y los leads que aún no tengan pipeline
update leads l
set pipeline_id = p.id
from pipelines p
where l.pipeline_id is null
  and p.user_id = l.user_id
  and p.client_id is null
  and p.is_default;

-- ── 4. Comprobación ─────────────────────────────────────────────────────────
-- Las tres cifras deberían ser 0. Si alguna no lo es, avísame antes de seguir.
select
  (select count(*) from pipeline_stages where pipeline_id is null) as etapas_sin_pipeline,
  (select count(*) from leads           where pipeline_id is null) as leads_sin_pipeline,
  (select count(*) from pipelines)                                  as pipelines_creados;
