// El enlace para que el cliente pruebe el agente: node pruebas/probar-publico.mjs
//
// Un agente se encendía sin que el cliente lo hubiera visto nunca. El visto
// bueno llegaba después del primer reclamo, porque la primera conversación de
// verdad la tenía un cliente suyo.
//
// Esto abre el probador a alguien SIN cuenta, y eso son tres puertas que hay
// que dejar cerradas:
//   1. Que el token no se pueda fabricar ni reutilizar para otro agente.
//   2. Que por ahí no se escape nada de la configuración ni del CRM: quien
//      prueba ve la conversación, no a qué tablero va el lead ni si califica.
//   3. Que no se pueda gastar sin límite: un enlace público a un chat con IA
//      acaba en un grupo de WhatsApp.

import { readFileSync } from 'node:fs';

// La firma se lee del entorno al importar el módulo, así que se fija antes.
process.env.LINK_SECRET = 'secreto-de-prueba-no-es-el-de-produccion';
const { crearToken, abrirToken, DIAS_ENLACE } = await import('../api/_enlace-probar.js');

const pub = readFileSync(new URL('../api/probar-publico.js', import.meta.url), 'utf8');
const mint = readFileSync(new URL('../api/agent-probar.js', import.meta.url), 'utf8');
const pag = readFileSync(new URL('../public/probar.html', import.meta.url), 'utf8');
const firma = readFileSync(new URL('../api/_enlace-probar.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

const USUARIO = 'user_abc123';
const AGENTE = '4ada6303-670b-48bf-9f94-27ef154cb3c6';

// ── 1. El token ─────────────────────────────────────────────────────────────
console.log('\nUn enlace válido se abre; uno tocado, no');

const t = await crearToken(USUARIO, AGENTE);
ok(!!t, 'se crea');
const abierto = await abrirToken(t);
ok(abierto?.userId === USUARIO && abierto?.agentId === AGENTE,
   'y devuelve la cuenta y el agente que se firmaron', JSON.stringify(abierto));

// Cambiar el agente dentro del token es el ataque obvio: probar el agente de
// otro con un enlace propio.
const [datos, mac] = [t.slice(0, t.lastIndexOf('.')), t.slice(t.lastIndexOf('.') + 1)];
const otroAgente = encodeURIComponent(
  decodeURIComponent(datos).replace(AGENTE, '00000000-0000-0000-0000-000000000000')) + '.' + mac;
ok(await abrirToken(otroAgente) === null, 'cambiar el agente invalida la firma');

const otraCuenta = encodeURIComponent(
  decodeURIComponent(datos).replace(USUARIO, 'user_otro')) + '.' + mac;
ok(await abrirToken(otraCuenta) === null, 'cambiar la cuenta, también');

ok(await abrirToken(datos + '.' + '0'.repeat(32)) === null, 'una firma inventada no pasa');
ok(await abrirToken(datos) === null, 'y sin firma tampoco');
ok(await abrirToken('') === null, 'vacío no revienta');
ok(await abrirToken(null) === null, 'null tampoco');
ok(await abrirToken('sinpunto') === null, 'ni una cadena cualquiera');

console.log('\nY caduca');
const viejo = await crearToken(USUARIO, AGENTE, -1);
const r = await abrirToken(viejo);
ok(r?.caducado === true, 'un token de ayer se rechaza por caducado', JSON.stringify(r));
ok(!r?.userId, 'y no deja pasar la cuenta');
ok(DIAS_ENLACE >= 7 && DIAS_ENLACE <= 90, 'la caducidad por defecto es razonable: ' + DIAS_ENLACE + ' días');

// El orden importa: si la caducidad se comprobara ANTES que la firma, un token
// falso con fecha vieja diría «caducado» en vez de «inválido», y quien lo
// probara aprendería que la fecha se puede tocar.
ok(firma.indexOf('const esperada = await firmar(datos)') < firma.indexOf('Number(caduca) > Date.now()'),
   'la firma se comprueba ANTES que la caducidad');
ok(/dif \|= firma\.charCodeAt\(k\) \^ esperada\.charCodeAt\(k\)/.test(firma),
   'y la comparación es en tiempo constante');

console.log('\nSin secreto configurado no se firma nada');
{
  const guardado = process.env.LINK_SECRET;
  process.env.LINK_SECRET = '';
  // El módulo ya leyó la variable, así que esto comprueba el código, no el
  // estado: lo que importa es que exista la guarda.
  ok(/if \(!LINK_SECRET\) return null;/.test(firma), 'crear y abrir devuelven null sin secreto');
  process.env.LINK_SECRET = guardado;
}

// ── 2. Nada del CRM se escapa ───────────────────────────────────────────────
console.log('\nQué sale por el enlace y qué no');

const devuelve = pub.slice(pub.lastIndexOf('return jsonResp({'));
// La radiografía SÍ sale por el enlace. Al principio se dejó fuera por
// prudencia —quien abre no tiene cuenta— y resultó ser justo lo que hacía
// falta: quien prueba es el dueño del negocio, no un comprador, y lo que
// quiere ver es si el agente entendió.
for (const dentro of ['capturado', 'calificacion', 'ruta', 'catalogo']) {
  ok(devuelve.includes(dentro + ':'), `se devuelve «${dentro}», que es lo que se juzga`);
}
// Lo que no sale: las líneas del catálogo. Son muchas, no aportan al juicio y
// el número con sus filtros ya explica por qué ofreció lo que ofreció.
ok(/pistas: r\.catalogo\?\.pistas \|\| \{\}, ofrecidas: r\.catalogo\?\.ofrecidas \|\| 0/.test(devuelve),
   'del catálogo solo el número y los filtros, no la lista entera');
ok(!/lineas/.test(devuelve), 'las líneas del inventario no viajan');

ok(/select=name,is_active/.test(pub),
   'del agente solo se lee el nombre, no su prompt ni su contexto');
ok(!/business_ctx|persona|faqs/.test(pub), 'la configuración no sale de aquí');

// El ensayo no escribe nada; eso lo cubre probador-agente.mjs. Aquí basta con
// que use la MISMA función y no una copia suelta que pudiera escribir.
ok(/import \{ ensayarAgente \} from '\.\/_inbox-engine\.js'/.test(pub),
   'usa el mismo motor que el probador interno');
ok(/origen: 'ensayo-publico'/.test(pub),
   'y marca el gasto aparte, para poder verlo y ponerle tope');

console.log('\nEl enlace solo lo puede crear el dueño del agente');
const bloque = mint.slice(mint.indexOf("if (req.method === 'GET')"), mint.indexOf('let body;'));
ok(/user_id=eq\.\$\{encodeURIComponent\(userId\)\}/.test(bloque),
   'antes de firmar se comprueba que el agente es de esa cuenta');
ok(/Ese agente no existe en tu cuenta/.test(bloque), 'y si no, no se firma');
ok(mint.indexOf('verificarSesion') < mint.indexOf("if (req.method === 'GET')"),
   'y todo esto va detrás de la sesión');

// ── 3. El gasto ─────────────────────────────────────────────────────────────
console.log('\nUn chat abierto a internet es una puerta a gastar');
ok(/const TOPE_DIARIO = \d+/.test(pub), 'hay tope diario declarado');
ok(/if \(await usadosHoy\(userId\) >= TOPE_DIARIO\)/.test(pub), 'y se compara de verdad');
ok(/origen=eq\.ensayo-publico/.test(pub) && /ai_usage/.test(pub),
   'contado sobre ai_usage, donde consta el gasto');
ok(/429/.test(pub), 'al llegar al tope, 429');
ok(/return 0;/.test(pub.slice(pub.indexOf('async function usadosHoy'))),
   'y si no se puede contar, no bloquea al cliente');

// ── 4. La página ────────────────────────────────────────────────────────────
console.log('\nLa página que abre el cliente');
ok(/noindex/.test(pag), 'no la indexa Google: es el agente de un cliente, no una landing');
ok(/content: d\.bruto/.test(pag),
   'el historial se guarda en bruto: con el texto limpio el agente se quedaría amnésico');
ok(/vista\.push\(\{ r: 'el', t: d\.texto \}\)/.test(pag), 'y se pinta el limpio');
ok(/hist\.pop\(\); vista\.pop\(\)/.test(pag), 'un envío fallido no se queda en el historial');
ok(/prefers-color-scheme: dark/.test(pag), 'y se ve en modo oscuro');
ok(/Esto es una prueba/.test(pag), 'dice que es una prueba, para que nadie crea que ha contactado de verdad');
ok(/function radiografia\(/.test(pag) && /id="rx"/.test(pag), 'y pinta la radiografía');
ok(/Sin asesor asignado/.test(pag), 'incluido el aviso de que el lead se quedaría sin dueño');
ok(/grid-template-columns:1fr\}/.test(pag),
   'que en el teléfono va debajo del chat y no al lado');
// El asterisco de WhatsApp se veía en crudo y parecía un fallo del agente.
ok(/negritaWa/.test(pag), 'la negrita de WhatsApp se pinta como negrita');
// Un alert() del sistema en un móvil tapa la pantalla entera y hay que darle a
// Aceptar para poder seguir leyendo.
ok(!/(?<!\/\/ [^\n]{0,80})\balert\(/.test(pag.replace(/\/\*[\s\S]*?\*\//g, '')),
   'y los avisos no son alert() del navegador');
ok(/function avisar\(/.test(pag) && /id="aviso"/.test(pag), 'sino un aviso dentro de la página');

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const rutas = vercel.rewrites.map(x => x.source);
const iProbar = rutas.indexOf('/probar/:token');
const iTodo = rutas.findIndex(s => s.startsWith('/((?!api/'));
ok(iProbar >= 0, 'la ruta /probar/:token existe');
ok(iProbar < iTodo,
   'y va ANTES del catch-all, que si no se la traga y devuelve el armazón de la app con un 200');

console.log('');
process.exit(mal ? 1 : 0);
