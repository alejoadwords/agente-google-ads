-- Integración con Palomma (13-10-2026), paso 1: recibir y guardar.
--
-- Palomma (el agente de WhatsApp que usa Certain) nos manda por webhook cada
-- evento de sus leads. NO reintenta: si un aviso no se guarda, se pierde. Por
-- eso el receptor solo guarda el evento crudo y responde; convertirlo en un
-- lead de Acuarius es el paso 2, que lee de aquí.
--
-- RLS activo y sin políticas: solo el servidor (service key) las toca.

-- Una conexión por cuenta (y cliente). El token va en la URL; el secreto llega
-- en el header X-Palomma-Secret y aquí solo se guarda su SHA-256. Al rotarlo,
-- el anterior se acepta hasta que Palomma confirme el cambio.
create table if not exists public.palomma_conexiones (
  id                     uuid primary key default gen_random_uuid(),
  user_id                text not null,                 -- Clerk del dueño de la cuenta
  client_id              text,                          -- cliente de la agencia (Certain: pro_main)
  token                  text not null unique,          -- va en la URL ?c=
  secreto_hash           text not null,                 -- sha256 hex del secreto
  secreto_hash_anterior  text,                          -- solo durante una rotación
  activo                 boolean not null default true,
  eventos                integer not null default 0,
  ultimo_evento_at       timestamptz,
  creado_at              timestamptz not null default now(),
  notas                  text
);
alter table public.palomma_conexiones enable row level security;

-- Cada aviso recibido, tal cual. Único por (conexión, tipo, lead, timestamp):
-- Palomma avisa que a veces repite un evento y esa es la clave que recomienda.
create table if not exists public.palomma_eventos (
  id               bigint generated always as identity primary key,
  conexion_id      uuid not null references public.palomma_conexiones(id) on delete cascade,
  user_id          text not null,
  tipo             text not null,                       -- lead.created, lead.status-updated…
  palomma_lead_id  text,                                -- data.lead.id (ULID)
  ts               text,                                -- timestamp del evento, tal cual
  payload          jsonb not null,
  recibido_at      timestamptz not null default now(),
  procesado_at     timestamptz,                         -- lo llena el paso 2
  resultado        text,
  error            text,
  unique (conexion_id, tipo, palomma_lead_id, ts)
);
create index if not exists palomma_eventos_pendientes_idx on public.palomma_eventos (recibido_at) where procesado_at is null;
create index if not exists palomma_eventos_lead_idx on public.palomma_eventos (conexion_id, palomma_lead_id);
alter table public.palomma_eventos enable row level security;

notify pgrst, 'reload schema';

-- Paso 2 (15-10-2026): cada lead de Palomma enlazado a su lead de Acuarius.
-- Es la llave de todo: Palomma recomienda su lead.id, no el teléfono (puede
-- faltar). ultimo_ts evita aplicar un evento viejo que llegue tarde.
create table if not exists public.palomma_leads (
  conexion_id          uuid not null references public.palomma_conexiones(id) on delete cascade,
  palomma_lead_id      text not null,
  lead_id              uuid not null,
  creado_por_palomma   boolean not null default false,   -- false = se unió a uno que ya existía
  etapa_palomma        text,
  ultimo_ts            text,
  nota_conversacion_id uuid,                              -- la nota con la conversación, se actualiza
  citas                text[] not null default '{}',     -- appointment.id ya agendados
  creado_at            timestamptz not null default now(),
  actualizado_at       timestamptz not null default now(),
  primary key (conexion_id, palomma_lead_id)
);
create index if not exists palomma_leads_lead_idx on public.palomma_leads (lead_id);
alter table public.palomma_leads enable row level security;
alter table public.palomma_eventos add column if not exists intentos integer not null default 0;
notify pgrst, 'reload schema';
-- Interruptor del paso 2: hasta encenderlo, los eventos solo se guardan.
alter table public.palomma_conexiones add column if not exists procesar boolean not null default false;
notify pgrst, 'reload schema';
