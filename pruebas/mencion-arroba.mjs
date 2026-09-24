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
ok(/const \{ lead_id, type, content, metadata, avisar, mencion \} = body;/.test(api),
   'el endpoint recibe a quién se menciona');
ok(/await esDelEquipo\(userId, mencion\)/.test(api),
   'y lo valida contra el equipo ANTES de avisar');
ok(/Esa persona no está en tu equipo\.' \}, 403\)/.test(api),
   'si no es del equipo responde 403 y no manda nada');
ok(/const para = mencionado\s*\n\s*\|\|/.test(api),
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

process.exit(mal ? 1 : 0);
