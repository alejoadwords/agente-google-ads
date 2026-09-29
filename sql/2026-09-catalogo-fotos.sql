-- Las fotos de cada inmueble.
--
-- El agente podía describir un apartamento y no enseñarlo: ante «¿me mandas
-- fotos?» tenía que pasar la conversación a un asesor para algo que ya está
-- publicado en la web del cliente. En una inmobiliaria, la foto es medio
-- proceso de venta.
--
-- Las fotos salen de la misma ficha de la que ya se lee el precio, así que no
-- cuesta ni una petición más. Se reconocen porque el nombre del archivo lleva
-- el código del inmueble —«121514301_1_1776116684_1.jpg»—, que es una señal
-- determinista: nunca se colará la foto de otro inmueble. En la muestra que
-- medí salen 5,5 por inmueble.
alter table public.client_properties
  add column if not exists fotos text[];

comment on column public.client_properties.fotos is
  'URLs de las fotos publicadas del inmueble, sacadas de su ficha. Vacío = no se encontró ninguna con su código en el nombre.';

-- Comprobación: debe salir 1.
select count(*) as columna from information_schema.columns
 where table_schema = 'public' and table_name = 'client_properties' and column_name = 'fotos';
