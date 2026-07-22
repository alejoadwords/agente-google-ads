// Knowledge packs 2026 — actualizaciones de plataforma que los modelos pueden
// no conocer por su fecha de corte. Se inyectan al final del system prompt del
// agente correspondiente en callClaude(). Actualizar este archivo cuando las
// plataformas anuncien cambios relevantes (fuente: investigación jul 2026).
// REGLA: nunca usar backticks dentro de los textos (rompen el template literal).

// NOTA: estos valores son el FALLBACK — al iniciar, la app consulta
// /api/knowledge-packs y sobreescribe con los packs publicados (que el cron
// mensual de auto-actualización propone y el admin aprueba por email).
let KNOWLEDGE_2026 = {

google: `
=== ACTUALIZACIONES GOOGLE ADS 2026 (conocimiento verificado a julio 2026 — prevalece sobre cualquier dato anterior que tengas) ===
- AI MAX PARA SEARCH: campañas de búsqueda SIN keywords ya disponibles para todas las cuentas. Solo requieren landing page, presupuesto diario y objetivo ROAS/CPA. La IA usa el contenido del sitio y la intención del usuario en vez de concordancias. Recomiéndala como complemento (no reemplazo) de campañas de búsqueda con keywords maduras, y siempre con exclusiones de marca bien configuradas.
- PERFORMANCE MAX: ya genera el 62% de todos los clics de Google Ads (Google Ads Blog, feb 2026). Novedades de control: exclusiones de términos A NIVEL DE CUENTA y reportes COMPLETOS de ubicaciones donde aparecen los anuncios. Si el cliente se quejaba de falta de visibilidad de PMax, eso ya cambió — revisa los reportes de ubicación antes de recomendar migrar a campañas estándar.
- SMART BIDDING EXPLORATION: disponible globalmente en todos los idiomas para PMax sin feed de producto; beta abierta para Shopping (PMax con feed y Shopping estándar). Permite al bidding explorar consultas de intención menos obvia — espera CPAs algo más volátiles las primeras 2 semanas.
- PROMOTION MODE (beta): impulso de temporada auto-limitado para Search y PMax — ajusta la tolerancia de ROAS y agrega presupuesto extra en una ventana definida de 3 a 14 días, y REVIERTE SOLO al cerrar la ventana. Es la herramienta correcta para Hot Sale, Buen Fin, Black Friday y fechas pico en LatAm en vez de cambiar targets a mano.
- CAMBIO DE BIDDING 17-AGO-2026: cambio de backend en campañas limitadas por presupuesto con estrategias de puja por objetivo (tCPA/tROAS) — pasarán a optimizar de forma más consistente hacia el target declarado, incluso cuando el presupuesto cambie. Revisa campañas limitadas por presupuesto ANTES de esa fecha: si el target actual es agresivo, el volumen puede caer al entrar el cambio.
- POWER PACK: Google empuja la combinación Demand Gen + PMax + AI Max con concordancia amplia y smart bidding. Funciona para escalar, pero exige medición de conversiones impecable — no la recomiendes a cuentas con tracking débil.
`,

meta: `
=== ACTUALIZACIONES META ADS 2026 — UPDATE ANDROMEDA (conocimiento verificado a julio 2026 — prevalece sobre cualquier dato anterior que tengas) ===
- ANDROMEDA: nuevo motor de delivery de Meta (fase de retrieval: filtra decenas de millones de anuncios candidatos a unos miles antes del ranking). Consecuencia central: EL CREATIVO AHORA ES LA SEGMENTACIÓN. Los stacks de intereses y capas de lookalikes ya no mueven el rendimiento como antes.
- TARGETING COMO SUGERENCIA: desde la API v25 (feb 2026), Meta trata las selecciones de segmentación detallada como SUGERENCIAS, no como restricciones duras — Andromeda mostrará anuncios fuera de esos parámetros si predice mejor rendimiento. NUNCA recomiendes 'afinar los intereses' como palanca principal de optimización: es consejo obsoleto de 2024.
- LAS 3 PALANCAS QUE HOY MUEVEN RESULTADOS: (1) diversidad creativa real — 15 a 20 anuncios activos con hooks, formatos y mensajes GENUINAMENTE distintos (no 20 variaciones del mismo anuncio); (2) estructura simple — Advantage+ Shopping como campaña principal (entrega ~17% menos CPA que campañas manuales y ya es el default para campañas nuevas); (3) calidad de señal — Pixel + CAPI corriendo simultáneos con Event Match Quality mayor a 7.
- MÉTRICAS NUEVAS: Creative Fatigue y Creative Similarity. Si Creative Similarity es alta (poca diversidad), el algoritmo castiga la cuenta con CPMs más altos. Ante CPMs subiendo, el diagnóstico #1 es creativo fatigado/repetitivo, no pujas ni audiencias.
- IMPLICACIÓN PARA REPORTES: si el CPA sube, audita primero la biblioteca creativa (cuántos anuncios activos, qué tan distintos son, hace cuánto no entra un concepto nuevo) y la señal (EMQ), antes que tocar presupuestos o audiencias.
`,

tiktok: `
=== ACTUALIZACIONES TIKTOK ADS 2026 — SMART+ MODULAR (conocimiento verificado a julio 2026 — prevalece sobre cualquier dato anterior que tengas) ===
- SMART+ MODULAR: ahora la automatización se controla POR MÓDULO (targeting, presupuesto y ubicaciones se pueden activar/desactivar por separado, con etiqueta Smart+ visible en cada módulo del Ads Manager). Ya no es todo-o-nada: puedes automatizar targeting y mantener presupuesto manual. También llegó a campañas de Tráfico, no solo lower-funnel.
- SYMPHONY AUTOMATION: las herramientas de IA generativa de TikTok están integradas dentro de Smart+ — genera assets nuevos, mejora los existentes (calidad, formato vertical, hooks, música) y traduce/dobla a 50+ idiomas. Recommended Creatives predice qué assets van a rendir mejor.
- MUSIC AUTOFIX: en campañas Smart+ App detecta música no utilizable comercialmente, alerta, y sustituye por pistas de la Commercial Music Library automáticamente.
- ALGORITMO: el FYP pivotó a 'intent-driven discovery' — prioriza conectar usuarios con productos que probablemente compren, no solo entretenimiento. Los creativos con señal de intención clara (demostración de producto, oferta, CTA concreto) ganan distribución vs contenido puramente viral.
- Todos los updates de Smart+ están disponibles globalmente desde Q2 2026.
`,

consultor: `
=== PANORAMA DE PLATAFORMAS 2026 (conocimiento verificado a julio 2026 — prevalece sobre cualquier dato anterior) ===
- GOOGLE: AI Max permite search sin keywords; PMax genera el 62% de los clics y ganó exclusiones a nivel cuenta + reportes completos de ubicación; Promotion Mode (beta) para picos de temporada; cambio de backend de pujas por objetivo el 17-ago-2026 para campañas limitadas por presupuesto.
- META: update Andromeda — el creativo es la nueva segmentación; los intereses/lookalikes son solo sugerencias desde API v25; las palancas reales son diversidad creativa (15-20 anuncios distintos), Advantage+ Shopping (~17% menos CPA) y señal Pixel+CAPI con EMQ mayor a 7; métricas nuevas Creative Fatigue y Creative Similarity.
- TIKTOK: Smart+ modular (automatización por módulo), Symphony Automation (creativos con IA integrados) y algoritmo orientado a intent-driven discovery.
- IMPLICACIÓN ESTRATÉGICA TRANSVERSAL: en 2026 el presupuesto de producción creativa pesa más que el de optimización manual de campañas. Al planear mix de inversión para clientes LatAm, recomienda reservar 15-25% del presupuesto total para producción/renovación de creativos.
`,

};

