// Cancelar y cambiar una cita desde el chat: node pruebas/reservas-cambios.mjs
//
// Lo que tiene que ser verdad, EJECUTANDO cada pieza con una base y un Claude
// de mentira:
//
//  - el agente solo ve y solo toca las citas del contacto de SU conversación;
//  - cancelar libera el hueco y borra el evento de Google;
//  - cambiar MUEVE la misma cita (el enlace de cancelar sigue valiendo), se
//    mira el hueco sin contarse a sí misma, y si no está libre la cita de antes
//    sigue en pie y se dice así;
//  - cambiar solo en servicios marcados; cancelar, siempre;
//  - nada se hace mientras el propio mensaje del agente pide el visto bueno.

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

const ZONA = 'America/Bogota';
const TODO = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, [['09:00', '17:00']]]));
const ASESORIA = '3f2a9c1d-0000-4000-8000-000000000001';
const TRATAMIENTO = '7b7b7b7b-0000-4000-8000-000000000002';
let db;
const resp = (d, s = 200) => new Response(d === null ? '' : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
let claude = null;

function base() {
  db = {
    settings: [{ user_id: 'u1', client_id: '', zona_horaria: ZONA, horario: TODO, excepciones: {}, margen_min: 0,
      paso_min: 60, antelacion_min_horas: 0, antelacion_max_dias: 30, activo: true }],
    servicios: [
      { id: ASESORIA, nombre: 'Asesoría', minutos: 60, agente_reserva: true, orden: 0,
        booking_service_resources: [{ resource_id: 'ana' }, { resource_id: 'luis' }] },
      { id: TRATAMIENTO, nombre: 'Tratamiento', minutos: 60, agente_reserva: false, orden: 1,
        booking_service_resources: [{ resource_id: 'ana' }] },
    ],
    recursos: [{ id: 'ana', nombre: 'Ana', horario: null, orden: 0 }, { id: 'luis', nombre: 'Luis', horario: null, orden: 1 }],
    citas: [],
    llamadas: [],
    googleBorrados: [],
  };
}
const cita = (o) => ({ id: o.id, user_id: 'u1', client_id: null, lead_id: o.lead || 'L1', title: 'Asesoría · Laura',
  service_id: o.servicio || ASESORIA, resource_id: o.recurso || 'ana', due_at: o.due, end_at: new Date(Date.parse(o.due) + 3600000).toISOString(),
  booking_token: 'tok' + o.id, gcal_event_id: o.gcal || null, cancelled_at: o.cancelada || null, recordatorios_enviados: [24] });

globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const m = init.method || 'GET';
  db.llamadas.push({ u, m, body: init.body });
  if (u.startsWith('https://api.anthropic.com')) {
    const b = JSON.parse(init.body);
    return resp({ content: [{ type: 'text', text: claude(b.system) }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'x' });
  }
  if (u.includes('googleapis.com/calendar')) { db.googleBorrados.push(u); return resp(null, 204); }
  if (u.includes('/platform_connections')) return resp([{ access_token: 'g', token_expires_at: new Date(Date.now() + 3600e3).toISOString() }]);
  if (u.includes('/booking_settings')) return resp(db.settings);
  if (u.includes('/booking_services')) return resp(db.servicios);
  if (u.includes('/booking_resources')) return resp(db.recursos);
  if (u.includes('/booking_blocks') || u.includes('/booking_resource_calendars')) return resp([]);
  if (u.includes('/activities')) {
    const vivas = db.citas.filter(c => !c.cancelled_at);
    if (m === 'PATCH') {
      const id = u.match(/id=eq\.([^&]+)/)[1];
      const c = db.citas.find(x => x.id === id && (!u.includes('cancelled_at=is.null') || !x.cancelled_at));
      if (!c) return resp([]);
      const cambios = JSON.parse(init.body);
      const tras = { ...c, ...cambios };
      // El índice único de verdad: misma persona, misma hora, cita viva.
      if (!tras.cancelled_at && vivas.some(x => x.id !== c.id && x.resource_id === tras.resource_id && x.due_at === tras.due_at)) {
        return resp({ code: '23505' }, 409);
      }
      Object.assign(c, cambios);
      return resp([c]);
    }
    if (m === 'POST') return resp([{ id: 'nueva', ...JSON.parse(init.body) }], 201);
    let out = vivas;
    const lead = u.match(/lead_id=eq\.([^&]+)/)?.[1];
    if (lead) out = out.filter(c => c.lead_id === lead);
    const desde = u.match(/due_at=gte\.([^&]+)/)?.[1];
    if (desde && lead) out = out.filter(c => c.due_at >= desde);
    return resp(out.sort((a, b) => a.due_at.localeCompare(b.due_at)));
  }
  if (m === 'POST') {
    const cuerpo = init.body ? JSON.parse(init.body) : {};
    return resp([{ id: 'fila' + db.llamadas.length, ...(Array.isArray(cuerpo) ? cuerpo[0] : cuerpo) }], 201);
  }
  return resp([]);
};

const A = await import('../api/_reservas-agente.js');
const { cleanForUser, processIncoming } = await import('../api/_inbox-engine.js');
const { instanteDe, diaLocal } = await import('../api/_disponibilidad.js');

const hoy = diaLocal(ZONA, new Date());
const DIA = new Date(Date.parse(hoy + 'T12:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
const DIA2 = new Date(Date.parse(hoy + 'T12:00:00Z') + 4 * 86400000).toISOString().slice(0, 10);
const iso = (hhmm, dia = DIA) => instanteDe(ZONA, dia, hhmm).toISOString();
const CLAVE = 'c1c1c1c1';
const ID = 'c1c1c1c1-0000-4000-8000-00000000000a';
const suyas = () => A.citasDelContacto('u1', null, 'L1');
const info = () => A.reservasParaAgente('u1', null);

// ── 1. Qué ve el agente ─────────────────────────────────────────────────────
console.log('\nLas citas que ve el agente\n');
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }),
                cita({ id: 'otroo000-0000-4000-8000-000000000001', due: iso('11:00'), lead: 'OTRO' }),
                cita({ id: 'pasad000-0000-4000-8000-000000000001', due: new Date(Date.now() - 86400000).toISOString() }),
                cita({ id: 'cance000-0000-4000-8000-000000000001', due: iso('12:00'), cancelada: new Date().toISOString() }),
                cita({ id: 'trata000-0000-4000-8000-000000000001', due: iso('15:00'), servicio: TRATAMIENTO }));
  const s = await suyas();
  const claves = s.citas.map(c => c.clave);
  ok(claves.includes(CLAVE), 've su cita');
  ok(!claves.includes('otroo000'), 'NO ve la de otro contacto');
  ok(!claves.includes('pasad000') && !claves.includes('cance000'), 'ni las pasadas ni las canceladas');
  ok(s.citas.find(c => c.clave === CLAVE).movible === true && s.citas.find(c => c.clave === 'trata000').movible === false,
     'la asesoría se puede mover; el tratamiento (sin marcar) no');
  const txt = A.bloqueCitas(s);
  ok(txt.includes('[' + CLAVE + '] Asesoría') && txt.includes('con Ana') && txt.includes('[CANCELAR_CITA: {"cita": "' + CLAVE + '"}]'),
     'el prompt nombra la cita por su clave y enseña el bloque con esa clave');
  ok(!txt.includes('`'), 'sin un solo backtick');
  ok((await A.citasDelContacto('u1', null, null)) === null, 'sin contacto en la conversación, no hay citas que tocar');
  base();
  ok((await suyas()) === null && A.bloqueCitas(null) === '', 'sin citas, el prompt ni lo menciona');
}

