// La fila espejo del equipo: node pruebas/equipo.mjs
//
// Aceptar una invitación no creaba la fila del miembro en `users`, y cuatro
// tablas la exigen por clave foránea. El síntoma era un 500 al guardar
// preferencias que SOLO le pasaba a los miembros, nunca al dueño —porque el
// dueño la tiene desde que se registró—, y por eso costó verlo: la cuenta desde
// la que se prueba todo es siempre la del dueño.
//
// Hay DOS caminos de aceptación. Que uno la cree y el otro no deja el fallo
// vivo en la mitad de los casos, así que la prueba mira los dos.

import { readFileSync } from 'node:fs';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const team = readFileSync(new URL('../api/team.js', import.meta.url), 'utf8');
// La fila espejo se mudó a su propio módulo: la necesitan team.js y profile.js,
// y dos copias acabarían diferenciándose. Lo que se comprueba es lo mismo,
// ahora donde vive de verdad.
const espejo = readFileSync(new URL('../api/_usuario-espejo.js', import.meta.url), 'utf8');

console.log('\nLos dos caminos de aceptación crean la fila\n');

chk('el ayudante existe y está compartido',
    /export async function asegurarUsuario\(userId, correo, nombre\)/.test(espejo) &&
    /import \{ asegurarUsuario \} from '\.\/_usuario-espejo\.js'/.test(team));

// Camino 1: vinculación automática al registrarse con el correo invitado.
chk('vincularPorCorreo la crea',
    /vincularPorCorreo[\s\S]*?await asegurarFilaDeUsuario\(userId, correo, inv\.member_name\)/.test(team));

// Camino 2: canje del enlace de invitación.
chk('el canje del enlace también',
    /action.*redeem[\s\S]*?await asegurarFilaDeUsuario\(userId, email \|\| inv\.member_email, inv\.member_name\)/.test(team));

console.log('\nCómo la crea\n');

chk('usa ignore-duplicates, no merge',
    /resolution=ignore-duplicates/.test(espejo));
chk('y NO usa merge-duplicates, que le pisaría el plan a quien ya tenga cuenta',
    !/merge-duplicates/.test(espejo));
// Y antes de insertar mira si ya está: así no reescribe la fila de nadie ni
// llama a Clerk en cada guardado de una preferencia.
chk('primero comprueba si la fila ya existe',
    /users\?id=eq\.\$\{encodeURIComponent\(userId\)\}&select=id&limit=1/.test(espejo));
chk('y si esa consulta falla NO inserta a ciegas', /if \(hay === null\) return false;/.test(espejo));
chk('manda on_conflict (sin él, el segundo guardado da 409)',
    /rest\/v1\/users\?on_conflict=id/.test(espejo));
chk('escribe id, email y nombre', /\{ id: userId, email: c, name: n \|\| null \}/.test(espejo));
// Sin correo no se crea la fila: `users.email` identifica a la persona en
// soporte, en el panel y en los avisos. Una fila sin él es un fantasma.
chk('y sin correo no crea nada', /if \(!c\) return false;/.test(espejo));

console.log('\nQue no tumbe la invitación\n');

chk('el ayudante atrapa su propio error y nunca lanza',
    /\} catch \{\s*return false;\s*\}/.test(espejo) &&
    /asegurarUsuario\(userId, correo, nombre\)\.catch\(\(\) => false\)/.test(team));
chk('y solo se llama si la aceptación salió bien',
    /if \(rCanje\.ok\) await asegurarFilaDeUsuario/.test(team));

console.log('\nY ahora también en el registro normal\n');

// Aquí estaba el agujero: la fila solo se creaba al aceptar una invitación o al
// sincronizar a mano desde el panel. Quien se registraba por su cuenta y
// guardaba cualquier preferencia recibía un 500 con un 23503 — cinco cuentas
// entre el 10 y el 21 de septiembre de 2026.
chk('?me=1 la asegura en cada sesión, sea miembro o no',
    /searchParams\.get\('me'\)[\s\S]{0,500}?asegurarFilaDeUsuario\(userId\)/.test(team));
chk('sin hacer esperar al arranque', /contexto\.waitUntil\(espejo\)/.test(team));
chk('y el handler declara el contexto que usa', /function handler\(req, contexto\)/.test(team));

console.log('\nEl nombre viaja hasta el ayudante\n');

chk('vincularPorCorreo pide member_name en su consulta',
    /status=eq\.invited&select=id,owner_user_id,owner_name,role,member_name/.test(team));

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
