-- Analista IA de la pauta (punto 7, 03-10-2026). Ver api/_analista.js.
--
-- Cada revisión guarda lo que dijo el modelo (resumen y recomendaciones) y con
-- qué datos lo dijo. Las recomendaciones que se pueden ejecutar no viven aquí:
-- se crean como propuestas en acciones_pauta, con el mismo Aprobar/Descartar
-- que las reglas, y aquí queda su id.
create table if not exists revisiones_pauta (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  client_id       text,
  pedida_por      text,
  resumen         text,
  recomendaciones jsonb not null default '[]'::jsonb,
  datos           jsonb,            -- la foto que vio el modelo, para poder auditarla
  modelo          text,
  costo           numeric,
  created_at      timestamptz not null default now()
);
create index if not exists revisiones_pauta_cuenta on revisiones_pauta (user_id, created_at desc);
alter table revisiones_pauta enable row level security;

-- Lo que una acción necesita además de campaña y porcentaje: el texto y el
-- tipo de una negativa, y de qué revisión salió.
alter table acciones_pauta add column if not exists detalle jsonb;
