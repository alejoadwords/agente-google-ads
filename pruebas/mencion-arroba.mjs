// pruebas/mencion-arroba.mjs
//
// Escribir `@` en una nota avisa a esa persona por correo, campana y teléfono
// — el mismo camino de la «Nota al responsable», que ya estaba probado.
//
// Lo que se protege:
//
//   1. Que el destinatario se valide CONTRA EL EQUIPO en el servidor. Sin eso,
//      cualquiera podría mandar un identificador por la petición y hacer que a
//      un usuario de OTRA cuenta le llegara un correo y un aviso al teléfono
//      con el texto que quisiera y el nombre de un lead ajeno dentro.
//   2. Que si borras el `@nombre` del texto, la mención se va con él: avisar a
//      alguien cuyo nombre ya no aparece es mandar un correo que nadie entiende.
//   3. Que el `@` NO aparezca en cajas que ve el cliente.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
const api = readFileSync(join(RAIZ, 'api/lead-activities.js'), 'utf8');
const perf = readFileSync(join(RAIZ, 'api/_perfiles.js'), 'utf8');

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

// ── El servidor manda ──────────────────────────────────────────────────
ok(/const \{ type, content, metadata, avisar, mencion, responde_a \} = body;/.test(api),
   'el endpoint recibe a quién se menciona');
ok(/await esDelEquipo\(userId, mencion\)/.test(api),
   'y lo valida contra el equipo ANTES de avisar');
ok(/Esa persona no está en tu equipo\.' \}, 403\)/.test(api),
   'si no es del equipo responde 403 y no manda nada');
