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

**Compruébalo primero, sin grabar**: entra a Acuarius con tu cuenta, abre el
agente **Meta Ads** en la barra lateral y mira si el panel trae impresiones,
clics y gasto distintos de cero. Si sale vacío, para aquí: hay que dejar correr
una campaña con presupuesto mínimo tres o cuatro días antes de grabar. Es el
mismo bloqueo que tienen parados los videos 9 y 10 de la Academia, así que una
sola campaña destraba las dos cosas.

### Preparación

- [ ] **La cuenta de prueba sin conexión de Meta.** `acuarius.review@gmail.com`
      no debe tener ninguna cuenta de Meta conectada: el revisor tiene que verte
      hacer la conexión desde cero. Si ya la tiene, entra y pulsa *Desconectar
      cuenta* antes de grabar.
- [ ] **Contraseña puesta** en `REVISION-META.md`, que va en el formulario.
- [ ] **Navegador limpio**: ventana nueva o perfil aparte. Sin barra de
      marcadores —la tuya tiene carpetas con nombres de clientes— y sin más
      pestañas abiertas.
- [ ] **Pantalla completa a 1920×1080.** Nada de ventanas a medias.
- [ ] **Un segundo dispositivo o navegador** con otra cuenta de Facebook, para
      escribirle a la página Acuarius AI por Messenger en la escena 8.
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

Seleccionar la cuenta publicitaria.

> **Justifica `ads_read`.** Igual: que se vea la lista.

### 6 · Elegir la página (1:20 – 1:35)

Seleccionar la página **Acuarius AI** y terminar el diálogo.

> **Justifica `pages_show_list`.** Marca solo la página que vas a usar, no todas:
> refuerza que conectas únicamente lo que el usuario elige.

### 7 · Volver a Acuarius (1:35 – 1:55)

Vuelve solo a Ajustes → Integraciones.

> Que se vea la tarjeta de Meta Ads ya **conectada, con el nombre y el
> identificador de la cuenta**. Detente 3 segundos.

### 8 · El panel con datos reales (1:55 – 2:30)

Cerrar Ajustes y abrir el agente **Meta Ads** en la barra lateral izquierda. El
panel de campañas se carga solo.

> **Es la escena más importante del video.** Detente 8-10 segundos y **recorre
> con el cursor** las cifras: alcance, impresiones, clics, gasto, CPC, CPM. Que
> se lean. Si hay varias campañas, pasa el cursor por dos o tres.
>
> **Justifica `ads_read`.** Si aquí sale un cero, el video no sirve.

### 9 · El agente analizando (2:30 – 3:10)

En el chat, escribir algo como:

> «Analiza el rendimiento de mis campañas de los últimos 7 días y dime cuál está
> gastando de más.»

Esperar la respuesta completa y **desplazarse por ella despacio**.

> **Justifica `ads_read` otra vez, y mejor.** Aquí se ve que los datos no son
> decorativos: alimentan el producto. Que en la respuesta se reconozcan los
> mismos números del panel.

### 10 · Crear una campaña, que queda en pausa (3:10 – 4:00)

Pedirle al agente que cree una campaña. Cuando muestre el panel de revisión,
confirmarla.

> **Justifica `ads_management`, y es la escena delicada.** No basta con crearla:
> **tienes que enseñar que queda PAUSADA**. Dos formas, haz las dos si puedes:
>
> 1. Que se vea el estado «en pausa» en la confirmación dentro de Acuarius.
> 2. Abrir el Administrador de anuncios de Meta en otra pestaña y enseñar la
>    campaña recién creada **con el estado Desactivada**.
>
> Esto es lo que le dice al revisor que no vas a gastarle el presupuesto a nadie
> sin que lo active. Es el argumento que sostiene todo el permiso.

### 11 · Un mensaje real de Messenger (4:00 – 4:45)

Desde el segundo dispositivo, escribirle a la página **Acuarius AI** por
Messenger algo normal: «Hola, quiero información sobre precios».

Volver a Acuarius → **Conversaciones**. El mensaje entra. Responder desde ahí y
enseñar que la respuesta llega a Messenger en el otro dispositivo.

> **Justifica `pages_messaging` y `pages_manage_metadata`** — sin la suscripción
> al webhook el mensaje nunca habría llegado, y eso es exactamente lo que se ve.
>
> Enseña **las dos pantallas**: la entrada y la respuesta llegando. Es lo que
> prueba que el ciclo se cierra.

### 12 · La identidad de la página (4:45 – 5:00)

En la misma conversación, señalar con el cursor **el nombre y la foto de la
página** conectada.

> **Justifica `pages_read_engagement`.** Es un permiso pequeño y se demuestra en
> cinco segundos, pero si no aparece en el video te lo pueden negar suelto.

### 13 · Desconectar (5:00 – 5:30)

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
| `ads_read` | 5, 8, 9 | ☐ |
| `pages_show_list` | 6 | ☐ |
| `ads_management` | 10 (**y en pausa**) | ☐ |
| `pages_messaging` | 11 | ☐ |
| `pages_manage_metadata` | 11 | ☐ |
| `pages_read_engagement` | 12 | ☐ |

Los siete van en **una sola solicitud**. Sueltos, cada uno abre su propio ciclo
de revisión y multiplicas la espera por siete.

## Después de grabar

1. Míralo entero una vez con la tabla de arriba al lado.
2. Súbelo a **YouTube como «oculto»** (no privado — Meta no podría verlo) o
   adjúntalo directamente en el formulario si pesa menos del límite.
3. Los textos de justificación y las Instrucciones de prueba ya están escritos en
   `REVISION-META.md`, sección 3 y 5. **Rellena la contraseña** antes de enviar.
4. Envía los siete permisos juntos.
