-- ════════════════════════════════════════════════════════════════════════════
-- Fuentes de lead personalizables + permisos por usuario
-- Correr en Supabase → SQL Editor. Es idempotente: se puede repetir sin daño.
--
-- Las dos partes son independientes; la app funciona sin correr nada (las
-- fuentes se quedan en las seis por defecto y los permisos no se aplican),
-- así que el orden de despliegue no puede romper el CRM.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Fuentes propias de cada cuenta ───────────────────────────────────────
-- Mismo diseño que lead_tags: por usuario y, opcionalmente, por cliente.
-- Las seis de siempre (manual, meta_ads, google_ads, organico, referido, web)
-- NO se guardan aquí: viven en el código y no se pueden borrar. Aquí solo van
-- las que añada cada cuenta.
create table if not exists lead_sources (
  id         uuid primary key default gen_random_uuid(),
  user_id    text        not null,
  client_id  text,                       -- null = fuente de toda la cuenta
  key        text        not null,       -- lo que se guarda en leads.source
  label      text        not null,       -- lo que se ve en pantalla
  position   int         not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists lead_sources_user_idx on lead_sources(user_id);

-- Una misma clave no puede repetirse dentro del mismo ámbito. Dos índices
-- porque en Postgres NULL nunca es igual a NULL: sin el segundo, el ámbito de
-- cuenta admitiría claves repetidas.
create unique index if not exists lead_sources_key_cliente_idx
  on lead_sources(user_id, client_id, key) where client_id is not null;
create unique index if not exists lead_sources_key_cuenta_idx
  on lead_sources(user_id, key) where client_id is null;

-- ── 2. Quién creó cada lead ─────────────────────────────────────────────────
-- Hace falta para el permiso "puedo gestionar los que yo creé". Es el id de
-- Clerk de la PERSONA, no el de la cuenta: user_id ya guarda el de la cuenta.
alter table leads add column if not exists created_by text;

create index if not exists leads_created_by_idx on leads(created_by);

-- Los leads que ya existen se quedan con created_by nulo, y eso es correcto:
-- no sabemos quién los creó, así que quedan sin dueño y cualquiera del equipo
-- puede gestionarlos, que es justo lo acordado para los leads sin responsable.

-- ── 3. Canales que se atienden a mano ───────────────────────────────────────
-- Hasta ahora todo canal colgaba de un agente de IA. Un canal sin agente se
-- atiende manualmente desde el inbox, así que agent_id deja de ser obligatorio.
alter table channel_connections alter column agent_id drop not null;

-- ── 4. Comprobación ─────────────────────────────────────────────────────────
-- La primera debe ser 0 (tabla recién creada) y la segunda 1 (la columna
-- existe). Si 'columna_created_by' sale 0, algo falló arriba.
-- 'agent_id_opcional' debe salir YES.
select
  (select count(*) from lead_sources) as fuentes_propias,
  (select count(*) from information_schema.columns
     where table_name = 'leads' and column_name = 'created_by') as columna_created_by,
  (select is_nullable from information_schema.columns
     where table_name = 'channel_connections' and column_name = 'agent_id') as agent_id_opcional;
