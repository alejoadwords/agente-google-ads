-- Alertas diarias de la pauta (03-10-2026). Una fila por alerta avisada: sirve
-- para no repetir la misma en días seguidos y para enseñarla en el Diagnóstico.
-- La escribe api/cron-alertas-pauta.js (api/_alertas-pauta.js).
create table if not exists alertas_pauta (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  client_id   text,
  clave       text not null,           -- tipo:red:campaña
  tipo        text not null,           -- detenida | gasto | sin_leads | cpl
  gravedad    text not null,
  red         text not null,
  campana_id  text,
  campana     text,
  titulo      text not null,
  detalle     text,
  created_at  timestamptz not null default now()
);
alter table alertas_pauta enable row level security;
create index if not exists alertas_pauta_cuenta on alertas_pauta (user_id, created_at desc);
