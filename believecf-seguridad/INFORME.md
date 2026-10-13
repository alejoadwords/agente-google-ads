# Incidente de seguridad — believecf.org y armoniawellnesscenter.com

Hosting: Hostinger, cuenta `u963981646` (7 sitios). Revisión y limpieza: 05/06-10-2026.

## Resumen

Dos sitios de la cuenta estaban infectados: **believecf.org** y **armoniawellnesscenter.com**.
El atacante entró **con la contraseña real del administrador `america@amerikconecta.com`**,
conectó ambos sitios a **su propia cuenta de ManageWP** y desde ahí instaló dos plugins maliciosos
ocultos y creó administradores falsos. La limpieza está hecha y verificada; **falta cambiar
contraseñas**, sin lo cual el atacante puede volver a entrar.

## Cronología (UTC)

| Fecha | Evento |
|---|---|
| 18-09 08:56 | armoniawellnesscenter.com conectado a ManageWP (plugin Worker) |
| 19-09 08:54 | believecf.org conectado a ManageWP |
| 05-10 11:52 | Plugin malicioso `asset-cache` instalado en ambos sitios |
| 05-10 15:23–15:24 | Inicios de sesión como `america@amerikconecta.com` desde 8 IPs distintas |
| 05-10 16:52–16:53 | Creación de 2 administradores falsos por sitio |
| 05-10 20:36 | Plugin malicioso `web-creatior` instalado en ambos sitios |
| 06-10 ~03:40 | Limpieza y verificación |

## Cómo entraron

- Todas las acciones maliciosas de hoy se hicieron **iniciando sesión como `america@amerikconecta.com`**,
  con la contraseña correcta, desde IPs de proxies residenciales (161.0.11.75, 170.83.233.57,
  72.56.184.171, 209.46.2.94, 191.96.150.99, 72.56.186.171, 173.209.233.112, 138.219.174.136,
  23.236.128.153, 72.56.185.57, 102.129.152.52, 72.56.187.146) y fingiendo ser el robot de Google.
- **No hubo correos de recuperación de contraseña**: el atacante ya tenía la contraseña.
- Para conectar ManageWP el 18-09 ya necesitaba esa contraseña, así que la tiene **desde antes del 18-09**.
- Solo cayeron los dos sitios donde esa cuenta es administradora con el correo como usuario.
  En diystudio323.com la misma persona usa el usuario `america`, y no fue tocado.

Origen más probable de la contraseña, en orden:
1. **Programa ladrón de contraseñas en el computador** de quien usa esa cuenta (Windows): roba las
   contraseñas guardadas en el navegador. Es la causa más común hoy.
2. **Contraseña reutilizada** en otro servicio que sufrió una filtración.
3. **Prueba de contraseñas**: el usuario es un correo que queda público en `/author/…` del sitio.

Para confirmarlo harían falta los registros de acceso de septiembre, que Hostinger no conserva por SSH.

## Qué hacía el malware

- `asset-cache` (oculto del panel): inyectaba `/asset-cache/fjs` en todas las páginas →
  pantalla falsa de Cloudflare con copia de comandos al portapapeles (*ClickFix*), robo de cookies y
  tokens del visitante, e instalación de un plugin desde `deleeue.lol` si visitaba un administrador.
  Servidores de control: `glegchner.com`, `193.149.189.187`, `saaverra.sbs`.
- `web-creatior` (oculto del panel y de las actualizaciones): servía una segunda carga ofuscada
  desde `renotad.com` por `admin-ajax.php?action=web_creatior_64`, no se mostraba a administradores
  conectados y borraba el malware de otros atacantes.

## Limpieza hecha (ambos sitios)

1. Respaldo completo previo (archivos + base de datos) en `~/incidente-20261006/` (privado).
2. Desconectado y borrado ManageWP Worker, su cargador `mu-plugins/0-worker.php` y sus 17 opciones.
3. Borrados los administradores falsos: `believecf`, `believecf_admin`,
   `armoniawellnesscenter`, `armoniawellnesscenter_admin` (contenido reasignado a `dev`).
4. Borrados `asset-cache` y `web-creatior`.
5. Borrado WP File Manager de believecf.org.
6. Cerradas todas las sesiones y regeneradas las claves de `wp-config.php`.
7. Verificado: núcleo de WordPress y plugins oficiales intactos; sin rastros en el servidor;
   los sitios cargan normal y las rutas maliciosas ya no existen.

Revisados y sin infección: diystudio323.com y maximotaxprous.com (amerikconecta.com y
konectastudios.com no son WordPress).

## Pendiente (urgente primero)

1. **Cambiar ya la contraseña de `america@amerikconecta.com`** en ambos sitios y en cualquier otro
   lugar donde se haya usado, empezando por el correo. Hasta entonces el atacante puede volver a entrar.
2. **Revisar con antivirus el computador** de quien usa esa cuenta antes de escribir contraseñas nuevas en él.
3. Cambiar las contraseñas de `dev` y `Anna`, y la de la cuenta de Hostinger.
4. **Verificación en dos pasos** para todos los administradores y para Hostinger.
5. Actualizar WordPress (believecf 6.7.9 y armonia 6.8.10; la versión actual es la 7.1) y los plugins.
6. Quitar de believecf las ~30 páginas de demostración de la plantilla y que el correo no sea
   el nombre público del administrador.
7. diystudio323.com: borrar `user990001`, un administrador que dejó el importador de demos del tema
   ThemeREX, con una contraseña que venía en el paquete de demostración.
8. Revisar Google Search Console por avisos de seguridad.
9. Borrar en hPanel (Avanzado → Acceso SSH) la llave `claude-limpieza` al terminar.
