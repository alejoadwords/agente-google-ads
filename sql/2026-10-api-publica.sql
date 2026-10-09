-- API pública de Acuarius (api/v1.js) — 08-10-2026
--
-- Llaves por cuenta, contador de uso, registro de llamadas, idempotencia y
-- avisos salientes (webhooks). Todas con RLS activo y SIN políticas: solo el
-- servidor (service_role) las toca. Ver [[project_rls_supabase]].
--
-- Se aplica por la Management API (la REST no ejecuta DDL). Va en una sola
-- transacción: si una sentencia falla, no queda nada a medias.

-- ── Llaves ──────────────────────────────────────────────────────────────────
-- La llave completa NO se guarda: solo su SHA-256. Quien la pierde crea otra.
create table if not exists api_llaves (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null,           -- la CUENTA (el dueño), nunca el miembro
  client_id         text,                    -- null = toda la cuenta
  nombre            text not null,
  prefijo           text not null,           -- lo visible: «acu_live_ab12cd34»
  hash              text not null unique,
  permisos          text[] not null default '{}',
  limite_minuto     integer not null default 120,
  limite_dia        integer not null default 20000,
  creada_por        text not null,
  creada_por_nombre text,
  created_at        timestamptz not null default now(),
  ultimo_uso_at     timestamptz,
  revocada_at       timestamptz,
  revocada_por      text
);
create index if not exists api_llaves_cuenta on api_llaves (user_id);
alter table api_llaves enable row level security;

-- ── Contador de uso ─────────────────────────────────────────────────────────
-- Una fila por llave y ventana ('m:2026-10-08T14:05' o 'd:2026-10-08'). El
-- incremento es atómico en la base: con funciones edge sin memoria compartida,
-- contar en el código dejaría pasar ráfagas enteras.
create table if not exists api_uso (
  llave_id uuid not null,
  ventana  text not null,
  n        integer not null default 0,
  primary key (llave_id, ventana)
);
alter table api_uso enable row level security;

create or replace function api_contar(p_llave uuid, p_minuto text, p_dia text)
returns table (minuto integer, dia integer)
language plpgsql security definer set search_path = public as $$
begin
  insert into api_uso (llave_id, ventana, n) values (p_llave, p_minuto, 1)
    on conflict (llave_id, ventana) do update set n = api_uso.n + 1
    returning api_uso.n into minuto;
  insert into api_uso (llave_id, ventana, n) values (p_llave, p_dia, 1)
    on conflict (llave_id, ventana) do update set n = api_uso.n + 1
    returning api_uso.n into dia;
  -- El «último uso» se escribe como mucho una vez por minuto: escribirlo en
  -- cada llamada duplicaría la escritura de toda la API.
  update api_llaves set ultimo_uso_at = now()
   where id = p_llave and (ultimo_uso_at is null or ultimo_uso_at < now() - interval '1 minute');
  return next;
end;
$$;
revoke all on function api_contar(uuid, text, text) from public, anon, authenticated;
grant execute on function api_contar(uuid, text, text) to service_role;

-- ── Registro de llamadas ────────────────────────────────────────────────────
-- Se guardan las escrituras y los errores, no cada lectura: es lo que alguien
-- necesita para responder «¿qué hizo el agente?» sin duplicar la escritura de
-- la base por cada consulta.
create table if not exists api_registro (
  id         bigint generated always as identity primary key,
  llave_id   uuid not null,
  user_id    text not null,
  metodo     text not null,
  ruta       text not null,
  estado     integer not null,
  ms         integer,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists api_registro_cuenta on api_registro (user_id, created_at desc);
alter table api_registro enable row level security;

-- ── Idempotencia ────────────────────────────────────────────────────────────
-- Un agente que reintenta tras un corte de red no debe crear dos tareas. Con
-- la cabecera Idempotency-Key la segunda llamada devuelve la primera respuesta.
create table if not exists api_idempotencia (
  llave_id   uuid not null,
  clave      text not null,
  estado     integer,                -- null mientras la primera sigue en curso
  cuerpo     jsonb,
  created_at timestamptz not null default now(),
  primary key (llave_id, clave)
);
alter table api_idempotencia enable row level security;

-- ── Avisos salientes ────────────────────────────────────────────────────────
create table if not exists api_webhooks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            text not null,
  client_id          text,
  url                text not null,
  secreto            text not null,      -- cifrado con api/_cifrado.js
  eventos            text[] not null default '{}',
  activo             boolean not null default true,
  creado_por         text,
  created_at         timestamptz not null default now(),
  fallos_seguidos    integer not null default 0,
  ultimo_error       text,
  ultimo_ok_at       timestamptz,
  desactivado_motivo text
);
create index if not exists api_webhooks_cuenta on api_webhooks (user_id) where activo;
alter table api_webhooks enable row level security;

create table if not exists api_entregas (
  id            bigint generated always as identity primary key,
  webhook_id    uuid not null references api_webhooks(id) on delete cascade,
  user_id       text not null,
  evento        text not null,
  evento_id     uuid not null default gen_random_uuid(),
  datos         jsonb not null,
  estado        text not null default 'pendiente',   -- pendiente | enviada | fallida
  intentos      integer not null default 0,
  proximo_at    timestamptz not null default now(),
  ultimo_estado integer,
  ultimo_error  text,
  created_at    timestamptz not null default now(),
  enviada_at    timestamptz
);
create index if not exists api_entregas_cola on api_entregas (proximo_at) where estado = 'pendiente';
create index if not exists api_entregas_webhook on api_entregas (webhook_id, created_at desc);
alter table api_entregas enable row level security;

