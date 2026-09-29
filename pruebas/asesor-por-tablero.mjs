// Quién atiende cada tablero: node pruebas/asesor-por-tablero.mjs
//
// El agente ya mandaba cada lead a su proceso —arriendo a Arriendo, venta a
// Venta, captación a Captación— pero con el asesor vacío. El lead caía en el
// tablero correcto y sin dueño, y un lead sin dueño es un lead que nadie llama.
//
// La salida fácil era elegir un asesor por ruta, y no sirve: el tablero de
// Arriendo de Certain lo llevan TRES personas (164, 89 y 89 leads). Un asesor
// fijo le habría dado todos los arriendos nuevos a una sola, y las otras dos se
// habrían quedado mirando.
//
// Así que se marca por persona qué tableros atiende, y el reparto por turnos
// que ya existía rota entre ellos.

import { readFileSync } from 'node:fs';
import { normalizarTableros } from '../api/team.js';

const team = readFileSync(new URL('../api/team.js', import.meta.url), 'utf8');
const qual = readFileSync(new URL('../api/_qualify.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
const htm = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

const A = '60ab4849-64ef-4219-9ebb-a6cdfc31299b';
const V = 'ca989925-2f90-473e-8e80-6756e627abe3';

// ── Lo que se guarda ────────────────────────────────────────────────────────
console.log('\nSolo se guardan tableros que puedan existir');
ok(normalizarTableros([A, V]).length === 2, 'dos tableros, dos');
ok(normalizarTableros([A, A]).length === 1, 'repetido, uno');
// Un id inventado no casaría con ningún tablero: la persona quedaría marcada
// para uno que no existe y nadie vería nada raro.
ok(normalizarTableros(['pepe', A]).length === 1, 'lo que no es un uuid se tira', JSON.stringify(normalizarTableros(['pepe', A])));
ok(normalizarTableros([`  ${A}  `])[0] === A, 'y se limpian los espacios');
for (const basura of [null, undefined, 'texto', 42, {}]) {
  ok(normalizarTableros(basura).length === 0, `${JSON.stringify(basura) ?? 'undefined'} no revienta`);
}
ok(normalizarTableros(new Array(40).fill(0).map((_, i) =>
  A.slice(0, -2) + String(i).padStart(2, '0'))).length === 20, 'y hay tope de 20');

// ── El reparto ──────────────────────────────────────────────────────────────
console.log('\nSin asesor fijo, rota entre los del tablero');

// Anclado por estructura: desde el reparto hasta el guardado del lead. El
// `leads?id=eq.` aparece antes también —al leer el lead—, así que se busca a
// partir del reparto y no desde el principio del fichero.
const iReparto = qual.indexOf('if (ruta && califica && !lead.assigned_to)');
const trozo = qual.slice(iReparto, qual.indexOf('lead_activities', iReparto));
ok(iReparto > 0, 'cuando la ruta decide un destino, el lead recibe dueño');
ok(/asesoresDelTablero\(userId, ruta\.pipeline_id\)/.test(trozo),
   'entre quienes atienden ESE tablero, no entre todo el equipo');

// Esto empezó escribiendo `assigned_to` a mano y era una regresión servida: el
// lead cambiaba de dueño EN SILENCIO —sin correo al comercial, sin tarea de
// primer contacto y sin nota en el historial—. Exactamente el «no me llegan
// las notificaciones» que se reporta al día siguiente.
ok(/asignarLead\(userId, \{ \.\.\.lead, \.\.\.update \}, canal,\s*ruta\.asignar_a \|\| null, hayLista \? quienes : null, hayLista\)/.test(trozo),
   'y por el mismo camino de siempre, que avisa y crea la tarea de primer contacto');

// Si nadie tiene marcado ese tablero, decide la regla de la fuente igual que
// antes de existir todo esto. Un lead sin dueño es peor que un lead con el
// dueño de siempre.
ok(/hayLista \? quienes : null, hayLista\)/.test(trozo),
   'y si el tablero no tiene a nadie, cae en la regla de la fuente');

// Un lead descartado no se le echa encima a un comercial: hasta ahora se
// quedaba sin dueño a propósito.
ok(/if \(ruta && califica && !lead\.assigned_to\)/.test(qual),
   'solo se asigna si califica, no si se descarta');

// El orden lo destapó una prueba real: en una conversación corta el lead se
// crea YA calificado, la regla de la fuente asignaba primero y ganaba siempre.
// El lead cayó en Arriendo y se lo llevó una administradora que no lleva
// arriendos; el reparto por tablero ya no podía corregirlo sin quitárselo.
ok(/reglaCal\.activo && \(reglaCal\.enrutado\?\.activo \|\| veredicto\.estado !== 'calificado'\)/.test(eng),
   'con enrutado activo, la creación del lead NO asigna: espera al veredicto');
// Los DOS caminos —asesor fijo y reparto— van por ahí. El fijo escribía
// `assigned_to` a mano: nadie lo usa todavía, pero el día que alguien elija un
// asesor en el paso 5, ese lead se habría asignado en silencio.
ok(!/assigned_to =/.test(qual),
   'nunca escribiendo el dueño a mano: eso se salta el aviso y la tarea');
ok(/ruta\.asignar_a \? null : await asesoresDelTablero/.test(trozo),
   'el asesor fijo de la ruta manda sobre el reparto');

// asignarLead no toca un lead que ya tenga dueño, pero se comprueba también
// aquí: quitarle un lead a quien ya lo estaba trabajando es peor que no
// asignarlo.
ok(/if \(ruta && califica && !lead\.assigned_to\)/.test(qual),
   'y solo si el lead no tiene ya dueño: a nadie se le quita lo suyo');
ok(/hayLista\)/.test(trozo),
   'con turnos forzados, para que un «fijo» de la fuente no se salte la lista del tablero');
