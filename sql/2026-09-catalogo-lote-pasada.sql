-- Con qué tamaño de lote empezó la pasada en curso.
--
-- La pasada recorre la web por páginas de N, y guarda por dónde va. Si N cambia
-- a mitad —un despliegue que sube el lote de 30 a 40— la página 5 deja de
-- apuntar a los mismos inmuebles: con 30 iba del 121 al 150 y con 40 va del 161
-- al 200. Los de en medio no se visitan en toda la pasada.
--
-- Eso antes solo significaba un precio viejo. Con la barrida significa BORRAR
-- inmuebles que siguen publicados: medido en Certain, la pasada dejó 82 sin ver
-- y 39 de ellos estaban perfectamente vivos. El freno del tercio no lo habría
-- parado, porque 82 de 485 es un 17%.
--
-- Guardando el lote con el que empezó la pasada, un cambio de tamaño la reinicia
-- desde la página 1 en vez de corromperla.
alter table public.client_knowledge_sources
  add column if not exists pase_lote int;

comment on column public.client_knowledge_sources.pase_lote is
  'Tamaño de página con el que empezó la pasada en curso. Si cambia, la pasada se reinicia: la paginación ya no apunta a lo mismo.';

-- Comprobación: debe salir 1.
select count(*) as columna from information_schema.columns
 where table_schema = 'public' and table_name = 'client_knowledge_sources' and column_name = 'pase_lote';
