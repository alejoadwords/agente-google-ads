// La agenda del teléfono: node pruebas/movil-agenda.mjs
//
// Dos cosas iban mal, y las dos calladas.
//
// 1. La agenda pedía `/api/agenda` SIN ventana. Esa puerta devuelve las 500
//    actividades más ANTIGUAS de la cuenta ordenadas por fecha: en Certain hay
//    564, así que todo lo posterior al 29 de septiembre no llegaba nunca. Una
//    cita de octubre no existía en el teléfono, sin hueco y sin aviso. Y lo
//    que sí llegaba eran las citas de semanas pasadas.
// 2. Cada cita se pintaba con la HORA y nada más. Dos visitas a las nueve, una
//    el martes y otra el jueves, se leían idénticas. En una pantalla cuyo
//    único trabajo es decirte dónde tienes que estar, eso es el error más caro
//    que puede tener.
//
// Y faltaba lo que más se hace de pie: agendar. Se comprueba que la cita se
// crea de verdad, dentro del cliente activo, y que si Google Calendar queda
// fuera se DICE — quien agenda una visita cuenta con que le suene la alarma.

import { readFileSync } from 'node:fs';
import { aCita, nombreDia, claveDia, desdeHoy, hastaEnUnMesYMedio, cargarTodo }
  from '../public/movil-datos.js';

const fuente = readFileSync(new URL('../public/movil-app.js', import.meta.url), 'utf8');
const datos = readFileSync(new URL('../public/movil-datos.js', import.meta.url), 'utf8');
const endpoint = readFileSync(new URL('../api/agenda.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/movil-app.css', import.meta.url), 'utf8');

// Los comentarios EXPLICAN el fallo, así que contienen las palabras que la
// prueba busca. Buscar sobre el fichero entero daba verde por el comentario.
// Es la cuarta vez que esta trampa muerde: se quitan siempre primero.
const soloCodigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const codApp = soloCodigo(fuente);
const codDatos = soloCodigo(datos);

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

// ── 1. La cita sabe de qué día es ───────────────────────────────────────────
console.log('\nUna cita lleva el día, no solo la hora\n');
{
  // Un martes a las 21:00 en Colombia. En UTC eso ya es el miércoles: si el
  // día se sacara de toISOString(), la visita aparecería un día tarde.
  const tarde = new Date(2026, 8, 22, 21, 0, 0);       // 22-09-2026, 21:00 local
  const c = aCita({ id: 'A1', type: 'meeting', due_at: tarde.toISOString(),
                    end_at: new Date(tarde.getTime() + 3600000).toISOString(),
                    title: 'Visita', lead_id: 'L1' }, tarde.getTime() - 3600000);
  chk('trae la clave del día', !!c.clave, JSON.stringify(c.clave));
  chk('y es el día LOCAL, no el de UTC', c.clave === '2026-09-22', c.clave);
  chk('trae un nombre de día legible', typeof c.dia === 'string' && c.dia.length > 0, c.dia);
  chk('la duración sigue saliendo', c.dur === '1 h', c.dur);
  chk('y el contacto, para poder abrirlo', c.lead === 'L1', String(c.lead));
}
{
  const ahora = new Date(2026, 8, 25, 10, 0, 0).getTime();
  chk('hoy se llama «Hoy»', nombreDia(new Date(2026, 8, 25, 18, 0), ahora) === 'Hoy',
      nombreDia(new Date(2026, 8, 25, 18, 0), ahora));
  chk('mañana se llama «Mañana»', nombreDia(new Date(2026, 8, 26, 8, 0), ahora) === 'Mañana',
      nombreDia(new Date(2026, 8, 26, 8, 0), ahora));
  const otro = nombreDia(new Date(2026, 8, 29, 8, 0), ahora);
  chk('el resto lleva día de la semana y fecha', /\d/.test(otro) && otro.length > 5, otro);
  chk('y no se llama «Hoy» un día que no es hoy', otro !== 'Hoy' && otro !== 'Mañana', otro);
}
{
  // Una cita sin fecha no puede colarse como si fuera de hoy.
  const c = aCita({ id: 'A2', type: 'meeting', due_at: null, title: 'Sin fecha' });
  chk('sin fecha se dice, no se inventa un día', c.dia === 'Sin fecha' && c.clave === '',
      JSON.stringify([c.dia, c.clave]));
  chk('y no se marca como pasada', c.pasada === false, String(c.pasada));
}

