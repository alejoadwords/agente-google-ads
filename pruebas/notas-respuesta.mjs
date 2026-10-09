// pruebas/notas-respuesta.mjs
//
// Las notas dirigidas (al responsable o con @) eran de ida: el asesor las leía
// y no tenía por dónde contestar (09-10-2026). Ahora se responden, y lo que
// se protege es:
//
//   1. Que solo responda quien participa en la nota (quien la escribió o a
//      quien iba) — lo decide el SERVIDOR, no un botón escondido.
//   2. Que la respuesta vaya al otro participante, también cuando la nota la
//      escribió el dueño, que no guardaba `actor_id`.
//   3. Que responder no necesite ser de dirección (empezar sí).
//   4. Que responder marque la nota como leída y avise igual que una nota.
//   5. Que la campana, la ficha y el móvil usen el mismo camino.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
const api = leer('api/lead-activities.js');
const correo = leer('api/_aviso-lead-nota.js');
const app = leer('public/app.js');
const movil = leer('public/movil-app.js');

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const post = api.slice(api.indexOf("if (req.method === 'POST')"), api.indexOf("// DELETE — delete activity"));

console.log('\nEl servidor decide quién responde y a quién va\n');
ok(/const autor = m\.actor_id \|\| userId;/.test(post), 'sin actor_id, la nota es del dueño');
ok(/if \(actorId !== m\.para && actorId !== autor\) \{\s*\n\s*return jsonResp\(\{ error: 'Solo puede responder quien escribió la nota o a quien iba\.' \}, 403\);/.test(post),
   'solo responden quien la escribió o a quien iba (403)');
ok(/respuesta = \{ orig, para: actorId === m\.para \? autor : m\.para \};/.test(post), 'la respuesta va al otro participante');
ok(/lead_id = orig\.lead_id;/.test(post), 'la respuesta vive en la ficha de la nota, diga lo que diga el navegador');
ok(/user_id=eq\.\$\{encodeURIComponent\(userId\)\}&type=eq\.nota/.test(post), 'la nota original se busca dentro de la cuenta');
ok(/if \(!orig \|\| !m\.para\) return jsonResp\(\{ error: 'Esa nota no existe o no iba dirigida a nadie\.' \}, 404\);/.test(post), 'solo se responden notas dirigidas');
ok(/\$\{respuesta \? '' : filtroMios\}/.test(post), 'participar basta: si el lead cambió de dueño, la conversación no se corta');
ok(/if \(respuesta && type !== 'nota'\) return jsonResp/.test(post), 'una respuesta es siempre una nota');

console.log('\nResponder no exige ser de dirección; empezar sí\n');
ok(/if \(avisar && !actorMandaEnLaCuenta\) \{/.test(post), 'el permiso de dirección mira solo `avisar`');
ok(!/responde_a[\s\S]{0,40}actorMandaEnLaCuenta/.test(post), 'y la respuesta no pasa por él');

console.log('\nLa respuesta guarda lo necesario y avisa\n');
ok(/actor_id: actorId, \.\.\.\(firma \? \{ actor: firma \} : \{\}\),\s*\n\s*responde_a: respuesta\.orig\.id,/.test(post), 'lleva su autor siempre, también el dueño, y a qué responde');
ok(/en_respuesta_a: String\(respuesta\.orig\.content \|\| ''\)\.slice\(0, 160\)/.test(post), 'y un trozo de la nota original, para leerla en contexto');
ok(/users\?id=eq\.\$\{encodeURIComponent\(actorId\)\}&select=name/.test(post), 'el dueño firma con su nombre');
ok(/respuesta\.orig\.metadata\.para === actorId && !respuesta\.orig\.metadata\.leida_at/.test(post), 'responder marca leída la nota de quien responde');
ok(/if \(avisar \|\| mencionado \|\| respuesta\) \{/.test(post), 'avisa como una nota: correo, campana y teléfono');
ok(/te respondiste a ti mismo, no hay a quién avisar/.test(post), 'y si no hay a quién, lo dice en vez de callarse');
ok(/respuesta: respuesta \? String\(respuesta\.orig\.content \|\| ''\) : null/.test(post), 'el correo sabe que es una respuesta');
ok(/respondió tu nota sobre/.test(correo) && /Tu nota decía/.test(correo), 'y lo redacta como respuesta, con lo que decía la nota');
ok(/en_respuesta_a: a\.metadata\?\.responde_a \? \(a\.metadata\.en_respuesta_a \|\| ''\) : null/.test(api), 'la campana recibe a qué responde');

console.log('\nUn solo camino en la web y en el móvil\n');
ok((app.match(/function notaResponder\(/g) || []).length === 1, 'notaResponder existe una vez');
ok(/await notaResponder\(id, txt, aviso && aviso\.lead_id\)/.test(app), 'la campana responde por él');
ok(/await notaResponder\(id, txt, leadId\)/.test(app), 'la ficha también');
ok(/await notaResponder\(id, texto, a && a\.lead_id\)/.test(movil), 'y el móvil');
ok(/responde_a: notaId/.test(app) && !/responde_a/.test(movil.replace(/notaResponder/g, '')), 'el móvil no arma su propia petición');
ok(/function notaRespondidaTexto\(d\)/.test(app) && /el aviso no salió/.test(app), 'nunca dice «enviada» si el aviso no salió');
const fila = movil.slice(movil.indexOf('function pintarAvisos('), movil.indexOf('function responderAviso('));
ok(/<div class="aviso-fila">/.test(fila) && !/<button class="aviso-fila"/.test(fila), 'en el móvil no hay un botón dentro de otro');
ok(/function lfPuedoResponder\(a\)/.test(app) && /a\.metadata\.para === yo \|\| a\.metadata\.actor_id === yo/.test(app), 'en la ficha, «Responder» solo a quien participa');

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);
