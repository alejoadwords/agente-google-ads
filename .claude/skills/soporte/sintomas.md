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
4. **¿Llegó al tope del plan?** free 10, pro/trial 2000, agency 10000. Al tope,
   los leads nuevos se rechazan.
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

- El envío sale **solo desde app.acuarius.app** (dominio verificado en Resend).
- **Cupo mensual por plan**: Pro 2.000, Agency 10.000.
- Los que rebotaron se **suprimen solos** y no vuelven a recibir.
- La etiqueta `no-email` da de baja: revisar que no la tengan.
- El motor va **por lotes cada 10 minutos**, no al instante.

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

- Hay **cupo de uso de IA** por plan (`ai_usage`). Agotado, no responde.
- Sonnet 5 **razona por defecto** y ese razonamiento comparte presupuesto con
  el texto: con `max_tokens` bajo la respuesta llega vacía.

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

## «Cambié algo y no lo veo»

Antes de investigar: **¿está desplegado?** Un `READY` en Vercel no prueba que
producción sirva ese código. Hacer grep del cambio en el asset servido:

```bash
curl -s "https://app.acuarius.app/app.js?v=$RANDOM" | grep -c "nombreDeLaFuncion"
```

Y ojo: el catch-all de `vercel.json` devuelve **200 con el shell de la app**
para cualquier ruta que no sea `/api`. Comprobar por contenido, nunca por
código de estado.
