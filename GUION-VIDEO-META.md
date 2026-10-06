# Guion de rodaje — video para App Review de Meta

Para seguir mientras grabas. Los nombres de botones y pestañas son los reales de
la aplicación, comprobados contra el código el 08-09-2026.

**Un solo video, una sola toma, sin cortes, 4-6 minutos.** El revisor no busca
producción: busca ver **cada permiso haciendo algo**. Un corte en medio le hace
sospechar que se saltó un paso.

---

## Antes de pulsar grabar

### Lo único que puede tumbar el video

**Que el panel de métricas salga en ceros.** Si `ads_read` no enseña números, el
revisor no puede comprobar que el permiso sirva para algo, y eso es rechazo casi
seguro.

**Compruébalo primero, sin grabar**: entra a Acuarius con la cuenta que tiene
Meta conectado, ve a **Marketing → Plataformas de pauta → Campañas** y mira que
la campaña de Meta traiga inversión, impresiones y clics distintos de cero. (El
agente Meta Ads está apagado desde el 17-09-2026: el panel ya no está ahí.)

**Comprobado por API el 05-10-2026**: «Acuarius — Tráfico al sitio (App Review)»
activa y entregando; en los últimos 7 días 11.780 impresiones, 991 clics y
$67.112 COP (ayer, $12.283). El panel NO sale en ceros. La cuenta de prueba
`acuarius.review@gmail.com` no tiene Meta conectado: la única conexión de Meta
es la de Alejandro.

### Preparación

- [ ] **Facebook abierto con la sesión de Johana** en el navegador donde grabas.
      Es la única cuenta con rol en la app: con cualquier otra, Meta muestra
      «Función no disponible» en el paso 3 (le pasó a Alejo el 02-10-2026).
- [ ] **Permisos de Instagram listos** (ver `REVISION-META.md`): añadidos en el
      panel y «Permitir acceso a los mensajes» activado en la cuenta de
      Instagram. Si no están, la escena 11 bis falla: grabar igual sin ella y
      pedir esos dos permisos en una segunda solicitud.
- [ ] **La cuenta de prueba sin conexión de Meta.** `acuarius.review@gmail.com`
      no debe tener ninguna cuenta de Meta conectada: el revisor tiene que verte
      hacer la conexión desde cero. Si ya la tiene, entra y pulsa *Desconectar
      cuenta* antes de grabar. Tampoco debe tener **canales de Messenger ni
      Instagram** en Fuentes de leads → Configurar canales: se conectan en el
      video (escena 10 bis). Y en Facebook de Johana, Configuración →
      Integraciones comerciales → **quitar Acuarius**, para que el diálogo pida
      los permisos desde cero (si no, arrastra los que se dieron antes).
- [ ] **Contraseña puesta** en `REVISION-META.md`, que va en el formulario.
- [ ] **Navegador limpio**: ventana nueva o perfil aparte. Sin barra de
      marcadores —la tuya tiene carpetas con nombres de clientes— y sin más
      pestañas abiertas.
- [ ] **Pantalla completa a 1920×1080.** Nada de ventanas a medias.
- [ ] **Un segundo dispositivo o navegador** con otra cuenta de Facebook, para
      escribirle a la página Acuarius AI por Messenger e Instagram (escenas 11 y
      11 bis). **Esa cuenta necesita rol de tester en la app**: mientras no se
      apruebe la revisión, Meta solo entrega mensajes de personas con rol. Johana
      la invita en developers.facebook.com → app Acuarius → Roles de la app, y
      hay que aceptar la invitación antes de grabar. **Para Instagram es otro
      rol**: «Evaluador de Instagram» para la cuenta que manda el DM
      (marketing.digital.con.alejo, aceptada el 05-10-2026). La invitación no
      sale en la app del teléfono: se acepta en la web, en
      instagram.com/accounts/manage_access → Invitaciones de evaluador. Sin
      ese rol Meta no entrega el DM y el inbox se queda vacío sin ningún error.
- [ ] Cerrar Slack, correo y todo lo que pueda sacar una notificación encima.

### Ajustes

- **Sin audio**: Meta no lo exige y una narración mala distrae. El video se
  entiende con las Instrucciones de prueba, que dicen lo mismo por escrito.
- **Cursor visible.** Es lo que guía al revisor.
- **Sin acelerar.** Un video a 2× se lee como que escondes algo. Si una carga
  tarda, espera: son tres segundos.
- La interfaz **en español** está bien. Lo dice el texto de las instrucciones.

---

## Escena por escena

Los tiempos son orientativos; lo importante es el orden y que cada pantalla se
vea entera antes de pasar.

### 1 · Entrar (0:00 – 0:20)

Ir a `app.acuarius.app`, escribir el correo `acuarius.review@gmail.com` y la
contraseña, entrar.

> **Detente 2 segundos en la pantalla de inicio ya cargada.** Que se vea que es
> un producto real con datos, no una maqueta.

