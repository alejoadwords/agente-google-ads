-- ════════════════════════════════════════════════════════════════════════════
-- Inventario del cliente para los agentes de WhatsApp
-- Correr en Supabase → SQL Editor. Idempotente.
--
-- El agente solo puede afirmar lo que tiene delante. Esta tabla es ese "delante":
-- las propiedades reales del cliente, sincronizadas desde su web.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. De dónde saca cada cliente su inventario ─────────────────────────────
create table if not exists client_knowledge_sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       text        not null,
  client_id     text        not null,         -- TEXTO, como en todo el proyecto
  tipo          text        not null default 'wordpress',
  base_url      text        not null,         -- https://sitio.com
  activo        boolean     not null default true,
  -- Estado de la última pasada, a la vista: una sincronización que falla en
  -- silencio deja al agente ofreciendo propiedades que ya no existen.
  ultimo_sync   timestamptz,
  ultimo_estado text,                         -- 'ok' | 'error' | 'en_curso'
  ultimo_error  text,
  items         int         not null default 0,
  cursor_pagina int         not null default 1,   -- por dónde va el lote
  created_at    timestamptz not null default now()
);

create unique index if not exists cks_cliente_idx
  on client_knowledge_sources(user_id, client_id);

-- Qué campo de la web es cada cosa. No todas las inmobiliarias llaman igual a
-- sus campos: una usa 'estado-del-inmueble' para Arriendo/Venta y otra
-- 'operacion'. Se detecta al conectar y se guarda aquí, así el mismo conector
-- sirve para cualquier WordPress sin tocar código.
alter table client_knowledge_sources add column if not exists mapeo jsonb;
alter table client_knowledge_sources add column if not exists post_type text;

-- ── 2. Las propiedades ──────────────────────────────────────────────────────
create table if not exists client_properties (
  id           uuid primary key default gen_random_uuid(),
  user_id      text        not null,
  client_id    text        not null,
  codigo       text        not null,          -- el que ve el cliente y el asesor
  operacion    text,                          -- Arriendo | Venta | Arriendo/Venta
  tipo         text,                          -- Apartamento, Casa, Local...
  ciudad       text,
  barrio       text,
  habitaciones int,
  banos        int,
  estrato      int,
  precio       bigint,                        -- en pesos, sin decimales
  url          text,
  -- 'modificado' viene de la web: permite sincronizar solo lo que cambió.
  modificado   timestamptz,
  visto_en     timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Una propiedad por código y cliente: resincronizar actualiza, no duplica.
create unique index if not exists cp_codigo_idx
  on client_properties(user_id, client_id, codigo);
create index if not exists cp_busqueda_idx
  on client_properties(user_id, client_id, operacion, ciudad, precio);

-- ── 3. Comprobación ─────────────────────────────────────────────────────────
-- Las dos deben salir 1.
select
  (select count(*) from information_schema.tables where table_name = 'client_knowledge_sources') as tabla_fuentes,
  (select count(*) from information_schema.tables where table_name = 'client_properties') as tabla_propiedades;
