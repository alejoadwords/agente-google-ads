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

**Tickets abiertos.**

```sql
select created_at, subject, status from public.support_tickets
where user_id = 'user_XXX' order by created_at desc limit 20;
```

## Lo que NO se consulta

- El contenido de `chat_messages` y `conversation_notes`: son conversaciones de
  terceros. Para diagnosticar basta saber que existen y cuándo.
- Los datos de contacto de sus leads (nombre, correo, teléfono) salvo que el
  cliente pida ayuda con un registro concreto y lo identifique él.
- Tokens y claves de `platform_connections` o `channel_connections`. Para saber
  si una conexión sirve basta `token_expires_at`.

## Probar en producción como un usuario real

Se puede, con Clerk: pedir un *sign-in token* con la clave secreta y canjearlo
por `strategy=ticket`. Es la forma de reproducir un fallo con los datos reales
del cliente sin pedirle la contraseña. **Revocar la sesión al terminar.** Y
avisar a Alejandro antes: es entrar en la cuenta de otro.

Ojo: las variables `sensitive` de Vercel **no se pueden leer de vuelta**; si
`decrypt=true` devuelve algo que empieza por `eyJ2IjoidjIi`, está cifrada y no
sirve.
