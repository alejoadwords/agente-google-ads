# App Review de Meta — lo que hay que hacer para que cualquier cliente pueda conectar

## Estado al 28-09-2026 (comprobado por API)

- **Verificación del negocio: HECHA.** `Acuarius AI` (`1532629158230893`) devuelve
  `verification_status: verified`. Era la puerta: App Review ya acepta la solicitud.
- **Roles en la app: UNO solo** — administradora Johana Muñoz (`10163537285356658`).
  Mientras no pase la revisión, solo ella (o quien tenga rol) puede conectar Meta.
  Para que Alejandro conecte cuentas de clientes ANTES de la revisión, Johana lo
  agrega en developers.facebook.com → app Acuarius → Roles de la app → Administrador.
- **La conexión de prueba funciona**: cuenta demo, los 7 permisos concedidos, token
  sin caducidad (`expires_at: 0`), ve 6 cuentas publicitarias.
- **Datos para el video**: la campaña «Acuarius — Tráfico al sitio (App Review)»
  (`act_1678079940003223`) entregó el 27-08 (2.601 impresiones), se detuvo un mes y
  **volvió a entregar el 28-09**. Dejarla correr 3-5 días antes de grabar: el panel
  usa los últimos 30 días y hoy casi todo cae fuera.
- **Código listo para la revisión** (28-09-2026):
  - el OAuth de Meta va firmado (antes se fiaba del `?userId=` de la URL) y el token
    ya no viaja en la URL de vuelta;
  - el proxy del agente exige sesión, usa el token guardado de la cuenta y **garantiza
    en el servidor** lo que prometemos: todo lo que se crea queda EN PAUSA, nada se
    activa, nada se borra, no se toca el presupuesto de lo que ya existe;
  - desconectar borra el token del servidor y del navegador.
  Pendiente aparte: el navegador todavía guarda una copia del token (igual que con
  Google Ads). No bloquea la revisión, pero conviene sacarlo.

### Llamadas de prueba — 28-09-2026

Con la conexión de pruebas (Johana, cuenta demo) se hizo una llamada correcta por
cada permiso concedido: `pages_show_list` (/me/accounts), `pages_read_engagement`
(página Acuarius AI), `pages_messaging` (conversaciones de Messenger),
`pages_manage_metadata` (leer y re-suscribir la página con los MISMOS campos),
`business_management` (/me/businesses), `ads_read` (insights y campañas),
`ads_management` (renombrar la campaña de App Review con el MISMO nombre: quedó
idéntica y activa). Todas OK. Si el panel pide llamadas en los últimos 30 días,
estas cuentan hasta el 28-10-2026. Faltan las dos de Instagram, cuando se añadan.

### La cuenta del revisor — revisada el 28-09-2026

`acuarius.review@gmail.com` (`user_3HpKaekkDvwRXrweXmEuHpz4hWB`): correo verificado,
entra con contraseña, **sin 2FA**, sin bloqueos, plan Pro de cortesía hasta
08-09-2027, 5 leads y un cliente de muestra, **sin ninguna conexión de Meta** (a
propósito). Se le creó el agente del inbox **«Asistente de prueba»** para que el
revisor pueda conectar Messenger e Instagram sin pasar por el asistente de creación.

### RESUELTO (28-09-2026): `ads_management` se justifica con «Pausar campaña»

Alejandro eligió construir un **Diagnóstico** en Plataformas de pauta. Justifica
`ads_read` (campañas y hallazgos) y `ads_management` (pausar una campaña que gasta sin
traer leads, con confirmación). Para el video hace falta que la cuenta tenga una
campaña que dispare ese hallazgo: una campaña de LEADS con gasto y sin leads en el CRM
(una de tráfico no cuenta: su objetivo no son leads).

### (Histórico) BLOQUEO: los agentes de chat están apagados

Las instrucciones y el guion usan el **agente de Meta Ads** (analizar y crear una
campaña), pero los agentes de marketing están apagados para todos desde el
17-09-2026 (`window.AGENTES_ACTIVOS = false`). Consecuencias:

- `ads_read` **se puede demostrar sin el agente**: Marketing → Plataformas de pauta
  enseña las campañas de Meta con sus métricas, calculadas en el servidor.
