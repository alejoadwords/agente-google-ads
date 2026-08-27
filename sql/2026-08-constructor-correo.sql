-- 2026-08-27 · El constructor visual necesita guardar el correo montado.
--
-- Una campaña hecha con el constructor no se puede reconstruir desde 'body':
-- ese campo es texto plano. Aquí va el HTML ya montado, con los estilos metidos
-- en cada etiqueta, que es lo que se envía tal cual.
--
-- Se copia de la plantilla al crear la campaña, no se enlaza: editar la
-- plantilla después no puede cambiar un correo ya revisado o enviado.
alter table campaigns add column if not exists html text;
