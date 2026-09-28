# Conectar el WhatsApp de Certain Pezzano y activar el agente

Guion de la primera conexión real de un número de cliente. Escrito el 28-09-2026
con el estado comprobado contra la base y contra Meta ese mismo día.

**Por qué importa más de lo que parece.** Hasta hoy ningún cliente tiene una
conexión de Meta funcionando: la única real es la cuenta de pruebas. Esta es la
que demuestra que el camino existe.

---

## Lo que ya está y no hay que tocar

Comprobado el 28-09-2026:

| | Estado |
|---|---|
| Verificación del negocio | ✅ aprobada el 28-09-2026 |
| Rol en la app de Meta | ✅ Alejandro es **Administrador** (por el portafolio Acuarius AI) |
| Agente de Certain | ✅ «Laura», activo, tono informal |
| Regla de calificación | ✅ activa, **con enrutado**: `arriendo` y `venta` a tableros distintos |
| Catálogo de inmuebles | ✅ 469 propiedades |
| Webhook de Meta | ✅ firma validada, campo `messages` suscrito |
| Atribución de pauta | ✅ el `referral` de clic-a-WhatsApp se guarda desde el 27-09 |

**Lo que NO está**: el acceso avanzado (App Review). Mientras siga en estándar,
solo conecta quien tenga rol en la app. Para esta prueba basta; para que los
clientes conecten solos, no.

---

## Antes de conectar: ensayar sin Meta

El motor tiene un simulador. Permite probar a Laura entera —conversación,
captura, calificación, enrutado, creación del lead— **sin tocar el número real**.
Conviene hacerlo antes, porque si Laura contesta mal, eso no lo arregla la
conexión.

```bash
curl -s -X POST "https://app.acuarius.app/api/webhooks/meta?simulate=1" \
  -H "Content-Type: application/json" \
  -H "x-acuarius-secret: $CRON_SECRET" \
  --data '{
    "channel": "whatsapp",
    "external_id": "sim_s0qk4ihg",
    "contact_id": "573001112233",
    "contact_name": "Prueba",
    "text": "Hola, vi un apartamento en arriendo en Villa Santos"
  }'
```

`external_id` es el del canal de pruebas que Certain ya tiene. La respuesta del
agente vuelve en el JSON, sin mandar nada a nadie.

**Qué mirar en el ensayo**, en este orden:

1. ¿Contesta con inmuebles **reales** del catálogo, con su código y su precio?
2. ¿Pregunta una cosa a la vez, o suelta el cuestionario entero?
3. ¿Distingue arriendo de venta y lo dice en el `[CALIFICACION]`?
4. ¿Se inventa algo? Precios, direcciones, plazos. Es el fallo que más caro sale.
5. ¿Escala cuando no sabe, en vez de improvisar?

---

## Las tres cosas que hay que arreglar antes, no después

### 1. El canal tiene que apuntar al tablero correcto

El canal de pruebas de Certain tiene `pipeline_id` vacío. Cuando eso pasa, el
lead cae en el **tablero por defecto de la cuenta**, y el de Certain es
`Principal` — que tiene **1 lead**, mientras el trabajo de verdad vive en
`Arriendo`, con 340.

Un lead que nace en un tablero donde nadie mira es un lead perdido sin que nada
falle a la vista. **Al crear el canal real hay que fijarle el `pipeline_id`.**

La regla de calificación ya enruta a `arriendo` y `venta`, pero eso ocurre
*después* del veredicto: hasta entonces el lead vive donde lo dejó el canal.

### 2. Laura está poco entrenada para lo que se le pide

Estado real: **750 caracteres** de contexto del negocio y **cero preguntas
frecuentes**. Para «que gestione cualquier conversación y la lleve a cierre» eso
es poco. Antes de conectar conviene cargarle:

- **Preguntas frecuentes** — las diez que más repiten los asesores de Certain.
  Es lo que más sube la calidad por unidad de esfuerzo.
- **Contexto del negocio** más completo: cómo funciona el arriendo allí,
  requisitos de los codeudores, plazos, qué incluye la administración.
- **Campos a capturar**: hoy son `nombre` y `celular`. Falta al menos el
  presupuesto y la zona, que es lo que un asesor necesita para no volver a
  empezar la conversación.

### 3. La ventana de 24 horas y la plantilla

Un asesor solo puede escribir libremente dentro de las 24 h desde el último
mensaje del cliente. Fuera de eso hace falta una **plantilla aprobada por Meta**,
y aprobarla tarda.

Si Certain va a escribir primero alguna vez, la plantilla hay que mandarla a
aprobación **antes** de la prueba, no cuando haga falta.

---

## La conexión, paso a paso

Cada paso dice **cómo comprobar que salió bien**. No basta con que la pantalla
no dé error.

### Paso 1 — El número, en la WABA de Certain

