// Con sesión abierta, ni un dato de ejemplo: node pruebas/movil-sin-ejemplos.mjs
//
// Un cliente entró con su cuenta y el Pulso le enseñó «Hellen Marún»,
// «Sandra Caro» y un CPA de Google Ads de $84.200. Nada de eso era suyo: eran
// los datos de ejemplo del boceto. No parecía un fallo — parecía su cuenta.
//
// Pasaba por dos sitios: se pintaba TODO con ejemplos antes de mirar si había
// sesión, y el único filtro del Pulso era `MODO === 'real'`, así que mientras
// cargaba —y también si la carga FALLABA— salían los inventados.
//
// Esta prueba ejecuta el fichero de verdad y comprueba el orden.

import { readFileSync } from 'node:fs';

const fuente = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
const codigo = fuente.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nEl modo se decide ANTES del primer pintado\n');
{
  const i = codigo.indexOf('function movilMontar');
  const fn = codigo.slice(i, codigo.indexOf('\n}', i));
  const vacia = fn.indexOf('vaciarEjemplos()');
  const pinta = fn.indexOf('pintarTabs()');
  chk('se vacían los ejemplos al montar con sesión', vacia >= 0, 'no se vacían');
  // El orden es el fallo entero: pintar primero y comprobar después significa
  // que el usuario YA vio los datos de otro.
  chk('y se vacían antes de pintar nada', vacia >= 0 && vacia < pinta,
      'se pinta en la posición ' + pinta + ' y se vacía en la ' + vacia);
  chk('el disparador es que haya fetchAuth, o sea sesión',
      /if \(opciones\.fetchAuth\) \{ MODO = 'cargando'; vaciarEjemplos\(\); \}/.test(codigo));
}

console.log('\nEl Pulso solo enseña ejemplos cuando NO hay sesión\n');
{
  const i = codigo.indexOf('function pintarPulso');
  const fn = codigo.slice(i, codigo.indexOf('\n}\nfunction', i));
  // Antes: `if (MODO === 'real')` … y si no, ejemplos. O sea que 'cargando' y
  // 'fallo' —los dos momentos en que el usuario YA entró— pintaban inventados.
  chk('hay una puerta explícita para el modo ejemplo', /MODO !== 'ejemplo'/.test(fn), fn.slice(0, 150));
  const puerta = fn.indexOf("MODO !== 'ejemplo'");
  const usaPulso = fn.indexOf('PULSO.map');
  chk('la lista de ejemplo se usa DESPUÉS de esa puerta',
      puerta >= 0 && usaPulso > puerta, 'ejemplo en ' + usaPulso + ', puerta en ' + puerta);
  chk('mientras carga lo dice, no finge un Pulso', /Trayendo lo tuyo/.test(fn));
  chk('y si falla lo dice, en vez de inventar', /No se pudo traer tu Pulso/.test(fn));
}

console.log('\n«Trayendo» y «no se pudo» no son lo mismo\n');
{
  chk('existe el ayudante que los separa', /function sinLista\(queEs\)/.test(codigo));
  chk('mira el modo para elegir el texto',
      /MODO === 'cargando'[\s\S]{0,80}Trayendo/.test(codigo));
  // Las cuatro listas del CRM tienen que usarlo: decir «no se pudieron traer»
  // mientras carga asusta sin motivo, y decir «no tienes» miente.
  for (const q of ['tus contactos', 'tus tareas', 'tu agenda', 'tus conversaciones']) {
    chk(q + ' pasa por el ayudante', codigo.includes("sinLista('" + q + "')"));
  }
}

console.log('\nLos ejemplos se vacían de verdad, todos\n');
{
  const i = codigo.indexOf('function vaciarEjemplos');
  const fn = codigo.slice(i, codigo.indexOf('\n}', i));
  // Dejarse uno es dejar una pantalla mintiendo.
  for (const v of ['LEADS', 'TAREAS', 'CITAS', 'CONVS', 'BOTS', 'PIPELINES']) {
    chk(v + ' se vacía', new RegExp('\\b' + v + ' = null').test(fn), fn.slice(0, 100));
  }
  chk('y el Pulso de ejemplo también', /PULSO = \[\]/.test(fn));
}

