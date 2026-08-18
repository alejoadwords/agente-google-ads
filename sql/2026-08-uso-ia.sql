-- ════════════════════════════════════════════════════════════════════════════
-- Registro de consumo de IA
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- Una fila por llamada al modelo. Hasta ahora no se registraba nada: no se sabe
-- cuánto gasta nadie, así que cualquier cupo que se ponga sería a ciegas —y
-- cortarle el servicio a alguien por un número inventado es peor que no tener
-- cupos.
--
-- Se guardan los tokens Y el costo calculado. Los tokens son el hecho; el costo
-- depende de precios que cambian, y guardar el de ese momento evita recalcular
-- el pasado con la tarifa de hoy.
create table if not exists ai_usage (
  id           uuid primary key default gen_random_uuid(),
  user_id      text        not null,          -- la cuenta (dueño) a la que se le imputa
  actor_id     text,                          -- quién lo hizo, si fue un miembro
  origen       text        not null,          -- agente | whatsapp | soporte | copiloto | propuesta
  agente       text,                          -- google-ads, meta-ads… cuando aplica
  modelo       text,
  tokens_in    integer     not null default 0,
  tokens_out   integer     not null default 0,
  cache_write  integer     not null default 0,
  cache_read   integer     not null default 0,
  costo        numeric(12,6) not null default 0,
  created_at   timestamptz not null default now()
);

-- Las dos consultas que se van a hacer siempre: el gasto de una cuenta en el mes
-- y el total del periodo.
create index if not exists uso_ia_cuenta_idx on ai_usage(user_id, created_at desc);
create index if not exists uso_ia_fecha_idx  on ai_usage(created_at desc);

-- Comprobación: debe salir 1.
select count(*) as tabla from information_schema.tables where table_name = 'ai_usage';