- `ads_management` **no tiene hoy ninguna pantalla que lo use**: crear, pausar o
  activar campañas de Meta solo existe dentro del chat del agente, y Plataformas de
  pauta es de solo lectura. Pedir un permiso que el producto no usa es rechazo casi
  seguro.

Tres salidas (decide Alejandro):
1. **Pedir ahora sin `ads_management`** y añadirlo cuando haya una función que lo use.
   Lo más rápido y lo que menos riesgo tiene de rechazo.
2. **Añadir «Pausar campaña» en Plataformas de pauta** (solo pausar: pausar no gasta
   dinero). Es una función útil y justifica `ads_management` con algo real.
3. **Encender el agente de Meta Ads** (solo para esta cuenta o para todos).

Hasta decidir, las instrucciones de prueba (sección 5) y el guion hay que cambiarlos:
el panel de datos va por **Marketing → Plataformas de pauta**, y los mensajes por
**Conversaciones** con el «Asistente de prueba».

### Estado al 02-10-2026

- **Datos para el video: LISTOS.** La campaña entrega desde el 28-09 sin parar; en 30
  días 5.845 impresiones, 487 clics, 233 visitas, $35.860 COP (comprobado por API).
- **`ads_management` ya no necesita una campaña de leads**: desde el 02-10-2026 cada
  campaña activa de Campañas tiene su botón «Pausar». El video pausa la de tráfico y
  luego se reactiva a mano en el Administrador de anuncios.
- La cuenta del revisor sigue sin conexión de Meta (comprobado).
- Las llamadas de prueba del 28-09 valen hasta el **28-10-2026**: enviar antes.

### Lo que falta, en orden

1. **Johana agrega a Alejandro como administrador** de la app (si quiere conectar
   Certain & Pezzano ya, sin esperar la revisión).
2. **Esperar 3-5 días** a que la campaña de Acuarius acumule datos.
3. **Grabar el video** con el guion de `GUION-VIDEO-META.md`, con una cuenta que SÍ
   tenga rol (sección 4).
4. **Poner la contraseña** de `acuarius.review@gmail.com` en las instrucciones de
   prueba (sección 5) y comprobar que esa cuenta sigue sin conexión de Meta.
5. **Enviar los NUEVE permisos en UNA solicitud** con los textos de la sección 3 (los siete de
   siempre + `instagram_basic` e `instagram_manage_messages`).
6. (Menor) cambiar la categoría de la app de *Utilidades* a *Negocios y páginas*.

### Instagram Direct: cómo añadir el permiso (lo hace Johana en el panel)

Comprobado contra Meta el 28-09-2026: leer los mensajes de Instagram de una página
devuelve `(#230) Requires instagram_manage_messages permission`. Las cuentas de
Instagram ligadas a las páginas SÍ se ven; solo falta ese permiso. La configuración
de inicio de sesión **no se puede editar por API**, así que va a mano:

1. developers.facebook.com → app **Acuarius** → **Casos de uso** → el de Instagram
   (mensajes) → **Personalizar** → **Permisos**: añadir `instagram_basic` e
   `instagram_manage_messages`. En acceso estándar funcionan para quien tenga rol.
2. **Inicio de sesión con Facebook para empresas → Configuraciones** → la
   configuración `1570497151241728` → **Editar** → marcar los dos permisos → Guardar.
   Si Meta crea una configuración NUEVA con otro ID, hay que poner ese ID en la
   variable de Vercel `META_LOGIN_CONFIG_ID` y redesplegar.
3. En cada cuenta de Instagram que se vaya a conectar, desde la app de Instagram:
   **Configuración → Mensajes → Herramientas conectadas → Permitir acceso a los
   mensajes**. Sin eso Meta tampoco entrega los directos.
4. En Acuarius: Configuración → Integraciones → Meta Ads → **Desconectar y volver a
   conectar**, para aceptar los permisos nuevos. Después, conectar el canal de
   Instagram en el agente.

Acuarius ya lo comprueba al conectar el canal: si falta el permiso o el interruptor
de Instagram, lo dice y no crea un canal que parecería vivo y estaría sordo.

### Ojo: WhatsApp NO está en la lista