// ── 2. Los bloques ──────────────────────────────────────────────────────────
console.log('\nLos bloques\n');
{
  const c = A.extraerCambio('Listo.\n[CANCELAR_CITA: {"cita": "C1C1C1C1"}]');
  ok(c && c.tipo === 'cancelar' && c.cita === 'c1c1c1c1', 'se lee el de cancelar');
  const m = A.extraerCambio('[CAMBIAR_CITA: {"cita": "c1c1c1c1", "dia": "2026-10-02", "hora": "15:00", "con": "Luis"}]');
  ok(m && m.tipo === 'cambiar' && m.dia === '2026-10-02' && m.hora === '15:00' && m.con === 'Luis', 'y el de cambiar');
  ok(A.extraerCambio('[CAMBIAR_CITA: {roto}]') === null && A.extraerCambio('hola') === null, 'uno roto o ninguno: nada');
  ok(cleanForUser('Hecho [CANCELAR_CITA: {"cita": "x"}] gracias') === 'Hecho  gracias', 'el canal no ve el de cancelar');
  ok(cleanForUser('Hecho [CAMBIAR_CITA: {"cita": "x", "dia"') === 'Hecho', 'ni el de cambiar, aunque venga cortado');
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = js.indexOf('function inboxLimpiar(txt) {');
  let prof = 0, j = js.indexOf('{', i);
  for (; j < js.length; j++) { if (js[j] === '{') prof++; else if (js[j] === '}' && --prof === 0) break; }
  const inboxLimpiar = new Function(js.slice(i, j + 1) + '; return inboxLimpiar;')();
  ok(inboxLimpiar('Hecho [CAMBIAR_CITA: {"cita": "x"}] gracias') === 'Hecho  gracias' && inboxLimpiar('Hecho [CANCELAR_CITA: {"ci') === 'Hecho',
     'el inbox tampoco los enseña');
  ok(/\[CAMBIAR_CITA:/.test(A.bloquesOcultos('x [CAMBIAR_CITA: {"cita": "a"}]')) && /\[CANCELAR_CITA:/.test(A.bloquesOcultos('x [CANCELAR_CITA: {"cita": "a"}]')),
     'al cambiar el texto del agente se conservan en el historial');
}

// ── 3. Cancelar ─────────────────────────────────────────────────────────────
console.log('\nCancelar\n');
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00'), gcal: 'ev1' }));
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cancelar', cita: CLAVE } });
  ok(r.ok && /^Cita cancelada: Asesoría/.test(r.texto), 'se cancela y se dice', r.texto);
  ok(!!db.citas[0].cancelled_at && db.citas[0].booking_status === 'cancelada', 'la fila queda cancelada');
  ok(db.googleBorrados.some(u => u.includes('/ev1')), 'y su evento de Google se borra');
}
{
  // Cancelar se puede aunque el servicio no esté marcado: la persona ya tiene
  // el enlace para hacerlo sola.
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00'), servicio: TRATAMIENTO }));
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cancelar', cita: CLAVE } });
  ok(r.ok && !!db.citas[0].cancelled_at, 'un servicio sin marcar también se cancela');
}
{
  base();
  db.citas.push(cita({ id: 'otroo000-0000-4000-8000-000000000001', due: iso('11:00'), lead: 'OTRO' }));
  const r = await A.ejecutarCambio({ suyas: await A.citasDelContacto('u1', null, 'OTRO').then(() => ({ citas: [], zona: ZONA })),
    info: await info(), pedido: { tipo: 'cancelar', cita: 'otroo000' } });
  ok(!r.ok && !db.citas[0].cancelled_at, 'una clave que no está entre SUS citas no cancela nada, aunque exista');
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }));
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cancelar', cita: CLAVE }, simular: true });
  ok(r.ok && r.simulada && !db.citas[0].cancelled_at, 'el ensayo no cancela nada');
}