console.log('\nEl alcance del móvil es el mismo que el de la web\n');
{
  // /api/leads sin alcance devuelve TODA la cuenta; /api/pipelines sin alcance
  // devuelve solo los tableros SIN cliente. Certain tiene cuatro tableros y
  // tres cuelgan de 'pro_main': el móvil enseñaba sus 369 contactos revueltos
  // y ningún selector, porque veía un solo tablero.
  chk('el móvil lee el alcance de la aplicación', /function alcanceCliente\(\)/.test(codigo));
  // `agencyActiveClientId` es un `let` de nivel superior en app.js, y esos NO
  // quedan en `window`: leerlo por `window.` daría undefined siempre y el
  // fallo volvería sin que nadie lo viera.
  chk('lo lee a pelo, no por window',
      /typeof agencyActiveClientId !== 'undefined'/.test(codigo)
      && !/window\.agencyActiveClientId/.test(codigo), 'lo lee por window: siempre undefined');
  chk('espera a que la aplicación lo resuelva', /function esperarAlcance\(/.test(codigo));
  chk('y se lo pasa a la carga', /cargarTodo\(fetchAuth, \{ clientId: cliente \}\)/.test(codigo));
  chk('si llega tarde, recarga con el bueno', /!== _alcanceUsado\) cargarReales\(\)/.test(codigo));
}

