-- Atribución de clic-a-WhatsApp.
--
-- Cuando alguien escribe tras pulsar un anuncio de Meta, el webhook trae un
-- bloque `referral` con el anuncio de origen, su titular y el identificador del
-- clic. Ese bloque viaja SOLO pegado al primer mensaje: si no se guarda en ese
-- momento, no se reconstruye después de ninguna forma.
--
-- Va en la conversación y no en el lead porque el lead todavía no existe: nace
-- más tarde, cuando el agente consigue el contacto. La conversación es lo único
-- que hay cuando el dato llega.
alter table public.chat_conversations
  add column if not exists referral jsonb;

comment on column public.chat_conversations.referral is
  'Bloque referral del webhook de WhatsApp: anuncio de origen del clic-a-WhatsApp. Se escribe una sola vez, con el primer mensaje.';

-- Para poder contar cuántas conversaciones llegaron de pauta sin recorrer la
-- tabla entera. Parcial: la enorme mayoría son orgánicas y no ocupan índice.
create index if not exists chat_conversations_referral_idx
  on public.chat_conversations (user_id)
  where referral is not null;

-- Comprobación: debe salir 1.
select count(*) as columna from information_schema.columns
  where table_schema = 'public' and table_name = 'chat_conversations' and column_name = 'referral';
