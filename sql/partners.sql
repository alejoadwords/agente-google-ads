-- Programa de Partners (06-10-2026).
--
-- Un Partner se postula, Acuarius lo aprueba, recibe su enlace /registro/<slug>
-- y gana el 20 % de cada cobro de LICENCIA (Pro o Agency) de las cuentas que
-- trae, mientras sigan pagando. Liquida una vez al mes subiendo su factura.
--
-- Todas con RLS activo y sin políticas: solo el servidor (service key) las toca.

-- Quién es Partner y en qué estado está.
create table if not exists public.partners (
  user_id           text primary key,                 -- Clerk
  estado            text not null default 'postulado' -- postulado | aprobado | rechazado | pausado
                    check (estado in ('postulado','aprobado','rechazado','pausado')),
  nombre_comercial  text not null,
  sitio_web         text,
  correo            text not null,
  whatsapp          text,
  paises            text[] not null default '{}',
  sectores          text[] not null default '{}',
  servicios         text[] not null default '{}',
  propuesta         text,                             -- cómo piensa traer clientes
  datos_pago        text,                             -- banco / PayPal / lo que el Partner indique
  comision_pct      numeric(5,2) not null default 20,
  slug              text,                             -- su enlace en enlaces_registro
  notas_admin       text,
  creado_at         timestamptz not null default now(),
  decidido_at       timestamptz,
  decidido_por      text,
  updated_at        timestamptz not null default now()
);
alter table public.partners enable row level security;

-- Cada cuenta que llegó por el enlace de un Partner. Una cuenta pertenece a un
-- solo Partner y para siempre (primer toque).
create table if not exists public.partner_referidos (
  referido_user_id  text primary key,                 -- Clerk de la cuenta traída
  partner_user_id   text not null references public.partners(user_id) on delete cascade,
  slug              text,
  correo            text,
  nombre            text,
  creado_at         timestamptz not null default now()
);
create index if not exists partner_referidos_partner_idx on public.partner_referidos (partner_user_id);
alter table public.partner_referidos enable row level security;

-- Cada cobro de licencia tal como lo informa la pasarela (Hotmart hoy, Stripe
-- mañana). Es la fuente de las comisiones: billing no sirve, solo se llena si la
-- cuenta tiene fila espejo en users. `tipo` = cobro | reembolso | contracargo.
create table if not exists public.cobros (
  id                bigint generated always as identity primary key,
  pasarela          text not null default 'hotmart',
  transaccion       text not null,
  tipo              text not null default 'cobro' check (tipo in ('cobro','reembolso','contracargo')),
  evento            text,
  user_id           text,                             -- Clerk, si se encontró
  correo            text,
  producto          text,
  plan              text,                             -- pro | agency
  periodo           text,                             -- mensual | anual
  monto             numeric(14,2) not null,
  moneda            text not null default 'USD',
  cobrado_at        timestamptz not null default now(),
  creado_at         timestamptz not null default now(),
  unique (pasarela, transaccion, tipo)
);
create index if not exists cobros_user_idx on public.cobros (user_id);
alter table public.cobros enable row level security;

-- Las comisiones, una por cobro (o reverso) de una cuenta referida. Negativa si
-- es un reembolso o contracargo de algo que ya generó comisión.
create table if not exists public.partner_comisiones (
  id                bigint generated always as identity primary key,
  partner_user_id   text not null references public.partners(user_id) on delete cascade,
  referido_user_id  text not null,
  cobro_id          bigint not null unique references public.cobros(id) on delete restrict,
  tipo              text not null default 'cobro',
  plan              text,
  monto_cobrado     numeric(14,2) not null,
  moneda            text not null,
  tasa_usd          numeric(14,6) not null default 1, -- unidades de moneda por 1 USD
  base_usd          numeric(14,2) not null,
  pct               numeric(5,2) not null,
  comision_usd      numeric(14,2) not null,
  estado            text not null default 'disponible'
                    check (estado in ('disponible','en_liquidacion','pagada','anulada')),
  liquidacion_id    bigint,
  cobrado_at        timestamptz not null,
  creado_at         timestamptz not null default now()
);
create index if not exists partner_comisiones_partner_idx on public.partner_comisiones (partner_user_id, estado);
alter table public.partner_comisiones enable row level security;

-- Una liquidación: las comisiones que el Partner pide cobrar, con su factura.
create table if not exists public.partner_liquidaciones (
  id                bigint generated always as identity primary key,
  partner_user_id   text not null references public.partners(user_id) on delete cascade,
  total_usd         numeric(14,2) not null,
  n_comisiones      integer not null,
  factura_ruta      text not null,                    -- ruta en el bucket privado partners-facturas
  factura_nombre    text,
  estado            text not null default 'solicitada'
                    check (estado in ('solicitada','pagada','rechazada')),
  nota_partner      text,
  nota_admin        text,
  referencia_pago   text,
  solicitada_at     timestamptz not null default now(),
  resuelta_at       timestamptz,
  resuelta_por      text
);
create index if not exists partner_liquidaciones_partner_idx on public.partner_liquidaciones (partner_user_id, estado);
alter table public.partner_liquidaciones enable row level security;

alter table public.partner_comisiones
  drop constraint if exists partner_comisiones_liquidacion_fk;
alter table public.partner_comisiones
  add constraint partner_comisiones_liquidacion_fk
  foreign key (liquidacion_id) references public.partner_liquidaciones(id) on delete set null;

-- Bucket privado para las facturas (se ven con URL firmada, nunca públicas).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partners-facturas', 'partners-facturas', false, 10485760,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';

-- Avisos para la campana del Partner: aprobación, liquidación pagada o devuelta.
-- Se quedan hasta que los abre (leido_at).
create table if not exists public.partner_avisos (
  id                bigint generated always as identity primary key,
  partner_user_id   text not null references public.partners(user_id) on delete cascade,
  tipo              text not null,                    -- aprobado | pagada | devuelta
  titulo            text not null,
  texto             text,
  leido_at          timestamptz,
  creado_at         timestamptz not null default now()
);
create index if not exists partner_avisos_pendientes_idx on public.partner_avisos (partner_user_id) where leido_at is null;
alter table public.partner_avisos enable row level security;
notify pgrst, 'reload schema';
