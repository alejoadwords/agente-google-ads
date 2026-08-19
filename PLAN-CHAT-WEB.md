# Plan técnico — Widget de chat web

Meta: que un cliente pegue una línea en su web y las conversaciones entren al
inbox de Acuarius igual que las de WhatsApp, con el mismo agente, la misma
calificación y el mismo lead en el CRM.

**La idea central es no construir un canal nuevo, sino enchufar uno más al motor
que ya existe.** Todo lo caro —conversaciones, agentes, calificación, políticas
de canal, creación del lead, escalado a humano, inbox— ya está hecho y es
agnóstico del canal.

---

## 1. Cómo encaja en lo que ya hay

Un canal en Acuarius es una fila de `channel_connections` (`channel`,
`external_id`, `agent_id`, `client_id`, `pipeline_id`, `is_active`) y dos puntos
de contacto con el motor:

| Pieza | Qué hace hoy | Qué necesita el chat web |
|---|---|---|
| `processIncoming()` en `api/_inbox-engine.js` | Recibe un mensaje, busca el canal, crea o recupera la conversación, llama al agente, califica, crea el lead | **Nada.** Se le llama igual que desde el webhook de Meta |
| `enviarPorCanal()` en `api/_enviar-canal.js` | Manda la respuesta del humano por Meta o TikTok | Una rama `webchat` que **no envía nada** |

Esa segunda fila es la única diferencia conceptual del canal: **en WhatsApp
empujamos el mensaje al cliente; en la web es el navegador quien lo viene a
buscar.** El mensaje ya queda guardado en `chat_messages` por el propio motor
(la respuesta del bot) y por `api/chat-conversations.js` (la del humano), así
que "enviar" se reduce a devolver un `{ ok: true }` y dejar que el widget
pregunte.

Decisión: **sondeo (polling), no WebSocket ni SSE.** No hay servidor propio, todo
son funciones edge; mantener conexiones abiertas cuesta invocaciones y
complejidad para un caso donde 3-4 segundos de latencia son irrelevantes.

---

## 2. Piezas nuevas

### 2.1 `public/w.js` — el widget

Mismo patrón de entrega que `public/f.js`, que ya está probado en producción:

```html
<script src="https://app.acuarius.app/w.js" data-key="CLAVE_DEL_SITIO" defer></script>
```

- Sin dependencias, sin framework, un solo archivo.
- **Shadow DOM obligatorio.** El widget vive en la web del cliente, con su CSS y
  su Bootstrap: sin shadow root, el primer cliente con `* { box-sizing }`
  agresivo nos rompe la burbuja y no hay forma de depurarlo a distancia.
- Estado en `localStorage`: `visitorId` (aleatorio, 32 hex), id de conversación
  y marca del último mensaje visto. Es lo que hace que al recargar la página la
  conversación siga donde estaba.
- Estados de la interfaz: burbuja cerrada · panel abierto · escribiendo ·
  error de red · fuera de horario.

### 2.2 `api/webchat.js` — la cara pública

Endpoint **sin autenticación**, como `api/form-public.js`. Tres acciones:

| Acción | Qué hace |
|---|---|
| `GET ?key=` | Configuración pública: nombre y avatar del agente, saludo, color, si está activo. Nunca devuelve datos de la cuenta |
| `POST ?key=&action=send` | Llama a `processIncoming({ channel:'webchat', externalId: key, contactId: visitorId, ... })` y devuelve la respuesta del bot si la hubo |
| `GET ?key=&action=poll&v=&since=` | Mensajes nuevos de ESA conversación desde una marca de tiempo |

### 2.3 La fila del canal

`channel = 'webchat'`, `external_id` = **clave del sitio** (32 hex aleatorios,
generada al conectar). El resto de columnas se reutilizan tal cual, así que la
pantalla de Canales, la elección de agente, el cliente y el pipeline funcionan
sin tocarlas.

### 2.4 Cambios pequeños en lo existente

- `api/_enviar-canal.js`: `if (channel === 'webchat') return { ok: true };`
- `api/_inbox-engine.js`: `telefonoDelCanal()` devuelve `null` para webchat
  (ya lo hace por defecto) — verificar que no asuma teléfono.
- Inbox del front: icono y etiqueta del canal, junto a los otros.
- Pantalla de Canales: alta del canal, snippet de instalación y apariencia.

---

## 3. Seguridad — lo que hay que resolver sí o sí

