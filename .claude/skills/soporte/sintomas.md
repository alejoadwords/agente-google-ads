# Síntomas y su causa real

Catálogo de lo que los clientes reportan de verdad, no una lista teórica. Cada
entrada: **lo que dice el cliente → qué comprobar → qué suele ser**.

Antes de nada, siempre: `node tools/soporte.mjs <correo>`.

---

## «No me llegan los leads»

1. **¿Entra alguno?** La radiografía dice cuándo entró el último. Si entró hoy,
   el problema no es la entrada: es que no los ve (ver el bloque siguiente).
2. **¿Hay alguna fuente activa?** Sin formularios activos ni canales conectados
   no puede entrar nada. La radiografía lo avisa en alto.
3. **¿El formulario está pausado?** `lead_forms.active`. Un formulario pausado
   devuelve 410 y la web del cliente no muestra ningún error visible.
4. **¿Llegó al tope del plan?** Lo que se limita son **contactos**: free 50,
   pro/trial 1.000, agency 5.000, más 1.000 por cada paquete de `leads_extra`.
   Al tope, los leads nuevos se rechazan. (El tope vive en `PLAN_LEADS`, en
   `api/leads.js`, `api/diagnostico.js` y `tools/soporte.mjs`: si alguna vez
   los tres no dicen lo mismo, el que manda es el de `api/leads.js`.)
5. **Si es un conector en web ajena**: el script manda por `sendBeacon`, que
   **solo conserva el cuerpo si el content-type está en la lista segura**. Con
   otro, el envío se pierde entero y en silencio. Ver [[project_form_connector]].

## «Los leads están pero no los veo» / «mi vendedor no ve nada»

Es el motivo número uno de tickets, y casi nunca es el mismo que el anterior.

- **Lead sin tablero** (`pipeline_id is null`): existe en la base y no aparece en
  ninguna vista de pipeline. La radiografía lo cuenta aparte.
- **Tablero de otro cliente**: si la cuenta es agencia, un lead en el pipeline
  del cliente A no se ve mientras esté seleccionado el cliente B.
- **Miembro del equipo**: todos los endpoints resuelven miembro → dueño. Si esa
  resolución falla, el miembro ve *su propia* cuenta vacía en vez de la del
  dueño. Comprobar que `team_members.member_user_id` esté relleno: una
  **invitación sin aceptar** no tiene identificador y esa persona no ve nada.
- **Alcance por cliente**: sin `client_id`, `/api/leads` devuelve toda la
  cuenta. Todo contador debe usar el alcance de la vista a la que enlaza.

## «El Pulso me avisa de leads sin actividad que sí tienen actividad»

Todo lo de inactividad cuelga de **`leads.updated_at`**. Quien atienda un lead
tiene que tocar ese campo o el lead se vuelve invisible para el Pulso, el badge,
el filtro y las automatizaciones de reactivación.

Arreglado el 01-09-2026: un lead con una **tarea pendiente para hoy o más
adelante** ya no cuenta como inactivo. Si el cliente lo sigue viendo, es caché
del navegador: que recargue.

## «Me llegan seguimientos de leads que ya perdí»

Arreglado. `leadCerrado()` es el único criterio y lo comparten agenda, cron de
tareas y automatizaciones. Si reaparece, mirar que la etapa del lead tenga la
`key` correcta: el pipeline es editable, pero `nuevo`, `ganado` y `perdido` las
usan otros módulos por clave, no por nombre.

## «No puedo conectar mi cuenta de Meta / Facebook»

**Ningún cliente puede, todavía.** La App de Meta no ha pasado App Review, así
que los permisos avanzados no están disponibles fuera de las cuentas de prueba.
No es un fallo de su cuenta. Decirlo de frente y dar fecha solo cuando la haya.
Ver [[project_meta_acceso_avanzado]].

## «No llegan los correos de mi campaña»

**Ojo: el «cupo mensual de Pro 2.000 / Agency 10.000» ya no existe.** Está en
`Infinity` para pro, agency y trial desde hace tiempo — repetirlo es
diagnosticar con un número inventado. Lo que se limita son **contactos**, no
correos (free 50, pro/trial 1.000, agency 5.000, más paquetes de 1.000). Ver
[[project_modelo_envios]].

Lo que sí puede frenar un envío, en orden de probabilidad:

- El motor va **por lotes cada 10 minutos**, no al instante. Una base de 7.000
  sale en una sola corrida de ~55 s; una de 40.000 tarda unos 30 minutos.
