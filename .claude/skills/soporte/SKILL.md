---
name: soporte
description: Atender un reporte de un cliente de Acuarius — diagnosticar su cuenta, distinguir mal uso de fallo del producto y redactar la respuesta. Úsalo cuando un cliente reporte algo (Certain Pezzano, HBSB, Karvio u otro), cuando alguien diga "no me llegan los leads", "no veo mis contactos", "no funciona X", cuando haya que revisar la cuenta de alguien, o al abrir una sesión dedicada a soporte.
---

# Soporte a clientes de Acuarius

Acuarius es un CRM y plataforma de marketing con IA para LatAm
(app.acuarius.app). Vanilla JS sin framework, funciones edge en Vercel,
Supabase como base y Clerk para identidad. El mapa completo está en
`CLAUDE.md`; los detalles de cada módulo, en el índice de memoria.

Este manual es para **atender a un cliente**, no para programar.

## «Agentes» son dos cosas, y confundirlas arruina el diagnóstico

1. **Agentes de marketing** (Consultor, Google Ads, Meta, TikTok, SEO,
   Contenido) — el chat con prompt largo. **Apagados el 17-09-2026**: nadie los
   usaba y descargaban 304 KB de prompts en cada carga. El interruptor vive en
   `public/index.html` (`AGENTES_ACTIVOS`). Si un cliente los echa de menos, no
   es un fallo: se quitaron.
2. **Agentes conversacionales** — los que atienden WhatsApp, Instagram,
   Messenger, TikTok y el chat web desde `api/_inbox-engine.js` y la tabla
   `chat_agents`. **Vivos, y son el gancho comercial.** Sistema aparte: no
   leen `prompts/` ni pasan por `api/chat.js`.

Casi todo lo que un cliente llama «el agente» hoy es el segundo.

## Lo primero, siempre: mirar la cuenta

Antes de teorizar sobre por qué «no le llegan los leads», se mira:

```bash
node --dns-result-order=ipv4first tools/soporte.mjs <parte del correo>
```

(Sin esa opción Node a veces se queda colgado conectando con Supabase aunque
`curl` responda al instante. Si sale `UND_ERR_CONNECT_TIMEOUT`, es eso.)

Da plan, leads, equipo, fuentes, tableros, canales, automatizaciones, tareas y
—lo que ahorra el tiempo— **los desajustes típicos ya señalados**. Sin
argumento, lista las cuentas.

Casi la mitad de los reportes se explican en esa pantalla sin preguntar nada
más. La otra mitad empieza ahí.

## Reglas que no se negocian

1. **En los datos de un cliente solo se lee.** Ni un `update`, ni un `insert`,
   ni un `delete`. Si hay que cambiar algo en su cuenta, se decide con
   Alejandro y se hace a la vista. Corregir por lo bajo un dato de un cliente
   es peor que el fallo que corriges.
2. **No se leen sus conversaciones ni los datos de contacto de sus leads.** Para
   diagnosticar hace falta saber que las cosas existen y cómo están
   configuradas. Si hace falta mirar un registro concreto, que lo señale él.
3. **Entrar a su cuenta se hace por la puerta buena y se avisa antes.** Ya no
   hay que elegir entre adivinar y suplantar: ver la sección siguiente. Lo que
   no se hace nunca es entrar sin decírselo a Alejandro.
4. **Nada de borrar.** El backoffice tiene «Eliminar cuenta por completo», que
   borra en cascada y no cancela Hotmart. **Ese botón lo pulsa Alejandro**, no
   Claude. Ver [[project_borrar_cuenta]].
5. **Las respuestas al cliente se firman «Equipo de Soporte — Acuarius»**,
   nunca con un nombre propio. Y **las manda Alejandro**: el borrador se le
   entrega en el chat, no se envía nada ni se escribe en el inbox del cliente.
6. **Nunca prometer lo que no está.** Si algo no existe todavía, se dice. Lo
   que hay publicado está en `public/novedades.json`.

## Entrar a la cuenta de un cliente

Desde el 30-09-2026 hay una forma soportada, y sustituye al viejo «modo
soporte» que se revirtió porque la identidad y el plan seguían siendo los del
admin.

**Cuentas de clientes** — icono en la cabecera y en ⌘K, solo para
`ADMIN_EMAILS`. Pide a Clerk un **actor token**: la sesión que se abre **es la
del cliente**, y el JWT lleva `act.sub` con el admin que entró. Por eso no hubo
que tocar ningún endpoint. **El motivo es obligatorio** y entrada y salida
quedan en `acceso_cuentas`. Para volver, el botón «volver» comprueba `act.sub`.

Dentro, `enSoporte()` corta lo que no debe dispararse en nombre de otro: la
prueba, las invitaciones, el push, la analítica, las novedades y los tours.
**Al añadir algo que corra solo al entrar, preguntarse si debe correr con
`act`.**

