// Ni un 401 mudo: node pruebas/sesion-en-todos.mjs
//
// Cuarenta y siete endpoints llevaban cada uno su COPIA del verificador de
// Clerk, y las cuarenta y siete terminaban igual: `catch { return null; }` →
// «No autorizado». Cinco averías distintas con la misma frase, y ni una pista
// del lado del servidor. Así se perdió una tarde con «Plataformas de pauta».
//
// Con una copia por fichero pasan además dos cosas peores que la duplicación:
// las copias se separan con el tiempo —una arregla un caso y las otras no— y
// nadie puede mejorar la puerta de entrada sin tocar cuarenta y siete sitios.
//
// Esta prueba vigila que no vuelvan a aparecer, y que la migración no se haya
// llevado por delante lo que cada endpoint SÍ tiene que conservar.

import { readFileSync, readdirSync } from 'node:fs';

const RAIZ = new URL('../api/', import.meta.url);
const leer = (f) => readFileSync(new URL(f, RAIZ), 'utf8');
const ficheros = readdirSync(RAIZ).filter((f) => f.endsWith('.js'));

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// Los que verifican una sesión de Clerk.
const conSesion = ficheros.filter((f) => f !== '_sesion.js' && leer(f).includes('verificarSesion'));

console.log('\nUn solo verificador para toda la aplicación\n');
{
  ok(conSesion.length >= 45, conSesion.length + ' endpoints verifican la sesión por el módulo común');

  // Nadie vuelve a pedirle las llaves a Clerk por su cuenta. Es la firma de
  // una copia nueva del verificador.
  //
  // Los de abajo son funciones NODE, y `api/_sesion.js` usa la forma web de
  // las cabeceras (`req.headers.get`), que en Node no existe. Migrarlos es
  // otro paso —y hay que comprobarlo desplegando, que es la regla de
  // CLAUDE.md para los módulos compartidos—. Se declaran aquí uno por uno: un
  // pendiente con nombre y apellidos no se olvida, y si mañana aparece OTRO
  // que no esté en esta lista, la prueba se pone en rojo.
  const PENDIENTES_NODE = [];   // vacía desde el 28-09-2026: no queda ninguna
  const copias = ficheros.filter((f) => f !== '_sesion.js' && leer(f).includes('.well-known/jwks.json'));
  const nuevas = copias.filter((f) => !PENDIENTES_NODE.includes(f));
  ok(nuevas.length === 0,
     'ningún endpoint NUEVO le pide las llaves a Clerk por su cuenta', nuevas.join(', '));

  // Y que la lista no se use de excusa: lo que esté ahí tiene que ser Node de
  // verdad. Un endpoint edge en esa lista sería un pendiente inventado.
  const coladas = PENDIENTES_NODE.filter((f) => ficheros.includes(f) && leer(f).includes("runtime: 'edge'"));
  ok(coladas.length === 0,
     'y los pendientes son Node de verdad, no edge escondidos ahí', coladas.join(', '));

  // Tampoco puede encogerse sola: si uno se migra, se quita de la lista.
  const yaMigrados = PENDIENTES_NODE.filter((f) => ficheros.includes(f) && !leer(f).includes('.well-known/jwks.json'));
  ok(yaMigrados.length === 0,
     'y el que ya se migró sale de la lista', yaMigrados.join(', '));
  console.log('     (quedan ' + copias.length + ' funciones Node por migrar, declaradas)');

  const viejos = ficheros.filter((f) => /async function getUserId\(req\)/.test(leer(f)));
  ok(viejos.length === 0, 'y no queda ningún getUserId propio', viejos.join(', '));
}

