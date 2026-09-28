-- El catálogo guardaba UN precio por inmueble, y lo sacaba cogiendo el importe
-- mayor de la ficha. En una ficha que anuncia venta Y arriendo, el mayor es el
-- de venta: 30 de los 469 inmuebles de Certain guardaban el precio de venta en
-- el sitio del canon. Consecuencia real, y silenciosa: quien busca arriendo con
-- 3 millones de presupuesto nunca ve esos 30, porque el filtro compara su
-- presupuesto contra 800.000.000. Y si alguno se colaba, el agente cantaba
-- ochocientos millones de canon.
--
-- La ficha sí trae los importes etiquetados ("Arriendo: $ X", "Venta: $ Y",
-- "Administración: $ Z"), así que se guardan por separado y cada búsqueda usa
-- el que le toca.
alter table public.client_properties
  add column if not exists precio_arriendo  bigint,
  add column if not exists precio_venta     bigint,
  add column if not exists administracion   bigint;

comment on column public.client_properties.precio_arriendo is
  'Canon mensual, leído de la etiqueta "Arriendo" de la ficha. Null si no se arrienda.';
comment on column public.client_properties.precio_venta is
  'Precio de venta, leído de la etiqueta "Venta". Null si no se vende.';
comment on column public.client_properties.administracion is
  'Administración publicada. Orientativa: el agente debe decir que la confirma un asesor.';

-- Para que el filtro por presupuesto no recorra la tabla entera.
create index if not exists client_properties_arriendo_idx
  on public.client_properties (user_id, precio_arriendo) where precio_arriendo is not null;
create index if not exists client_properties_venta_idx
  on public.client_properties (user_id, precio_venta) where precio_venta is not null;

-- Cuándo empezó la pasada que está en curso.
--
-- El sincronizador solo insertaba y actualizaba: NUNCA borraba. Un inmueble que
-- el cliente quitaba de su web se quedaba en el catálogo para siempre, y los
-- que se quitan son justo los que ya se arrendaron. Certain tenía 469 guardados
-- contra 444 publicados: 25 fantasmas que el agente podía ofrecer.
--
-- Con esto, al terminar una pasada completa se borra lo que no se vio en ella.
-- La marca (visto_en) ya se escribía; lo que faltaba era el corte.
alter table public.client_knowledge_sources
  add column if not exists pase_desde timestamptz;

comment on column public.client_knowledge_sources.pase_desde is
  'Inicio de la pasada en curso. Al completarla se borra lo que tenga visto_en anterior: es lo que el sitio ya no publica.';

-- Comprobación: deben salir 4.
select count(*) as columnas from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'client_properties'
         and column_name in ('precio_arriendo','precio_venta','administracion'))
     or (table_name = 'client_knowledge_sources' and column_name = 'pase_desde'));
