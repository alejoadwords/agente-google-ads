// api/_soporte-conocimiento.js
// Lo que el asistente de soporte sabe de Acuarius.
//
// Vive aquí y no en la base de datos a propósito: así se versiona con el código
// y cuando cambia una función se corrige en el mismo commit. Un asistente de
// soporte con la documentación desfasada es peor que no tener asistente: dice
// con seguridad cosas que ya no son ciertas.
//
// OJO: es un template literal. NUNCA meter acentos graves aquí dentro — rompen
// el string y tumban el endpoint entero. Para nombres de archivo o código usar
// comillas simples.
//
// ── CÓMO SE COMPLETA ────────────────────────────────────────────────────────
// Lo que dice [POR COMPLETAR: ...] son cosas que NO están en el código y que
// solo sabe el negocio: precios reales, tiempos de respuesta, política de
// cancelación, cómo se explica cada cosa a un cliente.
//
// El asistente tiene instrucciones de tratar esos bloques como algo que NO
// sabe, y de decirlo en vez de improvisar. Así que dejarlos sin rellenar no
// rompe nada: solo hace que ahí conteste "no lo sé, te paso con el equipo".
// Cada bloque que completes es una consulta menos que llega al equipo.
//
// Al reemplazar un bloque, borra el [POR COMPLETAR: ...] entero y escribe la
// respuesta en su lugar, con tus palabras.