- **Tope diario de toda la plataforma.** El de Resend es diario y **de la
  cuenta entera**, no de cada cliente. Lo contamos en `api/_correo.js` con la
  tabla `email_cuota`: `select dia, enviados from email_cuota order by dia desc`.
  Hay una **reserva que nunca se le presta a una campaña** (`EMAIL_RESERVA`,
  40) para que una confirmación de cita siempre salga, y **ninguna cuenta se
  lleva más de la mitad** de lo que quede. **`EMAIL_TOPE_DIARIO` vale 10.000,
  NO 100** — el 100 es solo el valor por defecto del código si falta la
  variable, y confundirlo lleva a diagnosticar mal.
- **Cuenta de menos de 24 h**: no manda más de **300** destinatarios por
  campaña (`TOPE_CUENTA_NUEVA`). Es el freno que caza el patrón de abuso.
- **`envio_bloqueado`** en el `public_metadata` de Clerk. Se respeta al encolar
  **y en el cron**; si no se puede consultar, **no se envía**.
- El envío sale **solo desde app.acuarius.app** (dominio verificado en Resend).
- Los que rebotaron se **suprimen solos** y no vuelven a recibir.
- La etiqueta `no-email` da de baja: revisar que no la tengan.

## «Mi campaña lleva horas en "enviando"»

Si el tope diario la retuvo, **la pantalla no lo dice**: el cliente la ve
«enviando» sin explicación. Es un fallo silencioso conocido y sin arreglar.
Se comprueba en `email_cuota` (arriba) y se le explica a mano.

Con SMS la pausa sí se ve: si se queda sin saldo a mitad, la campaña se pausa
con `stats.motivo_pausa` y se reanuda con `?action=resume`.

## «La automatización no hace nada»

- El motor corre **cada 10 minutos**, no en el momento.
- `automations.active` tiene que estar en true.
- El disparador `tag_added` es **una vez por lead**, a propósito, para no
  entrar en bucle. Volver a poner la etiqueta no lo dispara otra vez.
- `automation_logs` cuenta las ejecuciones: si son cero, nunca disparó.
- Un paso `wait` cuenta **horas, no días**.

## «No me llegan los avisos al celular»

- En iPhone **solo funcionan si la app está en la pantalla de inicio**. Si la
  abre desde Safari, el permiso ni se pide. La interfaz lo dice.
- Hoy se avisa al **entrar un lead** y al **haber actividad**. El aviso de
  **tarea vencida todavía no existe**: no prometerlo.
- **Casi nadie lo tiene activado**, y por eso el canal de verdad sigue siendo
  el correo. Se comprueba mirando si esa persona tiene fila en `push_subs`.
  Una nota dirigida tardaba de media **82 horas** en leerse por esto; lo que
  queda lo cubre `cron-notas`, que recuerda las que nadie abrió.

## «A mis asesores no les llega el resumen de tareas» / «solo le llega a uno»

- **Lo primero: mirar el MX del cliente.** `dig +short MX sudominio.com`. Si
  sale `*.mail.protection.outlook.com`, es Microsoft 365 y la causa probable
  es su filtro, no nuestro envío: Microsoft decide buzón por buzón según el
  historial con el remitente, así que al que lleva meses recibiéndonos le
  entra y a los recién creados se los lleva a Correo no deseado o a la
  cuarentena del administrador. Ver [[project_entregabilidad_correo]].
- **Antes de nada, mirar si corrió**, que ya no hay que adivinarlo:

```sql
select ultima_vez, ultimo_resultado, ultimo_fallo
from cron_latidos where cron = 'cron-tasks';
```

  `ultimo_resultado` trae `{cuentas, correos, fallidos, errores}` de la última
  corrida. El 23-09-2026 este mismo síntoma se investigó a ciegas durante horas
  porque no existía esta tabla: la consulta de tareas se resolvía con
  `.catch(() => [])` y un fallo se volvía «hoy nadie tiene nada» → 200 «todo
  bien». Ver [[project_latidos_crons]].
- **Comprobar que sí sale** disparando el cron (avisar antes: manda el correo
  de verdad al equipo del cliente, y gasta cuota diaria compartida):

```bash
curl -s -X GET "https://app.acuarius.app/api/cron-tasks" -H "x-acuarius-secret: $CRON_SECRET"
```

  Con `fallidos: []` el envío salió y el problema está del lado de ellos. Desde
  el 17-09-2026 cada fallo queda además en `error_log`.
- **Ojo a la expectativa**: el resumen sale **de lunes a viernes a las 7:00 de
  Colombia**, con **tres intentos** (12:00, 12:10 y 12:20 UTC) para que un
  tropiezo no se coma el día. Y nada más: **no hay aviso al crear ni al asignar
  una tarea.** Si lo que echan de menos es enterarse en el momento, eso todavía
  no existe.

## «Le dejo una nota al comercial y no se entera»

