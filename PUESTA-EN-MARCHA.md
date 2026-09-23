# Puesta en marcha de un cliente nuevo

Sacado del ensayo completo del 05-08-2026 con una inmobiliaria simulada. El orden importa: cada paso deja lista una pieza que el siguiente necesita.

## Antes de tocar la app

- [ ] Pedir el **archivo de contactos histórico** y revisar los encabezados. Las filas que solo traen nombre (sin teléfono ni correo) **no se pueden deduplicar**: si el cliente vuelve a cargar el archivo, se duplican. Limpiarlas antes.
- [ ] Confirmar **cuántos comerciales** van a usar la herramienta (Agency incluye 3 usuarios adicionales).
- [ ] Confirmar el **número de WhatsApp Business** y quién administra la cuenta de Meta.

## 1 · Cuenta y cliente

- [ ] Crear la cuenta con el correo del dueño del negocio, no el de un empleado: es quien recibe los avisos de la cuenta.
- [ ] Completar el **brief del cliente** (7 pasos). No saltárselo: es el contexto que usan todos los agentes de IA, y sin él las respuestas salen genéricas.
- [ ] Si la cuenta va a manejar varios clientes, dejar seleccionado el correcto antes de trabajar. El CRM recuerda el último cliente entre recargas; con "Mi cuenta" se ven todos mezclados.

## 2 · Pipeline

- [ ] Ajustar las etapas al proceso real del negocio (Configuración → Editar pipeline). En inmobiliaria: Nuevo → Contactado → Calificado → Visita agendada → Visita realizada → Negociación → Ganado/Perdido.
- [ ] **Ojo**: las etapas son de toda la cuenta, no por cliente. El conteo de leads que aparece al lado de cada etapa también es de toda la cuenta.
- [ ] Revisar los **motivos de cierre** (ganado y perdido) para que hablen el idioma del negocio.

## 3 · Equipo y reparto

- [ ] Invitar a los comerciales (Configuración → Equipo). Cada uno acepta desde su correo.
- [ ] Configurar el **reparto por fuente**. Recordar que el turno es **independiente por fuente**: si hay varias fuentes, cada una empieza por la primera persona de la lista y el primer comercial puede acumular más. Con pocos leads al día conviene poner "en turnos" solo en la fuente principal.
- [ ] Configurar el **seguimiento automático**: plazo del primer contacto (2 h es un buen punto de partida) y el título de la tarea.

## 4 · Canales y calificación

- [ ] Conectar WhatsApp (y Messenger/Instagram si aplica) desde la ficha del agente.
- [ ] Escribir la **persona y el contexto del negocio** del agente: es lo que hace que no suene a robot.
- [ ] Si el cliente va a preparar él el material, pasarle el **prompt del anexo** para que su propia IA lo entreviste y devuelva el documento ya con nuestra estructura.
- [ ] Definir los **criterios de calificación** — 3 son suficientes, 8 es un interrogatorio. Cada criterio necesita la pregunta y qué respuesta la da por buena.
- [ ] Decidir el **mínimo**: "todas" es estricto; "2 de 3" deja pasar al que no quiso responder algo.
- [ ] Definir la **regla de entrada al pipeline** por canal (Fuentes). "Cuando haya contacto" es el default sensato.

## 5 · Web

- [ ] Crear el formulario y elegir cómo instalarlo: página alojada, incrustado, o el conector para el formulario que la web ya tenga.
- [ ] **Hacer un envío de prueba desde el formulario real de su web** y comprobar que el lead llega. No dar el canal por bueno sin esto.

## 6 · Base histórica

- [ ] Importar el archivo. ~2.500 contactos por minuto; una base de 5.000 tarda dos minutos.
- [ ] Revisar el **mapeo de columnas** antes de confirmar. Las columnas de texto tipo "Presupuesto: 300-500M" no deben mapearse a importe.
- [ ] Etiquetar la importación (ej. `base-historica`) para poder segmentarla después.
- [ ] Revisar la **capacidad** en Configuración → Plan y activar la limpieza automática si la base va a crecer rápido.

## 7 · Prueba de humo antes de entregar

- [ ] Un lead que **sí** califica por WhatsApp → debe escalar, crear la oportunidad, asignarse y generar la tarea.
- [ ] Un lead que **no** califica → debe quedar etiquetado, **sin comercial y sin tarea**, y la conversación sigue con el bot.
- [ ] Un lead por el **formulario web** → debe asignarse y generar tarea.
- [ ] Cerrar uno como ganado con importe y motivo, y otro como perdido con motivo.
- [ ] Abrir **Análisis → Por comercial** y comprobar que los números cuadran.

## Lo que conviene explicarle al cliente

- **"Contactado" significa que una persona registró una interacción**, no que el sistema movió la ficha. Si el equipo arrastra tarjetas sin llamar, el informe lo va a decir.
- Los leads **sin dueño** salen en su propia fila del informe: son los que se le escapan a todo el mundo.
- Lo que se borra queda **30 días en la papelera** y se puede recuperar si hay cupo.

---

## Anexo · Prompt para que el cliente prepare el entrenamiento del agente

Se le entrega tal cual al cliente para que lo pegue en su propia IA. La IA lo
**entrevista** en vez de pedirle que escriba: el cliente no sabe qué
necesitamos, y un documento libre siempre llega con adjetivos de folleto y sin
los datos que hacen falta.

