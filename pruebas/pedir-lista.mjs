// pruebas/pedir-lista.mjs
//
// `pedirLista` existe para que una consulta que falla no se pueda confundir
// con «no hay nada». Esa confusión dejó a los cinco asesores de Certain sin su
// aviso diario el 23-09-2026 y no dejó ni un rastro.
//
// Lo que se comprueba es justo eso: que cada forma de fallar lance, y que una
// lista vacía legítima siga siendo una lista vacía legítima.

import { pedirLista } from '../api/_pedir.js';

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };
const lanza = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

const H = { apikey: 'x' };

// Caso legítimo: la base contesta bien y no hay filas.
globalThis.fetch = async () => new Response('[]', { status: 200 });
const vacio = await pedirLista('u', H, 'las tareas');
ok(Array.isArray(vacio) && vacio.length === 0, 'una lista vacía de verdad se devuelve tal cual');

// Y con filas.
globalThis.fetch = async () => new Response('[{"id":1}]', { status: 200 });
ok((await pedirLista('u', H, 'las tareas')).length === 1, 'y una lista con filas también');

// 504: el caso real que nos pasó con Supabase esta semana.
globalThis.fetch = async () => new Response('gateway timeout', { status: 504 });
let m = await lanza(() => pedirLista('u', H, 'las tareas'));
ok(m !== null, 'un 504 lanza en vez de devolver vacío');
ok(/las tareas/.test(m) && /504/.test(m), 'y el mensaje dice qué se pedía y qué pasó: ' + m);

// Red caída: ni siquiera hay respuesta.
globalThis.fetch = async () => { throw new Error('socket colgado'); };
m = await lanza(() => pedirLista('u', H, 'los leads'));
ok(/no se pudo contactar/.test(m || ''), 'un socket caído también lanza');

// PostgREST devuelve un OBJETO cuando el esquema no cuadra. Sin comprobarlo,
// `.length` da undefined y vuelve a parecer «no hay nada» — el mismo fallo
// disfrazado de otra cosa.
globalThis.fetch = async () => new Response('{"message":"column does not exist"}', { status: 200 });
m = await lanza(() => pedirLista('u', H, 'las citas'));
ok(/no es una lista/.test(m || ''), 'un objeto de error con 200 NO pasa por lista vacía');
ok(/column does not exist/.test(m || ''), 'y arrastra el motivo de PostgREST');

// Respuesta que no es ni JSON (una página de error del proxy, por ejemplo).
globalThis.fetch = async () => new Response('<html>502</html>', { status: 200 });
m = await lanza(() => pedirLista('u', H, 'los mensajes'));
ok(/no era JSON/.test(m || ''), 'y una respuesta que no es JSON tampoco');

process.exit(mal ? 1 : 0);
