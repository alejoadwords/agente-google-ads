-- «Mejorar el agente» (15-10-2026), fase 1.
--
-- Cada cuenta corrige su agente sola, como se hizo a mano con Certain: el
-- cliente dice qué estuvo mal en una respuesta del probador, un entrenador con
-- IA propone el cambio, se vuelve a probar y el cliente lo aplica. Las reglas
-- de estilo que salen de ahí viven en chat_agents.reglas (no mezcladas en la
-- persona) y cada cambio aplicado queda en agente_mejoras con lo que había
-- antes, para deshacerlo.
alter table public.chat_agents add column if not exists reglas jsonb not null default '[]'::jsonb;

create table if not exists public.agente_mejoras (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,          -- la cuenta (dueño)
  agent_id      uuid not null,
  actor_id      text,                   -- quién lo aplicó (dueño o miembro)
  tipo          text not null,          -- regla | bienvenida | faq | contexto | calificacion | enrutado | frase_escalar | tono | reporte
  correccion    text,                   -- lo que escribió el cliente
  explicacion   text,                   -- lo que propuso el entrenador
  cambio        jsonb,                  -- la propuesta aplicada
  antes         jsonb not null,         -- campos del agente y regla de calificación antes del cambio
  despues       jsonb,
  conversacion  jsonb,                  -- la conversación del probador hasta el mensaje corregido
  respuesta_antes   text,
  respuesta_despues text,
  ticket_id     uuid,                   -- si era un fallo de Acuarius
  creado_at     timestamptz not null default now(),
  deshecho_at   timestamptz,
  deshecho_por  text
);
create index if not exists agente_mejoras_agente_idx on public.agente_mejoras (agent_id, creado_at desc);
alter table public.agente_mejoras enable row level security;
notify pgrst, 'reload schema';
