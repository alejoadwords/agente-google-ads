// pruebas/instalar-y-avisos.mjs
//
// Un toque instala la app Y activa los avisos. Lo que hay que proteger:
//
//   1. El orden y la inmediatez. El permiso de avisos se pide JUSTO después de
//      aceptar la instalación: los navegadores solo lo permiten cerca de un
//      gesto del usuario, y con medio segundo de por medio lo rechazan sin
//      preguntar. Meter una recarga o un `await` de red en medio lo rompe sin
//      que nada falle a la vista.
//   2. Que a quien dice que NO se le deje en paz. Pedirle avisos a quien acaba
//      de rechazar la instalación es la forma más rápida de que bloquee las
//      dos cosas para siempre.
//   3. Que no se le ofrezca instalar a quien ya la tiene.
//
// Lo que NO se puede hacer, y conviene que quede escrito: instalar en
// silencio. El navegador enseña su propio diálogo y no hay API que lo salte.
// En iPhone no hay ni siquiera eso: Apple no expone nada para instalar ni para
// saber si ya está instalada.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(RAIZ, 'public/app.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(RAIZ, 'public/manifest.json'), 'utf8'));

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const src = app.slice(app.indexOf('async function pwaYaEstaInstalada()'),
                      app.indexOf('async function pwaInstalar() {'));

async function correr({ acepta, permiso, yaSuscrito = false }) {
  const pasos = [];
  const ctx = {
    _pwaPrompt: {
      prompt() { pasos.push('dialogo'); },
      userChoice: Promise.resolve({ outcome: acepta ? 'accepted' : 'dismissed' }),
    },
    pwaInstalada: () => false,
    pushSoportado: () => true,
    track: (e) => pasos.push('track:' + e),
    showToast: (t) => pasos.push('toast:' + t),
    pwaCerrarAviso: () => pasos.push('cierra'),
    pushClaveABytes: () => new Uint8Array(65),
    pushSuscripcionActual: async () => (yaSuscrito ? {} : null),
    fetchAuth: async () => ({ ok: true }),
    fetch: async () => ({ json: async () => ({ clave: 'k' }) }),
    Notification: { permission: permiso, requestPermission: async () => { pasos.push('permiso'); return 'granted'; } },
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe: async () => { pasos.push('suscribe'); return { toJSON: () => ({}) }; } } }) } },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null },
  };
  const f = new Function(...Object.keys(ctx), src + '; return pwaInstalarYAvisos;');
  await f(...Object.values(ctx))({});
  return pasos;
}

// ── Acepta: instala y encadena los avisos ──────────────────────────────
let p = await correr({ acepta: true, permiso: 'default' });
ok(p[0] === 'dialogo', 'primero sale el diálogo del navegador — instalar en silencio no existe');
ok(p.indexOf('permiso') > p.indexOf('track:pwa_instalada'),
   'el permiso de avisos se pide DESPUÉS de que aceptara instalar');
ok(p.indexOf('suscribe') > p.indexOf('permiso'), 'y la suscripción, después del permiso');
ok(p.includes('track:push_activado'), 'queda registrado que se activaron');
ok(/Listo: Acuarius quedó en tu pantalla de inicio y con avisos/.test(p.find(x => x.startsWith('toast:')) || ''),
   'y se le dice que quedaron las dos cosas');

// ── Rechaza: no se le insiste ──────────────────────────────────────────
p = await correr({ acepta: false, permiso: 'default' });
ok(!p.includes('permiso'),
   'si rechaza instalar NO se le piden avisos — insistir hace que bloquee las dos cosas');
ok(!p.includes('cierra'), 'y la barra se queda, por si cambia de idea');

// ── Ya había dado permiso: no se le vuelve a preguntar ─────────────────
p = await correr({ acepta: true, permiso: 'granted' });
ok(!p.includes('permiso') && p.includes('suscribe'),
   'con el permiso ya dado se suscribe directo, sin volver a preguntar');

// ── Ya estaba suscrito: nada que hacer ─────────────────────────────────
p = await correr({ acepta: true, permiso: 'granted', yaSuscrito: true });
ok(!p.includes('suscribe'), 'y si ya estaba suscrito, no se duplica');

// ── Nada entre aceptar y pedir ─────────────────────────────────────────
const fn = src.slice(src.indexOf('async function pwaInstalarYAvisos'));
const entre = fn.slice(fn.indexOf('track(\'pwa_instalada\')'), fn.indexOf('requestPermission'));
ok(!/setTimeout|location\.reload|await fetch\(/.test(entre),
   'entre aceptar y pedir el permiso no hay esperas ni recargas: el navegador lo rechazaría');

// ── Detección: hasta donde llega ───────────────────────────────────────
ok(/navigator\.getInstalledRelatedApps/.test(src),
   'en Android se detecta si ya está instalada aunque se esté en el navegador');
ok(manifest.id && Array.isArray(manifest.related_applications) &&
   manifest.related_applications.some(a => a.platform === 'webapp'),
   'el manifiesto declara su id y se lista a sí misma — sin eso la detección no funciona');
ok(manifest.prefer_related_applications !== true,
   'y NO prefiere una app relacionada: eso mandaría al usuario a una tienda en vez de instalar');
// Contra el fichero entero: el porqué vive en el comentario ENCIMA de la
// función, que es su sitio, y queda fuera del trozo que se recorta.
ok(/En iPhone no hay forma[\s\S]{0,120}Safari no expone nada/.test(app),
   'está escrito que en iPhone la detección es imposible, para que nadie lo intente otra vez');

// ── iPhone: el único momento en que se pueden pedir ────────────────────
const ios = app.slice(app.indexOf('async function pwaOfrecerAvisosAlAbrir'));
ok(/if \(!pwaInstalada\(\)\) return;/.test(ios.slice(0, 400)),
   'en iPhone los avisos se ofrecen SOLO con la app ya abierta desde la pantalla de inicio');
ok(/pwaOfrecerAvisosAlAbrir\(\)\.catch/.test(app), 'y se llama al arrancar');

process.exit(mal ? 1 : 0);
