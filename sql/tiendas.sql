-- sql/tiendas.sql — tiendas en línea (Shopify y WooCommerce), 15-10-2026.
--
-- Una tienda conectada manda sus avisos (pedidos, carritos, productos) a
-- /api/tienda-webhook; ahí solo se guardan crudos en tienda_eventos y el cron
-- (api/cron-tiendas.js) los convierte en pedidos, leads y automatizaciones.
-- Mismo molde que Palomma: el receptor no puede perder un aviso por estar
-- haciendo otra cosa.

create table if not exists public.tiendas (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  client_id text,
  plataforma text not null check (plataforma in ('shopify', 'woocommerce')),
  -- mitienda.myshopify.com  |  https://mitienda.com
  dominio text not null,
  -- JSON cifrado con _cifrado.js: Shopify {client_id, client_secret | token},
  -- WooCommerce {ck, cs}. Nunca sale hacia el navegador.
  credenciales text not null,
  -- Token de acceso de Shopify (vence a las 24 h) ya cifrado, y cuándo vence.
  acceso text,
  acceso_vence timestamptz,
  -- Va en la URL del webhook: ?t=<token>. Es público por diseño; la firma es
  -- lo que prueba que el aviso es de la tienda.
  token text not null unique,
  -- WooCommerce firma con un secreto que elegimos nosotros (cifrado).
  secreto text,
  nombre text,
  moneda text,
  activo boolean not null default true,
  estado text,
  ultimo_error text,
  webhooks jsonb,
  -- Cursor de la sincronización de productos en curso (null = no hay).
  cursor_productos text,
  productos integer not null default 0,
  pedidos integer not null default 0,
  ultimo_evento_at timestamptz,
  ultimo_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tiendas_unica on public.tiendas (user_id, client_id, plataforma, dominio) nulls not distinct;
alter table public.tiendas enable row level security;

create table if not exists public.tienda_eventos (
  id bigserial primary key,
  tienda_id uuid not null references public.tiendas(id) on delete cascade,
  user_id text not null,
  tema text not null,
  -- X-Shopify-Webhook-Id / X-WC-Webhook-Delivery-ID: Shopify reintenta el
  -- mismo aviso hasta 19 veces; con esto entra una sola.
  entrega text not null,
  payload jsonb,
  recibido_at timestamptz not null default now(),
  procesado_at timestamptz,
  resultado text,
  error text,
  intentos integer not null default 0
);
create unique index if not exists tienda_eventos_entrega on public.tienda_eventos (tienda_id, entrega);
create index if not exists tienda_eventos_pendientes on public.tienda_eventos (recibido_at) where procesado_at is null;
alter table public.tienda_eventos enable row level security;

create table if not exists public.tienda_pedidos (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  client_id text,
  tienda_id uuid not null references public.tiendas(id) on delete cascade,
  -- 'pedido' o 'carrito' (checkout de Shopify / pedido sin pagar de Woo)
  tipo text not null check (tipo in ('pedido', 'carrito')),
  externo_id text not null,
  numero text,
  checkout text,
  lead_id uuid,
  nombre text,
  email text,
  telefono text,
  total numeric,
  moneda text,
  -- pendiente | pagado | enviado | cancelado | reembolsado | abandonado | recuperado
  estado text,
  productos jsonb,
  enlace text,
  creado_at timestamptz,
  pagado_at timestamptz,
  enviado_at timestamptz,
  -- Qué automatizaciones ya se dispararon por este pedido: {pagado, enviado, carrito}
  disparos jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists tienda_pedidos_unico on public.tienda_pedidos (tienda_id, tipo, externo_id);
create index if not exists tienda_pedidos_lead on public.tienda_pedidos (lead_id);
create index if not exists tienda_pedidos_carritos on public.tienda_pedidos (estado, creado_at) where tipo = 'carrito';
create index if not exists tienda_pedidos_cuenta on public.tienda_pedidos (user_id, pagado_at);
alter table public.tienda_pedidos enable row level security;

-- Los productos de la tienda van al mismo catálogo que lee el agente; esta
-- columna dice de qué tienda vino cada uno, para quitarlos al desconectarla.
alter table public.client_products add column if not exists tienda_id uuid references public.tiendas(id) on delete cascade;
create index if not exists client_products_tienda on public.client_products (tienda_id) where tienda_id is not null;

-- Una tienda en dólares o pesos mexicanos cobra con centavos: bigint los cortaba.
alter table public.client_products alter column precio type numeric using precio::numeric;

-- Shopify: el dominio que ve el cliente (mitienda.com), para los enlaces a productos.
alter table public.tiendas add column if not exists dominio_publico text;

-- La importación de pedidos anteriores: {estado, desde, c|p, pedidos, clientes, terminado_at, error}.
alter table public.tiendas add column if not exists historial jsonb;

-- Tiendanube y VTEX (16-10-2026).
alter table public.tiendas drop constraint if exists tiendas_plataforma_check;
alter table public.tiendas add constraint tiendas_plataforma_check check (plataforma in ('shopify', 'woocommerce', 'tiendanube', 'vtex'));
-- Tiendanube no avisa los carritos abandonados: se consultan cada 30 minutos.
alter table public.tiendas add column if not exists sondeo_at timestamptz;
