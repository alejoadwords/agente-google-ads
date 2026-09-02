---
name: soporte
description: Atender un reporte de un cliente de Acuarius — diagnosticar su cuenta, distinguir mal uso de fallo del producto y redactar la respuesta. Úsalo cuando un cliente reporte algo (Certain Pezzano u otro), cuando alguien diga "no me llegan los leads", "no veo mis contactos", "no funciona X", cuando haya que revisar la cuenta de alguien, o al abrir una sesión dedicada a soporte.
---

# Soporte a clientes de Acuarius

Acuarius es un CRM y plataforma de marketing con IA para LatAm
(app.acuarius.app). Vanilla JS sin framework, funciones edge en Vercel,
Supabase como base y Clerk para identidad. El mapa completo está en
`CLAUDE.md`; los detalles de cada módulo, en el índice de memoria.

Este manual es para **atender a un cliente**, no para programar.

## Lo primero, siempre: mirar la cuenta

Antes de teorizar sobre por qué «no le llegan los leads», se mira:

```bash
node tools/soporte.mjs <parte del correo>
```

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
3. **No se suplanta a nadie.** El modo soporte se construyó y se quitó, porque
   la identidad y el plan seguían siendo los del admin. Existe
   `api/diagnostico.js` justo para no tener que entrar en la cuenta de nadie.
   Entrar como el usuario (con un *ticket* de Clerk) es reproducir un fallo con
   sus datos reales: se avisa antes y se revoca la sesión al terminar.
4. **Las respuestas al cliente se firman «Equipo de Soporte — Acuarius»**,
   nunca con un nombre propio.
5. **Nunca prometer lo que no está.** Si algo no existe todavía, se dice. Lo
   que hay publicado está en `public/novedades.json`.

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

## Si resulta ser un fallo del producto

El arreglo se hace con el criterio de siempre:

- **Fallar a la vista, nunca en silencio.** Preguntarse «¿qué se ve si esto
  falla?». La mayoría de fallos graves aquí han sido cosas que fallaban sin
  decir nada.
- **Verificar la integración, no solo el código**: rastrear todos los caminos
  que alimentan el dato y probarlo ejecutándolo.
- **Verificar el despliegue, no el estado**: `READY` no prueba que producción
  sirva tu código; grep del cambio en el asset servido.
- **Revisar la interfaz antes de publicar** si el arreglo se ve.

## Dónde está la verdad

| Qué | Dónde |
|---|---|
| Síntomas y sus causas | `.claude/skills/soporte/sintomas.md` |
| Consultas de solo lectura | `.claude/skills/soporte/consultas.md` |
| Mapa de módulos y endpoints | `.claude/skills/soporte/modulos.md` |
| Detalle de cada módulo y sus trampas | índice de memoria (`MEMORY.md`) |
| Qué se ha publicado y cuándo | `public/novedades.json` |
| Puesta en marcha de un cliente nuevo | `PUESTA-EN-MARCHA.md` |
| Estado de Meta (bloquea a todos) | memoria `project_meta_acceso_avanzado` |

El mapa de módulos se regenera cuando quede viejo:

```bash
node tools/mapa-modulos.mjs > .claude/skills/soporte/modulos.md
```

## Cuentas que ya se atienden

- **Certain Pezzano** — `direccioncomercial@certainpezzano.com` (dueña, plan
  pro) y `asesor1@certainpezzano.com`. Inmobiliaria; sus leads viven en el
  tablero **Arriendo**, no en el Principal, cosa que despista al mirar. Usan
  mucho la nota al responsable: la dueña escribe y Maira Ballesteros (vendedora,
  el único asiento) atiende. Ha reportado tres cosas, las tres ya arregladas:
  seguimientos de leads perdidos, leads marcados «sin actividad» teniendo tarea
  programada, y las notas al responsable que no avisaban.
