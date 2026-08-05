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