-- Encola un evento para cada webhook activo de la cuenta que lo pidió. Los
-- disparadores de abajo lo llaman: así se avisa venga el cambio de donde venga
-- (la app, la API, una automatización, el inbox, un webhook de entrada), sin
-- tener que acordarse de avisar en cada uno de esos caminos.
create or replace function api_encolar(p_cuenta text, p_cliente text, p_evento text, p_datos jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into api_entregas (webhook_id, user_id, evento, datos)
  select w.id, p_cuenta, p_evento, p_datos
    from api_webhooks w
   where w.user_id = p_cuenta and w.activo
     and p_evento = any (w.eventos)
     and (w.client_id is null or w.client_id is not distinct from p_cliente);
end;
$$;
revoke all on function api_encolar(text, text, text, jsonb) from public, anon, authenticated;

create or replace function api_lead_json(l leads) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', l.id, 'name', l.name, 'email', l.email, 'phone', l.phone, 'company', l.company,
    'stage', l.stage, 'pipeline_id', l.pipeline_id, 'client_id', l.client_id,
    'assigned_to', l.assigned_to, 'assigned_name', l.assigned_name,
    'value', l.value, 'source', l.source, 'tags', l.tags,
    'close_reason', l.close_reason, 'closed_at', l.closed_at,
    'created_at', l.created_at, 'updated_at', l.updated_at)
$$;

create or replace function api_eventos_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null then return new; end if;
  -- Salida rápida: casi ninguna cuenta tiene webhooks, y esto corre en cada
  -- guardado de un lead.
  if not exists (select 1 from api_webhooks where user_id = new.user_id and activo) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform api_encolar(new.user_id, new.client_id, 'lead.creado',
      jsonb_build_object('lead', api_lead_json(new)));
  else
    if new.stage is distinct from old.stage then
      perform api_encolar(new.user_id, new.client_id, 'lead.etapa_cambiada',
        jsonb_build_object('lead', api_lead_json(new), 'etapa_anterior', old.stage));
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      perform api_encolar(new.user_id, new.client_id, 'lead.asignado',
        jsonb_build_object('lead', api_lead_json(new), 'asignado_antes', old.assigned_to));
    end if;
  end if;
  return new;
exception when others then
  -- Un aviso que no se pudo encolar NUNCA puede impedir guardar un lead.
  raise warning 'api_eventos_lead: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists leads_api_eventos on leads;
create trigger leads_api_eventos
  after insert or update of stage, assigned_to on leads
  for each row execute function api_eventos_lead();

create or replace function api_eventos_mensaje() returns trigger
language plpgsql security definer set search_path = public as $$
declare c chat_conversations; v_cliente text;
begin
  if new.role <> 'user' then return new; end if;
  select * into c from chat_conversations where id = new.conversation_id;
  if c.id is null then return new; end if;
  if not exists (select 1 from api_webhooks where user_id = c.user_id and activo) then
    return new;
  end if;
  -- La conversación no guarda cliente: se toma el del lead y, si no hay, el
  -- del canal.
  select coalesce(
    (select client_id from leads where id = c.lead_id),
    (select client_id from channel_connections where id = c.connection_id)) into v_cliente;
  perform api_encolar(c.user_id, v_cliente, 'mensaje.recibido', jsonb_build_object(
    'mensaje', jsonb_build_object('id', new.id, 'contenido', new.content,
      'adjunto_url', new.adjunto_url, 'adjunto_tipo', new.adjunto_tipo, 'created_at', new.created_at),
    'conversacion', jsonb_build_object('id', c.id, 'canal', c.channel, 'estado', c.status,
      'contacto_id', c.contact_id, 'contacto_nombre', c.contact_name, 'lead_id', c.lead_id)));
  return new;
exception when others then
  raise warning 'api_eventos_mensaje: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists chat_messages_api_eventos on chat_messages;
create trigger chat_messages_api_eventos
  after insert on chat_messages
  for each row execute function api_eventos_mensaje();

create or replace function api_eventos_conversacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cliente text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if not exists (select 1 from api_webhooks where user_id = new.user_id and activo) then
    return new;
  end if;
  select coalesce(
    (select client_id from leads where id = new.lead_id),
    (select client_id from channel_connections where id = new.connection_id)) into v_cliente;
  perform api_encolar(new.user_id, v_cliente, 'conversacion.estado_cambiado', jsonb_build_object(
    'conversacion', jsonb_build_object('id', new.id, 'canal', new.channel, 'estado', new.status,
      'estado_anterior', old.status, 'contacto_id', new.contact_id,
      'contacto_nombre', new.contact_name, 'lead_id', new.lead_id)));
  return new;
exception when others then
  raise warning 'api_eventos_conversacion: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists chat_conversations_api_eventos on chat_conversations;
create trigger chat_conversations_api_eventos
  after update of status on chat_conversations
  for each row execute function api_eventos_conversacion();
