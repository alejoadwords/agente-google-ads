-- 2026-08-27 · Plantillas de correo reutilizables.
--
-- Hasta ahora el contenido de una campaña se escribía en el propio asistente y
-- moría con ella: no había forma de reutilizar un correo ni de que el equipo
-- partiera de algo aprobado. Esta tabla lo saca de la campaña y lo hace una cosa
-- con vida propia, igual que los procesos de venta o los motivos de cierre.
--
-- 'diseno' guarda el proyecto del constructor (GrapesJS) para poder VOLVER a
-- editarlo; 'html' guarda el resultado ya montado, que es lo que se envía. Hay
-- que guardar los dos: del HTML final no se puede reconstruir el diseño, y del
-- diseño no se puede enviar nada sin volver a exportarlo.

create table if not exists email_templates (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,                  -- la cuenta (el dueño), no quien la escribió
  client_id     text,                           -- null = plantilla general de la cuenta
  nombre        text not null,
  categoria     text,
  asunto        text,
  descripcion   text,
  -- 'simple' = el editor de siempre (texto + imagen + botón)
  -- 'html'   = construida con el constructor visual
  formato       text not null default 'simple',
  diseno        jsonb,                          -- proyecto del constructor, para reeditar
  html          text,                           -- resultado montado, para enviar
  -- Datos del editor simple, para poder seguir editándola sin constructor.
  contenido     jsonb,
  creado_por    text,                           -- quién la creó (miembro o dueño)
  creado_por_nombre text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz                     -- borrado suave: una campaña vieja puede apuntarla
);

-- El listado siempre filtra por cuenta y por cliente, y esconde las borradas.
create index if not exists email_templates_cuenta_idx
  on email_templates (user_id, client_id, deleted_at);

-- Para el buscador del listado.
create index if not exists email_templates_nombre_idx
  on email_templates (user_id, nombre);

-- Qué plantilla usó cada campaña. Es informativo: si luego se edita la
-- plantilla, la campaña ya enviada NO cambia, porque su contenido se copió al
-- crearla. Sin esta columna no habría forma de saber de dónde salió un correo.
alter table campaigns add column if not exists template_id uuid;
