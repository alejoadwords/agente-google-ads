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

## 2. Huecos de configuración que hay que tapar antes de enviar

Detectados en el panel el 12-08-2026:

- **Administrador de dominios vacío** ("No se establecieron dominios para esta app").
  Añadir `acuarius.app`. Configuración de la app → Avanzada → Administrador de dominios.
- **Página de la app sin asignar**. Meta pide una página de Facebook asociada; el nombre
  de la página debe contener "Acuarius".
- **La política de privacidad no nombra a Facebook, Instagram ni WhatsApp**, ni explica
  qué datos se traen de cada uno. El revisor la lee. Hay que añadir una sección que diga,
  con esas palabras: qué datos de Meta se leen (campañas y métricas de la cuenta
  publicitaria, mensajes de las páginas de Facebook e Instagram), para qué se usan, cuánto
  se conservan y cómo se eliminan.
- La app aparece con **categoría "Utilidad y productividad"**; para Marketing API encaja
  mejor "Negocios y páginas". No es bloqueante, pero evita preguntas.

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

Un solo video, sin cortes, con el cursor visible, mostrando el flujo completo desde una
cuenta que **no tenga ningún rol en la app**:

1. Entrar a app.acuarius.app e iniciar sesión.
2. Configuración → Integraciones → Meta Ads → Conectar con Meta.
3. El diálogo de Meta: elegir portafolio, cuenta publicitaria y páginas.
4. Volver a Acuarius y mostrar la cuenta ya conectada.
5. Abrir el panel con las métricas reales de esa cuenta (esto justifica `ads_read`).
6. Pedirle al agente que analice una campaña (justifica el uso de los datos).
7. Conversaciones → mostrar un mensaje real llegando desde Messenger (justifica
   `pages_messaging` y `pages_manage_metadata`).
8. Volver a Integraciones y **desconectar**, para demostrar que el cliente controla el acceso.

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
