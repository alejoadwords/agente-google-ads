-- ════════════════════════════════════════════════════════════════════════════
-- Un canal de chat pertenece a un cliente y entra a un pipeline
-- Correr en Supabase → SQL Editor. Idempotente.
--
-- Hasta ahora el cliente de un lead del inbox salía del AGENTE que atendía el
-- canal. Un canal atendido a mano no tiene agente, así que sus leads nacían sin
-- cliente y, con los pipelines por cliente, no aparecían en el tablero de nadie.
--
-- Y los leads del inbox nunca han llevado pipeline_id: aunque tuvieran cliente,
-- el tablero —que filtra por pipeline— no los pintaba en ninguna columna.
-- ════════════════════════════════════════════════════════════════════════════

-- client_id es TEXTO, como en el resto del proyecto: los ids de cliente son
-- 'pro_main' o 'ac_1754...', no uuid. (Ese error ya se cometió con pipelines.)
alter table channel_connections add column if not exists client_id text;

-- Pipeline al que entran por defecto las oportunidades de este canal. Nulo =
-- el principal del cliente. Es un valor por defecto, no una cárcel: al mandar
-- una conversación al CRM a mano se puede elegir otro.
alter table channel_connections add column if not exists pipeline_id uuid;

create index if not exists channel_connections_client_idx on channel_connections(client_id);

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Las dos deben salir 1.
select
  (select count(*) from information_schema.columns
     where table_name = 'channel_connections' and column_name = 'client_id') as col_client_id,
  (select count(*) from information_schema.columns
     where table_name = 'channel_connections' and column_name = 'pipeline_id') as col_pipeline_id;
