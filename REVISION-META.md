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

## 3. Permisos a solicitar y cómo justificarlos

Uno a uno en **Casos de uso → Personalizar → Permisos → Solicitar acceso avanzado**.
Meta exige la justificación **en inglés** y un video del flujo real.

| Permiso | Para qué lo usa Acuarius |
|---|---|
| `ads_read` | Leer campañas, conjuntos y anuncios de la cuenta publicitaria del cliente para mostrarlos en su panel y para que el agente los analice. |
| `ads_management` | Crear y pausar campañas desde el chat del agente, siempre en pausa hasta que el cliente las active. |
| `business_management` | Listar los portafolios comerciales del cliente para que elija cuál conectar. |
| `pages_show_list` | Mostrarle al cliente sus páginas para que elija cuál conectar al inbox. |
| `pages_read_engagement` | Leer el nombre y los datos básicos de la página conectada. |
| `pages_manage_metadata` | Suscribir la página al webhook; sin esto los mensajes no llegan. |
| `pages_messaging` | Recibir y responder los mensajes de Messenger dentro del inbox de Acuarius. |

Texto base para cada justificación (adaptar el nombre del permiso):

> Acuarius is a marketing platform for small and medium businesses in Latin America.
> After the user connects their own Meta account, we use `PERMISO` to LO_QUE_HACE. The
> data is shown only to the account owner inside their own workspace, is never sold or
> shared with third parties, and is deleted when the user disconnects the integration or
> deletes their account.

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

## 5. Cuenta de prueba para el revisor

Meta necesita entrar. Hay que crear en Acuarius una cuenta real y dejarla con datos:

- Correo y contraseña dedicados, que no caduquen ni tengan 2FA.
- Con un cliente cargado y la conexión de Meta lista de hacer.
- Se entregan en el campo "Instrucciones de prueba" de la solicitud, junto con los pasos
  1-8 escritos.

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