### 2 · Ir a la integración (0:20 – 0:35)

Icono del engranaje → pestaña **Integraciones** → bajar hasta la tarjeta **Meta
Ads** (la del icono azul de Facebook, que dice *Facebook e Instagram Ads*).

> Fíjate en que la insignia de la derecha diga **«sin conectar»**. Es la prueba
> de que empiezas de cero.

### 3 · Lanzar la conexión (0:35 – 0:50)

Pulsar **Conectar con Meta →**.

> Cuando se abra el diálogo de Facebook, **detente 4 o 5 segundos en la lista de
> permisos** sin hacer nada. Esta es la pantalla que más mira el revisor: quiere
> ver que le pides al usuario exactamente lo que declaraste. No la pases rápido.

### 4 · Elegir portafolio comercial (0:50 – 1:05)

Seleccionar el portafolio en la lista y continuar.

> **Justifica `business_management`.** Deja que se vea la lista completa antes de
> elegir: eso demuestra por qué necesitas listarlos.

### 5 · Elegir cuenta publicitaria (1:05 – 1:20)

Seleccionar la cuenta publicitaria **Acuarius** (`1678079940003223`): es la que
tiene la campaña con datos.

> **Justifica `ads_read`.** Igual: que se vea la lista.

### 6 · Elegir la página (1:20 – 1:35)

En «Elige los Páginas a los que quieres que acceda Acuarius» marcar **«Activar
solo los Páginas actuales»** (no «todos los actuales y futuros»), seleccionar
solo **Acuarius AI** y seguir. Lo mismo en la pantalla de Instagram: solo
**@acuarius.app**.

Al final sale **«Revisa la solicitud de acceso de Acuarius»** con los nueve
permisos: detente ahí, baja despacio hasta el final para que se lean todos, y
pulsa **Guardar**.

> **Justifica `pages_show_list`.** Marca solo la página que vas a usar, no todas:
> refuerza que conectas únicamente lo que el usuario elige.

### 7 · Volver a Acuarius (1:35 – 1:55)

Vuelve solo a Ajustes → Integraciones.

> Que se vea la tarjeta de Meta Ads ya **conectada, con el nombre y el
> identificador de la cuenta**. Detente 3 segundos.

### 8 · Las campañas con datos reales (1:55 – 2:30)

Ir a **Marketing → Plataformas de pauta → Campañas**. Se ven las campañas de la
cuenta de Meta conectada con su inversión, impresiones y clics, y al lado lo que
pasó con esos leads en el CRM.

> **Justifica `ads_read`.** Las cifras tienen que ser distintas de cero: por eso
> se graba después de 3-5 días de campaña entregando.

### 9 · El diagnóstico (2:30 – 3:10)

Pestaña **Diagnóstico**. Señalar con el cursor el resumen (errores,
oportunidades, lo que funciona) y abrir uno o dos hallazgos para que se lean sus
números.

> **Justifica `ads_read`**: es lectura de campañas, anuncios y estado de la cuenta.

### 10 · Pausar una campaña (3:10 – 4:00)

Volver a la pestaña **Campañas**. En la fila de «Acuarius — Tráfico al sitio (App
Review)», debajo de «Activa», pulsar **Pausar**. Aparece la ventana de
Acuarius **«¿Pausar esta campaña?»** (desde el 04-10-2026 ya no es el cuadro gris
del navegador): **detente 2 segundos** para que se lea y pulsa el botón rojo
**Pausar**. Enseña el aviso «Campaña pausada»: la fila pasa a «Pausada». Después,
abrir el **Administrador de anuncios** de Meta y enseñar esa campaña **en pausa**.

> **Justifica `ads_management`.** Desde el 02-10-2026 cada campaña activa de la
> tabla tiene su botón «Pausar» (antes solo salía en el diagnóstico, y solo para
> campañas de leads: la de tráfico no lo disparaba). Poner un texto en pantalla:
> desde Acuarius solo se pausa; nunca se activa ni se cambia el presupuesto.
>
> **Después de grabar, reactivarla** desde el Administrador de anuncios: la
> campaña tiene que seguir entregando para que el revisor vea datos.

### 10 bis · Conectar Messenger e Instagram como canales (4:00 – 4:40)

Conectar Meta Ads **no** deja los mensajes funcionando: da permiso sobre la
página, pero la suscripción de la página a los mensajes la hace este paso. Sin
él, el mensaje de la escena 11 nunca llega.

**Marketing → Fuentes de leads** → en «Canales de chat» pulsar **Configurar
canales**.

1. En **Messenger**, **+ Conectar**. Sale la ventana «¿Quién atiende este
   canal?»: elegir **Mi equipo** (los mensajes van al inbox y respondes tú).
   Luego «¿Qué página de Facebook conectas?»: **Acuarius AI**. Aparece
   «Conectando…» y después «Conectado: Acuarius AI».
