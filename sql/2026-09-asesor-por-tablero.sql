-- En qué procesos de venta trabaja cada persona del equipo.
--
-- El enrutado del agente ya mandaba cada lead a su tablero —arriendo a
-- Arriendo, venta a Venta, captación a Captación— pero con `asignar_a` vacío:
-- el lead caía en el tablero correcto y sin dueño. Y un lead sin dueño es un
-- lead que nadie llama.
--
-- La salida fácil era elegir un asesor por ruta. No sirve: en Certain el
-- tablero de Arriendo lo llevan TRES personas (164, 89 y 89 leads), y un
-- asignar_a fijo le habría dado los arriendos nuevos a una sola. Con la lista
-- de tableros por persona, el reparto por turnos que ya existe puede rotar
-- entre quienes de verdad atienden ese tablero.
--
-- text[] y no jsonb para que se parezca a leads.tags, que es la otra lista de
-- esta base.
alter table public.team_members
  add column if not exists pipeline_ids text[];

comment on column public.team_members.pipeline_ids is
  'Procesos de venta que atiende esta persona. Vacío = todos, que es como se comportaba antes de existir esta columna.';

-- Para encontrar a los de un tablero sin recorrer la tabla entera.
create index if not exists team_members_pipelines_idx
  on public.team_members using gin (pipeline_ids);

-- Comprobación: debe salir 1.
select count(*) as columna from information_schema.columns
 where table_schema = 'public' and table_name = 'team_members' and column_name = 'pipeline_ids';
