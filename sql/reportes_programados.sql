-- Reportes programados para clientes (punto 8, 04-10-2026). Ver api/_reportes.js.
--
-- Reemplaza en la práctica al reporte de WhatsApp del panel de clientes, que
-- guardaba en `agency_reports`: esa tabla NUNCA existió, así que no se guardó
-- ni un reporte. Este se arma solo con los datos reales de la pauta y del CRM.
create table if not exists reportes_programados (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  client_id      text,
  nombre         text not null,
  frecuencia     text not null check (frecuencia in ('semanal', 'quincenal', 'mensual')),
  destinatarios  text[] not null default '{}',
  firma          text,             -- quién lo manda: el nombre de la agencia
  logo_url       text,
  color          text,
  incluir_ia     boolean not null default true,
  activo         boolean not null default true,
  proximo_envio  date,
  ultimo_envio   timestamptz,
  creado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists reportes_programados_toca on reportes_programados (proximo_envio) where activo;
alter table reportes_programados enable row level security;

-- Cada reporte armado queda congelado: el enlace que recibió el cliente enseña
-- siempre los mismos números, aunque después se reatribuya un lead.
create table if not exists reportes_enviados (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,
  user_id      text not null,
  client_id    text,
  programa_id  uuid references reportes_programados(id) on delete set null,
  desde        date not null,
  hasta        date not null,
  datos        jsonb not null,
  resumen      text,
  enviado_a    text[],
  estado       text not null check (estado in ('enviado', 'fallido', 'vista')),
  error        text,
  vistas       integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists reportes_enviados_cuenta on reportes_enviados (user_id, created_at desc);
alter table reportes_enviados enable row level security;

-- 04-10-2026: nada sale al cliente sin que la agencia lo vea, si así lo pide.
-- Con revisar_antes, el cron arma el reporte en 'por_revisar' y avisa al dueño;
-- sale cuando alguien lo aprueba en la app.
alter table reportes_programados add column if not exists revisar_antes boolean not null default true;
alter table reportes_enviados drop constraint if exists reportes_enviados_estado_check;
alter table reportes_enviados add constraint reportes_enviados_estado_check check (estado in ('enviado', 'fallido', 'vista', 'por_revisar'));
