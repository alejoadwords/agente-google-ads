-- ════════════════════════════════════════════════════════════════════════════
-- Chat de soporte con IA y tickets
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- Una conversación de soporte por usuario y sesión. Se guarda para que el
-- ticket llegue con todo el hilo: sin él, quien atienda lee media frase.
create table if not exists support_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    text        not null,
  email      text,
  plan       text,
  mensajes   jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sop_conv_user_idx on support_conversations(user_id, updated_at desc);

-- El ticket nace cuando el asistente no puede resolverlo, o cuando el usuario
-- lo pide. Lleva el contexto técnico ya recogido para no tener que pedírselo.
create table if not exists support_tickets (
  id              uuid primary key default gen_random_uuid(),
  user_id         text        not null,
  email           text,
  plan            text,
  asunto          text        not null,
  detalle         text,
  -- Lo que el asistente vio de la cuenta al abrirlo: canales, agentes, plan…
  contexto        jsonb       not null default '{}'::jsonb,
  conversation_id uuid,
  -- abierto → en_curso → resuelto | cerrado
  estado          text        not null default 'abierto',
  respuesta       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sop_ticket_estado_idx on support_tickets(estado, created_at desc);
create index if not exists sop_ticket_user_idx on support_tickets(user_id, created_at desc);

-- Comprobación: debe salir 2.
select count(*) as tablas
from information_schema.tables
where table_name in ('support_conversations','support_tickets');