console.log('\nCada rechazo dice dónde fue, y conserva su sobre\n');
for (const f of conSesion) {
  const s = leer(f);
  const nombre = f.replace(/\.js$/, '');

  // 1. Rechaza con el motivo, o —si su envoltorio no responde— lo anota.
  const rechaza = /(?:cuerpoSinSesion|anotarSesion)\(sesion2?, '([\w-]+)'\)/.exec(s);
  if (!rechaza) { ok(false, f + ': rechaza con el motivo o lo anota'); continue; }

  // 2. Y con SU nombre: si todos dijeran lo mismo, el registro no serviría
  //    para saber qué pantalla falló, que es justo lo que hacía falta.
  if (rechaza[1] !== nombre) { ok(false, f + ': se identifica como «' + rechaza[1] + '»'); continue; }

  // 3. No puede quedar ningún 401 escrito a mano: sería un 401 mudo otra vez.
  //
  //    Solo el 401. Varios endpoints devuelven «No autorizado» con un 403 y
  //    eso es OTRA cosa —«esta conversación no es tuya»—: ahí la vaguedad es
  //    deliberada, porque un mensaje preciso confirmaría que el registro
  //    existe. La primera versión de esta prueba los marcaba a todos y me hizo
  //    perder el tiempo mirando cuatro rechazos que estaban bien.
  const mudos = (s.match(/error: 'No autorizado' \}, 401\)/g) || []).length;
  if (mudos) { ok(false, f + ': le queda un 401 mudo a mano (' + mudos + ')'); continue; }

  // 4. El sobre es suyo. Varios endpoints edge meten sus cabeceras CORS en su
  //    propio ayudante; si el rechazo se saltara ese ayudante, el navegador
  //    vería un error de CORS en vez del motivo — y de un formulario público
  //    o del webhook de leads eso es peor que el 401.
  //
  //    Esto es de los EDGE. Una función Node pone las CORS con
  //    `res.setHeader()` al entrar y responde con `res.status().json()`:
  //    exigirle el mismo envoltorio era inventarse un fallo.
  const esEdge = s.includes("runtime: 'edge'");
  const iCuerpo = s.indexOf('cuerpoSinSesion(sesion');
  if (esEdge && iCuerpo > 0) {
    const linea = s.slice(Math.max(0, iCuerpo - 200), iCuerpo + 60);
    const envuelto = /(jsonResp|json|new Response)\s*\(/.test(linea);
    if (!envuelto) { ok(false, f + ': el rechazo conserva su envoltorio', linea.slice(-120)); continue; }
  }
  if (!esEdge && iCuerpo > 0) {
    const linea = s.slice(Math.max(0, iCuerpo - 120), iCuerpo + 60);
    if (!/res\.status\(401\)\.json\(/.test(linea)) {
      ok(false, f + ': el rechazo Node sale por res.status(401).json()', linea.slice(-110)); continue;
    }
  }

  if (esEdge && s.includes('CORS')) {
    const usaSuAyudante = /(jsonResp|json)\(await cuerpoSinSesion/.test(s)
      // El `new Response(` puede llevar el cuerpo en la línea siguiente, así
      // que entre uno y otro puede haber salto y sangría. Buscarlos pegados
      // marcaba en rojo un chat.js que estaba perfectamente bien.
      || /new Response\([\s\S]{0,20}JSON\.stringify\(await cuerpoSinSesion[\s\S]{0,160}CORS/.test(s);
    if (!usaSuAyudante) { ok(false, f + ': el 401 sale con sus cabeceras CORS'); continue; }
  }
  ok(true, f);
}

console.log('\nNi los que no responden se quedan mudos\n');
{
  // Seis endpoints tienen un envoltorio que devuelve `null` o cae a plan
  // 'free' y deja que responda otro. Verificar por el módulo común no basta
  // ahí: si no anotan, siguen siendo mudos — media migración, y la peor
  // mitad, porque parece hecha.
  const mudos = conSesion.filter((f) => {
    const s = leer(f);
    return !/cuerpoSinSesion\(sesion2?, '[\w-]+'\)/.test(s)
        && !/anotarSesion\(sesion, '[\w-]+'\)/.test(s);
  });
  ok(mudos.length === 0, 'todos dicen quién falló, respondan o no', mudos.join(', '));

  // Y el que anota tiene que usar SU nombre, igual que el que responde.
  const malNombrados = conSesion.filter((f) => {
    const m = /anotarSesion\(sesion, '([\w-]+)'\)/.exec(leer(f));
    return m && m[1] !== f.replace(/\.js$/, '');
  });
  ok(malNombrados.length === 0, 'y con su propio nombre', malNombrados.join(', '));
}

console.log('\nLa regla de los módulos compartidos\n');
{
  // CLAUDE.md dice que un `api/_*.js` solo se importa desde funciones edge, y
  // `api/cron-tasks.js` lleva escrito que `_registro-errores.js` «rompió el
  // build una vez» desde Node. Pero `api/cron-retention.js` TAMBIÉN es Node,
  // lo importa estáticamente y corre todos los días a las 06:00. O sea que la
  // regla, como creencia general, está desactualizada.
  //
  // Lo que NO se puede es darla por buena sin más: hay que comprobarlo
  // desplegando, función por función. Por eso las que son Node van listadas
  // una a una, y cada nombre de esta lista significa «desplegada y
  // comprobada en producción».
  const NODE_COMPROBADAS = [   // desplegadas y comprobadas el 28-09-2026
    'admin.js', 'generate-image.js', 'geo-rank.js', 'google-ads.js', 'meta-ads.js',
    'refresh-google-token.js', 'refresh-meta-token.js', 'report.js', 'seo-rank.js',
    'social-publish.js', 'video-credits.js', 'video-gen.js',
  ];
  const noEdge = conSesion.filter((f) => !leer(f).includes("runtime: 'edge'"));
  const sinComprobar = noEdge.filter((f) => !NODE_COMPROBADAS.includes(f));
  ok(sinComprobar.length === 0,
     'las funciones Node que importan api/_sesion.js están comprobadas en producción',
     sinComprobar.join(', '));
  // Y al revés: una que se declare comprobada tiene que seguir siendo Node y
  // seguir importándolo, o la lista se vuelve un adorno.
  const fantasmas = NODE_COMPROBADAS.filter((f) => !noEdge.includes(f));
  ok(fantasmas.length === 0, 'y la lista no arrastra nombres que ya no aplican', fantasmas.join(', '));
}
{
  const s = leer('_sesion.js');
  ok(!s.includes('process.env.SUPABASE'),
     'el verificador no necesita credenciales: solo las llaves públicas de Clerk');
  ok(/export async function verificarSesion/.test(s) && /export async function cuerpoSinSesion/.test(s),
     'y expone las dos piezas que usan los endpoints');
}

// ── Que la migración no cambiara quién entra ────────────────────────────────
//
// Lo único que NO puede pasar es que esto haya ablandado un permiso. El
// verificador se prueba a fondo en `sesion-explica.mjs`; aquí se comprueba que
// el sitio donde se decide sigue siendo el mismo y sigue cortando.
console.log('\nY que siga cortando donde cortaba\n');
for (const f of conSesion.slice(0, 6).concat(['leads.js', 'team.js', 'pauta.js'])) {
  const s = leer(f);
  // `admin.js` verifica CONDICIONALMENTE —con el secreto del cron no hay
  // sesión que mirar— así que la línea no es siempre la misma. Se busca la
  // llamada, no una forma concreta de escribirla.
  const i = s.indexOf('verificarSesion(req)');
  const rechazo = Math.max(s.indexOf('cuerpoSinSesion(sesion'), s.indexOf('anotarSesion(sesion'));
  ok(i > 0 && rechazo > i && rechazo - i < 500,
     f + ': el rechazo va justo detrás de la verificación',
     'verifica en ' + i + ' y rechaza en ' + rechazo);
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);