console.log('\nEl botón flotante dice lo que hace\n');
{
  // Era un círculo azul VACÍO: el botón no llevaba icono dentro, así que no se
  // entendía qué era. Y tapaba la última fila de la lista.
  chk('lleva icono', /class="fab"[^>]*>\$\{icn\('plus'/.test(fuente), 'sigue vacío');
  chk('y la palabra, no solo un signo', /<span>Contacto<\/span><\/button>/.test(fuente));
  const css = readFileSync(new URL('../public/movil-app.css', import.meta.url), 'utf8');
  chk('la lista deja sitio para que no lo tape', /#leads \.lista\{padding-bottom:\d+px\}/.test(css));
}

console.log('\nLa barra de arriba: tres puertas y ninguna muerta\n');
{
  // Menú, avisos y cuenta. Y el cliente activo en medio, solo si hay de dónde
  // elegir.
  for (const [q, h] of [['menú', 'M.abrirMenu()'], ['avisos', 'M.abrirAvisos()'], ['cuenta', 'M.abrirPerfil()']]) {
    chk('la barra abre ' + q, fuente.includes(h));
  }
  chk('las tres pantallas existen',
      /function abrirMenu\(/.test(codigo) && /async function abrirAvisos\(/.test(codigo)
      && /function abrirPerfil\(/.test(codigo));
  // El botón atrás del sistema tiene que cerrarlas o uno se queda encerrado.
  chk('el botón atrás las cierra', /\['hoja-menu','hoja-avisos','hoja-perfil'\]/.test(codigo));
  // La franja que ofrece el móvil promete que se puede volver «con un toque».
  // Ese toque no existía en NINGUNA parte: una salida prometida y ausente es
  // peor que no ofrecerla.
  chk('hay salida a la versión de escritorio', /function volverEscritorio\(/.test(codigo));
  chk('y usa el enganche de verdad', /movilEnganche\.apagar\(\)/.test(codigo));
  chk('se puede cerrar sesión', /function cerrarSesion\(/.test(codigo) && /logout\(\)/.test(codigo));
  // Los avisos son los MISMOS que la campana de la web, no una segunda lista.
  chk('los avisos salen de crmAvisos, no de una copia',
      /typeof crmAvisos !== 'undefined'/.test(codigo) && !/var AVISOS =/.test(codigo));
  chk('y se marcan leídos por el camino de la web', /crmAvisosMarcarLeidos\(\)/.test(codigo));
}

console.log('\nSin sesión se dice, no se finge un fallo\n');
{
  // «No se pudo traer» cuando no hay nada que traer asusta por algo que no
  // está roto. Se me escapó tres veces —avisos, NPS/academia y el equipo—,
  // así que esto lo vigila una prueba en vez de mi memoria.
  for (const q of ['tus avisos', 'tu satisfacción', 'los videos', 'tu equipo']) {
    chk('sin sesión, ' + q + ' lo dice', codigo.includes('Entra con tu cuenta para ver ' + q), q);
  }
}

console.log('\nEl cliente activo de una agencia se puede cambiar\n');
{
  chk('la barra enseña el cliente', /function pintarBarraCliente\(/.test(codigo));
  // El chip se enseña también con UN cliente: es el contexto de todo lo de
  // abajo, y sin verlo no se sabe de quién son los contactos que se miran.
  chk('el chip sale aunque haya un solo cliente', /if \(!cs\.length\) \{ medio\.innerHTML/.test(codigo));
  // Pero sin nada que elegir es una etiqueta, no un botón.
  chk('y con uno solo es etiqueta, no botón', /cs\.length < 2\s*\n?\s*\? '<div class="bcliente">/.test(codigo));

  // ── El fallo que lo destapó ──
  // Una cuenta de AGENCIA no recibe alcance automático: la aplicación solo lo
  // activa sola en las Pro, y en las de agencia lo restaura del localStorage,
  // que es del NAVEGADOR. En el teléfono está vacío la primera vez.
  //
  // Sin alcance, los tableros se piden con alcance nulo —donde solo está el
  // Principal— mientras los leads vienen de TODA la cuenta: 377 contactos
  // revueltos y ningún selector.
  chk('el móvil elige cliente si no hay ninguno activo', /async function alcanceInicial\(/.test(codigo));
  const ai = codigo.slice(codigo.indexOf('async function alcanceInicial'),
                          codigo.indexOf('\n}', codigo.indexOf('async function alcanceInicial')));
  chk('espera también a que llegue la cartera, no solo al alcance',
      /clientesDeLaWeb\(\)\.length/.test(codigo.slice(codigo.indexOf('function esperarAlcance'),
                                                      codigo.indexOf('async function alcanceInicial'))));
  chk('usa la misma regla que la web: pro_main o el primero',
      /'pro_main'/.test(ai) && /cs\[0\]/.test(ai), ai.slice(0, 140));
  chk('y lo activa por la aplicación, no a mano', /window\.agencyOpenClient/.test(ai));
  chk('una cuenta sin cartera no se inventa un cliente', /if \(!cs\.length\) return '';/.test(ai));
  // Dejar los leads del cliente anterior bajo el nombre del nuevo es la peor
  // forma de equivocarse en una agencia.
  const i = codigo.indexOf('async function elegirCliente');
  const fn = codigo.slice(i, codigo.indexOf('\n}', i));
  // Que el nombre aparezca no basta: tiene que LLAMARLO. Mirar solo si el
  // nombre está deja pasar que quede en un `typeof` y el cambio se haga a mano.
  chk('el cambio lo hace la aplicación, no una copia de su lógica',
      /await window\.agencyOpenClient\(id\)/.test(fn), fn.slice(0, 120));
  // Y NO puede escribirlo por su cuenta: la web se quedaría en el cliente
  // anterior y las dos pantallas enseñarían cuentas distintas.
  chk('y el móvil no toca el valor a mano',
      !/agencyActiveClientId\s*=/.test(fn), 'lo asigna él mismo');
  chk('al cambiar se recarga todo', /cargarReales\(\)/.test(fn));
  chk('y se olvida el tablero del cliente anterior', /pipelineActual = null/.test(fn));
  chk('si no se pudo cambiar, se dice', /No se pudo cambiar de cliente/.test(fn));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