Sigue valiendo la regla de oro: se avisa antes, se mira, y no se escribe.
`api/diagnostico.js` da una radiografía de solo lectura sin entrar en la cuenta
de nadie — si basta con eso, mejor eso.

## Cómo se atiende

1. **Reproducir el síntoma con sus palabras.** «No me llegan los leads» y «no
   veo mis leads» son problemas distintos con causas distintas.
2. **Radiografía de la cuenta** (arriba).
3. **Buscar el síntoma** en `sintomas.md` — el catálogo de lo que pasa de
   verdad, con qué comprobar en cada caso. Si no está ahí, `consultas.md` tiene
   las recetas de solo lectura.
4. **Decidir de qué tipo es**, porque cambia la respuesta:
   - **Configuración**: se resuelve explicándole dónde tocar. Ojo con los
     catálogos (fuentes, motivos de cierre, etiquetas): **solo los edita
     dueño o admin**; a un vendedor no le aparecerán.
   - **Fallo del producto**: se arregla en el código. Entonces la respuesta al
     cliente dice qué pasaba y cuándo estará, y el arreglo lleva **su entrada
     en `public/novedades.json`, en el mismo commit**.
   - **Todavía no existe**: se dice claro y se apunta.
5. **Responder.** Breve, en español de LatAm, sin jerga técnica y **sin
   trasladarle nuestra arquitectura**: al cliente no le importa si es un cron o
   un edge function. Se le dice qué pasaba, qué hacer y qué va a pasar.

## «¿Corrió el cron?» — ahora se puede contestar

Esta pregunta costó dos investigaciones enteras antes de que hubiera forma de
responderla. Desde el 27-09-2026 **los dieciséis crons dejan latido**, salgan
bien o mal, en `cron_latidos`:

```sql
select cron, ultima_vez, ultimo_resultado, ultimo_fallo
from cron_latidos order by ultima_vez desc;
```

`ultimo_resultado` trae el resumen de la corrida. Así se distingue «no corrió»
de «corrió y no encontró nada» de «corrió y falló», que antes eran
indistinguibles después del hecho. `cron-errores` compara cada hora y convierte
el silencio en un error normal; el fin de semana **no se salta, no se cuenta**
para los de lunes a viernes.

La API de registros de Vercel **devuelve 404 con nuestro token**: no se pierda
tiempo ahí. Ver [[project_latidos_crons]].

Son **15 crons** en `vercel.json`. Los que más salen en soporte:
`cron-automations` y `cron-campaigns` (cada 10 min — nada de esto es
instantáneo), `cron-tasks` (el resumen diario, **tres intentos** a las 12:00,
12:10 y 12:20 UTC de lunes a viernes) y `cron-recordatorios` (reservas).
Las alertas de campañas y los reportes semanal y mensual de pauta **se apagaron
el 30-09-2026**: no producían nada.

## Si resulta ser un fallo del producto

El arreglo se hace con el criterio de siempre:

- **Fallar a la vista, nunca en silencio.** Preguntarse «¿qué se ve si esto
  falla?». La mayoría de fallos graves aquí han sido cosas que fallaban sin
  decir nada — incluido el patrón que más ha costado:
  `.then(r => r.ok ? r.json() : []).catch(() => [])`, que convierte cualquier
  error en una lista vacía y la línea siguiente la lee como «no hay nada».
- **Verificar la integración, no solo el código**: rastrear todos los caminos
  que alimentan el dato y probarlo ejecutándolo.
- **Verificar el despliegue, no el estado**: `READY` no prueba que producción
  sirva tu código; grep del cambio en el asset servido.
- **Revisar la interfaz antes de publicar** si el arreglo se ve.
- **Pasar los guardianes** antes de comitear: `node tools/exports.mjs` (un
  `export` pegado a la función equivocada no lo ve `node --check`) y
  `node tools/llaves.mjs`. En `pruebas/` hay ~100 pruebas y bancos visuales
  (`node pruebas/servidor-boceto.mjs` los sirve).

## Dónde está la verdad

| Qué | Dónde |
|---|---|
| Síntomas y sus causas | `.claude/skills/soporte/sintomas.md` |
| Consultas de solo lectura | `.claude/skills/soporte/consultas.md` |
| Mapa de módulos y endpoints | `.claude/skills/soporte/modulos.md` |
| Encuestas NPS, de punta a punta | `.claude/skills/soporte/nps.md` |
| Detalle de cada módulo y sus trampas | índice de memoria (`MEMORY.md`) |
| Dónde va el proyecto | memoria `project_donde_vamos` |
| Qué se ha publicado y cuándo | `public/novedades.json` |
| Puesta en marcha de un cliente nuevo | `PUESTA-EN-MARCHA.md` |
| Estado de Meta (bloquea a todos) | memoria `project_meta_acceso_avanzado` |

El mapa de módulos se regenera cuando quede viejo:

```bash
node tools/mapa-modulos.mjs > .claude/skills/soporte/modulos.md
```