Las ocho secciones caen directas en los campos de `chat_agents`: identidad y
trato en `persona` y `tone`, el bloque del negocio en `business_ctx`, las
preguntas frecuentes en `faqs`, los datos a conseguir en `capture_fields` y la
frase final en `escalate_phrase`. Quien lo cargue no tiene que interpretar nada.

Dos cosas que el prompt trae a propósito:

- **El catálogo va aparte.** Metido dentro del documento queda congelado; el
  inventario entra por su propio camino y se actualiza solo.
- **La lista final de «datos que faltan»** es lo más útil que llega: dice, antes
  de prender nada, en qué temas el agente va a escalar por falta de información.
  Esa es la conversación que hay que tener con el cliente.

```
Eres un consultor que va a preparar el documento de entrenamiento de un
asistente que atenderá los chats de mi empresa: WhatsApp, Instagram, Messenger
y el chat de nuestra página web.

Tu trabajo NO es escribir el documento de una vez. Es entrevistarme primero y
escribirlo al final.

CONTEXTO QUE DEBES TENER CLARO:
- El asistente responde por chat, en mensajes cortos, como una persona real.
- Tiene una regla innegociable: solo puede afirmar un precio, un horario, una
  dirección, un plazo o una condición si está literalmente escrito en este
  documento. Si no está, debe decir que lo confirma un asesor y pasar la
  conversación a una persona.
- No puede inventar, ni estimar, ni dar rangos aproximados.
- Por eso: cada dato concreto que falte en este documento es una conversación
  que va a terminar interrumpida en un humano.
- El mismo documento sirve para los cuatro canales, así que no lo escribas
  pensando solo en WhatsApp.

CÓMO QUIERO QUE TRABAJES:
1. Hazme preguntas de a una o dos por turno, en lenguaje sencillo. Espera mi
   respuesta antes de seguir.
2. Si respondo algo vago —"precios competitivos", "entrega rápida", "varias
   opciones"— insiste y pídeme el número, el plazo o la lista concreta.
3. Cubre todos los temas de la lista de abajo antes de escribir nada.
4. Al final, genera el documento con la estructura exacta que te indico.
5. Después del documento, agrégame una lista aparte de DATOS QUE FALTAN: todo
   lo que quedó sin responder o quedó vago, para que yo lo complete.

TEMAS QUE DEBES CUBRIR EN LA ENTREVISTA:
- Qué vende o hace la empresa, explicado en una frase que entienda cualquiera
- Quién es el cliente típico y con qué suele escribir
- Productos o servicios con nombre, precio y qué incluye cada uno
- Horarios y días de atención
- Dónde están, a qué zonas llegan, si hay envío o domicilio, cuánto cuesta y
  cuánto se demora
- Medios de pago, si hay financiación, si se pide anticipo
- Garantías, cambios y devoluciones
- Lo que la empresa NO hace, para que el asistente no lo ofrezca por error
- Las 15 o 20 preguntas que más les hacen por chat, con su respuesta real. Si
  por Instagram o por la página les preguntan cosas distintas que por WhatsApp,
  inclúyelas también
- Las objeciones más comunes y cómo las responden hoy los asesores
- Qué no debe decir nunca el asistente
- En qué casos debe pasar la conversación a una persona de inmediato
- Cómo quieren que hable: de tú o de usted, y con qué nombre se presenta
- Qué datos debe conseguir de la persona antes de pasarla a un asesor.
  Pregúntame esto con cuidado: en WhatsApp el número de la persona llega solo,
  pero en Instagram y en el chat de la página el visitante es anónimo y no
  sabremos ni quién es ni cómo volver a contactarlo si el asistente no se lo
  pregunta en la conversación

ESTRUCTURA DEL DOCUMENTO FINAL:

1. IDENTIDAD — el nombre con el que se presenta y, en dos o tres frases, quién
   es y cómo trata a la gente.
2. TRATO — de tú o de usted.
3. EL NEGOCIO — todo lo concreto: qué vende, precios, horarios, cobertura,
   pagos, garantías, plazos. En frases cortas y directas. Este bloque es el más
   importante: es lo único que el asistente va a poder afirmar.
4. LO QUE NO HACEMOS — en lista.
5. PREGUNTAS FRECUENTES — pares de pregunta y respuesta. Cada respuesta de una
   a tres frases, como se contesta por chat. Sin viñetas dentro de la respuesta.
6. CUÁNDO PASAR A UN ASESOR — situaciones concretas.
7. DATOS A CONSEGUIR — qué debe preguntarle a la persona y en qué momento de la
   conversación.
8. FRASE DE ESCALAMIENTO — la frase exacta con la que anuncia que pasa la
   conversación a un asesor.

REGLAS DE REDACCIÓN:
- Español neutro de LatAm.
- Nada de relleno de marketing. "Atención personalizada y precios competitivos"
  no le sirve de nada al asistente. "Atendemos de 8am a 6pm y el domicilio en
  la ciudad cuesta $8.000 y llega el mismo día" sí.
- Cifras exactas, no rangos, salvo que el rango sea el dato real.
- Si algo cambia seguido (promociones, inventario, stock), escríbelo como
  "variable: lo confirma un asesor" en vez de poner un número que va a quedar
  viejo en una semana.
- En las respuestas de las preguntas frecuentes no uses asteriscos, guiones
  bajos ni ningún símbolo para resaltar: escríbelas en texto plano, porque no
  todos los chats muestran formato.
- No metas aquí el catálogo completo de productos: ese va por separado, en su
  propio archivo.

Empieza presentándote en una línea y hazme la primera pregunta.
```
