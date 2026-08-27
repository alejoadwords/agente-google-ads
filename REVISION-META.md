# App Review de Meta — lo que hay que hacer para que cualquier cliente pueda conectar

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
Meta exige la justificación **en inglés**. Los siete van en UNA sola solicitud: enviados
sueltos, cada uno abre su propio ciclo de revisión.

Párrafo común que abre todas (Meta valora que se repita el contexto):

> Acuarius is a marketing and CRM platform for small and medium businesses in Latin
> America. Business owners connect their own Meta assets to manage their advertising and
> customer conversations from a single workspace, assisted by AI agents.

### ads_read

> We use `ads_read` to display the advertising performance of the account the user
> connects: campaigns, ad sets, ads and their metrics (reach, impressions, clicks, spend,
> CPC, CPM and conversions). These are shown in the user's own dashboard and are the input
> our AI agent analyses when the user asks questions such as "why did my cost per result
> go up this week?". Without this permission the product has nothing to show and the agent
> can only speak in generic terms. Seen in the video at the dashboard and agent steps.

### ads_management

> We use `ads_management` so the user can create and pause campaigns from the chat with
> our AI agent, using plain language instead of the Ads Manager interface. **Every campaign
> we create is left PAUSED** and is only delivered if the user activates it themselves in
> Meta. This is a deliberate safety decision: we never spend a user's budget without an
> explicit action from them. Shown in the video when a campaign is created and remains
> paused.

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

### pages_messaging

> We use `pages_messaging` to receive the messages people send to the user's Page and to
> send the replies the user writes in our inbox. Replies are either typed by the user or
> generated by an AI agent that the user configures and can switch off. We respect the
> 24-hour messaging window and never send promotional messages outside it.

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
| 8 | Abrir el panel: campañas reales con impresiones, clics y gasto **distintos de cero** | `ads_read` |
| 9 | Pedirle al agente que analice una campaña; se ve la respuesta con los datos reales | `ads_read` |
| 10 | Crear una campaña desde el chat y mostrar que **queda en pausa** | `ads_management` |
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
> 3. Complete the Facebook login dialog and select a business portfolio, an ad account and
>    a Page. (`business_management`, `ads_read`, `pages_show_list`)
> 4. Back in Acuarius the connected account is shown with its name and id.
> 5. Open the dashboard: campaigns, impressions, clicks, spend, CPC and CPM of the
>    connected ad account are displayed. (`ads_read`)
> 6. Open the chat with the "Meta Ads" agent and ask it to analyse a campaign. The answer
>    uses the real numbers of the connected account. (`ads_read`)
> 7. Ask the agent to create a campaign. It is created **paused** in the connected account
>    and never delivers unless you activate it in Meta. (`ads_management`)
> 8. Send a message to the connected Page from any Facebook account. It appears in
>    Conversaciones (inbox); reply from there and the reply is delivered to Messenger.
>    (`pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`)
> 9. Go back to Settings → Integrations → Disconnect. Access is revoked and the token is
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
3. Grabar el video con una cuenta sin rol.
4. Crear la cuenta de prueba.
5. Enviar los siete permisos **en una sola solicitud**: si se envían sueltos, cada uno
   abre su propio ciclo de revisión.

## Mientras tanto

Certain Pezzano puede arrancar hoy con Google Ads, el CRM, los formularios web, las
campañas de email, las automatizaciones y las propuestas. Lo que queda en pausa hasta que
Meta apruebe es Meta Ads, Messenger, Instagram y WhatsApp.
