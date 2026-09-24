// pruebas/cerrar-cita.mjs
//
// Cerrar una cita pide la nota de cómo fue la visita y la deja en el historial
// del contacto. Lo que hay que proteger es el ORDEN: primero se guarda la nota
// y solo después se cierra la cita.
//
// Al revés, si fallara la nota, la cita quedaría cerrada y lo que pasó en la
// visita se habría perdido sin que nadie pudiera recuperarlo — el asesor ya
// está en la calle y no va a volver a escribirlo. En este orden, lo peor que
// pasa es una nota guardada con la cita todavía abierta: se ve y se repite.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
const api = readFileSync(join(RAIZ, 'api/lead-activities.js'), 'utf8');

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

// ── El orden ───────────────────────────────────────────────────────────
const fn = (app.split('async function crmCitaCerrarGuardar')[1] || '').split('\n}\n')[0];
ok(fn.length > 0, 'existe crmCitaCerrarGuardar');
const posNota = fn.indexOf("/api/lead-activities");
const posCierre = fn.indexOf("/api/agenda");
ok(posNota > -1 && posCierre > -1, 'guarda la nota y cierra la cita');
ok(posNota < posCierre, 'PRIMERO la nota, DESPUÉS el cierre — si se invierte, una nota perdida cierra la cita igual');

// Si la nota falla, la cita NO se cierra: hay que poder reintentar.
const bloqueNota = fn.slice(posNota, posCierre);
ok(/catch[\s\S]*?return;/.test(bloqueNota), 'si la nota falla, se corta ahí y la cita sigue abierta');
ok(/la cita sigue abierta/.test(bloqueNota), 'y se le dice al usuario con esas palabras');

// Si el cierre falla habiendo nota, hay que decir que la nota SÍ quedó.
ok(/La nota quedó guardada, pero no se pudo cerrar la cita/.test(fn),
   'si falla el cierre con la nota ya guardada, se dice que la nota no se perdió');

// ── La casilla no puede mentir ─────────────────────────────────────────
ok((fn.match(/casilla\.checked = false/g) || []).length >= 2,
   'ante cualquier fallo la casilla vuelve atrás: si no, la cita se ve cerrada y sigue abierta');
const salir = (app.split('function crmCitaCerrarSalir')[1] || '').split('\n}\n')[0];
ok(/casilla\.checked = false/.test(salir), 'y también al cerrar la ventana sin guardar');

// ── El tipo «visita» de punta a punta ──────────────────────────────────
ok(/type: 'visita'/.test(fn), 'la nota se guarda como actividad de tipo «visita»');
ok(/'visita'/.test(api) && /validTypes[\s\S]{0,200}'visita'/.test(api),
   'y el servidor acepta ese tipo — sin esto responde «Tipo inválido»');
ok(/\['llamada', 'email', 'reunion', 'nota', 'tarea', 'visita'\]/.test(api),
   'y cuenta como actividad del lead, que es lo que mueve updated_at');
ok(/visita:\s*\['Visita'/.test(app), 'el historial la pinta como «Visita», no como «Actividad»');

// ── Sin nota también se puede cerrar ───────────────────────────────────
ok(/Cerrar sin nota/.test(app),
   'se puede cerrar sin nota: obligarla dejaría citas abiertas para siempre, que es peor dato');
ok(/if \(!sinNota && !texto\)/.test(fn), 'pero si eliges guardar, no deja guardar en vacío');

// ── Que lo recién escrito se vea ───────────────────────────────────────
ok(/crmTraerActividades\(leadId\)/.test(fn) && /lfPintar/.test(fn),
   'tras cerrar se refresca el historial: si no, la nota está guardada y parece perdida');

// Lo invocado tiene que existir de verdad. `typeof` protege de un error, no
// de que la función nunca haga nada.
for (const f of ['crmTraerActividades', 'crmCargarTareasLead', 'lfPintar', 'motivoDelFallo', 'crmPintarTareasLead']) {
  ok(new RegExp('(async )?function ' + f + '\\b').test(app), `${f}() existe`);
}

process.exit(mal ? 1 : 0);