- **Instagram Direct**: la configuración de inicio de sesión (`1570497151241728`)
  concede `pages_*`, `ads_*` y `business_management`, pero **no**
  `instagram_basic` ni `instagram_manage_messages`. Sin ellos los mensajes
  directos de Instagram no llegan al inbox aunque la página esté conectada.
  Hay que añadirlos a la configuración y a la solicitud de revisión.
- **WhatsApp** va por su propia configuración (`META_WA_CONFIG_ID`, registro
  insertado) y pide `whatsapp_business_management` y
  `whatsapp_business_messaging`. Para números de CLIENTES hacen falta en acceso
  avanzado —y Meta suele exigir figurar como proveedor de tecnología—: van en la
  misma solicitud o en una propia.
- En acceso estándar, Messenger e Instagram solo intercambian mensajes con
  personas que tengan ROL en la app: sirven para probar escribiendo desde una
  cuenta con rol, no para atender a clientes reales hasta aprobar.

### Código (28-09-2026, segunda pasada)

El token de Meta ya **no vive en el navegador**: el servidor usa el guardado y
el navegador solo sabe si hay conexión (`meta-ads?action=status`). Al arrancar,
se borra cualquier token que un navegador tuviera guardado de antes. También se
firmó el inicio de la conexión de WhatsApp (cuenta, agente y cliente dentro de
la firma). Google Ads y LinkedIn todavía dan su token al navegador.

---


**Por qué.** Los permisos que pide Acuarius están en **acceso estándar**. En ese nivel
Meta solo deja usarlos a quien tenga un rol en la app (admin, desarrollador, tester).
A cualquier otra persona le corta el inicio de sesión con "Función no disponible… estamos
actualizando otros detalles de la app". Para que conecte cualquier cliente hace falta
**acceso avanzado**, y eso pasa por App Review + verificación del negocio.

Datos de la app: **Acuarius**, ID `1384484453644299`, config de login para empresas
`1570497151241728`, dominio `acuarius.app`.

---

## 1. Verificación del negocio (es la puerta de todo)

Sin esto, App Review ni siquiera acepta la solicitud de los permisos de negocio.

En **business.facebook.com → Configuración del negocio → Centro de seguridad →
Verificación del negocio**. Piden:

- Nombre legal, dirección y teléfono de la empresa, **exactamente como aparecen** en el
  documento oficial. Cualquier diferencia (una abreviatura, un "S.A.S." que falta) es
  motivo de rechazo.
- Documento: certificado de existencia y representación legal de Cámara de Comercio, o
  el RUT. Con fecha reciente.
- Verificación del dominio `acuarius.app` (se hace con un registro DNS TXT o un meta tag).
- Confirmación por teléfono o correo del dominio de la empresa — usa `ceo@acuarius.app`,
  que ya es el correo de contacto de la app.

Plazo típico: de 2 a 10 días hábiles. Si rechazan, dicen el motivo y se puede reenviar.

## 2. Huecos de configuración — revisado por API el 26-08-2026

Casi todos estaban ya tapados. Estado real, comprobado contra la Graph API:

| | Estado |
|---|---|
| Dominios de la app | `["acuarius.app"]` ✅ |
| Página del portafolio | Acuarius AI (`1063964316799074`), publicada, fijada como `primary_page` ✅ |
| Sector del portafolio | `TECHNOLOGY` ✅ (estaba en `NOT_SET`) |
| Privacidad / términos / eliminación de datos | Puestos y respondiendo ✅ |
| Correo de contacto de la app | `ceo@acuarius.app` ✅ |
| Política de privacidad nombra Meta | Sí — sección 5 dedicada a Facebook, Instagram y WhatsApp ✅ |
| Página suscrita al webhook | `messages`, `messaging_postbacks` ✅ |
| Verificación del dominio | `acuarius.app` verificado en el portafolio ✅ |

Queda **una sola cosa menor**: la app está en categoría *Utilidad y productividad*;
para Marketing API encaja mejor *Negocios y páginas*. No es bloqueante.

## 3. Permisos: los textos que se pegan en el formulario

Uno a uno en **Casos de uso → Personalizar → Permisos → Solicitar acceso avanzado**.
Meta exige la justificación **en inglés**. Los nueve van en UNA sola solicitud: enviados
sueltos, cada uno abre su propio ciclo de revisión.

Párrafo común que abre todas (Meta valora que se repita el contexto):