// ── 2. Se entra por la puerta con ventana ───────────────────────────────────
console.log('\nLa agenda pide una ventana, no las 500 más antiguas\n');
{
  const pedidas = [];
  const fetchAuth = async (ruta) => {
    pedidas.push(ruta);
    return { ok: true, json: async () => ({ leads: [], activities: [], vencidas: [], hoy: [], proximas: [], conversations: [], pipelines: [] }) };
  };
  await cargarTodo(fetchAuth, { clientId: 'C9' });
  // La del calendario es la que NO lleva `tareas=1`.
  const cal = pedidas.find((r) => r.startsWith('/api/agenda') && !/tareas=1/.test(r));
  chk('se pide el calendario', !!cal, JSON.stringify(pedidas));
  chk('con from', /[?&]from=/.test(cal || ''), cal);
  chk('y con to', /[?&]to=/.test(cal || ''), cal);
  chk('y sin perder el cliente activo', /client_id=C9/.test(cal || ''), cal);

  const from = decodeURIComponent((cal.match(/[?&]from=([^&]+)/) || [])[1] || '');
  const to = decodeURIComponent((cal.match(/[?&]to=([^&]+)/) || [])[1] || '');
  // Contra el RELOJ, no contra `desdeHoy()`: comparar la ventana con la misma
  // función que la construye es una tautología —si la función se equivoca, la
  // prueba se equivoca con ella y da verde—. Lo que hay que comprobar es que
  // sea medianoche, para que la reunión de esta mañana siga a la vista.
  const dFrom = new Date(from);
  chk('el from es el principio de hoy, no de ahora',
      dFrom.getHours() === 0 && dFrom.getMinutes() === 0 && dFrom.getSeconds() === 0,
      from + ' → ' + dFrom.getHours() + ':' + dFrom.getMinutes());
  chk('y es HOY', dFrom.toDateString() === new Date().toDateString(), from);
  chk('el to está por delante del from', new Date(to) > new Date(from), from + ' → ' + to);
  chk('y la ventana llega a mes y medio',
      Math.round((new Date(to) - new Date(from)) / 86400000) >= 44,
      String(Math.round((new Date(to) - new Date(from)) / 86400000)) + ' días');
}
{
  // La regla de las puertas: un parámetro que el endpoint no lee es un
  // parámetro que no hace nada, y la petición cae en otra rama sin decirlo.
  // Fue exactamente lo que pasó con `?proximos=1`.
  chk('el endpoint LEE from', /searchParams\.get\('from'\)/.test(endpoint));
  chk('el endpoint LEE to', /searchParams\.get\('to'\)/.test(endpoint));
  chk('y los aplica a la consulta',
      /due_at=gte\.\$\{encodeURIComponent\(from\)\}/.test(endpoint)
      && /due_at=lte\.\$\{encodeURIComponent\(to\)\}/.test(endpoint));
}
{
  // Que la ventana exista en el código, no solo en la prueba.
  chk('cargarTodo no vuelve a pedir el calendario a pelo',
      !/uno\('\/api\/agenda'\s*\+\s*\(q1/.test(codDatos));
  chk('desdeHoy pone el reloj a cero', /setHours\(0,\s*0,\s*0,\s*0\)/.test(codDatos));
}

// ── 3. El navegador de mentira ──────────────────────────────────────────────
const CIERRE = '})();';
if (!fuente.trimEnd().endsWith(CIERRE)) {
  throw new Error('movil-app.js ya no acaba en ' + CIERRE + ': revisa el envoltorio antes de tocar esta prueba');
}
const conAsidero = fuente.trimEnd().slice(0, -CIERRE.length) + `
  window.__pruebas = {
    modoReal: function(){ MODO = 'real'; },
    abrirLead: function(l){ leadAbierto = l; },
    ponerCitas: function(c){ CITAS = c; },
    pintarAgenda: function(){ return pintarAgenda(); },
    ver: function(id){ return ver(id); },
    duracion: function(){ return duracionCita; },
  };
` + CIERRE;

function montar({ responde = { ok: true, datos: {} } } = {}) {
  const llamadas = [], chicharras = [], registro = {};
  const elemento = (marca) => {
    const e = {
      _marca: marca || '', innerHTML: '', className: '', id: '', value: '',
      style: {}, dataset: {}, hidden: false, checked: false, parentNode: null,
      classList: {
        _c: new Set(),
        add(c) { e.classList._c.add(c); }, remove(c) { e.classList._c.delete(c); },
        toggle(c, v) {
          if (v === undefined) { e.classList._c.has(c) ? e.classList._c.delete(c) : e.classList._c.add(c); }
          else if (v) { e.classList._c.add(c); } else { e.classList._c.delete(c); }
        },
        contains(c) { return e.classList._c.has(c); },
      },
      setAttribute() {}, appendChild(h) { h.parentNode = e; return h; },
      remove() { e._quitado = true; }, addEventListener() {}, focus() {}, blur() {},
      querySelector: (sel) => registro[sel] || elemento(sel),
      querySelectorAll: (sel) => registro['@@' + sel] || [],
      getBoundingClientRect: () => ({ width: 0 }),
      set textContent(v) {
        e._txt = v;
        if (String(e.className).includes('chicharra')) chicharras.push({ txt: v, clase: e.className });
      },
      get textContent() { return e._txt; },
    };
    return e;
  };
  const raiz = elemento('raiz');
  const doc = {
    querySelector: (sel) => registro[sel] || elemento(sel),
    querySelectorAll: (sel) => registro['@@' + sel] || [],
    getElementById: (id) => registro['#' + id] || elemento('#' + id),
    createElement: () => elemento(),
    addEventListener() {}, readyState: 'complete',
    body: elemento('body'), head: elemento('head'),
  };
  const fetchAuth = async (ruta, opts = {}) => {
    llamadas.push({ ruta, metodo: opts.method, cuerpo: opts.body ? JSON.parse(opts.body) : null });
    if (responde.explota) throw new Error('sin red');
    return {
      ok: !!responde.ok, status: responde.ok ? 200 : 422,
      json: async () => (responde.ok ? (responde.datos || {}) : { error: responde.error || 'no se pudo' }),
    };
  };
  const plantar = (sel) => (registro[sel] = elemento(sel));
  const plantarVarios = (sel, n) => (registro['@@' + sel] = Array.from({ length: n }, () => elemento(sel)));
  return { raiz, doc, llamadas, chicharras, fetchAuth, elemento, plantar, plantarVarios, registro };
}

function correr(e) {
  const g = { addEventListener() {}, removeEventListener() {}, scrollTo() {}, matchMedia: () => ({ matches: true }) };
  const win = new Proxy(g, { has: () => true, get: (t, k) => t[k], set: (t, k, v) => (t[k] = v, true) });
  const entorno = {
    window: win, document: e.doc, navigator: { vibrate() {} },
    history: { pushState() {} },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1,
    console: { warn() {}, error() {}, log() {} },
  };
  const nombres = Object.keys(entorno);
  new Function(...nombres, conAsidero)(...nombres.map((n) => entorno[n]));
  g.movilMontar({ fetchAuth: e.fetchAuth, raiz: e.raiz });
  return g;
}
const esperar = () => new Promise((r) => setImmediate(r));

// ── 4. La agenda se pinta por días ──────────────────────────────────────────
console.log('\nLa agenda se lee por días, y «AHORA» sale una vez\n');
{
  const e = montar();
  const lista = e.plantar('#agenda .lista');
  const g = correr(e);
  g.__pruebas.ponerCitas([
    { h: '09:30', dur: '45 min', t: 'Visita A', s: '', pasada: true,  dia: 'Hoy',    clave: '2026-09-25' },
    { h: '15:00', dur: '1 h',    t: 'Visita B', s: '', pasada: false, dia: 'Hoy',    clave: '2026-09-25' },
    { h: '08:00', dur: '1 h',    t: 'Visita C', s: '', pasada: false, dia: 'Mañana', clave: '2026-09-26' },
    { h: '11:00', dur: '30 min', t: 'Visita D', s: '', pasada: false, dia: 'jueves, 1 oct', clave: '2026-10-01' },
  ]);
  g.__pruebas.pintarAgenda();
  const h = lista.innerHTML;
  chk('hay un encabezado por día', (h.match(/class="grupo"/g) || []).length === 3,
      String((h.match(/class="grupo"/g) || []).length));
  chk('los días salen con su nombre', /Hoy/.test(h) && /Mañana/.test(h) && /jueves/.test(h));
  chk('«AHORA» sale UNA sola vez', (h.match(/class="ahora"/g) || []).length === 1,
      String((h.match(/class="ahora"/g) || []).length));
  chk('y las cuatro citas están', ['Visita A','Visita B','Visita C','Visita D'].every((t) => h.includes(t)));
}
{
  // «AHORA» marca UNA frontera. Hoy el servidor ordena por fecha, así que las
  // pasadas llegan todas juntas al principio y una sola frontera es lo natural.
  // Se prueba con la lista DESORDENADA a propósito: el día que ese orden cambie
  // —o que entre una cita sin fecha por medio— la pantalla no puede acabar con
  // tres líneas rojas repartidas, que no marcan nada.
  const e = montar();
  const lista = e.plantar('#agenda .lista');
  const g = correr(e);
  g.__pruebas.ponerCitas([
    { h: '09:00', t: 'Pasada',    s: '', pasada: true,  dia: 'Hoy',    clave: 'd1' },
    { h: '15:00', t: 'Luego',     s: '', pasada: false, dia: 'Hoy',    clave: 'd1' },
    { h: '08:00', t: 'Otra vieja',s: '', pasada: true,  dia: 'Mañana', clave: 'd2' },
    { h: '11:00', t: 'Más luego', s: '', pasada: false, dia: 'Mañana', clave: 'd2' },
  ]);
  g.__pruebas.pintarAgenda();
  chk('aunque el orden se rompa, «AHORA» sigue saliendo una vez',
      (lista.innerHTML.match(/class="ahora"/g) || []).length === 1,
      String((lista.innerHTML.match(/class="ahora"/g) || []).length));
}
{
  const e = montar();
  const lista = e.plantar('#agenda .lista');
  const g = correr(e);
  g.__pruebas.ponerCitas([]);
  g.__pruebas.pintarAgenda();
  chk('vacía no dice «para hoy»: la lista es de mes y medio',
      !/para hoy/i.test(lista.innerHTML) && /vacio/.test(lista.innerHTML), lista.innerHTML);
}
{
  const e = montar();
  const lista = e.plantar('#agenda .lista');
  const g = correr(e);
  g.__pruebas.ponerCitas(null);
  g.__pruebas.pintarAgenda();
  chk('y si no se pudo traer, no dice que no hay nada',
      !/Nada agendado/.test(lista.innerHTML), lista.innerHTML);
}

// ── 5. Agendar desde el teléfono ────────────────────────────────────────────
console.log('\nAgendar una cita guarda de verdad\n');
const sheetCita = (e, { email = '', cuando = '2026-10-01T09:00', invitar = false } = {}) => {
  const t = e.plantar('#sh-cita'); t.value = 'Visita · Prueba';
  const c = e.plantar('#sh-cita-cuando'); c.value = cuando;
  if (email) { const i = e.plantar('#sh-cita-inv'); i.checked = invitar; }
  e.plantar('#sh-dur');
};
const unLead = (extra) => Object.assign({
  id: 'L1', nom: 'Prueba', etapa: 'nuevo', hace: 'hace 2 h', tocado: 0,
  origen: 'web', tel: '', email: '', resp: 'Sin asignar', tags: [],
}, extra || {});

{
  const e = montar({ responde: { ok: true, datos: { activity: { id: 'A9' }, gcal_synced: true } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  const lead = unLead({ email: 'a@b.com' });
  g.__pruebas.abrirLead(lead);
  sheetCita(e, { email: 'a@b.com', invitar: true });
  g.M.crearCita(true);
  await esperar(); await esperar(); await esperar();
  const c = e.llamadas.find((x) => /\/api\/agenda/.test(x.ruta)) || {};
  chk('llama a /api/agenda', !!c.ruta, JSON.stringify(e.llamadas.map((x) => x.ruta)));
  chk('con POST', c.metodo === 'POST', c.metodo);
  chk('de tipo meeting, que es lo que sincroniza el calendario',
      c.cuerpo && c.cuerpo.type === 'meeting', JSON.stringify(c.cuerpo));
  chk('con due_at en ISO', c.cuerpo && !isNaN(new Date(c.cuerpo.due_at).getTime()), c.cuerpo?.due_at);
  chk('y con end_at: sin hora de fin el evento no tiene duración',
      c.cuerpo && !!c.cuerpo.end_at, String(c.cuerpo?.end_at));
  chk('la duración por defecto es una hora',
      c.cuerpo && (new Date(c.cuerpo.end_at) - new Date(c.cuerpo.due_at)) === 3600000,
      String((new Date(c.cuerpo?.end_at) - new Date(c.cuerpo?.due_at)) / 60000) + ' min');
  chk('la hora es la LOCAL que se escribió, no cinco horas corrida',
      c.cuerpo && new Date(c.cuerpo.due_at).getTime() === new Date('2026-10-01T09:00').getTime(),
      c.cuerpo?.due_at);
  chk('cuelga del contacto', c.cuerpo && c.cuerpo.lead_id === 'L1', String(c.cuerpo?.lead_id));
  chk('y lleva la invitación marcada', c.cuerpo && c.cuerpo.invite_lead === true,
      String(c.cuerpo?.invite_lead));
}
{
  // El alcance por cliente: sin él la cita nace con client_id null y
  // desaparece de la vista del cliente aunque esté guardada.
  const e = montar({ responde: { ok: true, datos: { activity: { id: 'A9' } } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  globalThis.agencyActiveClientId = 'C7';
  g.__pruebas.abrirLead(unLead());
  sheetCita(e);
  g.M.crearCita(true);
  await esperar(); await esperar(); await esperar();
  const c = e.llamadas.find((x) => /\/api\/agenda/.test(x.ruta)) || {};
  chk('la cita se crea DENTRO del cliente activo', /client_id=C7/.test(c.ruta || ''), c.ruta);
  delete globalThis.agencyActiveClientId;
}
{
  // Sin contacto: una reunión interna es una cita igual.
  const e = montar({ responde: { ok: true, datos: { activity: { id: 'A9' } } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  sheetCita(e);
  g.M.crearCita(false);
  await esperar(); await esperar(); await esperar();
  const c = e.llamadas.find((x) => /\/api\/agenda/.test(x.ruta)) || {};
  chk('sin contacto también se agenda', !!c.ruta, JSON.stringify(e.llamadas.map((x) => x.ruta)));
  chk('y va sin lead_id', c.cuerpo && c.cuerpo.lead_id === null, String(c.cuerpo?.lead_id));
}
{
  const e = montar();
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead());
  sheetCita(e, { cuando: '' });
  g.M.crearCita(true);
  await esperar(); await esperar();
  chk('sin fecha no se llama a nadie', e.llamadas.length === 0, String(e.llamadas.length));
  chk('y se dice qué falta', e.chicharras.some((x) => /fecha/i.test(x.txt)),
      JSON.stringify(e.chicharras.map((x) => x.txt)));
}
{
  const e = montar();
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead());
  sheetCita(e);
  e.registro['#sh-cita'].value = '   ';
  g.M.crearCita(true);
  await esperar(); await esperar();
  chk('sin título tampoco', e.llamadas.length === 0, String(e.llamadas.length));
}
{
  const e = montar({ responde: { ok: false, error: 'La fecha es requerida' } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead());
  sheetCita(e);
  g.M.crearCita(true);
  await esperar(); await esperar(); await esperar();
  chk('si el servidor dice que no, se dice con su motivo',
      e.chicharras.some((x) => /La fecha es requerida/.test(x.txt) && /mal/.test(x.clase)),
      JSON.stringify(e.chicharras.map((x) => x.txt)));
  chk('y NO se canta agendada', !e.chicharras.some((x) => /Google Calendar/.test(x.txt)),
      JSON.stringify(e.chicharras.map((x) => x.txt)));
}

console.log('\nLo que el calendario no pudo hacer se dice\n');
{
  const e = montar({ responde: { ok: true, datos: {
    activity: { id: 'A9' }, gcal_synced: false,
    gcal_warning: 'Google Calendar no está conectado — la reunión quedó solo en Acuarius.' } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead());
  sheetCita(e);
  g.M.crearCita(true);
  await esperar(); await esperar(); await esperar();
  chk('el aviso del calendario llega al usuario',
      e.chicharras.some((x) => /Google Calendar no está conectado/.test(x.txt)),
      JSON.stringify(e.chicharras.map((x) => x.txt)));
  chk('y se marca como problema, no como confirmación',
      e.chicharras.some((x) => /Google Calendar no está conectado/.test(x.txt) && /mal/.test(x.clase)),
      JSON.stringify(e.chicharras.map((x) => x.clase)));
}
{
  const e = montar({ responde: { ok: true, datos: { activity: { id: 'A9' }, gcal_synced: true } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead());
  sheetCita(e);
  g.M.crearCita(true);
  await esperar(); await esperar(); await esperar();
  chk('si sí se sincronizó, se dice también',
      e.chicharras.some((x) => /Google Calendar/.test(x.txt) && /ok/.test(x.clase)),
      JSON.stringify(e.chicharras.map((x) => x.txt)));
}
{
  // En modo muestra no se puede fingir que se agendó.
  const e = montar();
  const g = correr(e);
  g.movilMontar({});
  g.__pruebas.abrirLead(unLead());
  sheetCita(e);
  g.M.crearCita(true);
  await esperar(); await esperar();
  chk('en muestra no se llama a nadie', e.llamadas.length === 0, String(e.llamadas.length));
  chk('y se dice que es una muestra', e.chicharras.some((x) => /muestra/i.test(x.txt)),
      JSON.stringify(e.chicharras.map((x) => x.txt)));
}

// ── 6. La duración se elige y se ve ─────────────────────────────────────────
console.log('\nLa duración se puede cambiar y se ve cuál está puesta\n');
{
  const e = montar({ responde: { ok: true, datos: { activity: { id: 'A9' } } } });
  const g = correr(e);
  g.__pruebas.modoReal();
  g.__pruebas.abrirLead(unLead());
  sheetCita(e);
  const botones = e.plantarVarios('.rapida', 4);
  e.registro['#sh-dur'].querySelectorAll = () => botones;
  g.M.durCita(3);                       // 2 h
  chk('la duración elegida se guarda', g.__pruebas.duracion() === 120,
      String(g.__pruebas.duracion()));
  chk('y se marca el botón elegido', botones[3].classList.contains('puesta'));
  chk('solo ese', !botones[0].classList.contains('puesta') && !botones[1].classList.contains('puesta'));
  g.M.crearCita(true);
  await esperar(); await esperar(); await esperar();
  const c = e.llamadas.find((x) => /\/api\/agenda/.test(x.ruta)) || {};
  chk('y el end_at la respeta',
      (new Date(c.cuerpo.end_at) - new Date(c.cuerpo.due_at)) === 120 * 60000,
      String((new Date(c.cuerpo?.end_at) - new Date(c.cuerpo?.due_at)) / 60000) + ' min');
}
{
  // La clase tiene que existir de verdad: un `.puesta` inventado no falla, solo
  // deja los cuatro botones iguales y la duración invisible.
  chk('.rapida.puesta existe en el CSS', /\.rapida\.puesta\s*\{/.test(css));
}

// ── 7. Se llega a agendar desde las dos puertas ─────────────────────────────
console.log('\nSe llega a agendar desde la agenda y desde la ficha\n');
{
  const e = montar();
  const fab = e.plantar('.fab');
  // La etiqueta del botón es su `<span>`, y tiene que ser SIEMPRE el mismo
  // elemento: uno nuevo en cada consulta perdería el texto que acabamos de
  // poner y la prueba diría «undefined» sin que nada esté roto.
  const etiqueta = e.elemento('span');
  fab.querySelector = () => etiqueta;
  const g = correr(e);
  g.__pruebas.ver('agenda');
  chk('en Agenda el botón flotante se ve', fab.hidden === false, String(fab.hidden));
  chk('y dice «Cita»', etiqueta._txt === 'Cita', String(etiqueta._txt));
  g.__pruebas.ver('leads');
  chk('en Contactos sigue diciendo «Contacto»', etiqueta._txt === 'Contacto', String(etiqueta._txt));
  g.__pruebas.ver('tareas');
  chk('y en Tareas no hay botón flotante', fab.hidden === true, String(fab.hidden));
}
{
  chk('la ficha ofrece «+ Cita»', /M\.abrirCita\(true\)/.test(codApp));
  // Contra la LÍNEA de la caja de citas, no contra el fichero entero: `c.dia`
  // aparece en más sitios, así que buscarlo a secas daba verde aunque la ficha
  // volviera a pintar solo la hora.
  const cajaCitas = (codApp.match(/caja\('Citas'[\s\S]{0,220}/) || [''])[0];
  chk('la caja de citas de la ficha existe', /caja\('Citas'/.test(codApp));
  chk('y pinta el día junto a la hora',
      /c\.dia/.test(cajaCitas) && /c\.h/.test(cajaCitas), cajaCitas.slice(0, 120));
}
{
  // Todo `onclick` en línea corre en ámbito GLOBAL: si no pasa por `M.`, no
  // existe. Ya rompió las pestañas de la ficha una vez.
  const nuevos = (codApp.match(/onclick="[^"]*(?:Cita|cuandoCita|durCita)[^"]*"/g) || []);
  chk('hay manejadores nuevos que comprobar', nuevos.length >= 3, String(nuevos.length));
  chk('y todos pasan por M.', nuevos.every((h) => /onclick="M\./.test(h)),
      nuevos.filter((h) => !/onclick="M\./.test(h)).join(' | '));
  for (const f of ['abrirCita', 'cuandoCita', 'durCita', 'crearCita']) {
    chk(`${f} está expuesto en window.M`,
        new RegExp('\\b' + f + ':\\s*' + f + '\\b').test(codApp));
  }
}

console.log(fallos ? `\n  ${fallos} comprobaciones fallaron\n` : '\n  todo en verde\n');
process.exit(fallos ? 1 : 0);
