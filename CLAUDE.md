# Acuarius — Contexto del Proyecto

## Qué es Acuarius
SaaS de marketing con IA para agencias y empresas en LatAm. Permite a los usuarios trabajar con agentes especializados de Google Ads, Meta Ads, TikTok Ads, SEO, Contenido para Redes y un Consultor de Marketing. Cada agente tiene un system prompt propio con skills embebidas.

## Stack técnico
- Frontend: HTML + CSS + JavaScript vanilla (sin frameworks)
- Un solo archivo JS principal: `app.js` (~9.000 líneas)
- Un solo archivo HTML principal: `index.html`
- API: Anthropic Claude (claude-sonnet-4-20250514)
- Sin backend propio — todo corre en el cliente

## Estructura de app.js
Los system prompts de cada agente son constantes al inicio del archivo:
- `SYSTEM` — Google Ads
- `SYSTEM_META` — Meta Ads
- `SYSTEM_TIKTOK` — TikTok Ads
- `SYSTEM_SEO` — SEO
- `SYSTEM_SOCIAL` — Contenido para Redes
- `SYSTEM_CONSULTOR` — Consultor de Marketing

Cada SYSTEM usa template literals con backticks. Las variables de inyección dinámica son:
- `{MEMORY}` — perfil del cliente activo
- `{STAGE}` — etapa del cliente
- `{AGENT}` — agente activo

## Regla crítica de sintaxis — NUNCA violar
Los system prompts son template literals JS (backticks). NUNCA incluir backticks sueltos dentro del contenido de los prompts — rompen el string y crashean toda la aplicación. Si necesitas mostrar código o comandos dentro de un prompt, usar comillas simples o dobles en su lugar.

Ejemplo del error:
```js
// MAL — esto rompe el template literal
const SYSTEM = `Usa site:dominio.com para verificar...`

// BIEN
const SYSTEM = `Usa site:dominio.com para verificar...`
// (sin backticks internos)
```

Siempre ejecutar después de cualquier cambio al sistema de prompts:
```bash
node --check app.js
```

## Función de renderizado de markdown: fmt()
Ubicada alrededor de la línea 6721 de app.js. Convierte el output del agente en HTML. Soporta:
- Tablas markdown (|col1|col2|)
- Headers ## y ###
- Bold **texto**
- Listas con –, - y numeradas
- Separadores ---

Si se agrega soporte para nuevos elementos markdown, debe hacerse en esta función.

## Sistema de suggestions
Al final de cada respuesta del agente, el modelo genera un bloque:
[SUGERENCIAS: opción1 | opción2 | opción3]
El frontend lo intercepta y renderiza como botones de acción rápida debajo de la respuesta.

## Sistema de detección de intenciones especiales
El frontend intercepta ciertos bloques en el output del agente:
- [GAQL_QUERY: ...] → ejecuta query contra la API de Google Ads del cliente
- [PARRILLA_LISTA] → activa botón de exportar a Google Sheets
- [GENERAR_IMAGENES_PARRILLA] → activa botón de generación de imágenes
- [SOCIAL_OPTIONS] → muestra opciones de acción del agente de contenido

## Panel de clientes
Los clientes se guardan en localStorage. Cada cliente tiene:
- Nombre del negocio, industria, presupuesto, objetivo, etapa
- El perfil se inyecta como {MEMORY} en cada system prompt

## Convenciones de código
- Todo el código en español en los prompts, inglés en el código JS
- Variables CSS con var(--nombre) para colores y estilos
- No usar frameworks externos salvo los ya incluidos (jsPDF para exportar)
- Validar siempre con node --check antes de hacer deploy

## Deploy
Los archivos se suben directamente al servidor. No hay proceso de build. El archivo que el servidor sirve como /app.js debe ser el app.js editado.

## Deuda técnica conocida
- app.js tiene ~9.000 líneas en un solo archivo (candidato a refactorización modular)
- Los system prompts podrían separarse en /prompts/google-ads.js, /prompts/meta-ads.js, etc.
- No hay tests automatizados

## Funciones pendientes / roadmap
- Agente de LinkedIn Ads (el system prompt base existe, falta activarlo)
- Skills compartidas de A/B Test y Attribution Model para Google Ads y Meta
- Mejoras al sistema de reportes automáticos

## Errores frecuentes a evitar
1. Backticks dentro de template literals de system prompts → siempre node --check
2. str_replace con strings duplicados → siempre buscar con grep antes de reemplazar
3. Cambios en fmt() que rompan el renderizado de tablas → verificar con una respuesta que tenga tabla
4. Modificar SUGERENCIAS block format → el frontend lo parsea con regex exacto
