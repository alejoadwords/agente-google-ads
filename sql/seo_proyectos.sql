-- Proyecto SEO completo (17-10-2026). Reemplaza el blob user_profiles
-- 'seo-project' (uno por persona, que además separaba a cada miembro del
-- equipo). Todo cuelga del DUEÑO de la cuenta (user_id) y del cliente de
-- agencia (client_id, '' si no hay), como social_parrillas.
-- RLS activo y sin políticas: solo el servidor (service key) entra.

create table if not exists seo_proyectos (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  client_id text not null default '',
  nombre text not null,
  dominio text not null,
  marca text,
  pais text not null default 'co',
  idioma text not null default 'es',
  competidores jsonb not null default '[]',
  inicio date not null default current_date,      -- desde cuándo se trabaja (arranca el cronograma)
  creado_por text,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  archivado_at timestamptz,
  legado text                                      -- agent_key del blob del que se migró
);
create index if not exists seo_proyectos_cuenta on seo_proyectos (user_id, client_id) where archivado_at is null;

-- Clústeres temáticos: definen las keywords principales que se siguen.
create table if not exists seo_clusters (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  nombre text not null,
  pagina_pilar text,
  descripcion text,
  orden int not null default 0,
  creado_at timestamptz not null default now(),
  borrado_at timestamptz
);
create index if not exists seo_clusters_proyecto on seo_clusters (proyecto_id) where borrado_at is null;

create table if not exists seo_keywords (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  cluster_id uuid references seo_clusters(id) on delete set null,
  kw text not null,
  creado_at timestamptz not null default now(),
  borrado_at timestamptz
);
create unique index if not exists seo_keywords_unica on seo_keywords (proyecto_id, lower(kw)) where borrado_at is null;

-- Una medición por keyword y día (el cron mide cada semana; una medición a
-- mano el mismo día pisa la anterior).
create table if not exists seo_posiciones (
  id bigserial primary key,
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  keyword_id uuid not null references seo_keywords(id) on delete cascade,
  fecha date not null,
  pos int,                       -- null = fuera del top 100
  url text,
  top jsonb,                     -- los 5 primeros (competencia)
  creado_at timestamptz not null default now(),
  unique (keyword_id, fecha)
);
create index if not exists seo_posiciones_proyecto on seo_posiciones (proyecto_id, fecha desc);

create table if not exists seo_geo_preguntas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  cluster_id uuid references seo_clusters(id) on delete set null,
  pregunta text not null,
  intencion text,                -- informativa | comparativa | compra | local…
  creado_at timestamptz not null default now(),
  borrado_at timestamptz
);

-- Cada pregunta se hace 3 veces por IA y por mes: las IAs no responden igual
-- dos veces, y con una sola corrida el dato es casi ruido.
create table if not exists seo_geo_resultados (
  id bigserial primary key,
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  pregunta_id uuid not null references seo_geo_preguntas(id) on delete cascade,
  periodo text not null,         -- 'YYYY-MM'
  motor text not null,           -- claude | gemini | chatgpt | perplexity
  corrida int not null,
  mencionada boolean,
  citada boolean,                -- alguna URL citada es del dominio (solo motores que citan)
  posicion int,                  -- orden entre la marca y los competidores declarados
  competidores jsonb,
  citas jsonb,                   -- URLs que citó la IA
  fragmento text,
  error text,
  creado_at timestamptz not null default now(),
  unique (pregunta_id, periodo, motor, corrida)
);
create index if not exists seo_geo_resultados_proyecto on seo_geo_resultados (proyecto_id, periodo);

-- Cronograma: lo que se hizo y se hará, mes a mes, a la vista del cliente.
create table if not exists seo_acciones (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  mes text not null,             -- 'YYYY-MM'
  categoria text not null default 'otro',   -- onpage | tecnico | contenido | enlaces | local | geo | analitica | otro
  titulo text not null,
  detalle text,
  estado text not null default 'pendiente', -- pendiente | en_curso | hecha
  hecha_at timestamptz,
  visible_cliente boolean not null default true,
  orden int not null default 0,
  plantilla text,                -- clave de la plantilla de on-page inicial, si viene de ahí
  creado_por text,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  borrado_at timestamptz
);
create index if not exists seo_acciones_proyecto on seo_acciones (proyecto_id, mes) where borrado_at is null;

