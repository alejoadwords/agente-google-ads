# Mapa de la API

Generado el 2026-09-01 desde el código con `node tools/mapa-modulos.mjs`. No se
edita a mano: se vuelve a generar.

**113 endpoints** y **15 módulos compartidos**.

Dos reglas del despliegue que explican fallos raros:

- Un módulo `api/_*.js` **solo puede importarse desde funciones edge**. Desde
  una función Node revienta el build o el arranque.
- El catch-all de `vercel.json` devuelve **200 con el shell de la app** para
  cualquier ruta que no empiece por `/api`. Comprobar por contenido, nunca por
  código de estado.

## Endpoints

| Fichero | Entorno | Qué hace | Tablas que toca |
|---|---|---|---|
| `api/academia-admin.js` | edge | CRUD de videos de Academia — tabla academia_videos en Supabase | academia_videos |
| `api/admin.js` | node | Consolida: admin-metrics.js + admin-users.js + admin-sync.js | ai_usage, platform_connections, support_tickets, users |
| `api/agenda.js` | edge | Agenda del CRM: tareas y reuniones vinculadas a leads. | activities, leads, platform_connections, team_members |
| `api/assign-rules.js` | edge | — reglas de reparto de leads entre comerciales | team_members |
| `api/automations.js` | edge | CRUD de automatizaciones del CRM: flujos con trigger + pasos que el motor | automation_logs, automations |
| `api/callback.js` | node | api/oauth/callback.js | — |
| `api/campaigns.js` | edge | Campañas masivas de email y WhatsApp segmentadas por etiquetas/etapa/fuente. | campaign_recipients, campaigns, email_events, lead_lists, leads |
| `api/channel-connections.js` | edge | — | channel_connections, chat_agents, chat_conversations, chat_messages, platform_connections |
| `api/channel-policy.js` | edge | — regla de entrada al pipeline por canal | team_members |
| `api/chat-agents.js` | edge | — | chat_agents, team_members |
| `api/chat-conversations.js` | edge | — | channel_connections, chat_agents, chat_conversations, chat_messages, conversation_notes |
| `api/chat.js` | edge | ── Cupo mensual de mensajes ───────────────────────────────────────────────── | — |
| `api/close-reasons.js` | edge | Catálogo de motivos de cierre (ganada / perdida), editable por cada usuario. | close_reasons, team_members |
| `api/conversations.js` | node | Historial de conversaciones por agente | — |
| `api/create-sheet.js` | edge | Firma JWT para Google OAuth2 (service account) | — |
| `api/cron-alerts.js` | node | Ejecuta a las 9am, 2pm y 6pm UTC (lunes a viernes) — ver vercel.json | — |
| `api/cron-automations.js` | node | Motor de automatizaciones del CRM. Corre cada 10 min (vercel.json): | — |
| `api/cron-campaigns.js` | node | Motor de envío de campañas masivas (email + WhatsApp) por lotes. | — |
| `api/cron-conectores.js` | edge | Avisa cuando un conector deja de recoger leads. | lead_forms |
| `api/cron-errores.js` | edge | Avisa de los errores NUEVOS. Cada hora. | error_log |
| `api/cron-integridad.js` | edge | Vigilante diario de coherencia de datos. | — |
| `api/cron-knowledge.js` | node | Auto-actualización mensual de los knowledge packs de los agentes. | ai_usage |
| `api/cron-monthly-reports.js` | node | Genera y envía reportes mensuales el día 1 de cada mes a las 8am UTC | ai_usage |
| `api/cron-programados.js` | edge | Manda los mensajes que alguien dejó programados. Corre cada 5 minutos | channel_connections, chat_conversations, chat_messages, scheduled_messages |
| `api/cron-reports.js` | node | Genera y envía reportes semanales automáticos todos los lunes a las 8am UTC | ai_usage |
| `api/cron-retention.js` | node | — mantenimiento diario de la base de contactos. | leads, user_profiles |
| `api/cron-tasks.js` | node | — resumen diario de tareas. | activities, leads, team_members |
| `api/cron-trials.js` | node | Ciclo de vida de la prueba Pro de 14 días (corre 1 vez al día, vercel.json): | — |
| `api/cron-ventana.js` | edge | Avisa antes de que se cierre la ventana de 24 horas de WhatsApp. | chat_conversations, leads |
| `api/dashboard.js` | edge | — Live client dashboard backend | client_dashboards, platform_connections |
| `api/design-brief.js` | edge | Extrae un design brief estructurado de un prompt libre usando Claude | — |
| `api/diagnostico.js` | edge | — radiografía de solo lectura de la cuenta de un cliente. | leads, support_tickets |
| `api/email-templates.js` | edge | Plantillas de correo reutilizables. Viven fuera de la campaña a propósito: el | email_templates, team_members |
| `api/errores.js` | edge | Recibe los errores que ocurren en el NAVEGADOR del usuario. | — |
| `api/extract-brand.js` | edge | Fetches a website URL and extracts brand/business info using Claude Haiku | — |
| `api/form-public.js` | edge | Cara pública de los formularios de captura: | lead_forms |
| `api/forms.js` | edge | CRUD de formularios de captura de leads. Cada formulario tiene un token | lead_forms, team_members |
| `api/gcal-auth.js` | node | Inicia el OAuth de Google Calendar (scope de eventos, separado del de Ads). | — |
| `api/generate-image.js` | node | Genera imágenes de anuncios usando fal.ai | ai_usage, team_members |
| `api/generate-report.js` | node | Recibe datos del reporte para registro. El PDF se genera en el cliente con jsPDF. | activity_logs |
| `api/geo-rank.js` | node | GEO (Generative Engine Optimization): consulta a las principales IAs con las | — |
| `api/get-plan.js` | node | — | — |
| `api/google-ads-auth.js` | node | Inicia el flujo OAuth 2.0 para conectar Google Ads | — |
| `api/google-ads.js` | node | Proxy para Google Ads API con soporte de action router y refresh de tokens | ai_usage, platform_connections |
| `api/hook/[token].js` | edge | Trigger por webhook externo: cada automatización con lanzador "webhook" | — |
| `api/hotmart-webhook.js` | node | Sin dependencias externas — usa fetch nativo igual que referral.js | — |
| `api/inbox-adjunto.js` | edge | Da permiso para subir un archivo del inbox y devuelve dónde dejarlo. | channel_connections, chat_conversations, team_members |
| `api/inbox-simular.js` | edge | Mete un mensaje entrante como si lo hubiera enviado un cliente por WhatsApp, | channel_connections, team_members |
| `api/knowledge-approve.js` | node | Aprueba o rechaza un borrador de knowledge pack desde los links firmados | — |
| `api/knowledge-packs.js` | edge | Devuelve el último knowledge pack publicado por agente. El frontend los | knowledge_packs |
| `api/knowledge-sync.js` | edge | Trae el inventario del cliente desde su WordPress y lo guarda, para que el | client_knowledge_sources, client_properties, team_members |
| `api/knowledge-upload.js` | edge | Carga el inventario desde una hoja de cálculo, para los clientes cuya web no | client_knowledge_sources, client_properties, team_members |
| `api/l.js` | edge | La página de aterrizaje pública: /l/<slug>. | landings |
| `api/landings.js` | edge | Páginas de aterrizaje. Módulo deliberadamente autocontenido: tabla propia, | landings, lead_forms |
| `api/lead-activities.js` | edge | — | activities, lead_activities, leads, team_members |
| `api/lead-copilot.js` | edge | — | lead_activities, leads, team_members |
| `api/lead-lists.js` | edge | Listas/segmentos de leads para campañas: dinámicas (guardan filtros de | lead_lists, team_members |
| `api/lead-sources.js` | edge | Fuentes de lead. Las seis de siempre viven en el código y no se pueden | team_members |
| `api/lead-tags.js` | edge | Catálogo de etiquetas del CRM: nombre normalizado, color de la paleta de | lead_tags, leads, team_members |
| `api/lead-webhook.js` | edge | Webhook de entrada genérico por usuario (independiente de automatizaciones): | platform_connections, team_members |
| `api/leads.js` | edge | El token de sesión de Clerk (v2) ya no trae public_metadata: si el plan no | activities, automation_jobs, automations, lead_tags, leads |
| `api/linkedin-ads.js` | node | Proxy para LinkedIn Campaign Manager API | — |
| `api/linkedin-auth.js` | node | Inicia el flujo OAuth 2.0 con LinkedIn | — |
| `api/linkedin-callback.js` | node | Recibe el código de LinkedIn, obtiene access token y lo guarda en Supabase | platform_connections |
| `api/list-accounts.js` | node | Lista todas las cuentas de Google Ads accesibles con el token del usuario | platform_connections |
| `api/meta-ads.js` | node | Proxy para Meta Marketing API con action router y token desde Supabase | ai_usage, platform_connections |
| `api/meta-auth.js` | node | Inicia el flujo OAuth 2.0 con Meta (Facebook) | — |
| `api/meta-callback.js` | node | Recibe el código de Meta, obtiene long-lived token y lo guarda en Supabase | platform_connections |
| `api/meta-list-accounts.js` | node | Lista las cuentas publicitarias accesibles con el token del usuario | — |
| `api/mp-auth.js` | node | Inicia el OAuth de MercadoPago: cada usuario conecta SU cuenta de MP y los | — |
| `api/mp-webhook.js` | node | Notificaciones de pago de MercadoPago (Checkout Pro de propuestas). | leads, platform_connections, proposals |
| `api/novedades.js` | edge | — qué novedades ha visto ya cada usuario. | user_profiles |
| `api/nps.js` | edge | Encuestas NPS — cara pública y stats: | leads, nps_responses, team_members |
| `api/oauth/callback.js` | node | Recibe el código de Google, obtiene tokens y los guarda en Supabase | platform_connections |
| `api/oauth/gcal-callback.js` | node | Recibe el código de Google Calendar, guarda tokens en platform_connections | platform_connections |
| `api/oauth/mp-callback.js` | node | Recibe el código de MercadoPago, canjea los tokens y guarda la conexión en | platform_connections |
| `api/oauth/tiktok-callback.js` | node | Canjea el código de TikTok por un token y deja la cuenta conectada como canal | channel_connections |
| `api/pipeline-stages.js` | edge | — | leads, pipeline_stages, team_members |
| `api/pipelines.js` | edge | Varios pipelines por cuenta. Cada uno con sus propias etapas, incluidas las | team_members |
| `api/profile.js` | edge | agent_key reservado para guardar la cartera de clientes en user_profiles | conversations, team_members, user_profiles |
| `api/proposals.js` | edge | Propuestas comerciales del CRM: generación con IA (Sonnet 5 usando el lead + | knowledge_packs, leads, platform_connections, proposals, team_members |
| `api/push.js` | edge | Suscripciones de avisos push del navegador. | push_subs |
| `api/qualify-rules.js` | edge | — criterios de calificación de un agente del inbox. | chat_agents, team_members |
| `api/quick-replies.js` | edge | Respuestas rápidas del inbox: lo que un comercial escribe cien veces al día. | quick_replies, team_members |
| `api/referral-admin.js` | node | Endpoints de administración del sistema de referidos | — |
| `api/referral.js` | node | Sistema de referidos Acuarius — usa fetch REST de Supabase (sin SDK) | — |
| `api/refresh-google-token.js` | node | Refresca el access_token de Google Ads usando el refresh_token almacenado en Supabase. | platform_connections |
| `api/refresh-meta-token.js` | node | Renueva el long-lived token de Meta ANTES de que expire (duran 60 días). | platform_connections |
| `api/report.js` | node | — Reporte de campañas: guardar y leer públicamente | — |
| `api/resenas.js` | edge | Pedir reseñas de Google a los clientes que ya compraron. | lead_activities, team_members, user_profiles |
| `api/resend-webhook.js` | node | Recibe eventos de Resend (email.opened, email.clicked, email.bounced...) | email_events |
| `api/scheduled-messages.js` | edge | Programar, listar y cancelar mensajes de una conversación. | chat_conversations, scheduled_messages, team_members |
| `api/seo-rank.js` | node | Consulta posiciones reales en Google via Serper.dev (SERP API). | — |
| `api/social-callback.js` | node | Callback OAuth para publicación social | — |
| `api/social-connect.js` | node | Inicia OAuth para publicación orgánica en redes sociales (Instagram + Facebook Pages) | — |
| `api/social-publish.js` | node | Publica posts en Instagram y Facebook Pages via Meta Graph API | — |
| `api/soporte.js` | edge | Chat de soporte atendido por IA, con el conocimiento del producto y una | support_conversations, support_tickets, team_members |
| `api/team.js` | edge | Equipo y asientos: el dueño invita miembros por email (link firmado); el | team_members |
| `api/tiktok-auth.js` | node | Inicia la conexión de una cuenta de TikTok Business para mensajería directa. | — |
| `api/trial.js` | edge | Prueba Pro de 14 días para cuentas free: una sola vez por usuario. | — |
| `api/unsubscribe.js` | node | Baja de emails de campaña: el link firmado (HMAC con CRON_SECRET) del footer | leads |
| `api/upload-image.js` | edge | Sube una imagen (base64) al bucket público campaign-images de Supabase | — |
| `api/upload-media.js` | node | Sube un archivo base64 al CDN de fal.ai y devuelve una URL pública permanente | — |
| `api/video-credits.js` | node | GET  → devuelve créditos disponibles del usuario autenticado | users |
| `api/video-gen.js` | node | Genera videos publicitarios usando BytePlus ModelArk Seedance 2.0 | ai_usage, team_members |
| `api/web-search.js` | edge | Búsqueda web en vivo para los agentes. El agente emite [WEB_SEARCH: consulta] | — |
| `api/webchat.js` | edge | — cara pública del widget de chat web (public/w.js). | channel_connections, chat_agents, chat_conversations, chat_messages |
| `api/webhooks/meta.js` | edge | Webhook universal para Meta: WhatsApp, Messenger, Instagram DMs | channel_connections |
| `api/webhooks/tiktok.js` | edge | Webhook de mensajes directos de TikTok (Business Messaging API). | — |
| `api/whatsapp-auth.js` | node | Arranca la conexión de WhatsApp por REDIRECCIÓN, igual que la de Meta Ads. | — |
| `api/whatsapp-callback.js` | node | Vuelta de la conexión de WhatsApp por redirección. | channel_connections, team_members |
| `api/whatsapp-onboard.js` | edge | Alta de WhatsApp por el "registro insertado" de Meta (Embedded Signup). | channel_connections, team_members |
| `api/yt-auth.js` | node | Inicia el OAuth de YouTube para subir los videos de la Academia desde el | — |

## Módulos compartidos

| Fichero | Entorno | Qué hace | Tablas que toca |
|---|---|---|---|
| `api/_assign.js` | node | Reparto automático de leads entre los comerciales del equipo. | lead_activities, leads, team_members, user_profiles |
| `api/_aviso-lead-nota.js` | node | Avisa al comercial cuando la dirección le deja una nota en uno de sus leads. | team_members |
| `api/_aviso-nota.js` | node | Avisa por correo cuando alguien del equipo escribe una nota interna. | leads, team_members |
| `api/_campaign-email.js` | node | Plantilla compartida del email de campaña (v2) — la usan el motor de envío | — |
| `api/_channel-policy.js` | node | Regla de entrada al pipeline por canal. | user_profiles |
| `api/_email-layout.js` | node | La plantilla de todos los correos que manda Acuarius. | — |
| `api/_enviar-canal.js` | node | El único sitio donde Acuarius le habla a un canal. Lo usan la respuesta | — |
| `api/_followup.js` | node | Tareas de seguimiento automáticas. | activities, user_profiles |
| `api/_inbox-engine.js` | node | Motor común del inbox: agente que contesta, captura de datos y entrada al | channel_connections, chat_agents, chat_conversations, chat_messages, client_properties |
| `api/_lead-intake.js` | node | Ingesta compartida de leads desde fuentes externas (formularios web, | — |
| `api/_push.js` | node | Envío de avisos push por el estándar Web Push, sin librerías ni proveedor | push_subs |
| `api/_qualify.js` | node | Calificación de leads en la conversación, antes de molestar a un comercial. | lead_activities, leads, pipeline_stages, user_profiles |
| `api/_registro-errores.js` | node | api/_errores.js | — |
| `api/_soporte-conocimiento.js` | node | Lo que el asistente de soporte sabe de Acuarius. | — |
| `api/_uso-ia.js` | node | Registra cada llamada al modelo con sus tokens y su costo. | ai_usage, team_members |
