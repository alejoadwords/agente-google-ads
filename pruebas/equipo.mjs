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

console.log('\nLos dos caminos de aceptación crean la fila\n');

chk('el ayudante existe', /async function asegurarFilaDeUsuario\(userId, correo, nombre\)/.test(team));

// Camino 1: vinculación automática al registrarse con el correo invitado.
chk('vincularPorCorreo la crea',
    /vincularPorCorreo[\s\S]*?await asegurarFilaDeUsuario\(userId, correo, inv\.member_name\)/.test(team));

// Camino 2: canje del enlace de invitación.
chk('el canje del enlace también',
    /action.*redeem[\s\S]*?await asegurarFilaDeUsuario\(userId, email \|\| inv\.member_email, inv\.member_name\)/.test(team));

console.log('\nCómo la crea\n');

chk('usa ignore-duplicates, no merge',
    /resolution=ignore-duplicates/.test(team));
chk('y NO usa merge-duplicates, que le pisaría el plan a quien ya tenga cuenta',
    !/asegurarFilaDeUsuario[\s\S]{0,700}?merge-duplicates/.test(team));
chk('manda on_conflict (sin él, el segundo guardado da 409)',
    /rest\/v1\/users\?on_conflict=id/.test(team));
chk('escribe id, email y nombre', /\{ id: userId, email: correo, name: nombre \|\| null \}/.test(team));

console.log('\nQue no tumbe la invitación\n');

chk('el ayudante atrapa su propio error',
    /asegurarFilaDeUsuario[\s\S]{0,900}?catch \(e\)[\s\S]{0,200}?console\.error\('\[team\] fila espejo:'/.test(team));
chk('y solo se llama si la aceptación salió bien',
    /if \(rCanje\.ok\) await asegurarFilaDeUsuario/.test(team));

console.log('\nEl nombre viaja hasta el ayudante\n');

chk('vincularPorCorreo pide member_name en su consulta',
    /status=eq\.invited&select=id,owner_user_id,owner_name,role,member_name/.test(team));

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
