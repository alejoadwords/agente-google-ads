# Auditoría de la Academia — 08-10-2026

17 videos visibles revisados contra el código de octubre (narración desde los .srt
del Escritorio + cuadros cada 25 s). Los 6 de los agentes de marketing apagados
(Google Ads ×4, Análisis SEO con IA, Studio de Contenido) se retiraron el mismo día
(`academia_videos.retirado_at`).

**Resultado: 11 REHACER · 6 AJUSTAR · 0 DEJAR.** Aunque la narración de un video
siga siendo cierta, **todas las tomas hay que regrabarlas**: en todos los cuadros
sale el menú viejo (grupo «Agentes», lista «Recientes», píldora «agente google ads»),
que hoy no existe. Y todas las narraciones dicen «lead»: en los videos va
**«prospecto»** (la interfaz sigue diciendo «Nuevo lead», eso sí se verá en pantalla).

Voz: **es-MX-JorgeNeural** para toda la serie. Formato: grabación real de la cuenta
demo + envoltura HyperFrames (intro, subtítulos de marca, zoom, tarjetas para lo que no
se graba, cierre).

---

## Primeros pasos

### 1 · Tour completo de Acuarius — REHACER
- Falso: los agentes de chat como columna del producto; «seis herramientas» en Marketing
  (hoy 11); inbox con Messenger e Instagram; «Chatbots» (hoy «Agentes IA»); «programa de
  recomendados» (apagado, hoy **Partners**).
- Cambió: menú lateral entero, Inicio (Pulso, sin tarjetas de agentes ni caja de chat),
  submenús en la barra lateral en vez de pestañas arriba, Análisis con 7 informes.
- Mostrar: Inicio con el Pulso; CRM (Pipeline, Contactos, Tareas, Agenda, procesos de
  venta, ficha a página completa); Marketing › Plataformas de pauta (Campañas, Diagnóstico,
  Analista IA, Reglas, Búsquedas, Reportes, Ventas a la pauta) y Reservas; Conversaciones ›
  Agentes IA; ⌘K; Partners; selector de cliente para agencias.

### 2 · Tu prueba Pro de 14 días — REHACER
- Falso: «agentes con búsqueda web», «pídele al agente su análisis»; «Pro… dos mil correos
  al mes», «Agency diez mil… imágenes ilimitadas» (hoy correo ilimitado con tope diario,
  se cobra por contactos); «no pierdes nada» (al vencer baja a free: 50 contactos, sin
  campañas).
- Falta: cupos del Agente IA (trial 300 · pro 500 · agency 2.000 mensajes/mes).
- Mostrar: insignia de prueba, plan de 14 días con funciones reales (importar, conectar un
  formulario, automatización de bienvenida, campaña de correo, agente de WhatsApp, Google
  Ads + Ventas a la pauta), Configuración › Plan y facturación con los textos actuales.

### 3 · Crea tu primer cliente — REHACER (o pasar a «solo agencias»)
- Falso: el perfil «que usan todos los agentes»; la entrada «Configurar mi negocio» / «mi
  negocio» (retirada el 29-09). Una cuenta Pro nueva **no tiene hoy dónde llenar el perfil**.
- Hoy el perfil lo usan el Analista IA de pauta y los reportes programados. Solo se llega
  desde Panel de clientes › agregar cliente (agencias).
- Mostrar: asistente de 8 pasos con «Analizar sitio y autocompletar», para qué sirve hoy,
  selector de cliente y conexiones por cliente.

### 4 · Conecta tus cuentas publicitarias — AJUSTAR
- Falso: todo lo de «el agente leyendo tus campañas»; «son permisos de lectura» (Acuarius
  puede pausar y bajar presupuestos con Reglas); Meta «idéntico… y listo» (bloqueado por
  App Review); publicar desde el Studio (apagado); «el agente de TikTok funciona».
- Mostrar: conectar Google Ads desde **Plataformas de pauta › Conexiones** (estados, cambiar
  de cuenta), Meta «En revisión» contado de frente, qué se gana al conectar (Campañas,
  Diagnóstico, Analista IA, Reglas, Búsquedas, Ventas a la pauta, Reportes), permisos
  explicados bien. Decidir qué se promete de LinkedIn.

