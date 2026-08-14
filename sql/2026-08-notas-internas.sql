-- ════════════════════════════════════════════════════════════════════════════
-- Notas internas de las conversaciones
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- Tabla aparte, y no una fila más en chat_messages, a propósito: el motor lee
-- el historial de chat_messages y se lo pasa entero al modelo. Una nota metida
-- ahí llegaría al agente —que podría repetírsela al cliente— y además con un
-- 'role' que la API de Claude no acepta, lo que tumbaría la respuesta.
-- Con una tabla separada eso no puede pasar ni por descuido.
create table if not exists conversation_notes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid        not null,
  user_id         text        not null,   -- la cuenta (dueño), para el alcance
  author_user_id  text,                   -- quién la escribió de verdad
  author_name     text,
  texto           text        not null,
  created_at      timestamptz not null default now()
);

create index if not exists notas_conv_idx on conversation_notes(conversation_id);
create index if not exists notas_user_idx on conversation_notes(user_id);

-- Comprobación: debe salir 1.
select count(*) as tabla_notas
from information_schema.tables
where table_name = 'conversation_notes';
