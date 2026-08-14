-- ════════════════════════════════════════════════════════════════════════════
-- Mensajes programados del inbox
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists scheduled_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         text        not null,          -- la cuenta (dueño)
  author_user_id  text,                          -- quién lo programó
  conversation_id uuid        not null,
  texto           text,
  adjunto_url     text,
  adjunto_tipo    text,
  adjunto_nombre  text,
  adjunto_mime    text,
  enviar_at       timestamptz not null,
  -- pendiente → enviado | fallido | cancelado. 'enviando' existe para que dos
  -- pasadas del cron a la vez no manden el mismo mensaje dos veces.
  estado          text        not null default 'pendiente',
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists prog_pendientes_idx
  on scheduled_messages(enviar_at) where estado = 'pendiente';
create index if not exists prog_conv_idx on scheduled_messages(conversation_id);
create index if not exists prog_user_idx on scheduled_messages(user_id);

-- Comprobación: debe salir 1.
select count(*) as tabla_programados
from information_schema.tables
where table_name = 'scheduled_messages';
