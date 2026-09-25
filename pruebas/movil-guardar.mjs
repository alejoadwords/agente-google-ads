// Las acciones que escriben: node pruebas/movil-guardar.mjs
//
// Durante todo el boceto, las siete acciones que cambian algo repintaban la
// pantalla y NO llamaban a nadie. Mover un lead a Ganado se veía exactamente
// igual que si se hubiera guardado, y la base no se enteraba. En un CRM eso no
// se descubre hasta que el negocio ya se enfrió.
//
// Esta prueba EJECUTA el fichero de verdad contra un navegador y una red de
// mentira, y comprueba las tres cosas que importan:
//
//   1. que llame —a la ruta correcta, con el método y el cuerpo correctos—;
//   2. que si el servidor dice que no, la pantalla DESHAGA lo pintado;
//   3. que en modo muestra lo diga, en vez de fingir que guardó.
//
// Mirar el código con expresiones regulares no bastaba: una llamada puede
// existir y apuntar a la ruta equivocada.

import { readFileSync } from 'node:fs';

const fuente = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');

// El asidero para la prueba se INYECTA aquí, no vive en el fichero. Dejar
// ganchos de prueba en el código que baja al teléfono de un cliente es superficie
// que no hace falta; y como la inyección es mecánica, no puede separarse de lo
// que prueba. Si el envoltorio cambia de forma, esto revienta en vez de mentir.
const CIERRE = '})();';
if (!fuente.trimEnd().endsWith(CIERRE)) {
  throw new Error('movil-app.js ya no acaba en ' + CIERRE + ': revisa el envoltorio antes de tocar esta prueba');
}
const conAsidero = fuente.trimEnd().slice(0, -CIERRE.length) + `
  window.__pruebas = {
    modoReal: function(){ MODO = 'real'; },
    abrirLead: function(l){ leadAbierto = l; },
    abrirConv: function(c){ convAbierta = c; },
    caja: function(){ return $('#redactar'); },
    ponerCaja: function(el){ CAJA_PRUEBA = el; },
  };
` + CIERRE;

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

// ── El navegador de mentira ─────────────────────────────────────────────────
// Permisivo a propósito, igual que el de `movil-boceto.mjs`: cualquier
// `querySelector` devuelve un elemento en vez de null, para que el guion pueda
// montarse entero. Lo que SÍ se controla es el registro: los selectores que la
// prueba planta a mano —la caja de redactar, el campo de una hoja— y la
// chicharra, que es como el móvil dice si algo se guardó.
function montar({ responde = { ok: true, datos: {} } } = {}) {
  const llamadas = [];
  const chicharras = [];
  const registro = {};

  const elemento = (marca) => {
    const e = {
      _marca: marca || '', innerHTML: '', className: '', id: '', value: '',
      style: {}, dataset: {}, hidden: false, disabled: false, parentNode: null,
      classList: {
        _c: new Set(),
        add(c) { e.classList._c.add(c); }, remove(c) { e.classList._c.delete(c); },
        toggle(c) { e.classList._c.has(c) ? e.classList._c.delete(c) : e.classList._c.add(c); },
        contains(c) { return e.classList._c.has(c); },
      },
      setAttribute() {}, appendChild(h) { h.parentNode = e; return h; },
      remove() { e._quitado = true; }, addEventListener() {},
      querySelector: (sel) => registro[sel] || elemento(sel),
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ width: 0 }),
      set textContent(v) {
        e._txt = v;
        // La chicharra se reconoce por su clase, que es como la pinta el móvil.
        if (String(e.className).includes('chicharra')) chicharras.push({ txt: v, clase: e.className });
      },
      get textContent() { return e._txt; },
    };
    return e;
  };

  const raiz = elemento('raiz');
  const doc = {
    querySelector: (sel) => registro[sel] || elemento(sel),
    querySelectorAll: () => [],
    getElementById: (id) => registro['#' + id] || elemento('#' + id),
    createElement: () => elemento(),
    addEventListener() {}, readyState: 'complete',
    body: elemento('body'), head: elemento('head'),
  };

  const fetchAuth = async (ruta, opts = {}) => {
    llamadas.push({ ruta, metodo: opts.method, cuerpo: opts.body ? JSON.parse(opts.body) : null });
    if (responde.explota) throw new Error('sin red');
    return {
      ok: !!responde.ok,
      status: responde.ok ? 200 : 422,
      json: async () => (responde.ok ? (responde.datos || {}) : { error: responde.error || 'no se pudo' }),
    };
  };

  // Planta un elemento para un selector concreto y lo devuelve para inspeccionarlo.
  const plantar = (sel) => (registro[sel] = elemento(sel));

  return { raiz, doc, llamadas, chicharras, fetchAuth, elemento, plantar };
}