ok(/const hayLista = !!quienes\?\.length/.test(trozo),
   'si nadie tiene marcado ese tablero no se fuerza nada: decide la regla de la fuente');
ok(/catch \(e\) \{ \/\* que falle el reparto no puede tumbar la calificación/.test(trozo),
   'y si el reparto falla, la calificación se guarda igual');



console.log('\nY se busca con el filtro correcto');
const busca = qual.slice(qual.indexOf('export async function asesoresDelTablero'), qual.indexOf('// ── Efectos sobre el lead'));
ok(/pipeline_ids=cs\.\{/.test(busca), 'la consulta usa «contiene» sobre la lista');
ok(/status=eq\.active/.test(busca), 'y solo cuenta a quien está activo, no a un invitado sin aceptar');
ok(/owner_user_id=eq\.\$\{encodeURIComponent\(userId\)\}/.test(busca), 'acotado a la cuenta');
ok(/catch \{ return \[\]; \}/.test(busca), 'y si falla devuelve vacío, que es «no fuerces a nadie»');

// ── El endpoint ─────────────────────────────────────────────────────────────
console.log('\nLa pantalla recibe lo que necesita');
ok(/select=id,member_user_id,member_email,member_name,role,status,client_id,pipeline_ids/.test(team),
   'la lista de equipo trae los tableros de cada quien');
ok(/pipelines: pipelines \|\| \[\]/.test(team),
   'y el catálogo de tableros, para pintar nombres en vez de uuids');
ok(/'pipeline_ids' in \(body \|\| \{\}\)/.test(team),
   'al guardar se distingue «no lo mandes» de «déjalo vacío»: si no, no habría forma de quitárselos');

// Guardar una cosa no puede cambiar otra a la espalda de quien guarda. La
// pantalla reenviaba el perfil «para no perderlo» y el servidor lo
// normalizaba: cinco personas pasaron de «vendedor» a «ventas» al guardar unos
// tableros. Era inofensivo —el permiso ya se calculaba así— y aun así no puede
// volver a pasar.
ok(/const tocaPerfil = 'perfil' in \(body \|\| \{\}\) \|\| 'role' in \(body \|\| \{\}\)/.test(team),
   'el perfil solo se toca si lo mandan');
ok(/\.\.\.\(tocaPerfil \? \{ role: perfil \} : \{\}\)/.test(team),
   'y si no, la columna del perfil ni se escribe');
ok(!/perfil: _tbEditando\.role/.test(app),
   'la pantalla de tableros ya no manda el perfil');

console.log('\nDónde trabaja hoy, contado bien');
const donde = team.slice(team.indexOf("url.searchParams.get('donde')"), team.indexOf("url.searchParams.get('carga')"));
ok(/Prefer: 'count=exact'/.test(donde) && /Range: '0-0'/.test(donde),
   'se cuenta con count=exact y no trayendo los leads');
// PostgREST corta en 1.000 filas aunque pidas más: contar en el navegador
// mentiría en cuanto una cuenta pasara de mil leads, y en silencio.
ok(!/select=id,assigned_to/.test(donde) && !/limit=/.test(donde),
   'nada de traerse los leads para contarlos aquí');
ok(/deleted_at=is\.null/.test(donde), 'y la papelera no cuenta');
ok(/filter\(d => d\.leads > 0\)/.test(donde), 'solo se devuelven los tableros donde de verdad trabaja');

// ── La pantalla ─────────────────────────────────────────────────────────────
console.log('\nLa interfaz');
ok(/function teamTablerosFila\(/.test(app), 'cada persona muestra sus tableros');
ok(/Sin tablero asignado/.test(app), 'y se dice cuando no tiene ninguno, en vez de dejar el hueco en blanco');
ok(/_teamPipelines\.length < 2/.test(app),
   'con un solo tablero no se enseña nada: no habría nada que elegir');
ok(/teamPuedoTocar\(m\)/.test(app.slice(app.indexOf('function teamTablerosFila'))),
   'y solo puede cambiarlo quien gestiona el equipo');
ok(/id="tb-modal"/.test(htm) && /id="tb-lista"/.test(htm), 'el modal existe');
ok(/id="tb-sugerir"/.test(htm) && /Marcar donde ya trabaja/.test(htm),
   'con el atajo que propone lo que ya es cierto según sus leads');
ok(/' lead' : ' leads'/.test(app),
   'enseña cuántos leads tiene en cada uno, y «1 lead» no «1 leads»');

for (const c of ['crm-modal-overlay', 'crm-modal-box', 'crm-modal-foot', 'btn-pri', 'btn-ghost']) {
  ok(new RegExp('\\.' + c + '[{.,: ]').test(htm), `la clase .${c} existe`);
}
const css = htm.slice(htm.indexOf('id="tb-modal"'), htm.indexOf('MODAL CONEXIÓN WHATSAPP'));
for (const t of [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]))]) {
  ok(htm.includes(t + ':'), `el token ${t} existe`);
}
ok(/showToast\(/.test(app.slice(app.indexOf('async function teamGuardarTableros'))),
   'y los avisos usan showToast');

console.log('');
process.exit(mal ? 1 : 0);
