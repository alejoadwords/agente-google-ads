// El agente del chat agenda: node pruebas/reservas-agente.mjs
//
// Lo que tiene que ser verdad, y se comprueba EJECUTANDO cada pieza con una
// base y un Claude de mentira:
//
//  - solo se agendan los servicios marcados, aunque el modelo pida otro;
//  - la hora la comprueba el sistema: si ya no está libre, el «te agendo» del
//    agente NO sale y en su lugar se ofrecen otras horas;
//  - la cita se guarda por el mismo camino que la página pública, colgada del
//    contacto de la conversación, y el bloque repetido no la duplica;
//  - el ensayo comprueba y no escribe nada;
//  - el bloque no se le ve nunca al contacto: ni en el canal ni en el inbox.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.ANTHROPIC_API_KEY = 'ak';
delete process.env.RESEND_API_KEY;

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// ── La base de mentira ──────────────────────────────────────────────────────
// Un negocio en Bogotá, abierto todos los días de 9 a 17, dos personas y dos
// servicios: la asesoría la puede agendar el agente; el tratamiento, no.
const ZONA = 'America/Bogota';
const TODO = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, [['09:00', '17:00']]]));
const ASESORIA = '3f2a9c1d-0000-4000-8000-000000000001';
const TRATAMIENTO = '7b7b7b7b-0000-4000-8000-000000000002';
let db;
function base() {
  db = {
    settings: [{ user_id: 'u1', client_id: '', zona_horaria: ZONA, horario: TODO, excepciones: {}, margen_min: 0,
      paso_min: 30, antelacion_min_horas: 0, antelacion_max_dias: 30, activo: true, lead_source: 'reserva' }],
    servicios: [
      { id: ASESORIA, nombre: 'Asesoría', minutos: 60, precio: 0, agente_reserva: true, orden: 0,
        booking_service_resources: [{ resource_id: 'ana' }, { resource_id: 'luis' }] },
      { id: TRATAMIENTO, nombre: 'Tratamiento', minutos: 60, precio: 200000, agente_reserva: false, orden: 1,
        booking_service_resources: [{ resource_id: 'ana' }] },
    ],
    recursos: [{ id: 'ana', nombre: 'Ana Pérez', horario: null, orden: 0 }, { id: 'luis', nombre: 'Luis', horario: null, orden: 1 }],
    citas: [],
    insertadas: [],
    llamadas: [],
  };
}
const resp = (d, s = 200) => new Response(d === null ? '' : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
let claude = null;   // (system, messages) => texto
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const m = init.method || 'GET';
  db.llamadas.push({ u, m, body: init.body });
  if (u.startsWith('https://api.anthropic.com')) {
    const b = JSON.parse(init.body);
    return resp({ content: [{ type: 'text', text: claude(b.system, b.messages) }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'x' });
  }
  if (u.includes('/booking_settings')) return resp(db.settings);
  if (u.includes('/booking_services')) return resp(db.servicios);
  if (u.includes('/booking_resources')) return resp(db.recursos);
  if (u.includes('/booking_blocks') || u.includes('/booking_resource_calendars')) return resp([]);
  if (u.includes('/activities')) {
    if (m === 'POST') {
      const fila = { id: 'cita' + (db.insertadas.length + 1), ...JSON.parse(init.body) };
      // El índice único de verdad: misma persona, misma hora, cita viva.
      if (db.citas.some(c => c.resource_id === fila.resource_id && c.due_at === fila.due_at)) return resp({ code: '23505' }, 409);
      db.insertadas.push(fila); db.citas.push(fila);
      return resp([fila], 201);
    }
    if (u.includes('lead_id=eq.')) {
      const lead = u.match(/lead_id=eq\.([^&]+)/)[1], due = u.match(/due_at=eq\.([^&]+)/)?.[1];
      return resp(db.citas.filter(c => c.lead_id === lead && c.due_at === due));
    }
    return resp(db.citas);
  }
  if (m === 'POST') {
    const cuerpo = init.body ? JSON.parse(init.body) : {};
    return resp([{ id: 'fila' + db.llamadas.length, ...(Array.isArray(cuerpo) ? cuerpo[0] : cuerpo) }], 201);
  }
  if (m === 'PATCH' || m === 'DELETE') return resp([]);
  return resp([]);
};

const A = await import('../api/_reservas-agente.js');
const { cleanForUser } = await import('../api/_inbox-engine.js');
const { instanteDe, diaLocal } = await import('../api/_disponibilidad.js');

// Un día fijo de la semana que viene, para que la prueba no dependa de hoy.
const hoy = diaLocal(ZONA, new Date());
const DIA = new Date(Date.parse(hoy + 'T12:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
const iso = (hhmm) => instanteDe(ZONA, DIA, hhmm).toISOString();

// ── 1. El bloque y la limpieza ──────────────────────────────────────────────
console.log('\nEl bloque [RESERVA]\n');
{
  const p = A.extraerReserva('Perfecto, te la agendo.\n[RESERVA: {"servicio": "3f2a9c1d", "dia": "2026-10-01", "hora": "10:00", "nombre": "Laura", "con": "Ana"}]');
  ok(p && p.servicio === '3f2a9c1d' && p.dia === '2026-10-01' && p.hora === '10:00' && p.nombre === 'Laura' && p.con === 'Ana', 'se lee entero');
  ok(A.extraerReserva('hola') === null, 'sin bloque, nada');
  ok(A.extraerReserva('[RESERVA: {roto}]') === null, 'un JSON roto no revienta');
  ok(A.claveDe(ASESORIA) === '3f2a9c1d', 'la clave son los 8 primeros del id');

  const bruto = 'Te agendo.\n[CAPTURA: {"nombre": "Laura"}]\n[CALIFICACION: {"a": 1}]\n[RESERVA: {"servicio": "x"}]\n[ESCALAR]';
  const ocultos = A.bloquesOcultos(bruto);
  ok(/\[CAPTURA:/.test(ocultos) && /\[CALIFICACION:/.test(ocultos) && /\[RESERVA:/.test(ocultos) && /\[ESCALAR\]/.test(ocultos) && !/Te agendo/.test(ocultos),
     'al cambiar el texto se conservan los bloques y solo ellos', ocultos);

  ok(cleanForUser('Listo.\n[RESERVA: {"servicio": "x", "dia": "2026-10-01"}]') === 'Listo.', 'el canal no ve el bloque');
  ok(cleanForUser('Listo.\n[RESERVA: {"servicio": "x", "di') === 'Listo.', 'ni uno cortado a la mitad');
  ok(cleanForUser('Listo [RESERVA: {"servicio": "x"}] ¡nos vemos!') === 'Listo  ¡nos vemos!', 'y lo que va DESPUÉS del bloque no se pierde');

  // El inbox limpia por su cuenta al MOSTRAR: se ejecuta la función de verdad.
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = js.indexOf('function inboxLimpiar(txt) {');
  let prof = 0, j = js.indexOf('{', i);
  for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
  const inboxLimpiar = new Function(js.slice(i, j + 1) + '; return inboxLimpiar;')();
  ok(inboxLimpiar('Listo.\n[RESERVA: {"servicio": "x"}]') === 'Listo.', 'el inbox no enseña el bloque');
  ok(inboxLimpiar('Listo.\n[RESERVA: {"serv') === 'Listo.', 'ni cortado');
  ok(inboxLimpiar('Listo [RESERVA: {"servicio": "x"}] ¡nos vemos!') === 'Listo  ¡nos vemos!', 'ni se come lo que va después');
}

// Lo destapó Claude de verdad: «Te agendo mañana a las 11:00, ¿te parece
// bien?» con el bloque en el MISMO mensaje. La cita quedaba hecha antes del sí.
console.log('\n¿Está preguntando todavía?\n');
for (const [t, esperado] of [
  ['Dale. Te agendo mañana martes a las 11:00, ¿te parece bien?', true],
  ['Perfecto Laura, te agendo la asesoría el martes a las 9:00 con Ana, ¿está bien así?', true],
  ['¿Te la dejo el jueves a las 3?', true],
  ['¿Confirmamos para el viernes?', true],
  ['¿Te la cancelo entonces, la del martes a las 10?', true],
  ['¿Te la paso al jueves a las 3?', true],
  ['Listo, ya quedó cancelada. ¿Quieres agendar otra?', false],
  ['Listo, te la estoy agendando. ¿Necesitas algo más?', false],
  ['Listo, te la estoy agendando para el martes a las 10:00.', false],
  ['¿Qué día te viene mejor? Te agendo apenas me digas.', false],
]) ok(A.pideConfirmacion(t) === esperado, (esperado ? 'pregunta: ' : 'no pregunta: ') + t);

// ── 2. Lo que se le enseña al modelo ────────────────────────────────────────
console.log('\nLos huecos que ve el agente\n');
{
  base();
  db.citas.push({ due_at: iso('10:00'), end_at: iso('11:00'), resource_id: 'ana' },
                { due_at: iso('10:00'), end_at: iso('11:00'), resource_id: 'luis' });
  const info = await A.reservasParaAgente('u1', null, new Date());
  ok(info && info.servicios.length === 1 && info.servicios[0].nombre === 'Asesoría',
     'solo aparece el servicio marcado', JSON.stringify(info?.servicios.map(s => s.nombre)));
  const d = info.servicios[0].huecos.find(h => h.dia === DIA);
  ok(d && !d.horas.includes('10:00'), 'las 10:00, ocupadas por los dos, no se ofrecen', JSON.stringify(d));
  // Con citas de 60 min cada media hora de 9 a 17 salen más de 8 horas. La
  // muestra tiene que ir de la primera a la ÚLTIMA (16:00): con las 8 primeras,
  // a quien solo puede por la tarde no se le ofrecería nada.
  ok(d && d.horas.length <= 8 && d.horas.includes('09:00') && d.horas.includes('16:00'),
     'como mucho 8 por día, repartidas de la primera a la última', JSON.stringify(d?.horas));
  ok(info.servicios[0].huecos.length <= 5, 'como mucho 5 días');
  const txt = A.bloqueReservas(info, 'whatsapp');
  ok(txt.includes('[3f2a9c1d] Asesoría') && txt.includes(DIA) && !txt.includes('Tratamiento'),
     'el prompt nombra la asesoría por su clave y calla el tratamiento');
  ok(!txt.includes('`'), 'sin un solo backtick (vive dentro de un template literal)');
  ok(/es este chat/.test(txt) && !/es este chat/.test(A.bloqueReservas(info, 'webchat')),
     'en WhatsApp no pide el teléfono; en la web sí');
  ok(A.bloqueReservas(null) === '', 'sin reservas, el prompt ni las menciona');

  base();
  db.servicios.forEach(s => { s.agente_reserva = false; });
  ok((await A.reservasParaAgente('u1', null)) === null, 'sin servicios marcados, no hay nada que ofrecer');
}

// ── 3. Ejecutar la reserva ──────────────────────────────────────────────────
console.log('\nEjecutar el bloque\n');
const info0 = async () => { const i = await A.reservasParaAgente('u1', null, new Date()); return i; };
const pedido = (o = {}) => ({ servicio: '3f2a9c1d', dia: DIA, hora: '09:00', nombre: 'Laura', con: '', ...o });
const contacto = { nombre: 'Laura', telefono: '+573001112233', correo: '' };
{
  // Lo destapó la conversación con Claude de verdad: el modelo escribió
  // «Asesoría» en vez de la clave y no se agendó nada.
  base();
  const info = await info0();
  ok(A.servicioPedido(info, { servicio: 'Asesoría' })?.id === ASESORIA, 'si escribe el NOMBRE en vez de la clave, se reconoce igual');
  ok(A.servicioPedido(info, { servicio: 'asesoria' })?.id === ASESORIA, 'sin tilde y en minúsculas también');
  ok(A.servicioPedido(info, { servicio: 'Tratamiento' })?.id === TRATAMIENTO, 'y un nombre sin marcar se reconoce… para poder negarse');
  const r = await A.ejecutarReserva({ info, pedido: pedido({ servicio: 'Tratamiento' }), contacto, leadId: 'L1' });
  ok(!r.ok && r.escalar && db.insertadas.length === 0, 'pedir por su nombre uno SIN marcar tampoco lo agenda');
  db.servicios.push({ id: 'aaaaaaaa-0000-4000-8000-000000000003', nombre: 'Asesoría avanzada', minutos: 60, agente_reserva: true,
    booking_service_resources: [{ resource_id: 'ana' }] });
  db.servicios[0].nombre = 'Asesoría básica';
  const info2 = await info0();
  ok(A.servicioPedido(info2, { servicio: 'Asesoría' }) === null, 'con dos que empiezan igual no se adivina');
  const r2 = await A.ejecutarReserva({ info: info2, pedido: pedido({ servicio: 'Asesoría' }), contacto, leadId: 'L1' });
  ok(!r2.ok && r2.motivo === 'servicio_desconocido' && db.insertadas.length === 0, 'se pregunta cuál');
  const txt = A.bloqueReservas(info, 'whatsapp');
  ok(txt.includes('[RESERVA: {"servicio": "3f2a9c1d", "dia": "') && txt.includes('la de Asesoría es 3f2a9c1d'),
     'el ejemplo del prompt lleva la clave de verdad, no una plantilla');
}
{
  base();
  const info = await info0();
  const r = await A.ejecutarReserva({ info, pedido: pedido({ servicio: '7b7b7b7b' }), contacto, leadId: 'L1' });
  ok(!r.ok && r.escalar && db.insertadas.length === 0, 'un servicio SIN marcar no se agenda aunque el modelo lo pida, y se pasa a un asesor');
}
{
  base();
  const info = await info0();
  const r = await A.ejecutarReserva({ info, pedido: pedido(), contacto, leadId: 'L1' });
  const f = db.insertadas[0];
  ok(r.ok && f, 'el camino bueno guarda la cita', JSON.stringify(r).slice(0, 200));
  ok(f?.due_at === iso('09:00'), 'a las 09:00 de BOGOTÁ, no de UTC', f?.due_at);
  ok(f?.lead_id === 'L1', 'colgada del contacto de la conversación');
  ok(f?.service_id === ASESORIA && f?.booking_status === 'confirmada' && /^[a-f0-9]{32}$/.test(f?.booking_token || ''), 'con servicio, estado y token de cita');
  ok(r.texto.includes('https://app.acuarius.app/cita/' + f?.booking_token), 'la confirmación lleva el enlace para cancelar DE ESA cita');
  ok(!db.llamadas.some(l => l.u.includes('/leads') && l.m === 'POST'), 'con contacto ya creado, no se crea otro');
  await r.cerrar;

  // El mismo bloque otra vez (webhook repetido o el modelo lo repite).
  const r2 = await A.ejecutarReserva({ info, pedido: pedido(), contacto, leadId: 'L1' });
  ok(r2.ok && r2.repetida && db.insertadas.length === 1, 'el bloque repetido NO crea otra cita con la otra persona');
}
{
  base();
  // Solo se atiende ese día de la semana: así la hora que falla es la PRIMERA
  // de la lista de huecos, y se ve si se vuelve a ofrecer.
  db.settings[0].horario = { [new Date(DIA + 'T12:00:00Z').getUTCDay()]: [['09:00', '12:00']] };
  db.citas.push({ due_at: iso('09:00'), end_at: iso('10:00'), resource_id: 'ana', lead_id: 'otro' },
                { due_at: iso('09:00'), end_at: iso('10:00'), resource_id: 'luis', lead_id: 'otro' });
  // El agente ofreció las 09:00 antes de que se ocuparan: la info es de antes.
  const antes = db.citas.splice(0);
  const info = await info0();
  db.citas.push(...antes);
  const r = await A.ejecutarReserva({ info, pedido: pedido(), contacto, leadId: 'L1' });
  ok(!r.ok && r.motivo === 'ocupada' && db.insertadas.length === 0, 'si la hora ya no está libre, no se guarda nada');
  ok(/no está libre/.test(r.texto) && /¿Cuál te sirve\?/.test(r.texto), 'y el texto lo dice y ofrece otras', r.texto);
  const fallida = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso('09:00')));
  const ofrecidas = r.texto.split('\n').slice(1, -1);
  ok(ofrecidas.length >= 1 && !ofrecidas.includes(fallida), 'sin volver a ofrecer la que acaba de fallar', JSON.stringify({ fallida, ofrecidas }));
}
{
  // El índice único solo mira la hora EXACTA de inicio. Una cita de 8:30 a
  // 9:30 no choca con él y aun así tapa las 9:00: eso solo lo ve la
  // comprobación de antes de guardar.
  base();
  const info = await info0();
  db.citas.push({ due_at: iso('08:30'), end_at: iso('09:30'), resource_id: 'ana' },
                { due_at: iso('08:30'), end_at: iso('09:30'), resource_id: 'luis' });
  const r = await A.ejecutarReserva({ info, pedido: pedido(), contacto, leadId: 'L1' });
  ok(!r.ok && db.insertadas.length === 0, 'una cita que empezó antes y sigue en curso también tapa la hora');
}
{
  base();
  const info = await info0();
  const r = await A.ejecutarReserva({ info, pedido: pedido({ con: 'ana' }), contacto, leadId: 'L1' });
  ok(r.ok && db.insertadas[0]?.resource_id === 'ana', '«con Ana» agenda con Ana (sin mayúscula ni apellido)');
}
{
  // Luis va SEGUNDO: si el nombre no se reconociera, saldría Ana por ser la
  // primera libre y la prueba no se enteraría.
  base();
  const info = await info0();
  const r = await A.ejecutarReserva({ info, pedido: pedido({ con: 'LUÍS' }), contacto, leadId: 'L1' });
  ok(r.ok && db.insertadas[0]?.resource_id === 'luis', '«con LUÍS» agenda con Luis (con tilde y en mayúsculas)', db.insertadas[0]?.resource_id);
}
{
  base();
  const info = await info0();
  db.citas.push({ due_at: iso('09:00'), end_at: iso('10:00'), resource_id: 'ana' });
  const r = await A.ejecutarReserva({ info, pedido: pedido({ con: 'Ana' }), contacto, leadId: 'L1' });
  ok(!r.ok && /con Ana Pérez no está libre/.test(r.texto) && db.insertadas.length === 0,
     'si pidió a Ana y Ana está ocupada, NO se le cuela a Luis sin preguntar', r.texto);
}
{
  base();
  const info = await info0();
  const r = await A.ejecutarReserva({ info, pedido: pedido(), contacto, leadId: 'L1', simular: true });
  ok(r.ok && r.simulada && db.insertadas.length === 0 && /^\(Ensayo/.test(r.texto), 'el ensayo comprueba y no escribe nada');
  ok(!db.llamadas.some(l => l.m === 'POST'), 'ni contacto, ni cita, ni nada');
}
{
  base();
  const info = await info0();
  const lejos = new Date(Date.parse(DIA + 'T12:00:00Z') + 90 * 86400000).toISOString().slice(0, 10);
  const r = await A.ejecutarReserva({ info, pedido: pedido({ dia: lejos }), contacto, leadId: 'L1' });
  ok(!r.ok && r.motivo === 'lejos' && db.insertadas.length === 0, 'más allá de la antelación máxima no se agenda');
  const r2 = await A.ejecutarReserva({ info, pedido: pedido({ nombre: '' }), contacto: { telefono: '+57300' }, leadId: 'L1' });
  ok(!r2.ok && r2.motivo === 'nombre', 'sin nombre, lo pide');
  const r3 = await A.ejecutarReserva({ info, pedido: pedido(), contacto: { nombre: 'Laura' }, leadId: 'L1' });
  ok(!r3.ok && r3.motivo === 'contacto', 'sin teléfono ni correo (chat web), lo pide');
  const r4 = await A.ejecutarReserva({ info, pedido: pedido({ hora: 'mañana' }), contacto, leadId: 'L1' });
  ok(!r4.ok && r4.motivo === 'fecha', 'una hora que no es hora, se pregunta');
}

// ── 4. El motor entero, con un Claude de mentira ────────────────────────────
console.log('\nLa conversación de verdad (processIncoming)\n');
const { processIncoming } = await import('../api/_inbox-engine.js');
function conCanal() {
  const viejo = globalThis.fetch;
  const guardados = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const m = init.method || 'GET';
    if (u.includes('/channel_connections')) return resp([{ id: 'c1', user_id: 'u1', channel: 'whatsapp', external_id: 'x', agent_id: 'ag', client_id: null, is_active: true }]);
    if (u.includes('/chat_agents')) return resp([{ id: 'ag', name: 'Sofía', user_id: 'u1', client_id: null, is_active: true }]);
    if (u.includes('/chat_conversations') && m === 'GET') return resp([{ id: 'conv1', status: 'bot', channel: 'whatsapp', lead_id: 'L1', contact_name: 'Laura' }]);
    if (u.includes('/chat_messages') && m === 'POST') { const b = JSON.parse(init.body); guardados.push(b); return resp([{ id: 'm' + guardados.length, ...b }], 201); }
    if (u.includes('/chat_messages') && m === 'GET') return resp([{ role: 'user', content: 'sí, agéndame' }]);
    return viejo(url, init);
  };
  return { guardados, restaurar: () => { globalThis.fetch = viejo; } };
}
async function turno(respuestaModelo) {
  const enviados = [];
  let systemVisto = '';
  // El prompt llega como texto o como bloques (desde que se cachea): se lee el texto.
  claude = (system) => { systemVisto = Array.isArray(system) ? system.map(b => b.text || '').join('\n') : String(system); return respuestaModelo; };
  const c = conCanal();
  try {
    const r = await processIncoming({ channel: 'whatsapp', externalId: 'x', contactId: '573001112233', contactName: 'Laura',
      text: 'sí, agéndame', providerMessageId: 'p' + Math.random(), send: async (_c, _to, t) => { enviados.push(t); } });
    return { r, enviados, guardados: c.guardados, systemVisto };
  } finally { c.restaurar(); }
}
{
  base();
  const t = await turno('¡Perfecto, Laura! Te la estoy agendando.\n[RESERVA: {"servicio": "3f2a9c1d", "dia": "' + DIA + '", "hora": "11:00", "nombre": "Laura"}]');
  ok(t.systemVisto.includes('AGENDAR CITAS') && t.systemVisto.includes('[3f2a9c1d]'), 'el prompt real lleva los servicios y sus huecos');
  ok(db.insertadas.length === 1 && db.insertadas[0].due_at === iso('11:00') && db.insertadas[0].lead_id === 'L1',
     'la cita se guarda, a su hora y en su contacto', JSON.stringify(db.insertadas[0] || {}).slice(0, 160));
  ok(db.insertadas[0]?.resource_id && /573001112233/.test(db.insertadas[0].description), 'con el teléfono del chat');
  ok(t.enviados.length === 2 && t.enviados[0] === '¡Perfecto, Laura! Te la estoy agendando.' && /^Cita confirmada/.test(t.enviados[1]),
     'por WhatsApp salen dos mensajes: el del agente y la confirmación', JSON.stringify(t.enviados));
  ok(!t.enviados.some(x => x.includes('[RESERVA')), 'el bloque no le llega al contacto');
  ok(t.guardados.some(g => g.role === 'assistant' && g.content.includes('[RESERVA:')), 'el historial guarda el bloque en bruto');
  ok(t.guardados.some(g => g.role === 'assistant' && /^Cita confirmada/.test(g.content)), 'y la confirmación, para que el agente sepa que ya quedó');
}
{
  base();
  db.citas.push({ due_at: iso('11:00'), end_at: iso('12:00'), resource_id: 'ana', lead_id: 'otro' },
                { due_at: iso('11:00'), end_at: iso('12:00'), resource_id: 'luis', lead_id: 'otro' });
  const t = await turno('¡Listo, te agendo a las 11!\n[CAPTURA: {"nombre": "Laura"}]\n[RESERVA: {"servicio": "3f2a9c1d", "dia": "' + DIA + '", "hora": "11:00", "nombre": "Laura"}]');
  ok(db.insertadas.length === 0, 'con la hora ocupada no se guarda nada');
  ok(t.enviados.length === 1 && !t.enviados[0].includes('te agendo') && /no está libre/.test(t.enviados[0]),
     'el «te agendo» del agente NO sale: sale el aviso con otras horas', JSON.stringify(t.enviados));
  const g = t.guardados.find(x => x.role === 'assistant');
  ok(g && !g.content.includes('te agendo') && g.content.includes('[CAPTURA:'),
     'el historial guarda lo que de verdad se dijo, con los bloques ocultos intactos', g?.content);
}
{
  base();
  const t = await turno('Dale. Te agendo mañana a las 11:00, ¿te parece bien?\n[RESERVA: {"servicio": "3f2a9c1d", "dia": "' + DIA + '", "hora": "11:00", "nombre": "Laura"}]');
  ok(db.insertadas.length === 0, 'si el agente PREGUNTA y pone el bloque a la vez, no se agenda todavía');
  ok(t.enviados.length === 1 && t.enviados[0].endsWith('¿te parece bien?'), 'y la pregunta sale tal cual, esperando el sí', JSON.stringify(t.enviados));
}
{
  base();
  const t = await turno('Te agendo el tratamiento.\n[RESERVA: {"servicio": "7b7b7b7b", "dia": "' + DIA + '", "hora": "11:00", "nombre": "Laura"}]');
  ok(db.insertadas.length === 0 && t.r.escalated === true, 'un servicio no marcado no se agenda y la conversación pasa a una persona');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
