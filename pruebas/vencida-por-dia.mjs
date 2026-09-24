// pruebas/vencida-por-dia.mjs
//
// «Vencida» se cuenta por DÍA, no por hora.
//
// Contando por instante, una tarea puesta para hoy a las diez de la mañana
// salía como vencida a las once. A media tarde el panel de Certain enseñaba 27
// «vencidas» que eran el trabajo de esa misma mañana: de 36, veintiocho lo
// estaban por menos de un día y solo DOS llevaban más de tres. El equipo no
// iba atrasado; el contador mentía.
//
// Y un contador que siempre está en rojo deja de leerse, así que también se
// pierde el aviso los dos días en que sí hay algo atrasado de verdad.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
const agenda = readFileSync(join(RAIZ, 'api/agenda.js'), 'utf8');
const soporte = readFileSync(join(RAIZ, 'tools/soporte.mjs'), 'utf8');

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

// ── El servidor reparte por día ────────────────────────────────────────
ok(/const inicioDeHoy = new Date\(\); inicioDeHoy\.setHours\(0, 0, 0, 0\);/.test(agenda),
   'el servidor calcula el inicio del día');
ok(/else if \(vence < inicioDeHoy\.getTime\(\)\) out\.vencidas\.push/.test(agenda),
   'y solo va a «vencidas» lo de un día anterior');
ok(!/vence < ahora\) out\.vencidas/.test(agenda),
   'ya no se compara contra el instante actual');
ok(/else if \(vence <= finDeHoy\.getTime\(\)\) out\.hoy\.push/.test(agenda),
   'todo lo de hoy cae en «hoy», sea de la mañana o de la tarde');

// ── La interfaz, igual ─────────────────────────────────────────────────
const fn = app.slice(app.indexOf('function tareaVencida(due)'));
const tareaVencida = new Function('crmFechaLocal', fn.slice(0, fn.indexOf('\n}\n') + 2) + '; return tareaVencida;')(
  (d) => { const p = (n) => String(n).padStart(2, '0');
           return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); });

const hoyA = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const ayer = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString(); };
const manana = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString(); };

ok(tareaVencida(hoyA(1)) === false, 'una tarea de hoy a la 1 de la mañana NO está vencida');
ok(tareaVencida(ayer()) === true, 'una de ayer sí');
ok(tareaVencida(manana()) === false, 'y una de mañana no');
ok(tareaVencida(null) === false, 'sin fecha, no está vencida');

// La cita sí distingue «ya pasó su hora», que es cuando se puede cerrar.
const fp = app.slice(app.indexOf('function tareaPasada(due)'));
const tareaPasada = new Function(fp.slice(0, fp.indexOf('\n}\n') + 2) + '; return tareaPasada;')();
ok(tareaPasada(hoyA(1)) === true, 'pero una cita de esta mañana SÍ ya pasó: se puede cerrar');
ok(tareaPasada(manana()) === false, 'y una de mañana no');

// ── La radiografía de soporte ──────────────────────────────────────────
ok(/due_at < current_date\) as vencidas/.test(soporte), 'la radiografía cuenta por día');
ok(/vencidas_de_verdad/.test(soporte) && /interval '3 days'/.test(soporte),
   'y separa las que llevan más de 3 días, que son las abandonadas');
ok(/de_hoy_sin_hacer/.test(soporte), 'las de hoy se cuentan aparte, no como atraso');
ok(/llevan más de 3 días vencidas/.test(soporte),
   'el aviso habla de las abandonadas, no de todo lo que pasó de hora');

process.exit(mal ? 1 : 0);