2. En **Instagram**, igual: **Mi equipo** y **@acuarius.app**. Aparece
   «Conectado: @acuarius.app».

> **Justifica `pages_manage_metadata` y `pages_show_list`.** La lista de páginas
> sale de `pages_show_list`; al conectar, Acuarius suscribe la página al webhook
> de mensajes con `pages_manage_metadata`. Detente 2 segundos en cada «Conectado».
>
> Si sale un error en rojo, para: no se graba encima. @acuarius.app tiene mucho
> historial y Meta a veces tarda en la lectura de prueba; desde el 05-10-2026 eso
> ya no bloquea la conexión, pero cualquier otro error sí hay que mirarlo.

### 11 · Un mensaje real de Messenger (4:40 – 5:15)

Desde el segundo dispositivo, escribirle a la página **Acuarius AI** por
Messenger algo normal: «Hola, quiero información sobre precios».

Volver a Acuarius → **Conversaciones**. El mensaje entra. Responder desde ahí y
enseñar que la respuesta llega a Messenger en el otro dispositivo.

> **Justifica `pages_messaging` y `pages_manage_metadata`** — sin la suscripción
> de la escena 10 bis el mensaje nunca habría llegado, y eso es exactamente lo
> que se ve.
>
> Enseña **las dos pantallas**: la entrada y la respuesta llegando. Es lo que
> prueba que el ciclo se cierra.

### 11 bis · Un mensaje directo de Instagram (5:15 – 5:45)

Desde el segundo dispositivo, mandarle un **mensaje directo** a la cuenta de
Instagram conectada: «Hola, ¿tienen disponibilidad esta semana?».

Volver a Acuarius → **Conversaciones**. El mensaje entra con el nombre de la
cuenta de Instagram. Responder desde ahí y enseñar que la respuesta llega a
Instagram en el otro dispositivo.

> **Justifica `instagram_manage_messages` e `instagram_basic`.** Antes de grabar:
> los dos permisos añadidos en el panel, la cuenta de Instagram con «Permitir
> acceso a los mensajes» activado, y Meta Ads reconectado para aceptarlos.

### 12 · La identidad de la página (5:45 – 6:00)

En la misma conversación, señalar con el cursor **el nombre y la foto de la
página** conectada.

> **Justifica `pages_read_engagement`.** Es un permiso pequeño y se demuestra en
> cinco segundos, pero si no aparece en el video te lo pueden negar suelto.

### 13 · Desconectar (6:00 – 6:30)

Ajustes → Integraciones → Meta Ads → **Desconectar cuenta**. Que se vea la
tarjeta volviendo a **«sin conectar»**.

> **No es relleno: pesa.** Demuestra que el usuario manda sobre su propio acceso
> y que revocas de verdad. Meta lo valora en cualquier integración de terceros, y
> cierra el video con la idea correcta.

---

## Lo que hace que rechacen un video

- **Métricas en cero.** El motivo número uno.
- **Pasar rápido por el diálogo de permisos.** Si no se ve qué pides, no se
  aprueba lo que pides.
- **No enseñar que la campaña queda en pausa.** Sin eso, `ads_management` es un
  permiso para gastar dinero ajeno.
- **Cortes o saltos.** Levantan la sospecha de que algo no funcionó.
- **Un permiso que no aparece en el video.** Se conceden uno a uno: el que no se
  vea, se cae. Repasa la tabla de abajo antes de dar por bueno el video.
- **Datos de clientes reales a la vista** en marcadores, pestañas o
  notificaciones.

## Repaso antes de enviar

| Permiso | Escena | ¿Se ve? |
|---|---|---|
| `business_management` | 4 | ☐ |
| `ads_read` | 5, 8, 9 (Campañas y Diagnóstico) | ☐ |
| `pages_show_list` | 6, 10 bis (lista de páginas) | ☐ |
| `ads_management` | 10 (**Pausar campaña**) | ☐ |
| `pages_messaging` | 11 | ☐ |
| `pages_manage_metadata` | 10 bis (**conectar el canal**) y 11 | ☐ |
| `pages_read_engagement` | 12 | ☐ |
| `instagram_manage_messages` | 11 bis | ☐ |
| `instagram_basic` | 11 bis | ☐ |

Los nueve van en **una sola solicitud**. Sueltos, cada uno abre su propio ciclo
de revisión y multiplicas la espera por nueve.

## Después de grabar

1. Míralo entero una vez con la tabla de arriba al lado.
2. Súbelo a **YouTube como «oculto»** (no privado — Meta no podría verlo) o
   adjúntalo directamente en el formulario si pesa menos del límite.
3. Los textos de justificación y las Instrucciones de prueba ya están escritos en
   `REVISION-META.md`, sección 3 y 5. **Rellena la contraseña** antes de enviar.
4. Envía los **nueve** permisos juntos, **antes del 28-10-2026** (ese día vencen
   las llamadas de prueba del 28-09).
5. Reactiva la campaña de App Review en el Administrador de anuncios.
