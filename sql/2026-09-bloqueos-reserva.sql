-- Bloqueos del módulo de reservas.
--
-- Tabla propia y NO una `activity`, a propósito. Un bloqueo colado en
-- `activities` lo bloquearía gratis —`ocupadoDe()` no filtra por tipo— pero de
-- las 16 consultas que hay sobre esa tabla, 14 no miran el tipo. Dos de ellas
-- filtran solo por `done=false`, y una es `cron-tasks`: el resumen diario le
-- habría escrito a cada asesor contándole sus propios bloqueos como tareas
-- pendientes. Una reserva SÍ es una activity —es una cita de verdad, va en la
-- agenda—; un bloqueo es lo contrario de una cita.
--
-- `resource_id` NULL = todo el negocio. Se resuelve al calcular los huecos, no
-- creando una fila por recurso: así un recurso dado de alta mañana también
-- respeta el bloqueo de la semana que viene.
create table if not exists public.booking_blocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  client_id   text,
  resource_id uuid references public.booking_resources(id) on delete cascade,
  inicio      timestamptz not null,
  fin         timestamptz not null,
  motivo      text,
  created_at  timestamptz not null default now(),
  constraint booking_blocks_orden check (fin > inicio)
);

-- La consulta que se hace en cada cálculo de huecos: por cuenta y por rango.
create index if not exists booking_blocks_cuenta_rango
  on public.booking_blocks (user_id, inicio, fin);

-- Todo pasa por service_role, así que RLS activo y sin políticas es lo
-- correcto: sin política, nadie entra con la clave anon. Las tablas de
-- reservas nacieron abiertas y hubo que cerrarlas después; esta nace cerrada.
alter table public.booking_blocks enable row level security;
