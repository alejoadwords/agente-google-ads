# Acuarius — contexto del proyecto

## Qué es

SaaS de marketing y CRM con IA para agencias y empresas en LatAm.
**app.acuarius.app**. Dos cosas en una:

- **CRM**: leads, pipelines editables, tareas, agenda, equipo, inbox
  multicanal, automatizaciones, campañas de correo y WhatsApp, propuestas,
  páginas de aterrizaje, reportes.
- **Agentes de IA**: Google Ads, Meta Ads, TikTok Ads, SEO, Contenido para
  Redes y Consultor de Marketing, cada uno con su prompt y sus skills.

Planes: **free**, **trial** (14 días de Pro), **pro** (39 USD) y **agency**
(99 USD), cobrados por Hotmart.

## Stack

- **Frontend**: HTML + CSS + JavaScript vanilla, sin framework y **sin paso de
  compilación**. `public/index.html` (~5.800 líneas, todo el CSS dentro) y
  `public/app.js` (~34.000 líneas).
- **Backend**: ~128 funciones en `api/`, casi todas **edge de Vercel**
  (`export const config = { runtime: 'edge' }`). Las de cron son Node.
- **Base**: Supabase (PostgREST). 53 tablas. **El esquema no está versionado**:
  los `CREATE TABLE` que hay comentados dentro de `api/*.js` son
  aspiracionales, no la verdad. Preguntarle siempre a la base.
- **Identidad**: Clerk (`clerk.acuarius.app`). El JWT v2 **ya no trae
  `public_metadata`**, así que los gates de plan tienen que preguntarle a Clerk.
- **IA**: API de Anthropic. Sonnet 5 para los agentes, Haiku 4.5 donde basta.
- **Correo**: Resend, solo desde el dominio verificado app.acuarius.app.
- **`package.json` no tiene ni una dependencia**, a propósito. Lo que hace
  falta (VAPID, cifrado push, JWT) va con WebCrypto.

## Estructura

```
public/          lo que sirve el navegador — index.html, app.js, sw.js, manifest…
api/             funciones. api/_*.js son módulos compartidos, no endpoints
prompts/         los system prompts de los agentes, uno por fichero
tools/           utilidades de terminal (soporte, mapas)
.claude/skills/  manuales para trabajar aquí (soporte)
```

## Reglas de despliegue que causan fallos raros

1. **`public/` es la raíz web.** Todo fichero que cargue el navegador tiene que
   estar en `public/`. Hay copias en la raíz por historia: al tocar `app.js`,
   `index.html` o `novedades.json` hay que copiarlos (`cp public/app.js app.js`)
   o el cambio es invisible en producción.
2. **Un `api/_*.js` solo se importa desde funciones edge.** Desde una función
   Node rompe el build.
3. **El catch-all de `vercel.json` devuelve 200 con el shell de la app** para
   cualquier ruta que no empiece por `/api`. Al verificar un despliegue,
   comprobar por **contenido**, nunca por código de estado.
4. **`READY` en Vercel no prueba que producción sirva tu código.** Hacer grep
   del cambio en el asset servido:
   `curl -s "https://app.acuarius.app/app.js?v=$RANDOM" | grep -c loQueCambié`
5. **Upserts a Supabase: `?on_conflict=` es obligatorio.** Sin él, el segundo
   guardado da 409.

## Convenciones

- **Todo el texto que ve el usuario, en español de LatAm.** Los comentarios del
  código también: explican *por qué*, no *qué*.
- **Colores y medidas siempre con `var(--token)`**, nunca hex sueltos. Botones
  con `.btn-pri` / `.btn-ghost`, iconos con `icn()`, vacíos con `emptyAgua()`.
  Antes de publicar algo visual, comprobar que **cada `var(--x)` y cada clase
  existan**: un token inventado no falla, solo se ve mal.
- **Toda mejora visible lleva su entrada en `public/novedades.json`, en el
  mismo commit.** Validar el JSON (`python3 -c "import json;json.load(...)"`)
  antes de comitear, sobre todo tras resolver un rebase.
- **Fallar a la vista, nunca en silencio.** Ante cualquier cambio:
  «¿qué se ve si esto falla?».
- **Los avisos a clientes se firman «Equipo de Soporte — Acuarius»**, nunca con
  un nombre propio.

## Los prompts de los agentes

Viven en `prompts/` (uno por agente, ~3.700 líneas en total) y son **template
literals con backticks**. Variables de inyección: `{MEMORY}` (perfil del
cliente), `{STAGE}` (etapa) y `{AGENT}` (agente activo).

**Nunca meter un backtick suelto dentro del contenido de un prompt**: rompe el
string y tumba la aplicación entera. Si hay que mostrar código o un comando,
usar comillas simples o dobles. Siempre `node --check` después de tocarlos.

Las actualizaciones de conocimiento van en `prompts/actualizaciones-2026.js`;
**no se tocan los prompts grandes** para eso.

## Bloques que el frontend intercepta

El modelo los emite al final de su respuesta y `app.js` los convierte en
botones o acciones. Se parsean con regex exacto: **cambiar el formato los
rompe**.

`[SUGERENCIAS: a | b | c]` · `[GAQL_QUERY: …]` · `[PARRILLA_LISTA]` ·
`[GENERAR_IMAGENES_PARRILLA]` · `[SOCIAL_OPTIONS]` · `[CAMPAIGN_BUILD]` ·
`[CALIFICACION]`

El markdown de las respuestas lo renderiza `fmt()` en `public/app.js`. Soporta
tablas, `##`/`###`, negritas, listas y separadores. Si se toca, verificar con
una respuesta que traiga tabla.

## Crons

14, en `vercel.json`. Los dos que más aparecen en soporte: `cron-automations` y
`cron-campaigns`, ambos **cada 10 minutos** — nada de esto es instantáneo.

## Soporte a clientes

Hay un manual: `/soporte` (en `.claude/skills/soporte/`). Empieza siempre por
`node tools/soporte.mjs <correo>`.

## Lo que está bloqueado

**Meta**: la app no ha pasado App Review, así que **ningún cliente puede
conectar su cuenta de Meta todavía**. No es un fallo de su cuenta.