// ── 4. Cambiar ──────────────────────────────────────────────────────────────
console.log('\nCambiar de hora\n');
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00'), gcal: 'ev1' }));
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cambiar', cita: CLAVE, dia: DIA2, hora: '15:00' } });
  const c = db.citas[0];
  ok(r.ok && c.due_at === iso('15:00', DIA2) && !c.cancelled_at, 'la MISMA cita pasa a la hora nueva (hora de Bogotá)', JSON.stringify({ r: r.texto, due: c.due_at }));
  ok(db.citas.length === 1, 'sin crear otra');
  ok(r.texto.includes('https://app.acuarius.app/cita/tok' + ID), 'el enlace de cancelar que ya tenía sigue siendo el mismo');
  ok(Array.isArray(c.recordatorios_enviados) && c.recordatorios_enviados.length === 0, 'los recordatorios vuelven a empezar para la hora nueva');
  await r.cerrar;
  ok(db.googleBorrados.some(u => u.includes('/ev1')), 'el evento viejo de Google se borra');
}
{
  // Media hora más tarde solapa con donde estaba: no puede taparse a sí misma.
  base();
  db.settings[0].paso_min = 30;
  db.citas.push(cita({ id: ID, due: iso('10:00'), recurso: 'ana' }));
  db.recursos = db.recursos.filter(r => r.id === 'ana');
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cambiar', cita: CLAVE, dia: DIA, hora: '10:30' } });
  ok(r.ok && db.citas[0].due_at === iso('10:30'), 'moverla media hora dentro de su propio hueco se puede', r.texto);
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }),
                cita({ id: 'ajena000-0000-4000-8000-000000000001', due: iso('15:00', DIA2), recurso: 'ana', lead: 'OTRO' }),
                cita({ id: 'ajena000-0000-4000-8000-000000000002', due: iso('15:00', DIA2), recurso: 'luis', lead: 'OTRO' }));
  const s = await suyas(), inf = await info();
  const r = await A.ejecutarCambio({ suyas: s, info: inf, pedido: { tipo: 'cambiar', cita: CLAVE, dia: DIA2, hora: '15:00' } });
  ok(!r.ok && db.citas[0].due_at === iso('10:00'), 'si la hora nueva está ocupada, la cita NO se toca');
  ok(/sigue en pie/.test(r.texto) && /¿Cuál te sirve\?/.test(r.texto), 'y se le dice que la suya sigue en pie, con otras horas', r.texto);
}
{
  // Una cita ajena de 14:30 a 15:30 tapa las 15:00 sin empezar a esa hora: el
  // índice único no la ve, solo la comprobación de antes de mover.
  base();
  db.settings[0].paso_min = 30;
  db.citas.push(cita({ id: ID, due: iso('10:00') }),
                cita({ id: 'ajena000-0000-4000-8000-000000000003', due: iso('14:30', DIA2), recurso: 'ana', lead: 'OTRO' }),
                cita({ id: 'ajena000-0000-4000-8000-000000000004', due: iso('14:30', DIA2), recurso: 'luis', lead: 'OTRO' }));
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cambiar', cita: CLAVE, dia: DIA2, hora: '15:00' } });
  ok(!r.ok && db.citas[0].due_at === iso('10:00'), 'una cita en curso que empezó antes también tapa la hora nueva');
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00'), servicio: TRATAMIENTO }));
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cambiar', cita: CLAVE, dia: DIA2, hora: '15:00' } });
  ok(!r.ok && r.escalar && db.citas[0].due_at === iso('10:00'), 'un servicio sin marcar no se mueve: pasa a un asesor');
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00'), recurso: 'ana' }));
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cambiar', cita: CLAVE, dia: DIA, hora: '10:00', con: 'luis' } });
  ok(r.ok && db.citas[0].resource_id === 'luis' && db.citas[0].due_at === iso('10:00'), 'misma hora con otra persona: cambia quién atiende', r.texto);
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }));
  const r = await A.ejecutarCambio({ suyas: await suyas(), info: await info(), pedido: { tipo: 'cambiar', cita: CLAVE, dia: DIA2, hora: '15:00' }, simular: true });
  ok(r.ok && r.simulada && db.citas[0].due_at === iso('10:00'), 'el ensayo no mueve nada');
}