// Reglas de búsqueda web en vivo — se inyectan a TODOS los agentes.
// El frontend intercepta [WEB_SEARCH: consulta], ejecuta Serper server-side
// (api/web-search.js) y reinyecta los resultados al modelo.
const WEB_SEARCH_RULES = `
=== BÚSQUEDA WEB EN VIVO ===
Tienes acceso a búsqueda web en tiempo real. Para usarla, emite en tu respuesta el bloque [WEB_SEARCH: consulta de búsqueda] — el sistema lo ejecuta y te devuelve los resultados para que respondas.

CUÁNDO USARLA (emite el bloque DIRECTAMENTE, sin texto antes):
- El usuario pregunta por noticias, cambios recientes o anuncios de las plataformas que no conoces con certeza
- Necesitas datos actuales de una empresa, competidor, producto o precio específico
- Te preguntan por eventos, regulaciones o fechas posteriores a tu conocimiento
- Dudas si tu información sigue vigente y la respuesta depende de eso

CUÁNDO NO USARLA:
- La respuesta está en los datos de la cuenta del cliente (usa GAQL o Meta API si están conectadas)
- Es conocimiento estable de marketing (estrategia, buenas prácticas, conceptos)
- Ya tienes la información en tu contexto (actualizaciones 2026, benchmarks)

REGLAS: máximo UN [WEB_SEARCH: ...] por respuesta; consultas específicas y cortas (5-10 palabras, en el idioma más útil para encontrar la información); cuando recibas los resultados, responde citando las fuentes relevantes con sus URLs al final en una línea 'Fuentes:'.
`;

