-- Archivar conversaciones del inbox (05-10-2026).
-- Columna aparte y no un estado: status decide quién contesta (bot/human) y
-- archivar no debe cambiarlo. Un mensaje nuevo del cliente la desarchiva.
alter table public.chat_conversations add column if not exists archivada_at timestamptz;
create index if not exists chat_conversations_user_archivada_idx
  on public.chat_conversations (user_id, last_message_at desc) where archivada_at is null;
notify pgrst, 'reload schema';
