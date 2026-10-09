-- API pública: más freno (09-10-2026)
--
-- · Límite de CAMBIOS por llave, aparte del de llamadas: un agente que se
--   equivoca o al que engañan escribe a la velocidad de una máquina; leer
--   mucho no hace daño, cambiar mucho sí.
-- · Tope por CUENTA, sumando todas sus llaves: con 20 llaves una sola cuenta
--   podía hacer 2.400 llamadas por minuto, y el techo del proyecto es la
--   entrada/salida de la base ([[project_supabase_compute]]).

alter table api_llaves add column if not exists limite_escrituras_minuto integer not null default 30;

create table if not exists api_uso_cuenta (
  user_id text not null,
  ventana text not null,
  n       integer not null default 0,
  primary key (user_id, ventana)
);
alter table api_uso_cuenta enable row level security;

-- Cuenta en una sola ida a la base: llamadas de la llave (minuto y día),
-- llamadas de la cuenta (minuto) y, si es un cambio, cambios de la llave
-- (minuto). Atómico por fila: dos peticiones a la vez no leen el mismo número.
create or replace function api_contar_v2(p_llave uuid, p_cuenta text, p_minuto text, p_dia text, p_escritura boolean)
returns table (minuto integer, dia integer, cuenta_minuto integer, escrituras_minuto integer)
language plpgsql security definer set search_path = public as $$
begin
  insert into api_uso (llave_id, ventana, n) values (p_llave, p_minuto, 1)
    on conflict (llave_id, ventana) do update set n = api_uso.n + 1
    returning api_uso.n into minuto;
  insert into api_uso (llave_id, ventana, n) values (p_llave, p_dia, 1)
    on conflict (llave_id, ventana) do update set n = api_uso.n + 1
    returning api_uso.n into dia;
  insert into api_uso_cuenta (user_id, ventana, n) values (p_cuenta, p_minuto, 1)
    on conflict (user_id, ventana) do update set n = api_uso_cuenta.n + 1
    returning api_uso_cuenta.n into cuenta_minuto;
  if p_escritura then
    insert into api_uso (llave_id, ventana, n) values (p_llave, 'w' || substr(p_minuto, 2), 1)
      on conflict (llave_id, ventana) do update set n = api_uso.n + 1
      returning api_uso.n into escrituras_minuto;
  else
    escrituras_minuto := 0;
  end if;
  update api_llaves set ultimo_uso_at = now()
   where id = p_llave and (ultimo_uso_at is null or ultimo_uso_at < now() - interval '1 minute');
  return next;
end;
$$;
revoke all on function api_contar_v2(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function api_contar_v2(uuid, text, text, text, boolean) to service_role;