## CRM

### 15 · El CRM de Acuarius — REHACER
- Falso: «Editar pipeline» en el menú (hoy **Procesos de venta**, hasta 10, con
  probabilidad y «Al entrar: pedir cita»); la ficha como panel (hoy página completa);
  filtro por etapa; «CSV o pegar» (también xlsx, arrastrar, quién atiende, duplicados);
  «añadir motivo» (solo admin); «en 2 minutos» (sin dato).
- Mostrar: selector y gestor de procesos, modal ganada/perdida (importe, motivo, notas,
  fecha), ficha completa (embudo, cierre esperado, tareas, citas, historial, Agendar,
  Propuesta, Sugerir próxima acción), Lista con columnas y panel Filtros, importador de 4
  pasos, Papelera de 30 días.

### 16 · Etiquetas — AJUSTAR
- Falso: cualquiera crea etiquetas desde la ficha (solo admin; el comercial elige del
  catálogo); fichas de etiquetas encima del tablero (hoy en Filtros); audiencia solo por
  etiquetas (hoy segmento / lista / uno a uno + exclusiones).
- Mostrar: CRM › Etiquetas (gestor), etiqueta en la ficha, automática por fuente (⚡) y en
  la importación, Filtros combinados, campaña por segmento, lanzador «se añade una
  etiqueta», «Leads por etiqueta» en Resumen.

### 17 · Agenda y Google Calendar — AJUSTAR
- Cambió: agendar desde la ficha completa; filtro por asesor; solo las **reuniones** van a
  Google Calendar (las tareas no).
- Falta: vista **Tareas** (Vencidas/Hoy/Próximas, Míos), tarea automática de primer
  contacto (4 h), «Al entrar: pedir cita», Reservas públicas.

## Marketing

### 18 · Campaña de email masiva — REHACER
- Falso: «Pro dos mil correos, Agency diez mil» (ilimitado con tope diario = contactos ×3,
  300 el primer día); «contador a la vista» (dice «Ilimitado»); «email o WhatsApp» (WhatsApp
  no funciona para clientes); «enviar ahora… enviado» (lotes cada 10 min y horario Ley 2300).
- Cierto: la IA de redacción funciona sin el chat (endpoint propio) y ahora llena asunto y
  preencabezado; bajas con `no-email`.
- Cambiaron las 4 pantallas del asistente (modal de canal, pasos numerados, plantillas,
  «No enviar a», revisión automática, desglose de destinatarios).

### 19 · Automatizaciones — REHACER
- Falso: el correo «con IA» (el paso no tiene IA); «al instante» (cada 10 min + horario
  legal); «avisas al vendedor» (Notificarme va al dueño); reactivación a 30 días (máx. 14);
  horario «si quieres» (es obligatorio); WhatsApp; «ejecuciones en la lista».
- Mostrar: plantilla «Bienvenida» con su rama, «¿Abrió el email?» con espera 24 h, horario
  legal, lanzador por etiqueta, «Pedir reseña» y «No contactar» al perder.

### 20 · Fuentes de prospectos — REHACER
- Falso: «tres modos» (hoy dos; el conector es fuente aparte); Messenger/Instagram crean
  prospectos solos (Meta bloqueada).
- Mostrar: formulario propio con quién atiende, **conectar el formulario que ya tienes**
  (f.js o webhook) con «el mismo formulario alimenta varios tableros», reparto por turnos,
  aviso de silencio, webhook con tablero de destino, Hotmart, «Lo que sabe tu agente».

### 21 · Propuestas comerciales — REHACER
- Falso: «cuándo la abrió y cuántas veces» (solo estado «Vista», sin contador ni aviso);
  «acepta ahí mismo» (ahora firma obligatoria); MercadoPago automático (botón oculto).
- Mostrar: Propuesta desde la ficha, 4 estilos con IA, link de pago propio, Vista → firma →
  pago, correo al firmar, estados y «Marcar pagada» → Ganado. Decir solo «sabes si ya la abrió».

### 22 · Encuestas NPS — AJUSTAR
- Falso: «30 días después» en un paso (máx. 7, encadenar); «alerta si baja dos meses» (no
  existe).