- Mirar primero **cuál de las dos notas usó**. La «Nota» de *Registrar
  actividad* no avisa a nadie a propósito; la que avisa es **«Nota al
  responsable»**, el icono de la tarjeta y de la fila de acciones. En la base
  se distinguen: solo la segunda lleva `metadata->>'para'`.

```sql
select created_at, metadata->>'para' as para, metadata->>'avisado_at' as avisado,
       metadata->>'leida_at' as leida
from lead_activities where user_id = '<owner>' and type = 'nota'
order by created_at desc limit 20;
```

- **`para` nulo** en todas → está usando la nota que no avisa: es explicación,
  no fallo.
- **`para` con valor y `leida_at` nulo** → el aviso se generó. Entonces el
  correo es lo que falta: `node tools/exports.mjs`, porque el aviso vive en
  `api/_aviso-lead-nota.js` y ya se rompió una vez por un `export` mal puesto.
  Desde el 01-09-2026 un aviso que no sale también queda en `error_log`.
- El **push al celular casi nunca llega**: hay que tener fila en `push_subs`, y
  la mayoría de comerciales no la tiene. El canal de verdad es el correo.

## «El chat con el agente no responde / se corta»

**Primero: ¿de cuál de los dos agentes habla?**

- **Agentes de marketing** (Consultor, Google Ads, SEO, Contenido…): **se
  apagaron el 17-09-2026.** No es un fallo. Nadie los usaba —`ai_usage` no
  tiene ni una fila con `origen='agente'` en toda su historia— y cargaban
  304 KB de prompts en cada visita. Sus funciones se reubican bajo Marketing.
- **Agente conversacional** (WhatsApp, Instagram, chat web): ese sí está vivo y
  es lo que casi siempre quieren decir.

Para el conversacional:

- **Cupo mensual de mensajes** por plan: free 0 · trial 300 · pro 500 · agency
  2.000, contados en hora de Colombia desde `ai_usage`. Se ve en
  Conversaciones → Agentes IA. **El probador no gasta cupo.**
- Si la tira dice «no se pudo consultar», eso es un **503**, no un cliente sin
  consumo: no se le responde que va en cero.
- Sonnet 5 **razona por defecto** y ese razonamiento comparte presupuesto con
  el texto: con `max_tokens` bajo la respuesta llega vacía.
- Si se queda a medias y no retoma, mirar `cron-seguimiento` (cada 10 min):
  es el que reengancha la conversación que murió sin respuesta.

## «Pagué y sigo en prueba»

El webhook de Hotmart activa el plan en Clerk. Comprobar `users.plan` y
`plan_started_at`. Si el pago existe y el plan no cambió, es el webhook, no el
cliente. Ver [[project_hotmart_flow]].

## «El invitado no puede entrar»

- Asientos: Pro 1, Agency 3.
- La invitación caduca. `team_members.status` y `member_user_id` lo dicen.
- La agenda del miembro sincroniza con el **Google Calendar del dueño**, no con
  el suyo. Es a propósito, pero sorprende.

## «La página de aterrizaje se ve en blanco al editarla»

Arreglado el 01-09-2026. Además, ahora guardar con el lienzo vacío **no** borra
una página que sí tenía contenido. Si un cliente perdió contenido antes de esa
fecha, se puede reconstruir desde su plantilla.

## «Me aparecen tareas de clientes que ya perdí»

Arreglado el 01-09-2026: al cerrar un lead —ganado o perdido— sus tareas
pendientes **se anulan** (`activities.cancelled_at`). Antes se quedaban abiertas
para siempre y el contador de vencidas crecía solo.

Si en una cuenta antigua siguen apareciendo, son de antes del arreglo: la
radiografía las cuenta aparte como «sobre leads ya cerrados». Limpiarlas es
escribir en datos del cliente, así que **se pide permiso a Alejandro antes**.

Ojo al escribir cualquier consulta nueva sobre `activities`: **pendiente es
`done=false` Y `cancelled_at is null`**. Una consulta sin el segundo filtro hace
reaparecer la tarea en un solo sitio, y el usuario deja de fiarse de los dos.

## «Me dice que voy atrasado con una tarea que ya hice»

No es un fallo del cálculo: es que **no la marcó como hecha**. Desde el
02-09-2026 se puede marcar desde tres sitios —Tareas, Agenda y, lo nuevo, la
**ficha del lead**, arriba del todo—. Antes solo desde los dos primeros, así
que quien llamaba al cliente desde su ficha no tenía dónde apuntarlo.

Si dice que la marcó y sigue en rojo: el chip de la tarjeta sale de otra
consulta. Que recargue. Y si es un lead de otro comercial, la casilla sale
bloqueada a propósito.

## «Marqué una tarea sin querer» / «el correo marcó tareas solas»

