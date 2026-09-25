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
    pedirRapidas: function(){ return pedirRapidas(); },
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
      remove() { e._quitado = true; }, addEventListener() {}, focus() {}, blur() {},
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
  g.M.ponerEtapa('contactado');
  await esperar(); await esperar();
  const c = e.llamadas[0] || {};
  chk('llama a /api/leads', c.ruta === '/api/leads', c.ruta);
  chk('con PUT', c.metodo === 'PUT', c.metodo);
  chk('mandando el id y la etapa nueva',
      c.cuerpo && c.cuerpo.id === 'L1' && c.cuerpo.stage === 'contactado', JSON.stringify(c.cuerpo));
  chk('y la etapa queda puesta', lead.etapa === 'contactado', lead.etapa);
}
{
  // Lo que de verdad importa: el servidor dice que no y la pantalla NO puede
  // quedarse enseñando el cambio.
  const e = montar({ responde: { ok: false, error: 'etapa inválida' } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const lead = unLead();
  g.__pruebas.abrirLead(lead);
  g.M.ponerEtapa('contactado');
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
  g.M.ponerEtapa('contactado');
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
  g.M.ponerEtapa('contactado');
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

console.log('\nLas respuestas rápidas son las de la cuenta\n');
{
  // Eran cuatro frases escritas a mano —«¡Hola! ¿En qué te ayudo?»— iguales
  // para todas las cuentas. Las de verdad viven en la web y al teléfono no
  // llegaban, así que el atajo no ahorraba nada: había que escribirlo todo.
  const e = montar({ responde: { ok: true, datos: { respuestas: [
    { id: 'r1', titulo: 'Saludo', texto: 'Hola, ¿en qué te ayudo?' },
    { id: 'r2', texto: 'Te comparto la ficha del inmueble' },
  ] } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const caja = e.plantar('#rapidas');
  await g.M.abrirConv && 0;
  g.__pruebas.modoReal();
  await g.__pruebas.pedirRapidas();
  await esperar();
  chk('se piden a la cuenta',
      e.llamadas.some((x) => x.ruta.startsWith('/api/quick-replies')),
      e.llamadas.map((x) => x.ruta).join(','));
  chk('y se pintan las que tiene', /Saludo/.test(caja.innerHTML), caja.innerHTML.slice(0, 120));
  // Sin título se usa el principio del texto: un chip vacío no se puede tocar.
  chk('la que no tiene título usa su texto', /Te comparto/.test(caja.innerHTML));

  // Al usarla se AÑADE a lo escrito, no lo reemplaza: quien escribió media
  // frase y toca un atajo no espera perder lo suyo.
  const ta = e.plantar('#redactar'); ta.value = 'Buenas tardes';
  g.M.usarRapida('r1');
  chk('se añade a lo ya escrito, no lo pisa',
      ta.value === 'Buenas tardes\nHola, ¿en qué te ayudo?', JSON.stringify(ta.value));
  // Y con la caja vacía no deja un salto de línea al principio.
  ta.value = '';
  g.M.usarRapida('r2');
  chk('y con la caja vacía no mete un salto de más',
      ta.value === 'Te comparto la ficha del inmueble', JSON.stringify(ta.value));
  chk('se cuenta el uso, de paso',
      e.llamadas.some((x) => x.ruta === '/api/quick-replies' && x.metodo === 'PUT'),
      e.llamadas.map((x) => x.ruta + ':' + x.metodo).join(','));
}
{
  // Sin respuestas guardadas NO se inventan unas genéricas ni se deja la fila
  // ocupando sitio: en un teléfono esa franja se la come el teclado.
  const e = montar({ responde: { ok: true, datos: { respuestas: [] } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const caja = e.plantar('#rapidas');
  g.__pruebas.modoReal();
  await g.__pruebas.pedirRapidas();
  await esperar();
  chk('sin respuestas, la fila queda vacía', caja.innerHTML === '', caja.innerHTML);
}
{
  // Y si la consulta falla, tampoco se cae a las de ejemplo: serían frases de
  // otra persona en la conversación de un cliente.
  const e = montar({ responde: { ok: false } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const caja = e.plantar('#rapidas');
  g.__pruebas.modoReal();
  await g.__pruebas.pedirRapidas();
  await esperar();
  chk('si falla no se cae a las de ejemplo',
      !/En qué te ayudo/.test(caja.innerHTML), caja.innerHTML.slice(0, 120));
}

console.log('\nLa nota puede avisar al responsable\n');
{
  // Quien dirige deja una instrucción y al responsable le llega por correo y
  // en la campana. Antes el móvil solo guardaba la nota: la dejaba escrita y
  // nadie se enteraba.
  const e = montar({ responde: { ok: true, datos: { aviso: { enviado: true } } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ id: 'L8', resp: 'Maira', respId: 'u7' }));
  const ta = e.plantar('#sh-nota'); ta.value = 'Llamarla hoy sin falta';
  const ck = e.plantar('#sh-avisar-ck'); ck.checked = true;
  g.__pruebas.modoReal();
  await g.M.guardarNota();
  await esperar();
  const c = e.llamadas[0] || {};
  chk('la nota va con la marca de avisar', c.cuerpo && c.cuerpo.avisar === true, JSON.stringify(c.cuerpo));
  chk('y se confirma a quién se avisó',
      e.chicharras.some((x) => /avisado Maira/.test(x.txt)), JSON.stringify(e.chicharras.map((x) => x.txt)));
}
{
  // El caso que importa: la nota SE GUARDA pero el correo no sale —un buzón
  // que rebota, el cupo del día—. Callarlo deja a quien la escribió creyendo
  // que el responsable ya se enteró.
  const e = montar({ responde: { ok: true, datos: { aviso: { enviado: false, motivo: 'buzón rebotado' } } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ id: 'L8', resp: 'Maira', respId: 'u7' }));
  e.plantar('#sh-nota').value = 'Ojo con este';
  e.plantar('#sh-avisar-ck').checked = true;
  g.__pruebas.modoReal();
  await g.M.guardarNota();
  await esperar();
  chk('si el aviso no sale, se dice',
      e.chicharras.some((x) => /el aviso no salió/.test(x.txt)), JSON.stringify(e.chicharras.map((x) => x.txt)));
  chk('y se dice el motivo',
      e.chicharras.some((x) => /buzón rebotado/.test(x.txt)));
  chk('sin fingir que se avisó',
      !e.chicharras.some((x) => /avisado Maira/.test(x.txt)));
}
{
  // Sin responsable no hay a quién avisar: la marca no puede viajar en true o
  // el servidor intentaría mandar un correo a nadie.
  const e = montar({ responde: { ok: true, datos: {} } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ id: 'L8', resp: 'Sin asignar', respId: null }));
  e.plantar('#sh-nota').value = 'Nota suelta';
  e.plantar('#sh-avisar-ck').checked = true;   // aunque alguien la marcara
  g.__pruebas.modoReal();
  await g.M.guardarNota();
  await esperar();
  chk('sin responsable no se pide aviso',
      (e.llamadas[0] || {}).cuerpo.avisar === false, JSON.stringify((e.llamadas[0] || {}).cuerpo));
}
{
  // La casilla solo para quien dirige: a un vendedor se le ofrecería mandarse
  // un correo a sí mismo, y el servidor no lo haría igual.
  const codigoMov = fuente.split('\n').filter((x) => !x.trim().startsWith('//')).join('\n');
  const i = codigoMov.indexOf('async function abrirNota');
  const fn = codigoMov.slice(i, codigoMov.indexOf('\n}', i));
  chk('la casilla depende del permiso de dirección', /soyDireccion/.test(fn), fn.slice(0, 140));
  // Y se dice a quién va ANTES de escribir, no después.
  chk('sin responsable se avisa antes de escribir', /no tiene responsable/.test(fn));
}

console.log('\nReasignar un contacto\n');
{
  const e = montar({ responde: { ok: true, datos: { lead: {} } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const l = unLead({ id: 'L5', resp: 'Karen', respId: 'u1' });
  g.__pruebas.abrirLead(l);
  g.__pruebas.modoReal();
  await g.M.ponerResponsable('u7', 'Maira');
  await esperar();
  const c = e.llamadas[0] || {};
  chk('se guarda en /api/leads con PUT',
      c.ruta === '/api/leads' && c.metodo === 'PUT', c.ruta + ' ' + c.metodo);
  // El id Y el nombre: el nombre es lo que se pinta y el id lo que manda.
  chk('con el id y el nombre del nuevo responsable',
      c.cuerpo.assigned_to === 'u7' && c.cuerpo.assigned_name === 'Maira', JSON.stringify(c.cuerpo));
  chk('y la ficha queda con el nuevo', l.respId === 'u7' && l.resp === 'Maira');
}
{
  // «Sin asignar» tiene que llegar como null, no como cadena vacía: una cadena
  // vacía en assigned_to deja el contacto asignado a un usuario que no existe.
  const e = montar({ responde: { ok: true, datos: { lead: {} } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ id: 'L5', respId: 'u1' }));
  g.__pruebas.modoReal();
  await g.M.ponerResponsable('', 'Sin asignar');
  await esperar();
  const b = (e.llamadas[0] || {}).cuerpo || {};
  chk('«sin asignar» viaja como null', b.assigned_to === null && b.assigned_name === null, JSON.stringify(b));
}
{
  // Si el servidor dice que no, la pantalla NO puede quedarse enseñando un
  // dueño que no se guardó: el contacto sale del filtro «Míos» de quien lo
  // lleva y entra en el de otro, y nadie se entera hasta que alguien pregunta
  // por qué no lo han llamado.
  const e = montar({ responde: { ok: false, error: 'no puedes reasignar' } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const l = unLead({ id: 'L5', resp: 'Karen', respId: 'u1' });
  g.__pruebas.abrirLead(l);
  g.__pruebas.modoReal();
  await g.M.ponerResponsable('u7', 'Maira');
  await esperar(); await esperar();
  chk('si el servidor dice que no, vuelve el de antes',
      l.respId === 'u1' && l.resp === 'Karen', l.resp + '/' + l.respId);
  chk('y se dice el motivo',
      e.chicharras.some((x) => /no puedes reasignar/.test(x.txt)),
      JSON.stringify(e.chicharras.map((c) => c.txt)));
}
{
  // A un miembro no se le ofrece: el servidor se lo negaría con un 403, y un
  // botón que promete y no cumple es peor que no tenerlo.
  const codigoMov = fuente.split('\n').filter((x) => !x.trim().startsWith('//')).join('\n');
  const i = codigoMov.indexOf('async function abrirResponsable');
  const fn = codigoMov.slice(i, codigoMov.indexOf('\n}', i));
  chk('a un miembro se le enseña, no se le ofrece', /if \(soyMiembro\(\)\)/.test(fn), fn.slice(0, 120));
  chk('y se le dice quién lo lleva', /l\.resp \|\| 'Sin asignar'/.test(fn));
  // Solo los activos: ofrecer a alguien invitado que todavía no entró deja el
  // contacto en manos de nadie.
  chk('solo se ofrecen los miembros activos', /m\.activo && m\.id/.test(fn));
  chk('y uno no se ofrece a sí mismo dos veces', /m\.id !== yo\.id/.test(fn));
}

console.log('\nCerrar un negocio pide importe y motivo\n');
{
  // Antes, mover un lead a Ganado desde el móvil guardaba la etapa a secas:
  // el informe de ganancias no sumaba nada y el de pérdidas no sabía por qué
  // se perdió. Y eso no se nota hasta que alguien mira el reporte del mes.
  const e = montar({ responde: { ok: true, datos: { lead: {} } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ id: 'L3', etapa: 'propuesta' }));
  g.M.ponerEtapa('ganado');
  await esperar(); await esperar();
  chk('mover a ganado NO guarda todavía',
      !e.llamadas.some((x) => x.ruta === '/api/leads'), e.llamadas.map((x) => x.ruta).join(','));
  chk('primero se pide el catálogo de motivos',
      e.llamadas.some((x) => x.ruta === '/api/close-reasons'));
}
{
  const e = montar({ responde: { ok: true, datos: { lead: {} } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const l = unLead({ id: 'L3', etapa: 'propuesta' });
  g.__pruebas.abrirLead(l);
  g.M.abrirCierre('ganado', 'propuesta');
  await esperar();
  e.plantar('#sh-motivo').value = 'Precio';
  e.plantar('#sh-cierre-dia').value = '2026-09-30';
  e.plantar('#sh-monto').value = '320000000';
  e.plantar('#sh-moneda').value = 'USD';
  // El banco deja MODO en 'fallo' en cuanto hay un `await` por medio: la
  // importación de movil-datos.js no resuelve aquí. Se refija antes de actuar.
  g.__pruebas.modoReal();
  await g.M.guardarCierre();
  await esperar();

  const put = e.llamadas.filter((x) => x.ruta === '/api/leads')[0] || {};
  chk('se guarda en /api/leads con PUT', put.metodo === 'PUT', put.metodo);
  const b = put.cuerpo || {};
  chk('con la etapa de cierre', b.stage === 'ganado', JSON.stringify(b));
  chk('el motivo', b.close_reason === 'Precio', b.close_reason);
  chk('el importe', b.value === 320000000, String(b.value));
  chk('y la moneda elegida', b.close_currency === 'USD', b.close_currency);
  // Un día suelto se interpreta como medianoche UTC, y en Colombia el cierre
  // se guardaría con la fecha del día ANTERIOR. La web usa mediodía por eso.
  chk('la fecha de cierre no retrocede un día',
      /^2026-09-30T1[0-9]:/.test(String(b.closed_at)), String(b.closed_at));
  chk('y el lead queda cerrado', l.etapa === 'ganado' && l.cerrado === true);
}
{
  // Sin motivo no se llama a nadie: cerrar sin motivo es lo que deja el
  // informe de pérdidas en blanco.
  const e = montar();
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ etapa: 'propuesta' }));
  g.M.abrirCierre('perdido', 'propuesta');
  await esperar();
  e.plantar('#sh-motivo').value = '';
  e.plantar('#sh-cierre-dia').value = '2026-09-30';
  g.__pruebas.modoReal();
  await g.M.guardarCierre();
  chk('sin motivo no se cierra',
      !e.llamadas.some((x) => x.ruta === '/api/leads'), e.llamadas.map((x) => x.ruta).join(','));
  chk('y se dice qué falta', e.chicharras.some((x) => /por qué se perdió/i.test(x.txt)),
      JSON.stringify(e.chicharras.map((c) => c.txt)));
}
{
  // La nota va PRIMERO y si no se guarda NO se cierra: quedaría un negocio
  // cerrado sin la explicación que alguien acaba de escribir.
  const e = montar({ responde: { ok: false, error: 'no se pudo' } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ etapa: 'propuesta' }));
  g.M.abrirCierre('perdido', 'propuesta');
  await esperar();
  e.plantar('#sh-motivo').value = 'Precio';
  e.plantar('#sh-cierre-dia').value = '2026-09-30';
  e.plantar('#sh-cierre-nota').value = 'Se fue con la competencia';
  g.__pruebas.modoReal();
  await g.M.guardarCierre();
  await esperar();
  const rutas = e.llamadas.map((x) => x.ruta);
  chk('la nota se intenta antes que el cierre',
      rutas[rutas.length - 1] === '/api/lead-activities', rutas.join(','));
  chk('y si la nota falla, el negocio NO se cierra',
      !rutas.includes('/api/leads'), rutas.join(','));
}

console.log('\nProgramar un seguimiento desde el teléfono\n');
{
  const e = montar({ responde: { ok: true, datos: { activity: { id: 'a9' } } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ id: 'L7', nom: 'Hellen' }));
  const txt = e.plantar('#sh-tarea');  txt.value = 'Llamar a Hellen';
  const cnd = e.plantar('#sh-cuando'); cnd.value = '2026-09-30T09:00';
  await g.M.crearTarea();
  await esperar();

  // Dos llamadas y EN ESTE ORDEN. `activities` es el sistema que dispara los
  // recordatorios; `lead_activities` es solo el historial. Escribir la línea
  // del historial sin la tarea deja constancia de un seguimiento que nadie va
  // a recordar.
  chk('primero la tarea de verdad, en la agenda',
      (e.llamadas[0] || {}).ruta === '/api/agenda', (e.llamadas[0] || {}).ruta);
  chk('y después la línea del historial',
      (e.llamadas[1] || {}).ruta === '/api/lead-activities', (e.llamadas[1] || {}).ruta);
  const t = (e.llamadas[0] || {}).cuerpo || {};
  chk('la tarea va con su tipo y su contacto',
      t.type === 'task' && t.lead_id === 'L7', JSON.stringify(t));
  chk('y con el texto escrito', t.title === 'Llamar a Hellen', t.title);
  // El servidor exige hora y zona: un día suelto hacía que la tarea NO se
  // creara, y el aviso de eso ya nos costó una vez.
  chk('la fecha viaja completa, con hora', /T\d\d:\d\d/.test(String(t.due_at)), String(t.due_at));
  chk('en UTC, que es lo que espera el servidor', /Z$/.test(String(t.due_at)), String(t.due_at));

  // El historial guarda la fecha para poder leerla y el id de la tarea real.
  const h = (e.llamadas[1] || {}).cuerpo || {};
  chk('el historial apunta a la tarea creada',
      h.metadata && h.metadata.activity_id === 'a9', JSON.stringify(h.metadata));
}
{
  // Si la agenda falla, NO puede quedar la línea del historial: diría que hay
  // un seguimiento programado que no existe.
  const e = montar({ responde: { ok: false, error: 'fecha inválida' } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead({ id: 'L7' }));
  e.plantar('#sh-tarea').value = 'Llamar';
  e.plantar('#sh-cuando').value = '2026-09-30T09:00';
  await g.M.crearTarea();
  await esperar();
  chk('si la tarea no se crea, no se escribe el historial',
      e.llamadas.length === 1, e.llamadas.map((x) => x.ruta).join(','));
  // Y el corte tiene que ser EXPLÍCITO. Sin el `return`, el código sigue y
  // revienta por su cuenta al leer `d.activity` de un null — dentro de un
  // `try` que se traga el error. El resultado acaba bien por accidente, y
  // una prueba que solo cuenta llamadas no lo distingue de hacerlo a
  // propósito. Lo que se protege aquí es la intención, no la casualidad.
  const fuenteCrear = fuente.slice(fuente.indexOf('async function crearTarea'),
                                  fuente.indexOf('/api/lead-activities'));
  chk('y el corte es explícito, no un accidente',
      /if \(!d\) return;/.test(fuenteCrear), fuenteCrear.slice(-160));
  chk('y se dice el motivo del servidor',
      e.chicharras.some((x) => /fecha inválida/.test(x.txt)), JSON.stringify(e.chicharras.map((c) => c.txt)));
}
{
  // Sin texto o sin fecha no se llama a nadie: es más barato decirlo aquí que
  // que el servidor lo rechace.
  const e = montar();
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead());
  e.plantar('#sh-tarea').value = '';
  e.plantar('#sh-cuando').value = '2026-09-30T09:00';
  await g.M.crearTarea();
  chk('sin texto no se llama a nadie', e.llamadas.length === 0);
  chk('y se dice qué falta', e.chicharras.some((x) => /qué hay que hacer/i.test(x.txt)));
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
