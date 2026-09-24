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



// ── Y que la BASE acepte el tipo, no solo el código ────────────────────
//
// Esta parte faltaba, y por faltar salió a producción rota: `validTypes` en
// `api/lead-activities.js` aceptaba «visita», pero la tabla tenía un CHECK
// que no. Los asesores de Certain vieron el error de PostgreSQL en pantalla
// al intentar cerrar su primera cita.
//
// El esquema de Supabase no está versionado: los CREATE TABLE comentados en
// api/*.js son aspiracionales. Hay que preguntarle a la base, y una prueba
// que solo lee ficheros nunca lo habría visto.
if (process.argv[2]) {
  const { readFileSync: leer } = await import('node:fs');
  const env = {};
  for (const l of leer(process.argv[2] + '/.env', 'utf8').split('\n')) {
    const i = l.indexOf('='); if (i > 0) env[l.slice(0, i)] = l.slice(i + 1);
  }
  // Se comprueba insertando de verdad y borrando: leer la definición de la
  // restricción sería frágil, y lo que importa es si la base ACEPTA la fila.
  const cab = {
    'Content-Type': 'application/json',
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    Prefer: 'return=representation',
  };
  // CONTRA LA CUENTA DE PRUEBAS, nunca contra la de un cliente. La primera
  // versión cogía el primer lead que encontrara, que podía ser de Certain: una
  // prueba no escribe en los datos de nadie.
  const CUENTA_PRUEBAS = 'acuarius.review@gmail.com';
  const dueno = await fetch(
    `${env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(CUENTA_PRUEBAS)}&select=id&limit=1`,
    { headers: cab }).then(x => x.json()).then(x => x?.[0]).catch(() => null);
  const lead = dueno ? await fetch(
    `${env.SUPABASE_URL}/rest/v1/leads?user_id=eq.${dueno.id}&select=id,user_id&limit=1`,
    { headers: cab }).then(x => x.json()).then(x => x?.[0]).catch(() => null) : null;
  if (!lead) {
    ok(false, 'no hay un lead en la cuenta de pruebas (' + CUENTA_PRUEBAS + ') contra el que probar');
  } else {
    const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/lead_activities`, {
      method: 'POST', headers: cab,
      body: JSON.stringify({
        lead_id: lead.id, user_id: lead.user_id, type: 'visita',
        content: 'PRUEBA automatica', metadata: { prueba_visita: true },
      }),
    });
    const cuerpo = await ins.text();
    ok(ins.ok, 'la BASE acepta una actividad de tipo «visita»' +
       (ins.ok ? '' : ' → ' + cuerpo.slice(0, 160)));
    await fetch(`${env.SUPABASE_URL}/rest/v1/lead_activities` +
      `?metadata->>prueba_visita=eq.true&user_id=eq.${lead.user_id}`,
      { method: 'DELETE', headers: cab }).catch(() => {});
  }
} else {
  console.log('  · (sin .env: no se comprueba contra la base)');
}

process.exit(mal ? 1 : 0);
