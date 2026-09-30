-- Marca del último mensaje de seguimiento enviado en una conversación.
--
-- La usa api/cron-seguimiento.js para no retomar dos veces seguidas: se manda
-- como mucho un seguimiento por cada mensaje de la persona, comparando esta
-- marca contra last_inbound_at. Insistir dos veces es acoso, no seguimiento.
alter table public.chat_conversations
  add column if not exists seguimiento_at timestamptz;

-- Para que el cron no barra la tabla entera cada diez minutos.
create index if not exists idx_chat_conv_seguimiento
  on public.chat_conversations (status, last_message_at)
  where status = 'bot';
