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

> We use `ads_management` for one action only: **pausing** a campaign. Every active
> campaign in the Campaigns tab has a "Pausar" (pause) button, and the Diagnosis tab
> offers the same action when a campaign keeps spending without bringing any lead into
> the user's CRM. The user presses it, confirms, and the campaign is paused in Meta. We
> never activate campaigns, change budgets or delete anything: pausing stops spend, it
> never creates it, and turning a campaign back on is left to the user in Ads Manager.
> Shown in the video on the Campaigns tab.

### business_management

> We use `business_management` to list the business portfolios the user has access to, so
> they can pick which one to connect. Many of our users are agencies whose clients own
> separate portfolios, so without this list they cannot tell which assets belong to which
> client. We only read the list of portfolios and their assets; we do not modify them.

### pages_show_list

> We use `pages_show_list` to show the user the Facebook Pages they administer, so they
> can choose which one to connect to the Acuarius inbox. Only the Pages the user
> explicitly selects are connected.

### pages_read_engagement

> We use `pages_read_engagement` to read the basic identity of the connected Page — name,
> id and profile picture — so the user can see which Page a conversation belongs to inside
> the inbox. This matters for agencies handling several Pages at once.

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

### instagram_manage_messages

> We use `instagram_manage_messages` to receive the direct messages people send to the
> user's Instagram professional account and to send the replies the user writes in our
> inbox, or that an AI agent the user configures and can switch off writes for them.
> This is the same inbox the user already uses for Messenger and WhatsApp. We respect the
> 24-hour messaging window and never send promotional messages outside it. Shown in the
> video when a direct message arrives and is answered from the inbox.

### Cierre común

> Data is shown only to the account owner and the teammates they invite. It is never sold,
> never shared with third parties for advertising, and never used to train AI models. The
> user can revoke access at any time from Settings → Integrations → Disconnect, or from
> their own Facebook security settings; we delete the access token immediately and stop
> receiving data. Our privacy policy describes this in section 5:
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
> The account has no two-factor authentication and no Meta connection, so you can perform
> the connection flow yourself.
>
> **Steps**
> 1. Sign in at https://app.acuarius.app with the credentials above.
> 2. Open Settings (gear icon) → Integrations → Meta Ads → "Conectar con Meta".
> 3. Complete the Facebook login dialog: choose "only current" assets and select one Page,
>    one business portfolio and one Instagram account, then review the requested
>    permissions and press Save. (`business_management`, `pages_show_list`, `instagram_basic`)
> 4. Back in Acuarius the connection is shown with the ad accounts it can see; the user
>    picks which one is active. (`ads_read`)
> 5. Open Marketing → Plataformas de pauta → "Campañas": campaigns of the connected ad
>    account with spend, impressions and clicks, next to their leads in the CRM. (`ads_read`)
> 6. Open the "Diagnóstico" tab: it lists errors and improvement opportunities for those
>    campaigns, each with the numbers behind it. (`ads_read`)
> 7. Back on the "Campañas" tab, press "Pausar" under an active campaign and confirm: the
>    campaign is paused in Meta (the same action appears in Diagnóstico for a campaign
>    that spends without leads). Nothing is ever activated or re-budgeted from Acuarius.
>    (`ads_management`)
> 8. Open Marketing → Fuentes → "Configurar canales". Connect Messenger ("Mi equipo" →
>    the Page) and Instagram ("Mi equipo" → the Instagram account). Connecting subscribes
>    the Page to our webhook. (`pages_show_list`, `pages_manage_metadata`)
> 9. Send a message to the connected Page. It appears in Conversaciones (inbox) with the
>    sender's name; reply from there and the reply is delivered to Messenger.
>    (`pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`)
> 10. Send a direct message to the connected Instagram professional account. It appears in
>    Conversaciones; reply from there and the reply is delivered in Instagram.
>    (`instagram_manage_messages`, `instagram_basic`)
>
> Note on steps 9 and 10: while these permissions are in standard access, Meta only
> delivers messages sent by accounts that have a role on our app (we used an app tester
> and an Instagram tester in the video). Messages from other accounts will not reach the
> inbox until advanced access is granted — which is what this request is for.
> 11. Go back to Settings → Integrations → Disconnect. Access is revoked and the token is
>    deleted.
>
> The interface is in Spanish, which is the language of our market. The video follows
> exactly these steps.

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
