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

-- Fase 2 (15-10-2026): corregir desde conversaciones reales del inbox.
-- Quién escribió cada mensaje de salida: 'agente' (el modelo), 'equipo' (una
-- persona, a mano o programado) o 'sistema' (texto fijo del código: cupo
-- agotado, confirmación de cita, seguimiento). Solo lo del agente se corrige.
-- Los anteriores quedan en NULL: no se sabe y no se adivina.
alter table chat_messages add column if not exists autor text;
alter table agente_mejoras add column if not exists origen text not null default 'probador';
alter table agente_mejoras add column if not exists conversation_id uuid;
alter table agente_mejoras add column if not exists mensaje_id uuid;

-- Fase 3 (16-10-2026): el revisor. Lee solo las conversaciones del agente ya
-- terminadas, detecta la respuesta que salió mal y deja una sugerencia lista
-- (propuesta del entrenador + cómo respondería con el cambio). El cliente la
-- aplica o la descarta; lo descartado se le recuerda al revisor para que no
-- insista.
create table if not exists agente_sugerencias (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  agent_id uuid not null,
  conversation_id uuid not null,
  mensaje_id uuid,
  problema text not null,          -- lo que detectó el revisor, como lo diría el dueño
  propuesta jsonb not null,        -- ya validada por validarPropuesta
  resumen jsonb,
  conversacion jsonb,              -- hasta la respuesta señalada, limpia
  respuesta_antes text,
  respuesta_despues text,
  estado text not null default 'pendiente',   -- pendiente | aplicada | descartada | caducada
  mejora_id uuid,
  creado_at timestamptz not null default now(),
  resuelto_at timestamptz,
  resuelto_por text
);
alter table agente_sugerencias enable row level security;
create index if not exists agente_sugerencias_agente on agente_sugerencias (agent_id, estado, creado_at desc);
alter table chat_conversations add column if not exists revision_agente_at timestamptz;
alter table chat_agents add column if not exists revisar boolean not null default true;

-- Las conversaciones que el revisor tiene que leer: con agente, terminadas
-- (2 h sin mensajes), de los últimos 3 días y con algo nuevo desde su última
-- revisión. Función porque PostgREST no compara dos columnas entre sí.
create or replace function conversaciones_por_revisar(limite int default 30)
returns setof chat_conversations language sql stable as $$
  select * from chat_conversations c
  where c.agent_id is not null
    and c.last_message_at < now() - interval '2 hours'
    and c.last_message_at > now() - interval '3 days'
    and (c.revision_agente_at is null or c.revision_agente_at < c.last_message_at)
  order by c.last_message_at asc
  limit limite
$$;

-- Detector «nadie le respondió» (16-10-2026). Conversaciones con agente cuyo
-- último mensaje es de la persona y lleva rato sin respuesta:
--   bot   + agente encendido + 10 min → el agente falló (fallo nuestro)
--   human (ya escalada)      + 30 min → nadie del equipo contestó
-- Solo las de las últimas 24 h (después ya avisa cron-ventana) y una vez por
-- mensaje: sin_respuesta_aviso_at se compara con la hora del último mensaje.
alter table chat_conversations add column if not exists sin_respuesta_aviso_at timestamptz;
create or replace function conversaciones_sin_respuesta(limite int default 50)
returns table (id uuid, user_id text, agent_id uuid, lead_id uuid, channel text, status text, contact_name text, contact_phone text, ultimo_at timestamptz, ultimo_texto text)
language sql stable as $$
  select c.id, c.user_id, c.agent_id, c.lead_id, c.channel, c.status, c.contact_name, c.contact_phone, u.created_at, left(u.content, 300)
  from chat_conversations c
  join chat_agents a on a.id = c.agent_id
  join lateral (select m.role, m.created_at, m.content from chat_messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) u on true
  where c.archivada_at is null
    and c.last_message_at > now() - interval '24 hours'
    and u.role = 'user'
    and u.created_at > now() - interval '24 hours'
    and ((c.status = 'bot' and a.is_active and u.created_at < now() - interval '10 minutes')
      or (c.status = 'human' and u.created_at < now() - interval '30 minutes'))
    and (c.sin_respuesta_aviso_at is null or c.sin_respuesta_aviso_at < u.created_at)
  order by u.created_at asc
  limit limite
$$;