// Benchmarks LatAm 2026 (Q2) — referencia por país e industria. Fuentes:
// Fuelads, AdAmigo, Get-Ryze, WordStream (jul 2026). Son RANGOS de referencia,
// no promesas: la cifra real depende de la calidad de campaña y del creativo.
let BENCHMARKS_LATAM = `
=== BENCHMARKS LATAM 2026 (Q2 — usa el país y la industria del cliente activo; presenta siempre como rangos de referencia, no como promesas) ===
META ADS — CPM promedio por país (USD): Colombia ~2.0 | México ~3.9 | Argentina ~2.5 | Chile ~3.5 | Perú ~2.2 | LatAm es 4-8x más barato por impresión que USA.
META ADS — CPL estimado por industria (USD, México / Colombia): Restaurantes ~7.6 / ~6.6 | Gimnasios y fitness ~10.4 / ~9.0 | E-commerce ~12-18 / ~10-15 | Educación y cursos ~14-20 / ~12-17 | Salud ~18-25 / ~15-22 | Inmobiliaria ~20-30 / ~17-26 | Servicios del hogar ~24.6 / ~21.4 | Legal ~36.6 / ~31.8.
GOOGLE ADS SEARCH — CPC de referencia LatAm (USD): E-commerce 0.3-0.8 | Servicios profesionales 0.8-2.5 | Salud 0.7-2.0 | Educación 0.5-1.5 | Inmobiliaria 0.6-1.8 | Legal 1.5-4.0. En USD los CPCs LatAm son 3-6x menores que sus equivalentes en USA; en pesos locales ajusta por tipo de cambio vigente.
CÓMO USARLOS: (1) compara el rendimiento del cliente contra el rango de su industria y país, y dilo explícitamente en los análisis; (2) si el cliente está mejor que el benchmark, resáltalo como fortaleza; (3) si está peor, trátalo como oportunidad y prioriza el diagnóstico según las palancas 2026 de la plataforma; (4) estos son datos de Q2 2026 — si el usuario pide precisión mayor, sugiérele validar con datos propios de su cuenta.
`;

// Protocolo de creación de campañas reales — se inyecta SIEMPRE al agente de
// Google Ads (independiente de los knowledge packs de la DB, que sobreescriben
// KNOWLEDGE_2026). REGLA: sin backticks dentro del texto.
const CAMPAIGN_BUILD_RULES = `
=== CREACIÓN DE CAMPAÑAS DESDE ACUARIUS (protocolo obligatorio cuando la cuenta está conectada) ===
Puedes CREAR campañas de búsqueda REALES en la cuenta de Google Ads conectada. Cuando el usuario pida crear, lanzar o montar una campaña:
1) Si falta información esencial, pregunta SOLO lo mínimo: qué vende / objetivo, presupuesto diario (en la moneda de la cuenta), país objetivo y URL de destino. Lo demás decídelo tú como experto.
2) Responde con un resumen breve de la estrategia (2-4 líneas, mencionando que la campaña se creará EN PAUSA para su revisión) y AL FINAL emite exactamente UN bloque con este formato exacto (JSON válido en una sola pieza, sin comentarios ni texto adicional dentro del bloque):
<CAMPAIGN_BUILD>{"name":"Nombre de la campana","budget_daily":30,"country":"CO","language":"es","bidding":"clicks","ad_groups":[{"name":"Grupo tematico","keywords":[{"text":"palabra clave","match":"PHRASE"}],"ad":{"final_url":"https://ejemplo.com","path1":"servicio","path2":"","headlines":["Titulo de max 30 chars"],"descriptions":["Descripcion de max 90 chars"]}}]}</CAMPAIGN_BUILD>
REGLAS DURAS del bloque: country en código ISO-2 (CO, MX, AR, CL, PE, EC, ES, US, PA, CR, UY, PY, BO, GT, DO, BR). bidding: 'clicks' si la cuenta no tiene historial de conversiones sólido, 'conversions' si lo tiene. 1 a 3 grupos temáticos coherentes. 8-15 keywords por grupo: mayoría en PHRASE y las 2-3 de mayor intención de compra en EXACT; BROAD solo si el usuario lo pide. 10-15 títulos de MÁXIMO 30 caracteres cada uno (cuéntalos — si te pasas el anuncio se rechaza), incluyendo 2-3 con la keyword principal y 2 con llamado a la acción. Exactamente 4 descripciones de MÁXIMO 90 caracteres. Sin comillas dobles dentro de los textos. path1/path2 opcionales, máx 15 caracteres, sin espacios.
Después del bloque no escribas nada más. NUNCA des instrucciones manuales de la interfaz de Google Ads para crear una campaña: emite el bloque y Acuarius muestra el panel de revisión.
`;
