-- Ventas que Acuarius le reporta a Meta y a Google (01-10-2026).
--
-- La cola la llena la BASE, no la aplicación: un lead se gana desde el
-- tablero, la ficha, el móvil, una automatización o una importación, y
-- enganchar el envío en cada camino es garantizar que alguno se escape. El
-- disparador ve TODOS los caminos porque todos terminan en `leads`.
--
-- Solo se encola si la cuenta tiene activado el envío para esa red: sin eso,
-- cada venta de cada cuenta dejaría una fila que nadie va a mandar.
-- Lo envía api/cron-conversiones.js.

create table if not exists conversiones_pauta (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  client_id    text,
  lead_id      uuid not null,
  red          text not null check (red in ('meta', 'google')),
  evento       text not null default 'Purchase',
  event_id     text not null,              -- el mismo en cada reintento: la red deduplica
  ocurrio_at   timestamptz not null,       -- cuándo se ganó
  estado       text not null default 'pendiente'
               check (estado in ('pendiente', 'enviado', 'rechazado', 'vencido', 'sin_datos', 'cancelado')),
  intentos     int not null default 0,
  proximo_at   timestamptz not null default now(),
  valor        numeric,
  moneda       text,
  llave        text,                       -- con qué se identificó: lead de Meta, clic, teléfono…
  motivo       text,                       -- por qué no salió, en palabras
  respuesta    jsonb,
  enviado_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (red, event_id)
);
alter table conversiones_pauta enable row level security;
create index if not exists conversiones_pauta_cola on conversiones_pauta (proximo_at) where estado = 'pendiente';
create index if not exists conversiones_pauta_cuenta on conversiones_pauta (user_id, created_at desc);