-- El enlace público del dashboard: /seo/<token>.
create table if not exists seo_enlaces (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  user_id text not null,
  creado_por text,
  creado_por_nombre text,
  vistas int not null default 0,
  ultima_vista timestamptz,
  revocado_at timestamptz,
  creado_at timestamptz not null default now()
);

alter table seo_proyectos enable row level security;
alter table seo_clusters enable row level security;
alter table seo_keywords enable row level security;
alter table seo_posiciones enable row level security;
alter table seo_geo_preguntas enable row level security;
alter table seo_geo_resultados enable row level security;
alter table seo_acciones enable row level security;
alter table seo_enlaces enable row level security;

-- ── Fase 2 (17-10-2026): calendario de contenido con revisión del cliente ──
-- La agencia sube la pieza y la manda a revisión; el cliente, desde su enlace
-- /seo/<código>, la aprueba o pide cambios con una nota. Cada envío a revisión
-- guarda una versión: queda constancia de QUÉ se aprobó.
alter table seo_proyectos add column if not exists correo_cliente text;   -- a quién avisar cuando hay algo para revisar
alter table seo_proyectos add column if not exists nombre_cliente text;

create table if not exists seo_contenidos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  cluster_id uuid references seo_clusters(id) on delete set null,
  titulo text not null,
  tipo text not null default 'articulo',       -- articulo | pagina | landing | post | video | otro
  keyword text,
  fecha date,                                   -- publicación prevista
  estado text not null default 'borrador',      -- borrador | en_revision | cambios | aprobado | publicado
  cuerpo text,                                  -- el contenido o el brief
  enlace_doc text,                              -- Google Doc u otro enlace
  url_publicada text,
  version int not null default 0,               -- versiones enviadas a revisión
  enviado_at timestamptz,
  aprobado_at timestamptz,
  aprobado_por text,                            -- nombre que escribió el cliente
  publicado_at timestamptz,
  creado_por text,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  borrado_at timestamptz
);
create index if not exists seo_contenidos_proyecto on seo_contenidos (proyecto_id, fecha) where borrado_at is null;

create table if not exists seo_contenido_versiones (
  id bigserial primary key,
  contenido_id uuid not null references seo_contenidos(id) on delete cascade,
  version int not null,
  titulo text, cuerpo text, enlace_doc text,
  creado_por text,
  creado_at timestamptz not null default now(),
  unique (contenido_id, version)
);

create table if not exists seo_contenido_comentarios (
  id bigserial primary key,
  contenido_id uuid not null references seo_contenidos(id) on delete cascade,
  version int,
  autor_tipo text not null,                     -- cliente | agencia
  autor_nombre text,
  autor_id text,                                -- usuario de Acuarius (agencia)
  enlace_id uuid,                               -- desde qué enlace escribió el cliente
  accion text not null default 'comentario',    -- comentario | cambios | aprobado
  texto text,
  creado_at timestamptz not null default now()
);
create index if not exists seo_contenido_comentarios_c on seo_contenido_comentarios (contenido_id, creado_at);

alter table seo_contenidos enable row level security;
alter table seo_contenido_versiones enable row level security;
alter table seo_contenido_comentarios enable row level security;

