// pruebas/campana-avisa.mjs
//
// La campana existía y funcionaba, pero nadie la miraba: 29 notas dirigidas en
// tres semanas y un promedio de 82 HORAS hasta leerlas. La causa no era el
// canal —ya manda correo y push— sino que NINGUNO de los siete asesores de
// Certain tenía el push activado. Cero de siete.
//
// Lo que se protege aquí es que el aviso sea creíble. Un sonido que suena
// cuando no ha pasado nada se aprende a ignorar en dos días, y entonces no
// sirve el día que sí importa.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
const html = readFileSync(join(RAIZ, 'public/index.html'), 'utf8');

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

// ── Solo suena con algo nuevo ──────────────────────────────────────────
// Se extrae la función ENTERA, con su llave de cierre: quedarse con el cuerpo
// y volver a montarla a mano daba un SyntaxError que no dice nada del código.
const _i = app.indexOf('function campanaAvisarNuevos()');
const texto = _i > -1 ? app.slice(_i, app.indexOf('\n}\n', _i) + 2) : '';
ok(texto.length > 0, 'existe campanaAvisarNuevos');

let sonadas = 0;
const fn = new Function('estado', `
  let _avisosVistos = estado.vistos;
  let crmAvisos = estado.avisos;
  const campanaSonar = () => estado.sonar();
  const document = { getElementById: () => null };
  ${texto}
  campanaAvisarNuevos();
  return _avisosVistos;
`);

const correr = (vistos, cuantos) => {
  sonadas = 0;
  const r = fn({ vistos, avisos: new Array(cuantos).fill(0), sonar: () => { sonadas++; } });
  return { sonadas, vistos: r };
};

ok(correr(null, 3).sonadas === 0,
   'al abrir la aplicación con notas de ayer NO suena — no ha pasado nada ahora');
ok(correr(0, 1).sonadas === 1, 'suena cuando llega una nueva');
ok(correr(2, 2).sonadas === 0, 'no suena si el número no cambió');
ok(correr(3, 1).sonadas === 0, 'ni cuando BAJA, que es leerlas: leer no es un aviso');
ok(correr(1, 4).sonadas === 1, 'y llegan tres de golpe, suena una vez, no tres');
ok(correr(null, 3).vistos === 3, 'la primera pasada solo toma nota del punto de partida');

// ── Se puede callar, y el ajuste está a mano ───────────────────────────
ok(/function campanaMuda\(callar\)/.test(app) && /function campanaEstaMuda\(\)/.test(app),
   'se puede silenciar');
ok(/acuarius_campana_muda/.test(app), 'y la preferencia se recuerda en ese navegador');
const sonar = (app.split('function campanaSonar()')[1] || '').split('\n}\n')[0];
ok(/campana_muda[\s\S]{0,60}return;/.test(sonar), 'si está en silencio, ni se intenta');
ok(/onclick="campanaMuda\(/.test(app),
   'el interruptor está en el propio panel de la campana, no escondido en Configuración');

// ── El sonido no puede ser la única señal ──────────────────────────────
ok(/ctx\.state === 'suspended'/.test(sonar),
   'si el navegador todavía no deja sonar, se calla en vez de reventar');
ok(/try \{[\s\S]*?\} catch \{/.test(sonar), 'y cualquier fallo del audio es silencioso');
ok(/campana-late/.test(app) && /campana-late/.test(html),
   'además del sonido hay un toque visual, para quien tenga el equipo en silencio');
ok(/prefers-reduced-motion[\s\S]{0,80}campana-late[\s\S]{0,40}animation:none/.test(html),
   'y se respeta a quien pidió menos movimiento');

// ── Ofrecer el teléfono donde se entiende ──────────────────────────────
const ofrecer = (app.split('async function avisosProponerPush()')[1] || '').split('\n}\n')[0];
ok(/if \(!crmAvisos\.length\) return;/.test(ofrecer),
   'solo se ofrece a quien YA tiene notas sin leer: ahí se entiende para qué sirve');
ok(/Notification\.permission !== 'default'/.test(ofrecer),
   'no se insiste a quien ya dijo que sí o que no en el navegador');
ok(/localStorage\.getItem\(AVISO_PUSH_LS\)/.test(ofrecer), 'y si lo cierra, no vuelve');
ok(/await pushSuscripcionActual\(\)/.test(ofrecer), 'ni se ofrece a quien ya los tiene activados');

for (const f of ['pushSoportado', 'pushSuscripcionActual', 'pushActivar']) {
  ok(new RegExp('(async )?function ' + f + '\\b').test(app), `${f}() existe`);
}

process.exit(mal ? 1 : 0);
