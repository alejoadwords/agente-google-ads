// pruebas/hoy-en-su-zona.mjs
//
// «Hoy» en la lista de tareas es el día de quien mira, no el del servidor.
// La función corre en UTC: desde las 7 p. m. de Colombia el servidor ya está
// en mañana, y las tareas de hoy salían como vencidas y las de mañana en «Hoy»
// —todas las noches—. Se vio el 06-10-2026 revisando el móvil de VIVA 1A.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { limitesDeHoy } from '../api/agenda.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + extra)); if (!c) mal++; };
const iso = (ms) => new Date(ms).toISOString();

console.log('\nEl día se corta en la zona de quien mira\n');
// 7:26 p. m. del martes 6 en Bogotá = 00:26 UTC del miércoles 7.
const noche = Date.parse('2026-10-07T00:26:00Z');
const b = limitesDeHoy('America/Bogota', noche);
ok(iso(b.inicio) === '2026-10-06T05:00:00.000Z', 'a las 7:26 p. m. en Bogotá, hoy sigue siendo el martes 6', iso(b.inicio));
ok(iso(b.fin) === '2026-10-07T04:59:59.999Z', 'y termina a la medianoche de Bogotá', iso(b.fin));
ok(limitesDeHoy(null, noche).inicio === b.inicio, 'sin zona, la de Bogotá');
ok(limitesDeHoy('Zona/Inventada', noche).inicio === b.inicio, 'con una zona que no existe, también, sin romper');
ok(iso(limitesDeHoy('America/Mexico_City', noche).inicio) === '2026-10-06T06:00:00.000Z', 'Ciudad de México va una hora detrás');
ok(iso(limitesDeHoy('Europe/Madrid', Date.parse('2026-10-06T23:30:00Z')).inicio) === '2026-10-06T22:00:00.000Z',
   'y en Madrid, pasada su medianoche, ya es el día siguiente');

console.log('\nLos que piden la lista mandan su zona\n');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
const movil = readFileSync(join(RAIZ, 'public/movil-datos.js'), 'utf8');
const api = readFileSync(join(RAIZ, 'api/agenda.js'), 'utf8');
const pedidas = app.match(/\/api\/agenda\?tareas=1[^\n]*/g) || [];
ok(pedidas.length >= 2 && pedidas.every(l => l.includes('zonaQS()')), 'la web, en cada petición de tareas (' + pedidas.length + ')');
ok(/\/api\/agenda\?tareas=1' \+ q \+ zona\(\)/.test(movil), 'el móvil también');
ok(/limitesDeHoy\(url\.searchParams\.get\('tz'\)\)/.test(api) && !/inicioDeHoy\.setHours/.test(api), 'y el servidor ya no corta con su propio reloj');

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);