> Acuarius is a marketing and CRM platform for small and medium businesses in Latin
> America. Business owners connect their own Meta assets to manage their advertising and
> customer conversations from a single workspace, assisted by AI agents.

### ads_read

> We use `ads_read` to show the advertising performance of the ad account the user
> connects, in Marketing → Ad platforms: each campaign with its spend, impressions and
> clicks, next to what happened with those leads inside the user's CRM (how many arrived,
> how many were won, the real cost per lead). The same data powers the "Diagnosis" tab,
> which flags campaigns that are active but not delivering, ads that were rejected, a cost
> per lead far above the account average, a low click-through rate or a high frequency.
> Without this permission the screen has nothing to show. Seen in the video on the
> Campaigns and Diagnosis tabs.

### ads_management

> We use `ads_management` for two actions only, and both reduce spend: pausing a campaign
> and lowering a campaign's daily budget (by 1 % to 50 %). Every active campaign in the
> Campaigns tab has a "Pausar" (pause) button: the user presses it, confirms, and the
> campaign is paused in Meta. The same two actions can be proposed by our AI analyst or
> by an automatic rule that the user creates and switches on (for example, "pause a
> campaign that spends more than X without bringing any lead into the CRM"); proposals
> wait for the user's approval, and the user can turn any rule off at any time. We never
> activate campaigns, never raise budgets, never create ads and never delete anything:
> turning a campaign back on or increasing its budget is left to the user in Ads Manager.
> Shown in the video on the Campaigns tab, where a campaign is paused and then appears
> paused in Ads Manager.

### business_management

> We use `business_management` to list the business portfolios the user has access to, so
> they can pick which one to connect. Many of our users are agencies whose clients own
> separate portfolios, so without this list they cannot tell which assets belong to which
> client. We only read the list of portfolios and their assets; we do not modify them.
> Shown in the video in the Facebook dialog, where only the user's own portfolio is selected.

### pages_show_list

> We use `pages_show_list` to show the user the Facebook Pages they administer, so they
> can choose which one to connect to the Acuarius inbox. Only the Pages the user
> explicitly selects are connected. Shown in the video in the Facebook dialog ("only
> current Pages", one Page selected) and again when connecting Messenger in Marketing →
> Fuentes → "Configurar canales", where the user picks the Page from that list.

### pages_read_engagement

> We use `pages_read_engagement` to read the basic identity of the connected Page — name,
> id and profile picture — so the user can see which Page a conversation belongs to inside
> the inbox. This matters for agencies handling several Pages at once. We also read the
> name of the person who writes to the Page, from the Page's conversations, so the inbox
> shows who the message is from instead of a numeric id. Shown in the video in the
> connected channels and in each conversation of the inbox (the Messenger conversation
> appears with the sender's name).

### pages_manage_metadata

> We use `pages_manage_metadata` to subscribe the connected Page to our webhook. This is a
> technical requirement: without the subscription Meta does not deliver message events to
> us and the inbox stays empty. We only subscribe and unsubscribe the Page the user chose;
> we do not change any other Page setting. When the user disconnects, we unsubscribe.
> Shown in the video when the user connects Messenger and Instagram in Marketing → Fuentes
> → "Configurar canales", right before the first message arrives.

### pages_messaging

> We use `pages_messaging` to receive the messages people send to the user's Page and to
> send the replies the user writes in our inbox. Replies are either typed by the user or
> generated by an AI agent that the user configures and can switch off. We respect the
> 24-hour messaging window and never send promotional messages outside it. Shown in the
> video when a Messenger message arrives in the inbox and the reply is delivered.

### instagram_basic

> We use `instagram_basic` to read the identity of the Instagram professional account
> linked to the Page the user connects — its id, username and profile picture — so the
> user can pick it and see, inside the inbox, which account a conversation belongs to.
> We also read the profile name of the person who writes, so the conversation shows who
> they are. Shown in the video when connecting Instagram and when the direct message
> arrives in the inbox with the sender's name.

### instagram_manage_messages

> We request this permission on behalf of other Instagram business accounts: our customers
> are businesses that connect their own Instagram professional accounts to Acuarius, and
> we process their messages only to run their inbox. We do not use it for an account of our own.
>
> We use `instagram_manage_messages` to receive the direct messages people send to the
> user's Instagram professional account and to send the replies the user writes in our
> inbox, or that an AI agent the user configures and can switch off writes for them.
> This is the same inbox the user already uses for Messenger and WhatsApp. We respect the
> 24-hour messaging window and never send promotional messages outside it. Shown in the
> video when a direct message arrives and is answered from the inbox.

### Cierre común

> Data is shown only to the account owner and the teammates they invite. It is never sold,
> never shared with third parties for advertising, and never used to train AI models. The
> user can revoke access at any time: disconnecting Meta in Settings → Integrations deletes
> its access token, and disconnecting a Page or Instagram account in Marketing → Fuentes →
> "Configurar canales" deletes its token and unsubscribes the Page from our webhook. Access
> can also be removed from the user's own Facebook settings. Our privacy policy describes
> how we handle data received from Meta in section 5 ("Datos que recibimos de Meta"):
> https://app.acuarius.app/privacy.html

## 4. El video de demostración (lo que más rechazos causa)

### La corrección importante

El plan original decía *"grabar desde una cuenta que no tenga ningún rol en la app"*.
**Eso es imposible y contradictorio**: mientras los permisos estén en acceso estándar,
una cuenta sin rol ve *"Función no disponible"* y el flujo no arranca. Es justo el
problema que estamos intentando resolver.

Lo correcto es grabar **con una cuenta que sí tenga rol** (admin o tester) y explicarlo
en las instrucciones de prueba. El revisor sabe que el acceso estándar limita a los
roles; lo que quiere ver es **cómo usa el producto cada permiso**, no que funcione
para el público — eso es precisamente lo que va a conceder.

### El bloqueo real: no hay datos que enseñar

Comprobado por API el 26-08-2026: **ninguna de las 6 cuentas publicitarias visibles
tiene actividad en los últimos 90 días**. `insights` con `date_preset=last_90d`
devuelve vacío en todas, incluida la de Acuarius (`act_1678079940003223`), que además
no tiene ni una campaña creada.

Un video donde el panel de métricas sale en cero es un rechazo casi seguro: el revisor
no puede comprobar que `ads_read` haga algo. **Antes de grabar hay que generar datos
reales**: una campaña pequeña en la cuenta de Acuarius, con presupuesto mínimo, dejada
correr 3-5 días. Es el mismo bloqueo que tiene parados los videos 9 y 10 de la Academia,
así que una sola campaña destraba las dos cosas.

Messenger, en cambio, **sí se puede grabar hoy**: la página Acuarius AI ya está suscrita
al webhook de la app (`messages`, `messaging_postbacks`), así que basta escribirle desde
otra cuenta de Facebook y el mensaje entra al inbox.

### Guion de rodaje

**El guion completo, escena por escena y con los nombres reales de las pantallas,
está en `GUION-VIDEO-META.md`.** Aquí queda el resumen de qué justifica cada paso.

Un solo video, sin cortes, con el cursor visible y sin audio necesario. Grabar en
pantalla completa, sin pestañas ni marcadores que enseñen cuentas de clientes.

| # | Qué se ve | Qué permiso justifica |
|---|---|---|
| 1 | Entrar a `app.acuarius.app` e iniciar sesión con la cuenta de prueba | contexto |
| 2 | Configuración → Integraciones → Meta Ads → **Conectar con Meta** | contexto |
| 3 | El diálogo de Meta: **leer en voz alta / detenerse** en la lista de permisos que se piden | todos |
| 4 | Elegir portafolio comercial | `business_management` |
| 5 | Elegir cuenta publicitaria de la lista | `ads_read` |
| 6 | Elegir las páginas a conectar | `pages_show_list` |
| 7 | Volver a Acuarius: la cuenta aparece conectada, con su nombre e ID | contexto |
| 8 | Abrir el agente **Meta Ads**: el panel de campañas se carga solo dentro del chat, con impresiones, clics y gasto **distintos de cero** | `ads_read` |
| 9 | Pedirle al agente que analice una campaña; se ve la respuesta con los datos reales | `ads_read` |
| 10 | Pausar una campaña desde Campañas («Pausar») y mostrarla **en pausa** en el Administrador de anuncios | `ads_management` |
| 11 | Conversaciones → llega un mensaje real de Messenger y se responde desde el inbox | `pages_messaging`, `pages_manage_metadata` |
| 12 | Mostrar el nombre y la foto de la página conectada en el inbox | `pages_read_engagement` |
| 13 | Integraciones → **Desconectar**, y mostrar que el acceso desapareció | control del usuario |

El paso 13 pesa más de lo que parece: demuestra que el cliente manda sobre su propio
acceso, que es lo que Meta quiere ver en cualquier integración de terceros.

## 5. Instrucciones de prueba (campo "Instrucciones de prueba")

Cuenta verificada el 27-08-2026: plan Pro, contraseña propia, **sin 2FA**, un cliente
cargado y 5 leads. Sin ninguna conexión de plataforma a propósito — el revisor tiene que
hacer la conexión él mismo, que es lo que se está revisando.

Texto para pegar (en inglés):

> **Test account**
> URL: https://app.acuarius.app
> Email: acuarius.review@gmail.com
> Password: [PONER LA CONTRASEÑA]
> The account has no two-factor authentication. Meta Ads is disconnected so you can perform
> the connection flow yourself. The Page "Acuarius AI" and its Instagram account
> @acuarius.app are already connected as Messenger and Instagram channels, so you can test
> messaging without connecting a Page of your own.
>
> **Ads (business_management, ads_read, ads_management, pages_show_list)**
> 1. Sign in at https://app.acuarius.app with the credentials above.
> 2. Open Settings (gear icon) → Integrations → Meta Ads → "Conectar con Meta" and complete
>    the Facebook dialog: choose "only current" assets, select one business portfolio, one
>    Page and one Instagram account, review the permissions and press Save.
> 3. Back in Acuarius, pick the active ad account. Then open Marketing → Plataformas de pauta →
>    "Campañas": campaigns with spend, impressions and clicks, next to their leads in the CRM.
> 4. "Diagnóstico" tab: errors and opportunities for those campaigns, with the numbers behind.
> 5. Back on "Campañas", press "Pausar" under an active campaign and confirm: it is paused in
>    Meta. Nothing is ever activated or re-budgeted upwards from Acuarius.
>
> **Messaging (pages_manage_metadata, pages_messaging, pages_read_engagement, instagram_basic,
> instagram_manage_messages)**
> 6. Marketing → Fuentes → "Configurar canales" → "Mis canales" shows Messenger and Instagram
>    connected. Connecting a channel ("+ Conectar" → "Mi equipo" → choose the Page or account)
>    subscribes the Page to our webhook.
> 7. While the app is in standard access, Meta only delivers messages from accounts with a role
>    on the app. From a Facebook account with the Tester role, send a message to
>    https://m.me/1063964316799074; from an Instagram account with the Instagram Tester role,
>    send a direct message to @acuarius.app.
> 8. Open "Conversaciones": each message appears with the sender's name and the network icon.
>    Open it, type a reply and press "Enviar": it is delivered in Messenger or Instagram.
> 9. Settings → Integrations → Meta Ads → "Desconectar cuenta" revokes access and deletes the
>    token.
>
> The interface is in Spanish, the language of our market. The video follows these steps.

**Notas nuestras, no van en el formulario:**

- La contraseña la pone Alejandro; no dejar el campo con el marcador.
- Si Meta pide un segundo revisor o vuelve a preguntar, **no crear otra cuenta**: reusar
  esta y borrarle la conexión de Meta antes de reenviar, para que el flujo vuelva a
  empezar desde cero.

## 6. Orden recomendado

1. Verificación del negocio (lo más lento — empezar por aquí).
2. Tapar los huecos del punto 2, incluida la política de privacidad.
3. Grabar el video **con una cuenta que SÍ tenga rol** (ver sección 4: sin rol es
   imposible mientras los permisos estén en acceso estándar). Guion de rodaje
   paso a paso en `GUION-VIDEO-META.md`.
4. Crear la cuenta de prueba.
5. Enviar los nueve permisos **en una sola solicitud**: si se envían sueltos, cada uno
   abre su propio ciclo de revisión.

## Mientras tanto

Certain Pezzano puede arrancar hoy con Google Ads, el CRM, los formularios web, las
campañas de email, las automatizaciones y las propuestas. Lo que queda en pausa hasta que
Meta apruebe es Meta Ads, Messenger, Instagram y WhatsApp.

## 7. Segunda solicitud: publicar desde el Studio (preparada el 08-10-2026)

**Qué es.** Publicar los posts del Studio Social en Instagram y en páginas de Facebook.
El código está terminado y probado (`api/social-connect.js`, `social-callback.js`,
`social-publish.js`, `social-media-subida.js`; en `app.js`, `openPublishModal` y
`publishPostNow`), pero **apagado para los clientes**: `window.PUBLICAR_DIRECTO = false`
en `public/index.html`. El equipo de Acuarius (`isAdminUser`) lo ve igual, para probarlo.

Necesita dos permisos que la solicitud del 06-10 **no** pidió: `pages_manage_posts` e
`instagram_content_publish`. Los otros que usa (`pages_show_list`,
`pages_read_engagement`, `instagram_basic`, `business_management`) ya van en la primera.

### Lo que hace Johana en el panel (antes de grabar)

1. **Casos de uso → Personalizar → Permisos**: añadir `pages_manage_posts` e
   `instagram_content_publish` (en acceso estándar funcionan para quien tenga rol).
2. **Inicio de sesión con Facebook para empresas → Configuraciones → Crear**: una
   configuración NUEVA, aparte de la de Meta Ads (`1570497151241728`), llamada
   «Acuarius — publicar». Tipo de token: **usuario**. Activos: **Páginas** e
   **Instagram**. Permisos: `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`,
   `business_management`. Copiar el id que da.
3. Ese id va en Vercel como **`META_SOCIAL_CONFIG_ID`** (lo pongo yo por API). Sin él,
   `social-connect` pide los permisos por `scope`, que solo funciona para quien tiene rol.
4. La URI de redirección `https://app.acuarius.app/api/social-callback` tiene que estar en
   **Inicio de sesión con Facebook → Configuración → URI de redireccionamiento de OAuth
   válidos** (la de Meta Ads es otra: `/api/meta-callback`).

### Textos para el formulario (en inglés)

#### pages_manage_posts

> We use `pages_manage_posts` to publish the posts the user prepares in Acuarius' content
> calendar (Marketing → Studio Social) to the Facebook Page they connected. The user writes
> or generates the copy and image of each post, opens it, presses "Publish", chooses the
> Page and confirms. We publish a photo, several photos, a video or a text post, exactly as
> the user prepared it, and show the link to the published post. We never publish
> without that explicit action by the user, and we do not edit or delete existing posts.
> Shown in the video: connecting the Page, then publishing one post from the calendar and
> opening the published post on Facebook.

#### instagram_content_publish

> We use `instagram_content_publish` to publish the posts the user prepares in Acuarius'
> content calendar to the Instagram professional account linked to their Facebook Page:
> single images, carousels (2 to 10 images), reels and stories. The user opens the post,
> presses "Publish", picks the Instagram account and confirms; we create the media
> container, wait until Instagram finishes processing it and publish it, then show the
> link to the post. Nothing is published without that explicit action. Shown in the
> video: publishing one image post and opening it on Instagram.

### Guion del video (2-3 minutos, cuenta sin rol en la app)

1. Entrar a app.acuarius.app → Marketing → Studio Social. Se ve el calendario con posts.
2. «Conectar redes» → «Conectar con Facebook» → diálogo de Meta: elegir UNA página y su
   Instagram, dejar todos los permisos marcados → volver: modal «Instagram y Facebook
   conectados» con la página y la cuenta de Instagram.
3. Abrir un post con imagen → «Publicar» → se ven marcadas Instagram y Facebook con su
   cuenta → «Publicar ahora» → «Instagram está procesando la publicación…» →
   «¡Post publicado!» con «Ver publicación» en cada red.
4. Pulsar «Ver publicación» de Instagram y de Facebook: el post en vivo, con el mismo texto
   e imagen.
5. Volver al post: «Publicado en Instagram ↗ · Facebook ↗».

### Al aprobarse

1. `window.PUBLICAR_DIRECTO = true` en `public/index.html` (y la copia de la raíz).
2. Entrada en `public/novedades.json` anunciando la publicación directa.
3. Repasar los textos que hoy dicen «descarga y publica»: están condicionados a la misma
   bandera (barra del Studio y Academia), así que cambian solos.
