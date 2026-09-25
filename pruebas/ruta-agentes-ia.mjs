// La dirección de Agentes IA: node pruebas/ruta-agentes-ia.mjs
//
// La pantalla se llamaba «Chatbots» y su dirección era /conversaciones/chatbots.
// Al renombrarla, esa dirección no puede morir: hay enlaces guardados en
// marcadores y pegados en conversaciones. Un enlace que lleva a la pantalla de
// inicio en vez de a donde prometía es de los fallos que nadie reporta — el
// usuario supone que se equivocó él.
//
// Se ejecuta el enrutador de verdad contra un navegador de mentira. Comprobar
// esto leyendo el fichero no vale: lo que importa es a qué pantalla llega y qué
// deja escrito en la barra de direcciones.

import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const desde = js.indexOf('  const AGENT_KEYS = [');
const hasta = js.indexOf('setTimeout(function () { applying = false; }, 150);', desde);
if (desde < 0 || hasta < 0) throw new Error('No encontré el enrutador en app.js');
const router = js.slice(desde, hasta) + '}\n';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// Un navegador de juguete: solo lo que el enrutador toca.
function navegar(ruta) {
  const pasos = [];
  const barra = { valor: ruta, pushes: 0, replaces: 0 };
  const ctx = {
    showView: (v) => pasos.push('vista:' + v),
    crmInit: () => {},
    crmSetView: (v) => pasos.push('sub:' + v),
    openAgent: (a) => pasos.push('agente:' + a),
    crmAbrirFicha: (id) => pasos.push('ficha:' + id),
    crmLeadsLoaded: true,
    crmView: 'kanban',
    lfLead: null,
    currentAgentCtx: 'google-ads',
    medirPantalla: (p) => pasos.push('medido:' + p),
    history: {
      replaceState: (s, _t, u) => { barra.valor = u; barra.replaces++; },
      pushState: (s, _t, u) => { barra.valor = u; barra.pushes++; },
    },
    location: { get pathname() { return barra.valor; } },
    document: { title: '' },
    console,
    setTimeout: (fn) => fn(),        // sin esperas: el orden es lo que importa
    setInterval: () => 0,
    clearInterval: () => {},
  };
  const f = new Function(...Object.keys(ctx), router + '\n; return applyRoute;');
  f(...Object.values(ctx))(ruta);
  return { pasos, barra };
}

// ── La dirección nueva ─────────────────────────────────────────────────────
console.log('\nLa dirección nueva');
let r = navegar('/conversaciones/agentes-ia');
ok(r.pasos.includes('vista:crm') && r.pasos.includes('sub:agents'),
   'abre la pantalla de Agentes IA', JSON.stringify(r.pasos));
ok(r.barra.valor === '/conversaciones/agentes-ia',
   'y la barra de direcciones se queda como está', r.barra.valor);

// ── La vieja, que es lo que hay que proteger ───────────────────────────────
console.log('\nLa dirección vieja, la que está en los enlaces guardados');
r = navegar('/conversaciones/chatbots');
ok(r.pasos.includes('vista:crm') && r.pasos.includes('sub:agents'),
   'lleva a la MISMA pantalla, no al inicio', JSON.stringify(r.pasos));
ok(r.barra.valor === '/conversaciones/agentes-ia',
   'y corrige la barra de direcciones a la nueva', r.barra.valor);
ok(r.barra.replaces === 1 && r.barra.pushes === 0,
   'reemplazando la entrada, no apilando una: si no, el botón atrás devuelve a la misma pantalla');

// ── Que el alias no se haya comido otras rutas ─────────────────────────────
console.log('\nLo demás sigue donde estaba');
for (const [ruta, sub] of [
  ['/conversaciones', 'inbox'],
  ['/crm', 'kanban'],
  ['/crm/tareas', 'tareas'],
  ['/marketing/campanas', 'campaigns'],
  ['/analisis', 'analytics'],
]) {
  const x = navegar(ruta);
  ok(x.pasos.includes('sub:' + sub), `${ruta} → ${sub}`, JSON.stringify(x.pasos));
  ok(x.barra.valor === ruta, `   y ${ruta} no se reescribe`, x.barra.valor);
}

// Las rutas viejas /leads/* siguen siendo alias, que es cosa aparte.
console.log('\nLas /leads/* de siempre');
r = navegar('/leads/agentes-ia');
ok(r.pasos.includes('sub:agents'), '/leads/agentes-ia sigue llevando a Agentes IA', JSON.stringify(r.pasos));
r = navegar('/leads/inbox');
ok(r.pasos.includes('sub:inbox'), '/leads/inbox sigue llevando al Inbox');

// ── Una dirección que no existe no puede quedarse a medias ─────────────────
console.log('\nUna dirección inventada');
r = navegar('/conversaciones/loquesea');
ok(r.pasos.includes('vista:home'), 'cae al inicio', JSON.stringify(r.pasos));
ok(r.barra.valor === '/', 'y la barra de direcciones se limpia', r.barra.valor);

// ── El nombre y la dirección, de acuerdo ───────────────────────────────────
console.log('\nEl nombre y la dirección dicen lo mismo');
ok(/agents: '\/conversaciones\/agentes-ia'/.test(js), 'la dirección canónica es /conversaciones/agentes-ia');
ok(/CRM_RENOMBRADAS = \{ '\/conversaciones\/chatbots': 'agents' \}/.test(js),
   'y la vieja queda anotada como alias, no borrada');
ok(/inbox: 'Inbox', agents: 'Agentes IA'/.test(js), 'el menú sigue diciendo «Agentes IA»');

console.log('');
process.exit(mal ? 1 : 0);
