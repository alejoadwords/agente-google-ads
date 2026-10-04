-- Reglas automáticas de la pauta con datos del CRM (03-10-2026).
-- Las evalúa cada mañana api/cron-alertas-pauta.js (api/_reglas-pauta.js).
-- Solo dos acciones tocan la red, y las dos solo RESTAN: pausar y bajar el
-- presupuesto. Por defecto proponen y esperan aprobación.
create table if not exists reglas_pauta (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  client_id   text,
  nombre      text not null,
  red         text not null default 'todas' check (red in ('todas', 'google', 'meta')),
  campana_id  text,                         -- null = todas las campañas del alcance
  campana     text,
  metrica     text not null check (metrica in ('cpl_real', 'costo_venta', 'gasto_sin_leads')),
  dias        int  not null default 7 check (dias in (3, 7, 14)),
  umbral      numeric not null check (umbral > 0),
  accion      text not null check (accion in ('avisar', 'pausar', 'bajar_presupuesto')),
  porcentaje  int  check (porcentaje between 1 and 50),
  modo        text not null default 'aprobar' check (modo in ('aprobar', 'auto')),
  activa      boolean not null default true,
  creada_por  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table reglas_pauta enable row level security;
create index if not exists reglas_pauta_cuenta on reglas_pauta (user_id) where activa;

-- Cada vez que una regla se cumple: propuesta, ejecución o descarte. Es el
-- registro que se le enseña al cliente: qué, por qué, cuándo y quién.
create table if not exists acciones_pauta (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  client_id    text,
  regla_id     uuid references reglas_pauta(id) on delete set null,
  regla        text,                         -- el nombre, por si la regla se borra
  red          text not null,
  conexion_id  uuid,
  campana_id   text not null,
  campana      text,
  accion       text not null,
  porcentaje   int,
  motivo       text not null,                -- la cifra que la disparó, en palabras
  estado       text not null default 'propuesta'
               check (estado in ('propuesta', 'en_curso', 'ejecutada', 'descartada', 'fallida', 'avisada', 'caducada')),
  resultado    text,
  decidida_por text,
  created_at   timestamptz not null default now(),
  decidida_at  timestamptz
);
alter table acciones_pauta enable row level security;
create index if not exists acciones_pauta_cuenta on acciones_pauta (user_id, created_at desc);
create index if not exists acciones_pauta_pendientes on acciones_pauta (user_id) where estado = 'propuesta';
