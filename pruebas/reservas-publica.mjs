// La página pública de reservas: node pruebas/reservas-publica.mjs
//
// El circuito completo (reservar de verdad, la carrera de dos peticiones a la
// vez, cancelar) se prueba con `node pruebas/servidor-reservas.mjs`, que monta
// el endpoint REAL contra la base. Esto es el cinturón: lo que no se puede
// perder por el camino y que un `node --check` no ve.

import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/booking-public.js', import.meta.url), 'utf8');
const pag = readFileSync(new URL('../public/reservar.html', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nLas rutas llegan a la página\n');
{
  const rutas = (vercel.rewrites || []).reduce((m, r) => (m[r.source] = r.destination, m), {});
  chk('/reservar/:token → reservar.html', rutas['/reservar/:token'] === '/reservar.html');
  chk('/cita/:token → reservar.html', rutas['/cita/:token'] === '/reservar.html');
  // El catch-all devuelve 200 con el shell de la app para cualquier ruta que no
  // sea /api: sin estas dos reglas, un enlace de reservas no daría error — se
  // abriría la aplicación, que es peor porque parece que funciona.
  chk('la página lee el token de la propia URL',
      /\/\(reservar\|cita\)\\\/\(\[a-f0-9\]\{24,64\}\)/.test(pag));
}

console.log('\nEl endpoint es público, pero no ingenuo\n');
{
  chk('el token tiene que tener forma de token', /esToken\s*=\s*\(t\)\s*=>\s*\/\^\[a-f0-9\]\{24,64\}/.test(api));
  chk('una página apagada lo dice, no devuelve 404',
      /apagada: true/.test(api) && /410/.test(api));
  chk('hay honeypot contra bots, y responde ok sin crear nada',
      /body\._hp/.test(api) && /ok: true, cita: null/.test(api));
  chk('el token de cada cita se genera con getRandomValues, no con Math.random',
      /crypto\.getRandomValues/.test(api) && !/Math\.random/.test(api));
  chk('nunca se devuelve el user_id del negocio al público',
      !/user_id:\s*neg\.user_id/.test(api.slice(api.indexOf('const negocio = {'), api.indexOf('const servId'))));
}

console.log('\nLo que impide citar a dos personas a la vez\n');
{
  // La comprobación previa NO basta: entre mirar y escribir hay una rendija.
  // Quien cierra el hueco es el índice único de la base. Está comprobado a mano
  // con dos peticiones simultáneas, y este cinturón es para que nadie quite el
  // manejo del 23505 pensando que sobra.
  chk('se vuelve a comprobar justo antes de guardar', /sigueLibre\(inicio\.toISOString\(\)/.test(api));
  chk('y el choque de la base se traduce a un mensaje, no a un 500',
      /23505\|duplicate key/.test(api) && /ocupada: true/.test(api));
  chk('el aviso al cliente es el mismo en los dos caminos',
      (api.match(/Esa hora se acaba de ocupar/g) || []).length === 2);
  chk('la página devuelve a las horas cuando se la quitaron',
      /r\.d\.ocupada/.test(pag) && /elegirDia\(indiceDe\(sel\.dia\)\)/.test(pag));
}

console.log('\nUna reserva no se pierde por lo de después\n');
{
  // Lo que el cliente vino a hacer es reservar. Si falla el CRM, el correo o
  // Google Calendar, la cita sigue en pie y el fallo queda anotado.
  chk('si falla crear el contacto, la cita se guarda igual',
      /donde: 'intakeLead'/.test(api) && api.indexOf("donde: 'intakeLead'") < api.indexOf('const fila = {'));
  chk('un fallo de Google Calendar no invalida la cita',
      /donde: 'google calendar'/.test(api));
  chk('los avisos van en waitUntil: no hacen esperar a quien reserva',
      /contexto\.waitUntil\(cerrar\)/.test(api));
  chk('y si no hay waitUntil se esperan, en vez de abandonarlos',
      /else await cerrar/.test(api));
  chk('todo lo que falla queda en el registro de errores',
      (api.match(/registrarError\(/g) || []).length >= 4);
}

console.log('\nLo que la página promete, y solo cuando es verdad\n');
{
  // El recordatorio se puede apagar por negocio. Anunciarlo siempre sería
  // mentirle al cliente del negocio, que es quien menos culpa tiene.
  // Para cada mención se corta el trozo ANTERIOR del archivo, que es donde va
  // la condición. Con `matchAll` y un `.{0,150}` delante no valía: cada match
  // consume su contexto y el siguiente arranca ya pasada la condición.
  const menciones = [];
  const patron = /recordatorio|recordárte|recordamos/gi;
  for (let m; (m = patron.exec(pag)) !== null;) {
    menciones.push(pag.slice(Math.max(0, m.index - 200), m.index + 40));
  }
  chk('hay menciones al recordatorio', menciones.length > 0);
  chk('todas van condicionadas a N.recordatorio',
      menciones.every(t => /N\.recordatorio/.test(t)),
      menciones.filter(t => !/N\.recordatorio/.test(t)).join(' ⏎ '));
  chk('y el servidor manda ese dato', /recordatorio: \(Array\.isArray\(neg\.recordatorios\)/.test(api));
  chk('el correo de confirmación solo sale si hay a dónde mandarlo',
      /if \(!quien\.correo \|\| !process\.env\.RESEND_API_KEY\) return;/.test(api));
}

console.log('\nDetalles que se ven\n');
{
  chk('cerrado y lleno se pintan distinto',
      /\.dias button\.cerrado/.test(pag) && /\.dias button\.lleno/.test(pag));
  chk('se abre en el primer día con hueco', /if \(DIAS\[i\]\.cupo\) \{ k = i; break; \}/.test(pag));
  chk('con una sola persona no se pregunta con quién',
      /puede\.length <= 1/.test(pag));
  chk('las horas se enseñan en reloj de 12 h', /hour12: true/.test(pag));
  chk('el acento del negocio se aplica a la página', /aplicarAcento/.test(pag));
  chk('y solo si es un color de verdad', /\^#\[0-9a-f\]\{6\}\$/i.test(pag));
  chk('hay enlace para meterla en el calendario', /calendar\.google\.com\/calendar\/render/.test(pag));
  chk('todo lo que entra del servidor se escapa antes de pintarlo',
      /function esc\(t\)/.test(pag) && (pag.match(/esc\(/g) || []).length > 25);
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
