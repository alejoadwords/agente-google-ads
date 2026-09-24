// pruebas/google-ads-sin-permiso.mjs
//
// «No tienes permiso sobre esa cuenta» no es una avería: es que el Google
// conectado no alcanza ese identificador. Se devolvía como 502, y el navegador
// —que reporta los 5xx y se salta los 403 a propósito— lo anotaba una y otra
// vez: 39 veces entre el 16 y el 24-09-2026, con el mensaje de Google en
// inglés y sin decirle al usuario qué hacer. De paso era el error con más
// recuento de toda la plataforma, así que tapaba a los que sí eran averías.
//
// Lo que se comprueba aquí es la clasificación, que es donde se confunden las
// tres cosas: token expirado, sin permiso, y avería de verdad.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

// `gaqlAuthError` es interna del endpoint: se extrae y se ejecuta suelta.
const src = readFileSync(join(RAIZ, 'api/google-ads.js'), 'utf8');
const desde = src.indexOf('function gaqlAuthError(');
const cuerpo = src.slice(desde);
const gaqlAuthError = new Function(cuerpo.slice(0, cuerpo.indexOf('\n}\n') + 2) + '; return gaqlAuthError;')();

// Lo que devolvió Google de verdad para la cuenta de Alejandro.
const REAL_SIN_PERMISO = { error: { code: 403, message: 'The caller does not have permission',
  status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' } }] }] } };
const REAL_EXPIRADO = { error: { code: 401, message: 'Request had invalid authentication credentials.',
  status: 'UNAUTHENTICATED' } };
const AVERIA = { error: { code: 500, message: 'Internal error encountered.', status: 'INTERNAL' } };

ok(gaqlAuthError(null) === null, 'una respuesta sin error no clasifica nada');
ok(gaqlAuthError({ results: [] }) === null, 'ni una respuesta con datos');

const p = gaqlAuthError(REAL_SIN_PERMISO);
ok(p.status === 403, 'sin permiso devuelve 403, no 502 — que es lo que el navegador NO reporta (era ' + p.status + ')');
ok(p.body.sinPermiso === true, 'y lo marca, para poder distinguirlo del token expirado');
ok(p.body.needsConnect === true, 'sin perder la señal que la pantalla ya entendía');
ok(/no está en la cuenta de Google que conectaste/.test(p.body.error), 'con un mensaje en español que dice qué pasa');
ok(/identificador del cliente/.test(p.body.error), 'y qué hacer, que es lo que faltaba');
ok(!/caller does not have permission/i.test(p.body.error), 'sin dejar pasar el mensaje de Google en inglés');

const e = gaqlAuthError(REAL_EXPIRADO);
ok(e.status === 401, 'el token expirado sigue siendo 401');
ok(e.body.needsConnect === true && !e.body.sinPermiso, 'y NO se marca como sin permiso: se arregla reconectando');

const a = gaqlAuthError(AVERIA);
ok(a.status === 502, 'una avería de verdad sigue siendo 502, para que se reporte');
ok(!a.body.sinPermiso, 'y no se disfraza de problema de permisos');

// Sin el `code`, solo por el texto: Google no siempre manda los dos.
ok(gaqlAuthError({ error: { message: 'The caller does not have permission' } }).status === 403,
   'basta el texto para clasificarlo, aunque no venga el código');
ok(gaqlAuthError({ error: { status: 'PERMISSION_DENIED', message: 'x' } }).status === 403,
   'y basta el status PERMISSION_DENIED');

// La pantalla tiene que tener las dos tarjetas, y decir cosas distintas.
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
ok(/function pulsoSinPermisoCard/.test(app), 'la pantalla de clientes tiene tarjeta propia para esto');
ok(/if \(d && d\.sinPermiso\) sinPermiso\+\+;/.test(app), 'y la cuenta aparte de las conexiones expiradas');
ok(!/pulsoSinPermisoCard[\s\S]{0,400}conexión expirada/.test(app),
   'la tarjeta nueva no dice «conexión expirada», que sería mentira');

process.exit(mal ? 1 : 0);
