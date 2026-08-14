-- ════════════════════════════════════════════════════════════════════════════
-- Conectores de formularios que ya existen en la web del cliente
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- El script de conexión necesita un token, y el token vive en lead_forms. Hasta
-- ahora eso obligaba a crear un formulario que nadie iba a usar solo para poder
-- copiar el script. Con esta columna la misma tabla guarda las dos cosas y cada
-- una se muestra donde corresponde.
alter table lead_forms add column if not exists tipo text not null default 'formulario';

-- De qué web viene, para poder distinguir varios conectores de un vistazo.
alter table lead_forms add column if not exists origen_url text;

-- Lo que ya existía es formulario: la columna nace con ese valor por defecto,
-- pero se deja explícito por si alguna fila vieja quedó con null.
update lead_forms set tipo = 'formulario' where tipo is null;

-- Comprobación: 'columnas' debe dar 2.
select
  (select count(*) from information_schema.columns
     where table_name = 'lead_forms' and column_name in ('tipo','origen_url')) as columnas,
  (select count(*) from lead_forms where tipo = 'conector') as conectores;