// Se ejecuta el fichero entero y se recoge lo que expone.
function correr(e) {
  const g = {
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    matchMedia: () => ({ matches: true }),
  };
  const win = new Proxy(g, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => (t[k] = v, true) });
  const entorno = {
    window: win, document: e.doc, navigator: { vibrate() {} },
    history: { pushState() {} },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1,
    console: { warn() {}, error() {}, log() {} },
  };
  const nombres = Object.keys(entorno);
  new Function(...nombres, conAsidero)(...nombres.map((n) => entorno[n]));
  // El móvil busca su raíz con movilRaiz(); aquí no hay documento de verdad, así
  // que se monta contra la nuestra.
  g.movilMontar({ fetchAuth: e.fetchAuth, raiz: e.raiz });
  return g;
}

// Un lead con la forma que devuelve `aLead`: probar con uno a medias haría que
// la prueba reventara por algo que en la aplicación no pasa.
const unLead = (extra) => Object.assign({
  id: 'L1', nom: 'Prueba', etapa: 'nuevo', hace: 'hace 2 h', tocado: 0, creado: 0,
  cerrado: false, origen: 'web', tel: '', email: '', empresa: '', valor: '',
  resp: 'Sin asignar', tags: [], interes: '', campana: '', pagina: '', cierre: '',
}, extra || {});

const esperar = () => new Promise((r) => setImmediate(r));