- En la **ficha del lead** las hechas siguen a la vista siete días, tildadas:
  se destildan y vuelven a estar pendientes. No hace falta tocar la base.
- El enlace **«Ya la hice»** del correo diario **no marca al abrirse**: lleva a
  una página con un botón, justamente para que ningún antivirus de correo las
  marque solas. Si alguien dice que se marcaron solas, no puede ser por ahí —
  mirar quién más tiene acceso a la cuenta.
- El enlace **caduca a los 14 días** y solo sirve para su tarea y su cuenta.

## «Mi asesor no ve lo mismo que yo» / «no le cargan los tableros»

Casi siempre es **el plan**: un miembro tiene el suyo (trial o free) y hasta el
14-09-2026 la aplicación le dibujaba la variante Pro en vez del selector de
cliente del dueño. Sin cliente seleccionado no se ven los pipelines, que cuelgan
de un cliente. Arreglado: ahora manda el plan del dueño. Si lo sigue viendo mal,
que cierre sesión y vuelva a entrar.

Si el problema es que **no está en el equipo**, mirar `team_members`: `status`
debe ser `active` y `member_user_id` no puede estar vacío. Desde el 14-09-2026
la invitación se aplica sola al entrar con el correo invitado **verificado**;
si su correo no está verificado en Clerk, no se ata y es correcto que no se ate.

## «Creé un proceso y no lo encuentro» / «no veo mis etapas, veo otras columnas»

Lo que le pasó a Karvio en plena capacitación. Dos causas que se parecen:

- **El selector de cliente es SOLO de las cuentas de agencia.** Una cuenta Pro
  o de prueba guarda su negocio como un único cliente (`pro_main`) y trabaja
  siempre dentro de él. Antes había dos espacios —«Mi cuenta» y el negocio— con
  procesos distintos: el cliente creaba un proceso en uno y lo buscaba en el
  otro. Arreglado el 29-09-2026.
- **La «vista global»** (columnas Abiertas / Ganadas / Perdidas) es solo para
  una agencia con cartera mirando a todos sus clientes. Una cuenta **sin**
  cartera caía ahí siempre y nunca veía sus propias etapas.

Al verificar un arreglo del CRM, mirar **las columnas pintadas**
(`crmColumnasTablero`), no solo que `crmStages` cargara: ese despiste ya hizo
dar por bueno un arreglo incompleto. Ver [[project_cuenta_un_negocio]].

## «Me faltan días en la agenda» / «el mes sale incompleto»

Arreglado el 29-09-2026. La consulta traía `limit=500` ordenado de forma
ascendente, así que en una cuenta con muchas actividades **se perdían los
últimos días del mes**: Certain tenía 626 actividades y el 29 de septiembre
salía con 19 de 67. Ahora pagina con `todasLasFilas()`.

Regla que deja esto: **una consulta nueva que liste actividades o leads por
rango nunca lleva un `limit=` fijo.** PostgREST además corta en 1.000 filas
aunque pidas más. Ver [[feedback_postgrest_mil]].

## «Mi asesor llama a un lead que ya estaba» / «no puede buscar»

El perfil **Ventas** solo ve los leads que le asignaron, y **eso se queda
así**: un asesor nuevo no debe encontrarse la cartera entera. Pero desde el
22-09-2026 tiene encima del tablero un buscador de «¿ya existe?» que consulta
toda la cuenta y devuelve **solo** nombre, empresa, etapa y asesor. Ni
teléfono, ni correo, ni valor, ni notas. Mínimo 3 caracteres.

Si dice que no le aparece: solo sale a quien tiene el tablero acotado, es
decir al perfil Ventas. Al dueño y a los admin no, porque ellos ya ven todo.

## «¿Pueden mandar SMS?»

**Todavía no.** El módulo existe desde el 30-09-2026 pero está **en beta y en
modo simulado**: solo lo ven las cuentas de `SMS_BETA` y, sin las credenciales
de LabsMobile, reserva créditos y no envía nada. No prometerlo ni dar fecha.

Cuando se abra: solo móviles colombianos, horario de la Ley 2300 (lun–vie 7–19,
sáb 8–15, nunca domingos ni festivos) y baja con la etiqueta `no-sms`.

## «Cambié algo y no lo veo»

Antes de investigar: **¿está desplegado?** Un `READY` en Vercel no prueba que
producción sirva ese código. Hacer grep del cambio en el asset servido:

```bash
curl -s "https://app.acuarius.app/app.js?v=$RANDOM" | grep -c "nombreDeLaFuncion"
```

Y ojo: el catch-all de `vercel.json` devuelve **200 con el shell de la app**
para cualquier ruta que no sea `/api`. Comprobar por contenido, nunca por
código de estado.
