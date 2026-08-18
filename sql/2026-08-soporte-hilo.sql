-- ════════════════════════════════════════════════════════════════════════════
-- El soporte continúa en el mismo chat
-- Correr en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- Quién abrió el ticket. Hasta ahora solo se guardaba la cuenta (el dueño), así
-- que en un equipo todos veían los casos de todos en "Mis casos".
alter table support_tickets add column if not exists author_user_id text;

-- Los tickets que ya existen: su autor está dentro del contexto que guardó el
-- asistente. Sin esto desaparecerían de "Mis casos" al filtrar por autor.
update support_tickets
set author_user_id = coalesce(author_user_id, contexto->>'escribe', user_id)
where author_user_id is null;

create index if not exists sop_ticket_autor_idx on support_tickets(author_user_id, created_at desc);

-- Comprobación: 'sin_autor' debe salir 0.
select
  (select count(*) from support_tickets where author_user_id is null) as sin_autor,
  (select count(*) from support_tickets) as total;