El número debe estar dado de alta en la cuenta de WhatsApp Business del
portafolio de Certain, al que Alejandro tiene acceso de administrador.

**Comprobar**: aparece en Configuración del negocio → Cuentas de WhatsApp, con
su nombre para mostrar verificado.

### Paso 2 — Conectar desde Acuarius

Con la sesión de Facebook de Alejandro (la que tiene rol de administrador en la
app), en Acuarius: **Conversaciones → Agentes IA → conectar WhatsApp**.

**El primer resultado es la prueba de fuego.** Si el diálogo de Meta abre y deja
elegir el portafolio, el acceso estándar funciona y seguimos. Si sale *«Función
no disponible — estamos actualizando otros detalles de la app»*, el rol por
portafolio no basta y hay que añadir la cuenta a los roles clásicos de la app.

**Comprobar** que quedó guardado:

```sql
select channel, channel_name, external_id, waba_id, is_active,
       client_id, pipeline_id, (access_token is not null) as con_token
from channel_connections
where user_id = '<id de Certain>' and channel = 'whatsapp';
```

Tiene que traer `external_id` con el **phone_number_id real** (no `sim_…`),
`waba_id` puesto, `con_token = true` y el `pipeline_id` del tablero Arriendo.

### Paso 3 — Enganchar a Laura

El canal nuevo nace sin agente. Hay que asignarle **Laura** y el cliente
`pro_main`.

**Comprobar**: `agent_id` no nulo y `client_id = 'pro_main'`.

### Paso 4 — Que Meta esté mandando los eventos

En el panel de la app, la WABA de Certain tiene que estar suscrita a la app y al
campo `messages`.

**Comprobar de verdad**: mandar un WhatsApp **desde un teléfono cualquiera** al
número de Certain y ver que aparece en el inbox. Si no llega, mirar `error_log`:
desde el 27-09 una firma inválida deja rastro ahí.

### Paso 5 — La conversación completa

Desde un teléfono que no sea de nadie del equipo, hacer la conversación entera:

1. Escribir como un cliente real: *«Hola, busco apartamento en arriendo en el norte»*
2. Dejar que Laura pregunte y responder con naturalidad
3. Dar nombre y celular cuando los pida
4. Llegar hasta que califique

**Comprobar, uno por uno:**

- [ ] El mensaje entra al inbox y Laura responde en menos de un minuto
- [ ] Los inmuebles que menciona **existen** en el catálogo, con su código
- [ ] Se creó el lead, con nombre y celular
- [ ] El lead está en el tablero **Arriendo**, no en Principal
- [ ] Tiene la etiqueta de calificado y su `custom_fields.calificacion`
- [ ] Quedó asignado a un asesor
- [ ] El historial del contacto tiene la conversación

### Paso 6 — El relevo al humano

Escribir *«quiero hablar con una persona»* y comprobar que:

- [ ] Laura responde con su frase de escalada y **se calla**
- [ ] La conversación pasa a `human` en el inbox
- [ ] Un asesor puede responder desde el inbox y el mensaje llega al teléfono

Este es el paso que más se olvida probar y el que más molesta al cliente cuando
falla: el agente contestando encima del asesor.

### Paso 7 — La atribución de pauta

Si Certain tiene un anuncio de clic-a-WhatsApp corriendo, pulsar el anuncio y
escribir desde ahí.

**Comprobar**: el lead nuevo trae `Anuncio`, `ID de anuncio`, `Clic de anuncio` y
`Plataforma` en sus campos propios. Si viene vacío, el `referral` no llegó y hay
que mirar el webhook.

---

## Si algo sale mal

| Síntoma | Dónde mirar |
|---|---|
| «Función no disponible» al conectar | Roles de la app: la cuenta necesita rol clásico, no solo por portafolio |
| Conecta pero no llegan mensajes | Suscripción de la WABA al campo `messages`; y `error_log` por firma inválida |
| Llegan mensajes pero Laura no contesta | `is_active` del agente, y que el canal tenga `agent_id` |
| Laura contesta pero no se crea el lead | La política de creación del canal (`always` / `on_contact`) |
| El lead aparece en Principal | Falta el `pipeline_id` en el canal |
| Laura se inventa precios | El catálogo no se le está inyectando: revisar `client_properties` y el cliente del canal |

---

## Después de la prueba

Si sale bien, lo que queda para que esto sea un producto y no una demo:

1. **App Review** — para que los clientes conecten solos. La verificación ya está;
   falta reactivar la campaña 3-4 días para tener datos en el panel, grabar el
   video y enviar los siete permisos en una sola solicitud. Plan en
   `REVISION-META.md`.
2. **Entrenar a Laura de verdad** — preguntas frecuentes y contexto.
3. **Herramientas para el agente** — agendar visita y mandar propuesta. Hoy solo
   conversa, califica y escala: no puede cerrar.