// Desde el 09-10-2026 delante va la respuesta a una nota; la mención sigue
// mandando sobre el responsable del lead.
ok(/\|\| mencionado\s*\n\s*\|\| \(\(avisar && lead\.assigned_to/.test(api),
   'la mención manda sobre el responsable del lead');
ok(/if \(mencion && mencion !== actorId\)/.test(api),
   'y uno no se menciona a sí mismo');

const ede = (perf.split('export async function esDelEquipo')[1] || '').split('\n}\n')[0];
ok(/if \(userId === cuenta\) return true;/.test(ede),
   'el dueño cuenta como equipo: no tiene fila en team_members y aun así se le menciona');
ok(/status=eq\.active/.test(ede), 'solo miembros activos');
ok(/catch \{[\s\S]{0,300}return false;/.test(ede),
   'ante un fallo NO deja pasar: es una comprobación de permisos');

// ── La mención se va con el nombre ─────────────────────────────────────
const i = app.indexOf('function menDe(caja)');
const menDe = new Function('caja', 'mapa', `
  const _menElegido = mapa;
  ${app.slice(i, app.indexOf('\n}\n', i) + 2)}
  return menDe(caja);
`);
const caja = { value: 'Mira esto @Deysy Elena por favor' };
const mapa = new WeakMap([[caja, { id: 'u1', nombre: 'Deysy Elena' }]]);
ok(menDe(caja, mapa)?.id === 'u1', 'con el nombre escrito, la mención vale');
caja.value = 'Mira esto por favor';
ok(menDe(caja, mapa) === null,
   'si borra el @nombre, no se avisa a nadie — un correo sin su mención no se entiende');
ok(menDe({ value: 'hola' }, new WeakMap()) === null, 'y sin mención elegida, nada');

// ── Una sola persona, a propósito ──────────────────────────────────────
ok(/UNA sola persona por nota/.test(app),
   'está escrito por qué es una sola: la campana busca por un único `metadata->>para`');

// ── Dónde NO va ────────────────────────────────────────────────────────
const enchufes = (app.match(/menEnchufar\(/g) || []).length;
ok(enchufes >= 2, 'el `@` se engancha explícitamente, caja por caja (' + (enchufes - 1) + ' cajas)');
for (const prohibida of ['cmpw-cta-text', 'pln-cta-text', 'wa-mensaje', 'prp-']) {
  ok(!new RegExp('menEnchufar\\([^)]*' + prohibida).test(app),
     'no se engancha en «' + prohibida + '» — el cliente no debe ver nombres internos');
}

// ── Se ve que existe ───────────────────────────────────────────────────
ok(/Escribe @ para avisar a alguien del equipo/.test(app),
   'el placeholder lo anuncia: una función sin botón que no se ve, no se usa');
ok(/men-pista/.test(app) && /Le llegará a/.test(app),
   'y al elegir se dice a quién le va a llegar');

// ── Que el menú no se rompa con un nombre raro ─────────────────────────
ok(!/onmousedown="event\.preventDefault\(\);menElegir\(/.test(app),
   'el nombre no se incrusta en un atributo de evento');
ok(/it\.dataset\.id, it\.dataset\.nombre/.test(app), 'se lee del propio elemento');

// ── QUIÉN sale en la lista, ejecutando la función de verdad ────────────
//
// Lo que faltaba aquí y costó el reporte de Certain: esta prueba comprobaba
// que el SERVIDOR acepta al dueño (`esDelEquipo` lo deja pasar desde el primer
// día) y nunca comprobó que el navegador lo OFRECIERA. La regla estaba bien y
// el camino no, que es exactamente el punto ciego de siempre.
//
// A las ocho personas del equipo de Certain el `@` no les ofrecía a Marilia
// —la dueña—, que es justo a quien más se quiere avisar. Y a ella le ofrecía
// mencionarse a sí misma, que no hace nada.
//
// Se EJECUTA `menCandidatos`, no se mira con una expresión regular: una lista
// puede construirse y dejar fuera a quien no debe.
console.log('\nQuién sale en la lista del `@`\n');
{
  const a = app.indexOf('/** El equipo mencionable');
  const fin = app.indexOf('\n}', app.indexOf('return lista.filter', a));
  const src = app.slice(a, fin + 2);
  if (a < 0 || fin < 0) throw new Error('No encontré menCandidatos en app.js');

  const correr = ({ yo, workspace, equipo }) => {
    const entorno = {
      _menEquipo: equipo,
      crmTeam: [],
      window: { _workspace: workspace },
      clerkInstance: { user: { id: yo } },
    };
    const f = new Function(...Object.keys(entorno), src + '\n; return menCandidatos();');
    return f(...Object.values(entorno));
  };

  const EQUIPO = [
    { member_user_id: 'u_maira',  member_name: 'Maira Ballesteros', status: 'active' },
    { member_user_id: 'u_karina', member_name: 'Karina Matute',     status: 'active' },
    { member_user_id: 'u_pier',   member_name: 'Pierluigi Pezzano', status: 'invited' },
    { member_user_id: null,       member_name: 'Sin cuenta',        status: 'active' },
  ];
  const DUENA = { ownerId: 'u_marilia', ownerName: 'MARILIA GONZALEZ D' };

  // El caso del reporte: mira un miembro del equipo.
  const vistaMiembro = correr({ yo: 'u_maira', workspace: DUENA, equipo: EQUIPO });
  const nombres = vistaMiembro.map(p => p.nombre);
  ok(vistaMiembro.some(p => p.id === 'u_marilia'),
     'un miembro VE a la dueña, que no tiene fila en el equipo', JSON.stringify(nombres));
  ok(vistaMiembro[0]?.id === 'u_marilia',
     'y sale la primera: es a quien más se avisa', JSON.stringify(nombres));
  ok(vistaMiembro.find(p => p.id === 'u_marilia')?.nombre === 'MARILIA GONZALEZ D',
     'con su nombre, no con «Dirección»');
  ok(!vistaMiembro.some(p => p.id === 'u_maira'),
     'y NO se ve a sí misma: el servidor ignora la mención propia', JSON.stringify(nombres));
  ok(vistaMiembro.some(p => p.id === 'u_karina'), 'sus compañeros sí salen');
  ok(!vistaMiembro.some(p => p.id === 'u_pier'),
     'quien no ha aceptado la invitación no sale: no tiene dónde recibirlo');
  ok(!vistaMiembro.some(p => !p.id), 'ni quien no tiene cuenta');

  // Y la dueña, mirando desde su propia sesión.
  const vistaDuena = correr({ yo: 'u_marilia', workspace: null, equipo: EQUIPO });
  ok(vistaDuena.some(p => p.id === 'u_maira') && vistaDuena.some(p => p.id === 'u_karina'),
     'la dueña ve a su equipo');
  ok(!vistaDuena.some(p => p.id === 'u_marilia'),
     'y no se ve a sí misma — antes salía como «Tú», que guarda la nota y no avisa a nadie',
     JSON.stringify(vistaDuena.map(p => p.nombre)));
  ok(!vistaDuena.some(p => p.nombre === 'Tú'), 'ya no existe la opción «Tú»');

  // Un dueño sin equipo todavía: lista vacía, no una lista con él dentro.
  ok(correr({ yo: 'u_marilia', workspace: null, equipo: [] }).length === 0,
     'trabajando solo, el `@` no ofrece a nadie');
}

// ── Y que la lista llegue a cargarse para un miembro ───────────────────
//
// El segundo fallo, encadenado: se añadió `teamEnsureLoaded()` al abrir la
// ficha «para que un asesor pudiera mencionar», pero esa función arranca con
// `if (window._workspace || crmTeam.length) return;` — o sea que a un miembro
// no le traía nada y su desplegable salía VACÍO. La llamada existía y no hacía
// nada.
console.log('\nEl equipo se carga también para un miembro\n');
{
  const i = app.indexOf('async function menCargarEquipo');
  const fn = app.slice(i, app.indexOf('\n}', i));
  ok(i > 0, 'existe un cargador propio para el `@`');
  ok(!/window\._workspace/.test(fn),
     'que NO se salta a los miembros', fn.slice(0, 160));
  ok(/fetchAuth\('\/api\/team'\)/.test(fn), 'y pide el equipo de verdad');
  ok(!/\bcrmTeam\s*=/.test(fn),
     'sin tocar `crmTeam`: ese global lo leen el filtro por comercial y el selector de responsable');
  const enchufar = app.slice(app.indexOf('function menEnchufar'),
                             app.indexOf("caja.addEventListener('keydown'"));
  ok(/menCargarEquipo\(\)/.test(enchufar),
     'y se llama al enchufar el `@`, no solo desde la ficha', enchufar.slice(0, 200));
  ok(!/if \(typeof teamEnsureLoaded === 'function'\) teamEnsureLoaded\(\)\.catch/.test(app),
     'la llamada vieja, la que no hacía nada, ya no está');
}

// ── Mencionar avisa de verdad, no solo en la campana ───────────────────
//
// El tercero: el correo y el aviso al teléfono estaban bajo `if (avisar)`, y
// el navegador no manda `avisar` con un `@`. La mención dejaba la marca `para`
// —así que salía en la campana— y nada más. Si era de tipo «nota», el correo
// acababa saliendo 24 h después por `cron-notas`; en una Llamada, un Email,
// una Reunión o una Tarea ese cron ni la mira (`type=eq.nota`) y no salía
// nunca.
console.log('\nMencionar avisa por correo y teléfono, no solo en la campana\n');
{
  ok(/if \(avisar \|\| mencionado \|\| respuesta\) \{/.test(api),
     'el aviso se dispara también con una mención, no solo con `avisar`');
  const bloqueAviso = api.slice(api.indexOf('if (avisar || mencionado || respuesta)'), api.indexOf('return jsonResp({ activity: rows[0]'));
  ok(/avisarNotaLead\(/.test(bloqueAviso), 'manda el correo');
  ok(/enviarPushA\(para/.test(bloqueAviso), 'y el aviso al teléfono');
  ok(/mencion: !!mencionado/.test(bloqueAviso),
     'diciendo que es una mención, para que el correo no la redacte como nota de dirección');
  // Un vendedor NO puede usar la nota de dirección, pero SÍ mencionar: si el
  // permiso se hubiera reutilizado, mencionar le daría un 403.
  ok(/if \(avisar && !actorMandaEnLaCuenta\) \{/.test(api),
     'y mencionar NO exige ser dueño o administrador: ese permiso mira SOLO `avisar`',
     (api.match(/if \(.{0,40}actorMandaEnLaCuenta\) \{/) || ['no está'])[0]);
}
{
  const correo = readFileSync(join(RAIZ, 'api/_aviso-lead-nota.js'), 'utf8');
  ok(/avisarNotaLead\(\{ ownerId, autorNombre, lead, texto, paraId, mencion, respuesta = null \}\)/.test(correo),
     'el correo recibe si es una mención');
  ok(/mencion \? `\$\{esc\(quien\)\} te mencionó/.test(correo), 'y lo dice en el título');
  // La frase falsa: a quien te mencionan puede no llevar ese lead.
  const intro = correo.slice(correo.indexOf('intro:'), correo.indexOf('preheader:'));
  ok(/mencion/.test(intro),
     'y no le afirma que el lead es suyo — a quien mencionas puede no serlo', intro.slice(0, 120));
}

process.exit(mal ? 1 : 0);
