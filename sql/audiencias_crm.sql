-- Audiencias desde el CRM hacia Google y Meta (punto 4, 05-10-2026).
-- Ver api/_audiencias.js.
--
-- Una audiencia es un grupo de leads del CRM (los que ya compraron, los que
-- están en proceso, los perdidos, o por etiqueta) que se sube como lista de
-- clientes a Google (Customer Match, por la Data Manager API) o a Meta
-- (audiencia personalizada). Sirve para EXCLUIRLOS de la captación —no
-- pagar por traer a quien ya es cliente— o para buscar parecidos.
create table if not exists audiencias_crm (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  client_id      text,
  nombre         text not null,
  red            text not null check (red in ('google', 'meta')),
  conexion_id    uuid not null,
  segmento       text not null check (segmento in ('clientes', 'en_proceso', 'perdidos', 'todos', 'etiquetas')),
  filtro         jsonb not null default '{}'::jsonb,   -- {etiquetas:[], motivos:[], dias}
  destino_id     text,            -- id de la lista en Google o de la audiencia en Meta
  activa         boolean not null default true,
  miembros       integer not null default 0,     -- los que se enviaron (no los que la red reconoció)
  ultimo_sync    timestamptz,
  error          text,
  -- Quién declaró tener el consentimiento de esos contactos (Ley 1581 y
  -- condiciones de Customer Match / audiencias personalizadas), y cuándo.
  consentimiento_por text not null,
  consentimiento_at  timestamptz not null default now(),
  creado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists audiencias_crm_cuenta on audiencias_crm (user_id);
alter table audiencias_crm enable row level security;

-- Quién está en cada audiencia, con sus llaves ya cifradas (SHA-256): se envía
-- solo la diferencia y se saca a quien dejó de cumplir el filtro.
create table if not exists audiencias_miembros (
  audiencia_id uuid not null references audiencias_crm(id) on delete cascade,
  lead_id      uuid not null,
  h_email      text,
  h_tel        text,
  created_at   timestamptz not null default now(),
  primary key (audiencia_id, lead_id)
);
alter table audiencias_miembros enable row level security;