console.log('\nCambiar de etapa guarda, y si falla vuelve atrás\n');
{
  const e = montar({ responde: { ok: true, datos: {} } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const lead = unLead();
  g.__pruebas.abrirLead(lead);
  g.M.ponerEtapa('ganado');
  await esperar(); await esperar();
  const c = e.llamadas[0] || {};
  chk('llama a /api/leads', c.ruta === '/api/leads', c.ruta);
  chk('con PUT', c.metodo === 'PUT', c.metodo);
  chk('mandando el id y la etapa nueva',
      c.cuerpo && c.cuerpo.id === 'L1' && c.cuerpo.stage === 'ganado', JSON.stringify(c.cuerpo));
  chk('y la etapa queda puesta', lead.etapa === 'ganado', lead.etapa);
}
{
  // Lo que de verdad importa: el servidor dice que no y la pantalla NO puede
  // quedarse enseñando el cambio.
  const e = montar({ responde: { ok: false, error: 'etapa inválida' } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const lead = unLead();
  g.__pruebas.abrirLead(lead);
  g.M.ponerEtapa('ganado');
  await esperar(); await esperar();
  chk('si el servidor dice que no, la etapa VUELVE a la de antes',
      lead.etapa === 'nuevo', lead.etapa);
  chk('y se dice por qué, con el motivo del servidor',
      e.chicharras.some((x) => /etapa inválida/.test(x.txt) && /mal/.test(x.clase)),
      JSON.stringify(e.chicharras));
}
{
  const e = montar({ responde: { explota: true } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const lead = unLead();
  g.__pruebas.abrirLead(lead);
  g.M.ponerEtapa('ganado');
  await esperar(); await esperar();
  chk('sin red tampoco se da por guardado', lead.etapa === 'nuevo', lead.etapa);
  chk('y se dice que fue la conexión',
      e.chicharras.some((x) => /conexión/.test(x.txt)), JSON.stringify(e.chicharras.map((c) => c.txt)));
}

console.log('\nEn modo muestra NO se finge que se guardó\n');
{
  // Alguien revisando el diseño sin sesión no puede llevarse la impresión de
  // que movió un lead de verdad.
  const e = montar();
  const g = correr(e);
  g.movilMontar({});                 // sin fetchAuth: se queda en 'ejemplo'
  const lead = unLead();
  g.__pruebas.abrirLead(lead);
  g.M.ponerEtapa('ganado');
  await esperar(); await esperar();
  chk('no se llama a nadie', e.llamadas.length === 0, String(e.llamadas.length));
  chk('la etapa NO se queda cambiada', lead.etapa === 'nuevo', lead.etapa);
  chk('y se dice que es una muestra',
      e.chicharras.some((x) => /muestra/i.test(x.txt)), JSON.stringify(e.chicharras.map((c) => c.txt)));
}

console.log('\nPasar la conversación a «la atiendo yo» se guarda ANTES de pintar\n');
{
  // Esta es la que menos puede fallar en silencio: la hoja promete que el
  // agente deja de responder. Si no se guarda, el agente y el comercial le
  // escriben al cliente a la vez.
  const e = montar({ responde: { ok: false } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const conv = { id: 'C1', quien: 'bot' };
  g.__pruebas.abrirConv(conv);
  await g.M.ponerQuien('human');
  await esperar();
  const c = e.llamadas[0] || {};
  chk('llama a /api/chat-conversations con PUT',
      c.ruta === '/api/chat-conversations' && c.metodo === 'PUT', c.ruta + ' ' + c.metodo);
  chk('mandando el estado nuevo', c.cuerpo && c.cuerpo.status === 'human', JSON.stringify(c.cuerpo));
  chk('si no se guarda, el agente SIGUE marcado como quien atiende',
      conv.quien === 'bot', conv.quien);
}

console.log('\nEl mensaje no se borra de la caja hasta que sale\n');
{
  const e = montar({ responde: { ok: false, error: 'fuera de la ventana de 24 h' } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirConv({ id: 'C1', quien: 'human' });
  const caja = e.plantar('#redactar');
  caja.value = 'Voy para allá';
  await g.M.enviarMsg();
  await esperar();
  chk('se llama a la conversación', (e.llamadas[0] || {}).ruta === '/api/chat-conversations');
  // Perder lo escrito Y creer que se envió es el peor de los dos mundos.
  chk('si no salió, el texto SIGUE en la caja', caja.value === 'Voy para allá', caja.value);
  chk('y se dice el motivo del servidor',
      e.chicharras.some((x) => /ventana de 24/.test(x.txt)), JSON.stringify(e.chicharras.map((c) => c.txt)));
}

console.log('\nLas rutas son las mismas que usa la web\n');
{
  // Un segundo camino para lo mismo se separa del primero en un mes. Aquí solo
  // se comprueba que las rutas coincidan con las que llama app.js.
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const rutas = [...fuente.matchAll(/guardar\('([^']+)'/g)].map((m) => m[1]);
  chk('hay una ruta por cada acción que escribe', rutas.length >= 6, String(rutas.length));
  const fuera = rutas.filter((r) => !app.includes(r.split('?')[0]));
  chk('todas existen en app.js', fuera.length === 0, fuera.join(', '));
  chk('la nota interna usa el ?action=nota de la web',
      rutas.includes('/api/chat-conversations?action=nota'), rutas.join(' '));
  chk('la tarea se cierra en la agenda, que es el sistema real',
      rutas.includes('/api/agenda'), rutas.join(' '));
}

console.log('\nNinguna acción se quedó sin enchufar\n');
{
  // El barrido: si mañana alguien añade una acción que pinta y no guarda,
  // esto lo caza sin que haga falta acordarse de escribir su prueba.
  const codigo = fuente.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const ESCRIBEN = ['ponerEtapa', 'marcar', 'guardarNota', 'guardarCampo', 'crearLead', 'enviarMsg', 'ponerQuien'];
  for (const f of ESCRIBEN) {
    const i = codigo.indexOf('function ' + f + '(');
    const cuerpo = i < 0 ? '' : codigo.slice(i, codigo.indexOf('\n}', i));
    chk(f + ' guarda de verdad', /guardar\(/.test(cuerpo), i < 0 ? 'no existe' : 'no llama a guardar()');
  }
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