-- ── Fase 3 (17-10-2026): tráfico de Search Console y GA4 ───────────────────
-- Se guarda en nuestra base (Google da 16 meses de Search Console; aquí el
-- histórico no caduca). Conexión por cuenta de servicio: el cliente agrega el
-- correo de Acuarius como lector de su Search Console y de su GA4.
alter table seo_proyectos add column if not exists gsc_propiedad text;      -- 'sc-domain:x.com' o 'https://x.com/'
alter table seo_proyectos add column if not exists ga4_propiedad text;      -- solo números
alter table seo_proyectos add column if not exists gsc_estado text;         -- ok | sin_acceso | error
alter table seo_proyectos add column if not exists ga4_estado text;
alter table seo_proyectos add column if not exists gsc_error text;
alter table seo_proyectos add column if not exists ga4_error text;
alter table seo_proyectos add column if not exists gsc_sincronizado_at timestamptz;
alter table seo_proyectos add column if not exists ga4_sincronizado_at timestamptz;
alter table seo_proyectos add column if not exists gsc_meses_atras int not null default 0;  -- historial ya traído
alter table seo_proyectos add column if not exists ga4_meses_atras int not null default 0;

create table if not exists seo_gsc_dias (
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  fecha date not null,
  clics int not null default 0, impresiones int not null default 0, ctr real, posicion real,
  primary key (proyecto_id, fecha)
);
-- Todas las búsquedas que dieron impresiones en el mes, aunque no estén en
-- seguimiento: así se ve cómo crece cada clúster más allá de las keywords elegidas.
create table if not exists seo_gsc_consultas (
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  mes text not null, consulta text not null,
  clics int not null default 0, impresiones int not null default 0, ctr real, posicion real,
  primary key (proyecto_id, mes, consulta)
);
create table if not exists seo_gsc_paginas (
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  mes text not null, pagina text not null,
  clics int not null default 0, impresiones int not null default 0, ctr real, posicion real,
  primary key (proyecto_id, mes, pagina)
);
create table if not exists seo_ga4_dias (
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  fecha date not null,
  sesiones int not null default 0, usuarios int not null default 0, conversiones real not null default 0,
  sesiones_organicas int not null default 0, conversiones_organicas real not null default 0,
  sesiones_ia int not null default 0, conversiones_ia real not null default 0,
  primary key (proyecto_id, fecha)
);
-- De qué IA llegó cada visita (ChatGPT, Perplexity, Gemini…), por mes.
create table if not exists seo_ga4_ia (
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  mes text not null, fuente text not null,
  sesiones int not null default 0, conversiones real not null default 0,
  primary key (proyecto_id, mes, fuente)
);
alter table seo_gsc_dias enable row level security;
alter table seo_gsc_consultas enable row level security;
alter table seo_gsc_paginas enable row level security;
alter table seo_ga4_dias enable row level security;
alter table seo_ga4_ia enable row level security;

-- Detalle de GA4 por mes (17-10-2026): de dónde llega cada visita. Una tabla
-- para varios cortes, según `tipo`:
--   fuente      valor = canal, valor2 = fuente / medio        (todo el sitio)
--   entrada_org valor = página de entrada, fuente = buscador  (orgánico)
--   entrada_ia  valor = página de entrada, fuente = la IA
--   referente_ia valor = dirección exacta de origen (Perplexity suele traer la pregunta)
--   pais_ia     valor = país, valor2 = dispositivo
create table if not exists seo_ga4_detalle (
  proyecto_id uuid not null references seo_proyectos(id) on delete cascade,
  mes text not null, tipo text not null, fuente text not null default '', valor text not null default '', valor2 text not null default '',
  sesiones int not null default 0, comprometidas int not null default 0, duracion real, conversiones real not null default 0,
  primary key (proyecto_id, mes, tipo, fuente, valor, valor2)
);
alter table seo_ga4_detalle enable row level security;

-- Calidad del tráfico (17-10-2026), tipo 'calidad' en seo_ga4_detalle:
-- valor = canal ('__total' = todo el sitio, sin sumar usuarios entre canales).
alter table seo_ga4_detalle add column if not exists usuarios int not null default 0;
alter table seo_ga4_detalle add column if not exists nuevos int not null default 0;
alter table seo_ga4_detalle add column if not exists vistas int not null default 0;
alter table seo_ga4_detalle add column if not exists interaccion_seg real not null default 0;