-- El conjunto de datos de Meta de cada cuenta o cliente. Tabla propia y no
-- `platform_connections`, que es única por (user_id, platform): una agencia
-- necesita uno por cliente, porque cada cliente tiene su propio pixel.
create table if not exists conversiones_conexion (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  client_id   text,
  red         text not null default 'meta' check (red in ('meta')),
  dataset     text not null,
  nombre      text,
  token       text not null,               -- cifrado con TOKENS_KEY (api/_cifrado.js)
  activo      boolean not null default true,
  test_event_code text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table conversiones_conexion enable row level security;
create unique index if not exists conversiones_conexion_ambito
  on conversiones_conexion (user_id, red, coalesce(client_id, ''));

-- Etapas del embudo que se reportan a la pauta (03-10-2026). Meta optimiza
-- hacia «Conversion Leads» cuando recibe las etapas intermedias, no solo el
-- lead y la venta; Google puede pujar por valor si cada etapa trae el suyo.
alter table pipeline_stages add column if not exists pauta_reportar boolean not null default false;
alter table pipeline_stages add column if not exists pauta_valor numeric;
-- En la cola: de qué etapa es el evento y con qué valor (el de la etapa, no
-- el del negocio: llegar a «cita» no vale lo que vale la venta).
alter table conversiones_pauta add column if not exists etapa text;
alter table conversiones_pauta add column if not exists valor_etapa numeric;

-- ¿Esta cuenta (o este cliente) manda sus ventas a esta red?
--   meta:   una fila activa en conversiones_conexion.
--   google: la conexión `google_ads` con extra_data.conversiones.activo.
-- Una conexión sin cliente vale para toda la cuenta; una con cliente, solo
-- para los leads de ese cliente.
create or replace function conversiones_red_activa(p_user text, p_client text, p_red text)
returns boolean language sql stable as $$
  select case p_red
    when 'meta' then exists (
      select 1 from conversiones_conexion c
      where c.user_id = p_user and c.red = 'meta' and c.activo
        and (c.client_id is null or c.client_id = p_client))
    when 'google' then exists (
      select 1 from platform_connections c
      where c.user_id = p_user and c.platform = 'google_ads'
        and (c.client_id is null or c.client_id = p_client)
        and coalesce((c.extra_data->'conversiones'->>'activo')::boolean, false))
    else false end;
$$;

create or replace function conversiones_encolar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cuando timestamptz;
  v_red  text;   -- NO «red»: chocaría con la columna en el ON CONFLICT y el
                 -- error quedaba tapado por el `exception` de abajo
  v_etapa  text;
  v_nombre text;
  v_valor  numeric;
begin
  if new.deleted_at is not null then return new; end if;
  -- El lead que llega de un anuncio de Meta se le reporta también al ENTRAR
  -- («Lead»): la API de conversiones para CRM pide la etapa de entrada además
  -- de la venta para unir el recorrido. Solo si trae una llave de Meta; sin
  -- ella, un «Lead» no le dice nada a Meta que valga la pena.
  if tg_op = 'INSERT'
     and (new.custom_fields ? 'ID de lead de Meta'
          or (coalesce(new.custom_fields->>'Plataforma', '') = 'Meta' and new.custom_fields ? 'Clic de anuncio'))
     and conversiones_red_activa(new.user_id, new.client_id, 'meta') then
    insert into conversiones_pauta (user_id, client_id, lead_id, red, evento, event_id, ocurrio_at)
    values (new.user_id, new.client_id, new.id, 'meta', 'Lead', 'acu-lead-' || new.id, coalesce(new.created_at, now()))
    on conflict (red, event_id) do nothing;
  end if;
  -- Etapas intermedias marcadas para la pauta. Solo de leads que vinieron de
  -- un anuncio de ESA red: a Meta no le sirve saber que un lead de un portal
  -- llegó a «cita», y mandárselo sería sacar datos de más. Una vez por lead y
  -- etapa: ir y volver no la cuenta dos veces.
  if new.stage not in ('ganado', 'perdido')
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage) then
    select s.key, left(s.label, 40), s.pauta_valor into v_etapa, v_nombre, v_valor
      from pipeline_stages s
     where s.key = new.stage and s.pauta_reportar
       and s.pipeline_id = coalesce(new.pipeline_id, (
             select p.id from pipelines p
              where p.user_id = new.user_id and p.is_default
                and (p.client_id is not distinct from new.client_id or p.client_id is null)
              order by (p.client_id is not distinct from new.client_id) desc limit 1))
     limit 1;
    if v_etapa is not null then
      if (new.custom_fields ? 'ID de lead de Meta' or coalesce(new.custom_fields->>'Plataforma', '') like 'Meta%')
         and coalesce(new.custom_fields->>'Plataforma', '') <> 'Meta orgánico'
         and conversiones_red_activa(new.user_id, new.client_id, 'meta') then
        insert into conversiones_pauta (user_id, client_id, lead_id, red, evento, etapa, valor_etapa, event_id, ocurrio_at)
        values (new.user_id, new.client_id, new.id, 'meta', v_nombre, v_etapa, v_valor,
                'acu-et-' || new.id || '-' || v_etapa, now())
        on conflict (red, event_id) do nothing;
      end if;
      if coalesce(new.custom_fields->>'Plataforma', '') like 'Google%' and new.custom_fields ? 'Clic de anuncio'
         and conversiones_red_activa(new.user_id, new.client_id, 'google') then
        insert into conversiones_pauta (user_id, client_id, lead_id, red, evento, etapa, valor_etapa, event_id, ocurrio_at)
        values (new.user_id, new.client_id, new.id, 'google', v_nombre, v_etapa, v_valor,
                'acu-et-' || new.id || '-' || v_etapa, now())
        on conflict (red, event_id) do nothing;
      end if;
    end if;
  end if;

  if new.stage is distinct from 'ganado' then return new; end if;
  if tg_op = 'UPDATE' and old.stage is not distinct from 'ganado' then return new; end if;
  -- La ventana de cierre guarda solo el DÍA (a las 12:00) porque deja elegir
  -- uno anterior. Si ese día es hoy, la venta ocurrió ahora y se informa la
  -- hora real; si eligieron otro día, se respeta ese día.
  cuando := case when new.closed_at is null or abs(extract(epoch from now() - new.closed_at)) < 86400
                 then now() else new.closed_at end;
  foreach v_red in array array['meta', 'google'] loop
    if conversiones_red_activa(new.user_id, new.client_id, v_red) then
      -- event_id con el instante del cierre: si el negocio se reabre y se
      -- vuelve a ganar es OTRA venta; si solo se reintenta, es la misma.
      insert into conversiones_pauta (user_id, client_id, lead_id, red, event_id, ocurrio_at)
      values (new.user_id, new.client_id, new.id, v_red,
              'acu-' || new.id || '-' || floor(extract(epoch from cuando))::bigint, cuando)
      on conflict (red, event_id) do nothing;
    end if;
  end loop;
  return new;
exception when others then
  -- Un fallo aquí NO puede impedir ganar un negocio: se anota y sigue.
  raise warning 'conversiones_encolar: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists leads_conversiones on leads;
create trigger leads_conversiones
  after insert or update of stage, deleted_at on leads
  for each row execute function conversiones_encolar();