La clave del sitio **está a la vista en el HTML de cualquiera**. El diseño tiene
que asumir que es pública:

1. **La clave solo permite escribir en su propio canal.** Nunca leer
   conversaciones ajenas, ni la cuenta, ni la lista de contactos.
2. **Leer exige `visitorId`**, que es aleatorio y vive solo en el navegador de
   esa persona. El endpoint de sondeo cruza `key + visitorId`: sin los dos, no
   devuelve nada.
3. **Lista de dominios permitidos por canal.** Se comprueba el `Origin`. Sin
   esto, cualquiera clona el snippet en otra web y nos llena el CRM de basura
   atribuida a nuestro cliente.
4. **Límite de frecuencia** por `visitorId` y por IP, y tope de longitud del
   mensaje. Un chat público sin límite es una factura de tokens del agente.
5. **Nada de HTML en los mensajes**, ni al guardar ni al pintar. El widget
   escribe con `textContent`.
6. **Honeypot** como en los formularios, para bots tontos.

---

## 4. Trampas conocidas

- **El content-type del envío.** Es exactamente el fallo que nos costó el 100%
  de los leads en `f.js`: un `application/json` desde otro dominio dispara un
  preflight, y con `sendBeacon` el navegador lo descarta **devolviendo `true`**.
  Aquí usamos `fetch` normal con CORS bien configurado y comprobamos la
  respuesta; no `sendBeacon`.
- **Coste del sondeo.** 4 segundos con el panel abierto, 20 con el panel cerrado
  y **parar del todo** tras unos minutos sin actividad, reanudando al interactuar.
  Sin esto, una pestaña olvidada sondea toda la noche.
- **El widget se carga en webs que no controlamos.** Cualquier excepción no
  capturada aparece en la consola del cliente y parece un fallo *de su web*.
  Todo el widget va dentro de un `try/catch` y falla en silencio hacia fuera,
  pero deja rastro en nuestro lado.
- **Conversación eterna.** Un visitante que vuelve a los tres meses no debería
  reabrir el hilo de marzo. Cerrar por inactividad (p. ej. 24 h) y empezar una
  conversación nueva.

---

## 5. Orden de trabajo

**Etapa 1 — que funcione de punta a punta.**
Canal `webchat` en la base · `api/webchat.js` con las tres acciones ·
`public/w.js` mínimo (burbuja, panel, enviar, sondear) · rama en
`enviarPorCanal` · icono en el inbox.
*Se da por buena cuando:* un mensaje escrito en una web de prueba aparece en el
inbox, el agente contesta, el lead se crea en el pipeline del canal y el
comercial puede responder desde el inbox y verse en el widget.

**Etapa 2 — que el cliente lo instale solo.**
Alta del canal desde Conversaciones → Canales, con la clave y el snippet para
copiar · elección de agente, cliente y pipeline (ya existe) · dominios
permitidos · apariencia: color, posición, saludo, avatar · un botón de "probar"
que abra el widget contra su propia clave.

**Etapa 3 — los detalles que lo hacen usable.**
Aviso de no leído en la burbuja · sonido · "escribiendo…" · historial al
recargar · fuera de horario con captura de correo · adjuntos (última: obliga a
tocar el espejado de archivos que ya existe para Meta).

---

## 6. Lo que NO entra en la primera versión

Adjuntos, videollamada, co-navegación, traducción automática, chat proactivo por
comportamiento. Todo eso es de la etapa 4 en adelante y ninguno es lo que hace
que un cliente elija Acuarius frente a Sagicc.

---

## 7. Lo que hay que decidir antes de escribir código

1. **¿El visitante se identifica antes de escribir?** Pedir nombre y correo
   antes sube la calidad del lead y baja el número de conversaciones. Mi
   recomendación: **no pedirlo**; que el agente lo pida en la conversación, que
   es justo lo que ya sabe hacer con la calificación.
2. **¿Cuenta contra el cupo de leads del plan?** Un chat web genera muchos más
   contactos que un formulario. Si cada visitante que saluda es un lead, un
   cliente Pro quema sus 1.000 en una semana. Mi recomendación: **el lead se
   crea cuando el agente capta un dato de contacto**, no al primer "hola" —
   la política por canal ya permite exactamente eso (`mode: 'always'` frente a
   esperar la calificación).
3. **¿Se ofrece en el plan Free?** Es el gancho de adquisición más fuerte que
   tendríamos, pero también el que más cuesta en tokens.
