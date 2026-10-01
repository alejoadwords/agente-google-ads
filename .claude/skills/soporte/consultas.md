# Consultas de solo lectura

Recetas para mirar la base cuando la radiografía no basta. **Solo `select`.**
Cambiar datos de un cliente se decide con Alejandro y se hace a la vista.

## Cómo se ejecuta

El token sale del llavero (sesión del CLI de Supabase). El **User-Agent es
obligatorio**: sin él, Cloudflare corta con `403 error code: 1010` y el error no
tiene nada que ver con el token. El SQL va por fichero: metido en `-d` se rompe
con sus propias comillas.

```bash
TOK=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
printf '%s' '{"query":"select 1;"}' > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/qgznzzhkuwxcknmcnrzn/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -H "User-Agent: SupabaseCLI/2.72.7" --data-binary @/tmp/q.json
```

## El esquema no está versionado

Los `CREATE TABLE` comentados dentro de `api/*.js` son **aspiracionales**: no
son la verdad. Antes de usar una columna, preguntarle a la base:

```sql
select column_name, data_type from information_schema.columns
where table_name = 'leads' order by ordinal_position;
```

Nombres que ya han hecho fallar consultas: `activities.done` (no
`completed_at`), `automations.active` y `automations."trigger"` (no
`is_active` ni `trigger_type`), `campaigns` no tiene `sent_count`.

## Recetas

**Por qué un lead concreto no se ve.** Sin sacar sus datos de contacto:

```sql
select l.id, l.stage, l.pipeline_id, p.name as tablero, p.client_id as tablero_cliente,
       l.client_id as lead_cliente, l.assigned_to, l.deleted_at, l.updated_at
from public.leads l left join public.pipelines p on p.id = l.pipeline_id
where l.user_id = 'user_XXX' and l.id = 'UUID';
```

Si `pipeline_id` es null, o el `client_id` del tablero no coincide con el del
lead, ahí está: existe pero no aparece en ninguna vista.

**Qué entró por dónde, últimos 30 días.**

```sql
select source, count(*), max(created_at) from public.leads
where user_id = 'user_XXX' and deleted_at is null
  and created_at > now() - interval '30 days'
group by source order by 2 desc;
```

**Si una automatización disparó alguna vez.**

```sql
select a.name, a.active, a."trigger", count(g.id) as ejecuciones, max(g.created_at) as ultima
from public.automations a left join public.automation_logs g on g.automation_id = a.id
where a.user_id = 'user_XXX' group by 1,2,3 order by 4 desc;
```

**Errores registrados de esa cuenta** (la tabla `error_log` es de 09-2026):

```sql
select created_at, message, context from public.error_log
where user_id = 'user_XXX' order by created_at desc limit 20;
```

**¿Corrió el cron?** La primera pregunta de medio soporte, y la que antes no
se podía contestar. Los dieciséis laten desde el 27-09-2026:

```sql
select cron, ultima_vez, ultimo_resultado, ultimo_fallo
from cron_latidos order by ultima_vez desc;
```

`ultimo_resultado` trae el resumen de la corrida (`{correos, cuentas,
fallidos…}`), así que distingue «no corrió» de «corrió y no había nada» de
«corrió y falló». La API de registros de Vercel da 404 con nuestro token: no
perder tiempo ahí.

**Cuánto correo se ha gastado hoy.** El tope de Resend es diario y **de la
plataforma entera**, no de cada cliente: una sola cuenta puede dejar a todas
las demás sin correo, y ya pasó el 21-09-2026.

```sql
select dia, enviados from email_cuota order by dia desc limit 10;
```

Para ver si fue una cuenta la que se lo comió, la columna `por_cuenta` de esa
misma fila lo reparte. `EMAIL_TOPE_DIARIO` vale **10.000**, no 100 — el 100 es
solo el valor por defecto del código si falta la variable.

**Quién entró a la cuenta de un cliente y por qué.** Cada entrada y cada salida
por «Cuentas de clientes» quedan registradas, con el motivo:

```sql
select admin_email, cuenta_email, motivo, inicio, fin
from acceso_cuentas order by inicio desc limit 20;
```

**Tickets abiertos.**

```sql
select created_at, subject, status from public.support_tickets
where user_id = 'user_XXX' order by created_at desc limit 20;
```

## Comprobar que una tabla nueva no nació abierta

Acuarius solo habla con Supabase desde el servidor con la clave de servicio, que
se salta RLS. Por eso toda tabla debe tener **RLS activo y ninguna política**.

```sql
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

Cualquier fila ahí es una tabla que **cualquiera con la clave pública puede leer
y escribir**. Y las políticas que dejan pasar a todos:

```sql
select tablename, policyname, cmd, roles::text from pg_policies
where schemaname = 'public' and (qual = 'true' or with_check = 'true');
```

Ojo: **un `PATCH` no sirve para comprobarlo** — una tabla protegida sin
políticas también responde 204 con cero filas. Ver [[project_rls_supabase]].

## Un endpoint nunca se cree un userId de la petición

El 14-09-2026 se cerraron cuatro que sí lo hacían y servían el token de OAuth
guardado de esa persona. Al revisar o escribir un endpoint que devuelva datos de
una cuenta, comprobar que el id sale del **token firmado**:

```bash
grep -l "req.query.userId\|req.body.userId" api/*.js
```

Cada resultado hay que mirarlo: solo vale si además verifica la firma del JWT.
Ver [[project_agujero_ads_sin_sesion]].

## Lo que NO se consulta

- El contenido de `chat_messages` y `conversation_notes`: son conversaciones de
  terceros. Para diagnosticar basta saber que existen y cuándo.
- Los datos de contacto de sus leads (nombre, correo, teléfono) salvo que el
  cliente pida ayuda con un registro concreto y lo identifique él.
- Tokens y claves de `platform_connections` o `channel_connections`. Para saber
  si una conexión sirve basta `token_expires_at`.

## Probar en producción como un usuario real

Desde el 30-09-2026 hay una puerta hecha para esto y es la que se usa:
**«Cuentas de clientes»** en la cabecera (solo `ADMIN_EMAILS`). Pide a Clerk un
*actor token*, así que la sesión **es la del cliente** y el JWT lleva `act.sub`
con quien entró; el motivo es obligatorio y queda en `acceso_cuentas`. Dentro,
`enSoporte()` corta la prueba, las invitaciones, el push, la analítica y los
tours para que nada se dispare en nombre de otro.

Sigue valiendo: **avisar a Alejandro antes** —es entrar en la cuenta de otro—,
mirar sin escribir, y salir por el botón «volver».

El camino viejo a mano (pedir un *sign-in token* con la clave secreta y
canjearlo por `strategy=ticket`) sigue funcionando y es lo que se usa para dar
sesión al navegador integrado sin contraseña. Si se usa, **revocar la sesión al
terminar**.

Ojo: las variables `sensitive` de Vercel **no se pueden leer de vuelta**; si
`decrypt=true` devuelve algo que empieza por `eyJ2IjoidjIi`, está cifrada y no
sirve.
