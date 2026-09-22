# Encuestas NPS — cómo funcionan

Para atender a un cliente que pregunta por la encuesta de satisfacción: qué
hace cada pieza, en qué orden, y dónde mirar cuando algo no llega.

Escrito leyendo el código, no de memoria. Si se toca `api/_nps.js`,
`api/nps.js` o `actionSendNps` en `api/cron-automations.js`, revisar esto.

---

## En una frase

Una automatización manda un correo con una escala del 0 al 10; el cliente
pulsa un número, cae en una página donde puede escribir y contestar preguntas
propias de la cuenta, y su nota etiqueta al lead — lo que a su vez puede
disparar otra automatización.

---

## El recorrido

**1. Se dispara desde una automatización.** Es la única vía: no hay envío
manual. El paso es `send_nps` («Encuesta NPS» en la paleta del constructor).
El disparador lo elige el cliente; lo habitual es `stage_changed` a Ganado, o
un `wait` de N días.

**2. El motor la manda** — `actionSendNps` en `api/cron-automations.js`, que
corre cada 10 minutos. Antes de enviar inserta una fila en `nps_responses`
con un **token único** y una **copia de las preguntas tal como están en ese
momento** (columna `preguntas`).

Se salta si el lead no tiene email (`skipped · El lead no tiene email`) y
falla si no hay `RESEND_API_KEY`.

**3. El correo** va con `emailHtml()` —la plantilla de la casa— y con el logo y
el color de la cuenta. Los once números son once enlaces:

```
https://app.acuarius.app/api/nps?t={token}&s={nota}
```

Rojo el 0–6, ámbar el 7–8, verde el 9–10.

**4. El clic en un número** (GET con `t` y `s`) hace tres cosas de una vez:

- guarda `score` y `responded_at`,
- etiqueta el lead con `nps promotor` (9–10), `nps neutro` (7–8) o
  `nps detractor` (0–6), quitando cualquier etiqueta `nps ` anterior,
- encola automatizaciones con el trigger **`tag_added`** para esa etiqueta.

Las tres solo en la PRIMERA respuesta (`first`).

**5. La página de gracias** enseña la carita según la nota, el pie configurado
para esa franja, las preguntas adicionales y una caja de comentario. Las
escalas son radios disfrazados, sin JavaScript, para que abran en cualquier
navegador.

**6. El POST** guarda `comment` y `answers` (un mapa `{idPregunta: valor}`).
Se valida contra la copia que viajó con el envío, no contra la configuración
de hoy.

**7. Se ve** en Análisis › Satisfacción y en la **ficha del contacto**
(`GET /api/nps?lead_id=`): nota, categoría con color, comentario y respuestas.

---

## Qué se puede configurar

Análisis › Satisfacción › **Personalizar encuesta**. Lo que no está en
`NPS_POR_DEFECTO` (`api/_nps.js`) no es configurable.

| Bloque | Campos |
|---|---|
| Correo | `asunto`, `intro`, `pregunta`, `etiquetaMin`, `etiquetaMax` |
| Página | `gracias`, `pieDetractor`, `pieNeutro`, `piePromotor`, `comentarioPlaceholder`, `boton`, `finalTitulo`, `finalTexto` |
| Marca | `logoUrl`, `color` (solo `#rrggbb`) |
| Preguntas | hasta 8, tipo `texto`, `escala5` o `escala10`, obligatorias o no |

Se guarda como las reseñas: **una fila en `user_profiles`** con `agent_key =
'__nps__'` y un mapa por cliente dentro. Una agencia con ocho clientes tiene
ocho encuestas y una sola fila.

El paso de la automatización solo puede sobreescribir `subject`, `question` y
`message` del correo — existía antes que la pantalla. Las preguntas y la marca
salen siempre de la configuración de la cuenta.

---

## El reporte

**NPS = % promotores − % detractores**, sobre los que respondieron. De −100 a
+100. Las preguntas propias se promedian si son escala y se listan si son
texto, agrupadas por `id + texto`: si dos textos distintos comparten id, se
separan, para que una pregunta reescrita no reetiquete lo ya contestado.

Lee hasta **1.000 filas**, acotadas al cliente activo.

---

## Lo que hay que saber antes de prometer nada

- **Solo cuenta la primera respuesta.** Quien vuelva a pulsar ve la nota
  guardada, no la nueva. La pantalla no puede decir «anotamos tu 10» mientras
  en la base hay un 9.
- **Las preguntas viajan con el envío.** Reescribir una mañana no cambia lo
  contestado ayer.
- **No se reenvía antes de 30 días** (`DIAS_ENTRE_ENCUESTAS` en
  `api/cron-automations.js`). Impide la ráfaga —una automatización que se
  dispara dos veces mandaba dos correos y creaba dos filas, falseando la tasa
  de respuesta y el NPS— pero **no** bloquea para siempre como la reseña:
  encuestar cada cierto tiempo es justo para lo que sirve. El candado mira la
  fecha de ENVÍO, no la de respuesta. Cuando salta, la bitácora dice
  `skipped · A este lead ya se le mandó la encuesta hace menos de 30 días`.
- **Requiere plan Pro o Agency** (va dentro de automatizaciones) y **email del
  lead**.
- **Sale por la cuota diaria de Resend**, que es de toda la plataforma. Ver la
  memoria `project_cuota_correo_diaria`.

---

## Si el cliente dice que no llega

1. **La ficha del contacto, caja Automatizaciones.** Dice si el paso corrió y,
   si falló, por qué. Ahí se resuelve casi todo sin salir de la pantalla.
2. **¿Tiene email el lead?** Es el motivo número uno del `skipped`.
3. **¿Está activa la automatización y el plan es de pago?** El motor cancela
   los trabajos de una cuenta que ya no es Pro.
4. **¿Se disparó el trigger?** Un `stage_changed` a Ganado no corre si el lead
   llegó a Ganado antes de crear la automatización.
5. **¿Cuota de Resend?** Un 429 en `automation_logs` lo dice tal cual.

Consulta de solo lectura:

```sql
select n.sent_at, n.responded_at, n.score, left(n.comment,60) as comentario
from nps_responses n
where n.user_id = '<user_id>'
order by n.sent_at desc limit 20;
```

---

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Configuración y valores por defecto | `api/_nps.js` |
| Página pública, respuesta y reporte | `api/nps.js` |
| El envío | `actionSendNps` en `api/cron-automations.js` |
| Pantalla de configuración | `npsCfgAbrir()` en `public/app.js` |
| Caja de la ficha del lead | `lfCargarNps()` en `public/app.js` |
| Tabla | `nps_responses` |
