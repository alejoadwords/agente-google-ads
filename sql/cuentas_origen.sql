-- De dónde llegó cada cuenta nueva de Acuarius (17-10-2026). La landing y la
-- app guardan la primera visita en la cookie acu_origen (public/origen.js);
-- al registrarse, /api/origen-cuenta la clasifica (api/_origen.js) y la deja
-- aquí. Una por cuenta; solo cuentas recién creadas (no se etiqueta una cuenta
-- vieja con la visita de hoy). RLS activo y sin políticas.
create table if not exists cuentas_origen (
  user_id text primary key,
  canal text not null,
  origen text,
  pagina text,
  referente text,
  sitio text,
  params jsonb,
  visita_at timestamptz,          -- cuándo fue la primera visita
  creado_at timestamptz not null default now()
);
alter table cuentas_origen enable row level security;
