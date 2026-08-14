-- ════════════════════════════════════════════════════════════════════════════
-- Adjuntar imágenes y archivos en las conversaciones
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Dónde viven los archivos ─────────────────────────────────────────────
-- El bucket es PÚBLICO por obligación, no por comodidad: WhatsApp y Messenger
-- no reciben el archivo, reciben una URL y van ellos a descargarla. Si el
-- bucket fuera privado, Meta se encontraría un 403 y el cliente no vería nada.
-- Por eso la ruta lleva un tramo aleatorio: sin la URL exacta no hay forma de
-- llegar al archivo, ni de listar lo que hay dentro.
insert into storage.buckets (id, name, public)
values ('inbox-adjuntos', 'inbox-adjuntos', true)
on conflict (id) do nothing;

-- ── 2. El adjunto en el mensaje ─────────────────────────────────────────────
alter table chat_messages add column if not exists adjunto_url    text;
alter table chat_messages add column if not exists adjunto_tipo   text;  -- image | document | video | audio
alter table chat_messages add column if not exists adjunto_nombre text;
alter table chat_messages add column if not exists adjunto_mime   text;

-- ── 3. Comprobación ─────────────────────────────────────────────────────────
-- 'bucket' debe salir 1 y 'columnas' debe salir 4.
select
  (select count(*) from storage.buckets where id = 'inbox-adjuntos') as bucket,
  (select count(*) from information_schema.columns
     where table_name = 'chat_messages'
       and column_name in ('adjunto_url','adjunto_tipo','adjunto_nombre','adjunto_mime')) as columnas;
