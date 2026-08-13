-- ════════════════════════════════════════════════════════════════════════════
-- Ventana de 24 horas + respuestas rápidas del inbox
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Cuándo escribió el cliente por última vez ────────────────────────────
-- WhatsApp solo deja responder libremente durante 24 horas desde el ÚLTIMO
-- mensaje del cliente. 'last_message_at' no sirve: se actualiza también cuando
-- escribimos nosotros, así que la ventana parecería reiniciarse sola.
alter table chat_conversations add column if not exists last_inbound_at timestamptz;

-- Relleno para lo que ya existe: el último mensaje entrante de cada conversación.
update chat_conversations c
set last_inbound_at = m.ultimo
from (
  select conversation_id, max(created_at) as ultimo
  from chat_messages where role = 'user' group by conversation_id
) m
where m.conversation_id = c.id and c.last_inbound_at is null;

-- ── 2. Respuestas rápidas ───────────────────────────────────────────────────
-- Lo que un comercial escribe cien veces al día. Por cuenta y, si se quiere,
-- por cliente: la respuesta de una inmobiliaria no sirve a una clínica.
create table if not exists quick_replies (
  id         uuid primary key default gen_random_uuid(),
  user_id    text        not null,
  client_id  text,                         -- null = de toda la cuenta
  titulo     text        not null,         -- con lo que se busca
  texto      text        not null,
  usos       int         not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists qr_user_idx on quick_replies(user_id);

-- ── 3. Comprobación ─────────────────────────────────────────────────────────
-- 'columna' debe salir 1 y 'rellenadas' dice cuántas conversaciones quedaron
-- con su fecha real de último mensaje entrante.
select
  (select count(*) from information_schema.columns
     where table_name = 'chat_conversations' and column_name = 'last_inbound_at') as columna,
  (select count(*) from chat_conversations where last_inbound_at is not null) as rellenadas,
  (select count(*) from information_schema.tables where table_name = 'quick_replies') as tabla_respuestas;