## Módulos nuevos que todavía no aparecen en muchos tickets

- **Reservas** (21-09-2026) — citas públicas en `/reservar/:token`. **Una
  reserva es una fila de `activities`**, la misma tabla de la agenda: por eso
  entra sola en Google Calendar y en el resumen diario.
- **SMS** (30-09-2026) — **en beta y simulado**: solo lo ven las cuentas de
  `SMS_BETA`, y sin las credenciales de LabsMobile reserva créditos pero no
  envía. **No ofrecérselo a nadie todavía.** Horario de la Ley 2300 y baja con
  la etiqueta `no-sms`.
- **CRM por voz** (beta, `VOZ_BETA`) — solo consulta; crear o mover contesta
  «todavía no».
- **Cupo del agente** — tira en Conversaciones → Agentes IA. free 0 · trial 300
  · pro 500 · agency 2.000 mensajes al mes, contados en hora de Colombia. El
  probador **no** gasta cupo. «No se pudo contar» no es «cero»: si la pantalla
  dice que no pudo consultar, es un 503, no un cliente sin consumo.
- **Catálogo desde Domus** — el inventario de Certain se lee de `api.domus.la`,
  no de su WordPress. 444 inmuebles. Ver [[project_catalogo_domus]].
- **«¿Ya existe este lead?»** — buscador para el perfil Ventas, que solo ve sus
  propios leads. Devuelve nombre, empresa, etapa y asesor; **nunca** teléfono
  ni correo.

## Cuentas que ya se atienden

- **Certain Pezzano** — `direccioncomercial@certainpezzano.com` (Marilia,
  dueña). **Plan agency, ~523 leads, 8 asesores activos.** Inmobiliaria;
  sus leads viven en los tableros **Arriendo**, **Venta** y **Captación**, no en
  el Principal, cosa que despista al mirar. Su catálogo sale de Domus. Es la
  cuenta que más reportes genera y casi todos han sido reales: seguimientos de
  leads perdidos, leads «sin actividad» con tarea programada, notas al
  responsable que no avisaban, el resumen de tareas que no llegaba y la agenda
  que escondía los últimos días del mes. Tiene la beta de voz.
- **HBSB** — `comercialhbsb53@gmail.com`, 74 leads. Alta el 10-09-2026. Se le
  dieron 30 días de prueba a mano y **quedó con 44**: los días se **SUMAN a lo
  que le quede**, y al registrarse ya tenía los 14 de la prueba automática. Es
  el comportamiento de diseño —renovar a quien está al día no le recorta—, pero
  para una prueba «de un mes desde hoy» a una cuenta recién creada hay que dar
  **16 días, no 30**. Ver [[project_planes_con_fecha]].
- **Karvio** — `giancarlo@karvio.co` (pro), `diego@` y `farid@`. Entraron el
  29-09-2026. **Cuenta sin cartera**: trabaja a nivel de cuenta, sin clientes.
  De su capacitación salió el arreglo de la vista global del tablero — una
  cuenta sin cartera caía siempre en las columnas Abiertas/Ganadas/Perdidas y
  nunca veía sus propias etapas. Ver [[project_cuenta_un_negocio]].
- **`a32438686@gmail.com`** — no es un cliente: la cuenta de **phishing** del
  21-09-2026 que pagó US$101, importó 5.000 correos comprados y agotó la cuota
  diaria de Resend de toda la plataforma en 22 minutos. Queda aquí para que
  nadie la trate como un cliente con un problema. Ver [[project_abuso_phishing]].

## Conectar el formulario de una web (receta)

El caso que ya salió: **Elementor Forms**, el mismo formulario repetido en todas
las páginas, y dentro un desplegable que decide el destino del lead.

1. Mirar el HTML de la página y sacar el **`name` del campo que decide**. En
   Elementor llega como `form_fields[field_a74788e]`; en Acuarius se escribe
   solo `field_a74788e`.
2. Crear **una** conexión en Fuentes de leads y marcar «El mismo formulario
   alimenta varios tableros». Una rama por cada opción del desplegable, con su
   tablero y su reparto.
3. Dar la **URL de webhook**, no el script, si el constructor tiene acción de
   Webhook. Con reCAPTCHA en la página el script mete también los envíos que el
   propio formulario rechaza. **Nunca los dos a la vez**: entra duplicado.
4. Probar enviando el formulario real una vez por cada opción y comprobar dónde
   cae. La ficha del lead dice `Destino: <rama>` — ahí se lee qué decidió el
   sistema en vez de adivinarlo.

Trampas comprobadas: el tablero de una rama tiene que ser **del mismo cliente**
que la conexión, o `pipelineElegido()` lo rechaza y el lead cae en el tablero
por defecto sin avisar. Y el «tablero por defecto» no se configura en el
conector: es la casilla *proceso por defecto* del CRM, por cuenta y por cliente.