// ── 5. El motor entero ──────────────────────────────────────────────────────
console.log('\nLa conversación de verdad (processIncoming)\n');
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
    if (u.includes('/chat_messages') && m === 'GET') return resp([{ role: 'user', content: 'sí' }]);
    return viejo(url, init);
  };
  return { guardados, restaurar: () => { globalThis.fetch = viejo; } };
}
async function turno(respuesta) {
  const enviados = [];
  let system = '';
  claude = (s) => { system = s; return respuesta; };
  const c = conCanal();
  try {
    const r = await processIncoming({ channel: 'whatsapp', externalId: 'x', contactId: '573001112233', contactName: 'Laura',
      text: 'sí', providerMessageId: 'p' + Math.random(), send: async (_c, _to, t) => { enviados.push(t); } });
    return { r, enviados, guardados: c.guardados, system };
  } finally { c.restaurar(); }
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }));
  const t = await turno('Listo, te la cancelo.\n[CANCELAR_CITA: {"cita": "' + CLAVE + '"}]');
  ok(t.system.includes('CITAS QUE YA TIENE ESTA PERSONA') && t.system.includes('[' + CLAVE + ']'), 'el prompt real lleva sus citas');
  ok(!!db.citas[0].cancelled_at, 'la cita se cancela');
  ok(t.enviados.length === 2 && /^Cita cancelada/.test(t.enviados[1]) && !t.enviados.some(x => x.includes('[CANCELAR')),
     'salen el mensaje del agente y la confirmación, sin el bloque', JSON.stringify(t.enviados));
  ok(t.guardados.some(g => /^Cita cancelada/.test(g.content)), 'y la confirmación queda en el historial');
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }));
  const t = await turno('¿Te la cancelo entonces, la del martes a las 10?\n[CANCELAR_CITA: {"cita": "' + CLAVE + '"}]');
  ok(!db.citas[0].cancelled_at && t.enviados.length === 1, 'si el agente todavía PREGUNTA, no se cancela nada');
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }),
                cita({ id: 'ajena000-0000-4000-8000-000000000001', due: iso('15:00', DIA2), recurso: 'ana', lead: 'OTRO' }),
                cita({ id: 'ajena000-0000-4000-8000-000000000002', due: iso('15:00', DIA2), recurso: 'luis', lead: 'OTRO' }));
  const t = await turno('Perfecto, te la paso al día siguiente a las 3.\n[CAMBIAR_CITA: {"cita": "' + CLAVE + '", "dia": "' + DIA2 + '", "hora": "15:00"}]');
  ok(db.citas[0].due_at === iso('10:00'), 'con la hora nueva ocupada, la cita sigue donde estaba');
  ok(t.enviados.length === 1 && !t.enviados[0].includes('te la paso') && /sigue en pie/.test(t.enviados[0]),
     'y el «te la paso» del agente NO sale', JSON.stringify(t.enviados));
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }));
  const t = await turno('Listo, te la cancelo y te agendo otra.\n[CANCELAR_CITA: {"cita": "' + CLAVE + '"}]\n[RESERVA: {"servicio": "3f2a9c1d", "dia": "' + DIA2 + '", "hora": "11:00", "nombre": "Laura"}]');
  ok(!!db.citas[0].cancelled_at && !db.llamadas.some(l => l.m === 'POST' && l.u.includes('/activities')),
     'una sola acción por mensaje: si mezcla cancelar y reservar, se cancela y no se crea nada');
}

