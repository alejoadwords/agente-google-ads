-- ════════════════════════════════════════════════════════════════════════════
-- Aviso antes de que se cierre la ventana de 24 h de WhatsApp
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- Marca de "ya se avisó de esta conversación". Sin ella, cada pasada del cron
-- crearía otra tarea de lo mismo, una por hora hasta que caduque.
alter table chat_conversations add column if not exists aviso_ventana_at timestamptz;

-- El cron busca por estas tres columnas a la vez.
create index if not exists conv_ventana_idx
  on chat_conversations(last_inbound_at)
  where aviso_ventana_at is null and channel = 'whatsapp';

-- Comprobación: debe salir 1.
select count(*) as columna_aviso
from information_schema.columns
where table_name = 'chat_conversations' and column_name = 'aviso_ventana_at';