- Mostrar: Ganado → esperar → NPS, **Personalizar encuesta**, reacción por etiqueta
  (detractor → aviso + tarea; promotor → Pedir reseña), reporte por pregunta.

## Conversaciones

### 23 · Inbox unificado — REHACER
- Falso: 4 canales (Messenger/Instagram bloqueados; WhatsApp solo con credenciales propias;
  falta el Chat web); filtros viejos; «Escalado» (hoy Manual cuando no hay agente); «cada
  quien atiende lo suyo» (el inbox no filtra por responsable).
- Mostrar: canales posibles hoy, logos por red, filtros Agente IA / Manual y escalados /
  Archivadas, archivar y reapertura sola, nota interna, respuestas rápidas, programar
  mensaje, ventana de 24 h, «Pasar al pipeline» con proceso.

### 24 · Chatbots con IA — REHACER
- Falso: «Chatbots» (hoy Agentes IA); «le dices qué datos conseguir» (fijos en el motor);
  canales Meta; «a cualquier hora» sin cupo; «entra al CRM» siempre (depende de la regla).
- Mostrar: asistente de 6 pasos (Identidad, Respuestas, Canales, **Calificación**,
  **Proceso**, **Probar**), probador que no gasta cupo y se comparte, hora/horario/festivos,
  catálogo, citas, escalado, seguimiento a los 10 min, cupo por plan.

## Análisis

### 25 · Análisis comercial — AJUSTAR
- Falso: «seis informes arriba» (siete, en la barra lateral, con **Por comercial**); «todo se
  compara con el periodo anterior» (solo importe y ticket); probabilidades «en el editor del
  pipeline» (hoy Procesos de venta).
- Rangos nuevos: 7 / 30 / 90 / Todo / **Elegir fechas**.

### 26 · Análisis de marketing y clientes — AJUSTAR
- Falso: «qué día rinde más» (no hay análisis por día); cierre «con esto termina la Academia…
  los agentes».
- Mostrar: rangos nuevos, Marketing, Conversaciones (con canales reales), Por comercial,
  Satisfacción con «Personalizar encuesta».

### 13 · Proyecto SEO y reporte GEO — REHACER
- Falso: todo el ciclo con el agente SEO (botones ocultos con AGENTES_ACTIVOS=false);
  «cada mes una fila nueva» (no hay cron: actualiza al abrir en un mes nuevo y gasta cupo).
- Falta: cupo mensual (GEO 80/200/1.000 · posiciones 150/500/3.000 trial/pro/agency; free 0).
- Mostrar: configuración, posiciones con Serper (mes anterior, mejor, tendencia), cupo,
  GEO en 4 IAs con competidores y exportar, Competencia con top 5 real.

---

## Videos que no existen y hoy son fuertes
Plataformas de pauta (Ventas a la pauta, Reglas, Búsquedas/negativas, Analista IA,
Reportes a clientes) · Procesos de venta y ficha (si el 15 no alcanza) · Tareas ·
Reservas · Equipo y perfiles de acceso · Panel de agencias · Programa de Partners.

## Fallos de producto encontrados de paso (no son de los videos)
1. Configuración › Integraciones: «Conectar con Meta» activo y sin aviso; el texto dice
   «para que los agentes puedan acceder…».
2. Brief de cliente (paso Plataformas): LinkedIn «Próximamente» aunque se conecta; Meta
   habilitado.
3. Plataformas de pauta › Conexiones dice «solo lectura» y Acuarius puede pausar y bajar
   presupuestos.
4. Una cuenta Pro no tiene dónde llenar el perfil de negocio que usa el Analista IA.
5. La ficha muestra «Enviar al Consultor» con los agentes apagados (solo da un aviso).
6. Análisis › Ventas: la variación de «Ticket medio» usa la del número de ventas.
7. Agentes IA › paso Canales ofrece «Conectar» Messenger e Instagram; la cabecera promete
   esos canales; el vacío del informe de Conversaciones también.
8. (Sin probar) Abrir `/p/{token}` desde la lista de Propuestas podría marcarla «Vista».