// ── 6. La promesa sin bloque ────────────────────────────────────────────────
// Pasó con Claude de verdad: «te estoy agendando, en un momento te llega la
// confirmación» y ningún bloque. La persona esperaba algo que no iba a llegar.
console.log('\nCuando el agente promete la cita y no escribe el bloque\n');
for (const [t, esperado] of [
  ['Listo, te estoy agendando para mañana a las 9. En un momento te llega la confirmación.', true],
  ['Perfecto, voy a cancelar tu cita.', true],
  ['Ya quedó agendada, Laura.', true],
  ['Claro, te voy a pasar con un asesor.', false],
  ['¿Qué día te viene mejor?', false],
]) ok(A.prometeAccion(t) === esperado, (esperado ? 'promete: ' : 'no promete: ') + t);
async function turnos(respuestas) {
  let n = 0;
  const enviados = [];
  claude = () => respuestas[Math.min(n++, respuestas.length - 1)];
  const c = conCanal();
  try {
    const r = await processIncoming({ channel: 'whatsapp', externalId: 'x', contactId: '573001112233', contactName: 'Laura',
      text: 'sí', providerMessageId: 'p' + Math.random(), send: async (_c, _to, t) => { enviados.push(t); } });
    return { r, enviados, llamadas: n };
  } finally { c.restaurar(); }
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }));
  const t = await turnos(['Listo, te la estoy cancelando. En un momento te llega la confirmación.',
    'Listo, te la estoy cancelando.\n[CANCELAR_CITA: {"cita": "' + CLAVE + '"}]']);
  ok(t.llamadas === 2 && !!db.citas[0].cancelled_at, 'se le pide que escriba el bloque, y entonces SÍ se cancela');
  ok(t.enviados.length === 2 && /^Cita cancelada/.test(t.enviados[1]), 'y la confirmación llega');
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }));
  const t = await turnos(['Listo, te la estoy cancelando.', 'Listo, ya la cancelé.']);
  ok(!db.citas[0].cancelled_at && t.r.escalated === true, 'si tampoco lo escribe, no se inventa nada y la conversación pasa a una persona');
}
{
  base();
  db.citas.push(cita({ id: ID, due: iso('10:00') }));
  const t = await turnos(['Claro, te voy a pasar con un asesor.\n[ESCALAR]']);
  ok(t.llamadas === 1, 'pasar con un asesor no es prometer una cita: una sola llamada');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