export const CONOCIMIENTO = `
ACUARIUS — CÓMO FUNCIONA

Acuarius es un CRM con agentes de IA para agencias y empresas en LatAm. La app
vive en app.acuarius.app. Se entra con Clerk (correo o Google).

═══ NAVEGACIÓN ═══
La barra lateral tiene, de arriba abajo:
- Inicio: el Pulso, resumen de la cuenta o de la cartera de clientes.
- Agentes: Consultor, Google Ads, Meta Ads, TikTok Ads, LinkedIn Ads, SEO y
  Social Media Manager. Son chats especializados, cada uno con su conocimiento.
- CRM: Pipeline (kanban), Lista, Tareas y Agenda.
- Marketing: Campañas, Automatizaciones, Fuentes, Propuestas, Studio y SEO.
- Conversaciones: Inbox y Chatbots (los agentes de WhatsApp y redes).
- Análisis: Ventas, Productividad, Por comercial, Marketing, Inbox, Analytics y NPS.
Abajo: el cliente activo, Academia y Configuración.

═══ CLIENTE ACTIVO ═══
Casi todo en Acuarius cuelga de un CLIENTE. El selector está arriba a la
izquierda. Si no hay cliente activo, se ve la cuenta general y muchos módulos
aparecen vacíos aunque haya datos. Es la causa número uno de "no veo mis leads":
están en otro cliente. Se cambia con el selector y se recuerda al recargar.

═══ CRM ═══
- Pipeline: tablero por etapas. Se arrastran las tarjetas entre columnas.
- Procesos de venta (pipelines): hasta 10 por cliente. Se crean y editan con el
  engranaje junto al selector de proceso. Las etapas son libres salvo tres que
  otros módulos usan por clave: nuevo, ganado y perdido. Borrar una etapa migra
  sus leads.
  [POR COMPLETAR: cuándo conviene tener varios procesos y con qué ejemplo lo
  explicas. Ej: arriendo y venta llevan pasos distintos, así que van separados.]
- Nuevo lead: botón arriba a la derecha. El lead se queda en el proceso que
  estés viendo. El teléfono se convierte solo a formato internacional usando el
  país del cliente. Si el correo o el teléfono ya existen, avisa y deja abrir el
  que existe, crear igual o seguir editando.
- Responsable: se elige al crear o desde la ficha del lead. Solo el usuario
  principal puede reasignar; un miembro gestiona los que tiene asignados y los
  que crea.
- Cierre: al mover a Ganado o Perdido se pide importe y motivo. El catálogo de
  motivos se edita en Configuración.
- Importar: botón Importar en el pipeline, admite CSV. Papelera de 30 días para
  lo borrado.
- Tareas: lista de trabajo del comercial. Se crea una sola al asignar un lead.
- Agenda: eventos propios y sincronía real con Google Calendar.

═══ CONVERSACIONES ═══
- Inbox: todos los chats de WhatsApp, Messenger, Instagram y TikTok.
- Un canal se atiende de dos formas y se elige al conectarlo o después: con un
  AGENTE de IA que contesta y califica, o A MANO desde el inbox. No hace falta
  crear un agente para conectar un canal.
- Caja de respuesta, de izquierda a derecha: emoji, respuestas rápidas, nota
  interna, nota de voz, adjunto, programar el mensaje y sugerencia del agente.
- Nota interna: solo la ve el equipo, nunca el cliente. La caja se pone ámbar.
- Ventana de 24 horas (solo WhatsApp): pasadas 24 horas desde el último mensaje
  DEL CLIENTE, Meta no deja escribirle libremente. Cada conversación muestra lo
  que queda y avisa al caducar. Hay que esperar a que escriba él o usar una
  plantilla aprobada.
- Mensajes programados: salen en el siguiente múltiplo de 5 minutos, no al
  minuto exacto.
- Adjuntos: imagen hasta 5 MB, documentos, video y audio hasta 16 MB. Son los
  límites de WhatsApp, no nuestros.
- El agente ve las fotos que le mandan y lee los PDF del cliente.

═══ AGENTES DE CHAT (CHATBOTS) ═══
- Se crean en Conversaciones - Chatbots, en pasos: identidad, qué captura,
  calificación, enrutado y canal.
- Calificación: el agente pregunta lo que se le indique y decide si el lead
  sirve. Puede enrutar a un proceso de venta y asignar a un comercial.
- Catálogo: en Marketing - Fuentes - Conectar catálogo. Dos vías: desde una web
  hecha en WordPress, o subiendo un CSV. El agente solo ofrece lo que esté en el
  catálogo; si no está, lo dice en vez de inventarlo.
- Canal de prueba: uno por cliente, permite simular mensajes entrantes sin
  depender de Meta. No envía nada real.

═══ FUENTES DE LEADS (Marketing - Fuentes) ═══
- Formularios web: se crean aquí y se usan de dos formas, como página alojada
  para compartir o incrustados en la web.
- Formularios que ya tienes en tu web: para recoger los envíos de un formulario
  ajeno que no se puede cambiar. Se crea la conexión, se copia una línea de
  código y se pega antes de la etiqueta de cierre del body. No hace falta crear
  ningún formulario para esto.
- Plataformas externas: un webhook que acepta POST de Hotmart, Zapier, Make o
  cualquier sistema.
- Canales de chat: WhatsApp, Messenger, Instagram y TikTok.
- Cada fuente puede tener un ejecutivo fijo; si no, se reparte por turnos según
  la regla de Configuración - Equipo.

═══ AUTOMATIZACIONES Y CAMPAÑAS ═══
- Automatizaciones: disparadores (lead nuevo, etiqueta añadida, lead inactivo,
  encuesta NPS) y pasos (correo, WhatsApp, etiqueta, tarea, notificarme, esperar).
  El motor corre cada 10 minutos.
- Campañas: envíos masivos por etiqueta, con cupo mensual según el plan.
- Los correos salen desde app.acuarius.app; es el dominio verificado.

═══ EQUIPO ═══
- Configuración - Equipo. Se invita por correo con un enlace firmado.
- Asientos: Pro 1 usuario adicional, Agency 3.
- Un miembro trabaja sobre los leads, la agenda y el inbox del dueño. Las
  automatizaciones, campañas y configuración quedan solo en la cuenta del dueño.
- Reparto automático: por turnos entre el equipo, o fijo a una persona, y se
  configura por fuente.

═══ PLANES ═══
- Free: 50 contactos.
  [POR COMPLETAR: qué SÍ y qué NO puede hacer alguien en Free, dicho como se lo
  explicas a un cliente.]
- Pro: 1.000 contactos, 1 usuario adicional, 2.000 correos de campaña al mes.
- Agency: 5.000 contactos, 3 usuarios adicionales, 10.000 correos al mes.
- Al registrarse se activa una prueba de Pro de 14 días.
- El pago va por Hotmart. Para cambiar o cancelar el plan: Configuración - Plan
  y facturación, o directamente en Hotmart.
  [POR COMPLETAR: precios reales de Pro y Agency, si hay descuento anual, en qué
  monedas se cobra y qué pasa con los datos al cancelar o al bajar de plan.]
  [POR COMPLETAR: qué ocurre exactamente cuando se acaban los 14 días de prueba:
  ¿se bloquea la cuenta, se pasa a Free, se conservan los contactos de más?]

═══ ACADEMIA ═══
Videos de formación organizados por categorías, en el menú lateral.
[POR COMPLETAR: qué videos existen y para quién es cada uno, para poder mandar
a la persona al que le sirve en vez de decirle 'mira la Academia'.]

═══ PROBLEMAS FRECUENTES Y SU CAUSA REAL ═══
- "No veo mis leads": casi siempre el cliente activo es otro, o el proceso de
  venta seleccionado no es donde están. Revisar ambos selectores.
- "El lead que creé desapareció": se creó en otro proceso de venta o en otro
  cliente.
- "No me llegan los leads del formulario de mi web": el script del conector pudo
  desaparecer al rehacer la página o cambiar el tema de WordPress. El contador de
  envíos de la tarjeta lo delata. Hay que volver a pegar el código.
- "El agente no responde en WhatsApp": revisar que el canal esté activo, que el
  agente esté activo y que el canal tenga agente asignado. Un canal sin agente se
  atiende a mano, y eso es normal si así se configuró.
- "No puedo escribirle a un contacto por WhatsApp": pasaron más de 24 horas
  desde su último mensaje. Es una regla de Meta, no de Acuarius.
- "El agente ofrece propiedades que no tenemos" o "no ofrece nada": el catálogo
  está vacío o desactualizado. Marketing - Fuentes - Conectar catálogo.
- "Un compañero no puede registrar llamadas ni notas": debe estar como miembro
  ACTIVO en Configuración - Equipo, es decir haber aceptado la invitación.
- "Llegué al límite de contactos": es el tope del plan. Se amplía cambiando de
  plan o liberando contactos desde la papelera.

═══ SOPORTE, DATOS Y FACTURACIÓN ═══
[POR COMPLETAR: en cuánto tiempo responde el equipo a un ticket y en qué horario.]
[POR COMPLETAR: si hay acompañamiento o puesta en marcha al contratar, y qué incluye.]
[POR COMPLETAR: cómo se exportan los datos si alguien quiere irse, y qué pasa con
ellos al cerrar la cuenta.]
[POR COMPLETAR: si se firman acuerdos de tratamiento de datos, y dónde está la
política de privacidad.]

═══ LO QUE MÁS PREGUNTAN ═══
[POR COMPLETAR: las cinco preguntas que os llegan cada semana por WhatsApp o
correo, con la respuesta tal como se la das tú. Esta es la sección que más
rinde: cada una que añadas es una consulta que deja de llegar al equipo.]

═══ ESTADO ACTUAL DEL PRODUCTO ═══
- WhatsApp, Messenger e Instagram están pendientes de la aprobación de la app
  por parte de Meta. Mientras tanto se puede configurar todo y probar con el
  canal de prueba, pero los mensajes reales no fluyen todavía.
- Meta Lead Ads está en preparación por el mismo motivo.
`;
