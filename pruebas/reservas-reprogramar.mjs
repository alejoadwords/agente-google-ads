// Cambiar la cita desde /cita/<token>: node pruebas/reservas-reprogramar.mjs
//
// Se EJECUTA el endpoint real (api/booking-public.js) contra una base de
// mentira que imita el índice único y el PATCH condicional. Lo que tiene que
// ser verdad:
//
//  - las horas que se ofrecen para cambiar NO cuentan la propia cita;
//  - se mueve la MISMA cita, primero con la misma persona y, si a esa hora no
//    está libre, con quien lo esté;
//  - si la hora ya no está libre, la cita no se toca;
//  - cancelada, pasada, página apagada o servicio retirado: no se cambia, y se
//    dice por qué;
//  - el negocio se busca por cuenta Y cliente.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
delete process.env.RESEND_API_KEY;

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

const ZONA = 'America/Bogota';
const TODO = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, [['09:00', '17:00']]]));
const SERV = '3f2a9c1d-0000-4000-8000-000000000001';
const TOKEN = 'a'.repeat(32);
let db;
const resp = (d, s = 200) => new Response(d === null ? '' : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

function base() {
  db = {
    settings: [
      { user_id: 'u1', client_id: '', zona_horaria: ZONA, horario: TODO, excepciones: {}, margen_min: 0, paso_min: 60,
        antelacion_min_horas: 0, antelacion_max_dias: 30, activo: true, nombre_negocio: 'Estudio Cuenta' },
      { user_id: 'u1', client_id: 'cli2', zona_horaria: ZONA, horario: TODO, excepciones: {}, margen_min: 0, paso_min: 60,
        antelacion_min_horas: 0, antelacion_max_dias: 30, activo: true, nombre_negocio: 'Otro cliente' },
    ],
    servicios: [{ id: SERV, nombre: 'Corte', minutos: 60, activo: true, orden: 0,
      booking_service_resources: [{ resource_id: 'ana' }, { resource_id: 'luis' }] }],
    recursos: [{ id: 'ana', nombre: 'Ana', horario: null, orden: 0 }, { id: 'luis', nombre: 'Luis', horario: null, orden: 1 }],
    citas: [],
    llamadas: [],
  };
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const m = init.method || 'GET';
  db.llamadas.push({ u, m });
  if (u.includes('googleapis.com') || u.includes('/platform_connections') || u.includes('/rpc/')) return resp([]);
  if (u.includes('/booking_settings')) {
    const cli = u.match(/client_id=eq\.([^&]*)/);
    return resp(db.settings.filter(x => x.user_id === 'u1' && (!cli || x.client_id === cli[1])));
  }
  if (u.includes('/booking_services')) return resp(db.servicios);
  if (u.includes('/booking_resources')) return resp(db.recursos);
  if (u.includes('/booking_blocks') || u.includes('/booking_resource_calendars')) return resp([]);
  if (u.includes('/activities')) {
    const vivas = db.citas.filter(c => !c.cancelled_at);
    if (m === 'PATCH') {
      const id = u.match(/id=eq\.([^&]+)/)[1];
      const c = db.citas.find(x => x.id === id && (!u.includes('cancelled_at=is.null') || !x.cancelled_at));
      if (!c) return resp([]);
      const tras = { ...c, ...JSON.parse(init.body) };
      if (!tras.cancelled_at && vivas.some(x => x.id !== c.id && x.resource_id === tras.resource_id && x.due_at === tras.due_at)) {
        return resp({ code: '23505' }, 409);
      }
      Object.assign(c, JSON.parse(init.body));
      return resp([c]);
    }
    const tok = u.match(/booking_token=eq\.([^&]+)/)?.[1];
    if (tok) return resp(db.citas.filter(c => c.booking_token === tok));
    return resp(vivas);
  }
  return resp([]);
};

const { default: handler } = await import('../api/booking-public.js');
const { instanteDe, diaLocal } = await import('../api/_disponibilidad.js');
const hoy = diaLocal(ZONA, new Date());
const DIA = new Date(Date.parse(hoy + 'T12:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
const DIA2 = new Date(Date.parse(hoy + 'T12:00:00Z') + 4 * 86400000).toISOString().slice(0, 10);
const iso = (hhmm, dia = DIA) => instanteDe(ZONA, dia, hhmm).toISOString();
const cita = (o) => ({ id: o.id || 'c1', user_id: 'u1', client_id: o.cliente ?? null, title: 'Corte · Laura', service_id: SERV,
  resource_id: o.recurso || 'ana', due_at: o.due, end_at: new Date(Date.parse(o.due) + 3600000).toISOString(),
  booking_token: o.token || TOKEN, booking_status: 'confirmada', cancelled_at: o.cancelada || null, gcal_event_id: null,
  recordatorios_enviados: [24] });

const get = async (qs) => { const r = await handler(new Request('https://x/api/booking-public?cita=' + TOKEN + qs), {}); return { s: r.status, d: await r.json() }; };
const post = async (body) => { const r = await handler(new Request('https://x/api/booking-public?cita=' + TOKEN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {}); return { s: r.status, d: await r.json() }; };

// ── Ver ─────────────────────────────────────────────────────────────────────
console.log('\nVer la cita\n');
{
  base();
  db.citas.push(cita({ due: iso('10:00') }));
  const { s, d } = await get('');
  ok(s === 200 && d.cita.se_puede_cambiar === true, 'una cita futura y viva se puede cambiar');
  ok(d.cita.servicio?.nombre === 'Corte' && d.cita.con === 'Ana', 'y dice qué servicio es y con quién');
  ok(d.cita.negocio === 'Estudio Cuenta', 'con el negocio de SU cuenta');
}
{
  // Una agencia con reservas para dos clientes: la cita del cliente 2 enseña
  // el negocio del cliente 2, no el primero que salga de la cuenta.
  base();
  db.citas.push(cita({ due: iso('10:00'), cliente: 'cli2' }));
  const { d } = await get('');
  ok(d.cita.negocio === 'Otro cliente', 'el negocio se busca por cuenta Y cliente', d.cita.negocio);
}
{
  base();
  db.citas.push(cita({ due: iso('10:00') }));
  db.settings[0].activo = false;
  const { d } = await get('');
  ok(d.cita.se_puede_cambiar === false && /no está tomando reservas/.test(d.cita.motivo_no_cambiar || ''),
     'con la página apagada no se cambia, y se dice por qué');
  base();
  db.citas.push(cita({ due: iso('10:00') }));
  db.servicios = [];
  const r2 = await get('');
  ok(r2.d.cita.se_puede_cambiar === false && /ya no se puede reservar/.test(r2.d.cita.motivo_no_cambiar || ''),
     'con el servicio retirado, igual');
  base();
  db.citas.push(cita({ due: iso('10:00'), cancelada: new Date().toISOString() }));
  ok((await get('')).d.cita.se_puede_cambiar === false, 'una cancelada no se cambia');
  base();
  db.citas.push(cita({ due: new Date(Date.now() - 3600000).toISOString() }));
  ok((await get('')).d.cita.se_puede_cambiar === false, 'una pasada tampoco');
}

// ── Las horas para cambiar ──────────────────────────────────────────────────
console.log('\nLas horas que se ofrecen\n');
{
  // Una sola persona: con la cita contándose, su propia hora saldría ocupada.
  base();
  db.recursos = db.recursos.filter(r => r.id === 'ana');
  db.servicios[0].booking_service_resources = [{ resource_id: 'ana' }];
  db.citas.push(cita({ due: iso('10:00') }));
  const { s, d } = await get('&dia=' + DIA);
  const horas = (d.horas || []).map(h => h.inicio);
  ok(s === 200 && horas.includes(iso('10:00')), 'su propia hora aparece libre: la cita no se tapa a sí misma', JSON.stringify(horas.slice(0, 4)));
  ok(horas.includes(iso('09:00')) && horas.includes(iso('11:00')), 'y las de al lado también');
  const dias = await get('&dias=1');
  ok(dias.s === 200 && Array.isArray(dias.d.dias) && dias.d.dias.some(x => x.cupo), 'la tira de días llega');
}
{
  base();
  db.citas.push(cita({ due: iso('10:00'), cancelada: new Date().toISOString() }));
  const { s } = await get('&dia=' + DIA);
  ok(s === 409, 'de una cita cancelada no se piden horas');
}

// ── Cambiar ─────────────────────────────────────────────────────────────────
console.log('\nCambiarla\n');
{
  base();
  db.citas.push(cita({ due: iso('10:00'), recurso: 'luis' }));
  const { s, d } = await post({ accion: 'cambiar', inicio: iso('15:00', DIA2) });
  const c = db.citas[0];
  ok(s === 200 && c.due_at === iso('15:00', DIA2) && c.booking_token === TOKEN, 'la MISMA cita pasa a la hora nueva, con su mismo enlace', JSON.stringify(d).slice(0, 160));
  ok(c.resource_id === 'luis' && d.cambio_persona === false, 'y sigue con la misma persona (Luis, aunque Ana va primera)');
  ok(Array.isArray(c.recordatorios_enviados) && !c.recordatorios_enviados.length, 'los recordatorios vuelven a empezar');
}
{
  base();
  db.citas.push(cita({ due: iso('10:00'), recurso: 'ana' }),
                cita({ id: 'otra', token: 'b'.repeat(32), due: iso('15:00', DIA2), recurso: 'ana' }));
  const { s, d } = await post({ accion: 'cambiar', inicio: iso('15:00', DIA2) });
  ok(s === 200 && db.citas[0].resource_id === 'luis' && d.cambio_persona === true,
     'si su persona no está libre a esa hora, con quien lo esté, y se avisa', JSON.stringify(d).slice(0, 160));
}
{
  base();
  db.citas.push(cita({ due: iso('10:00') }),
                cita({ id: 'o1', token: 'b'.repeat(32), due: iso('15:00', DIA2), recurso: 'ana' }),
                cita({ id: 'o2', token: 'c'.repeat(32), due: iso('15:00', DIA2), recurso: 'luis' }));
  const { s, d } = await post({ accion: 'cambiar', inicio: iso('15:00', DIA2) });
  ok(s === 409 && d.ocupada === true && db.citas[0].due_at === iso('10:00'), 'si no hay nadie libre, 409 y la cita NO se toca');
}
{
  base();
  db.citas.push(cita({ due: iso('10:00') }),
                cita({ id: 'o1', token: 'b'.repeat(32), due: iso('14:30', DIA2), recurso: 'ana' }),
                cita({ id: 'o2', token: 'c'.repeat(32), due: iso('14:30', DIA2), recurso: 'luis' }));
  const { s } = await post({ accion: 'cambiar', inicio: iso('15:00', DIA2) });
  ok(s === 409 && db.citas[0].due_at === iso('10:00'), 'una cita en curso que empezó antes también tapa la hora');
}
{
  base();
  db.citas.push(cita({ due: iso('10:00'), cancelada: new Date().toISOString() }));
  const { s } = await post({ accion: 'cambiar', inicio: iso('15:00', DIA2) });
  ok(s === 409 && db.citas[0].due_at === iso('10:00'), 'una cancelada no se cambia');
  base();
  db.citas.push(cita({ due: iso('10:00') }));
  db.settings[0].activo = false;
  ok((await post({ accion: 'cambiar', inicio: iso('15:00', DIA2) })).s === 409 && db.citas[0].due_at === iso('10:00'),
     'con la página apagada tampoco, aunque se llame al endpoint a mano');
  base();
  db.citas.push(cita({ due: iso('10:00') }));
  const lejos = new Date(Date.now() + 90 * 86400000).toISOString();
  ok((await post({ accion: 'cambiar', inicio: lejos })).s === 400 && db.citas[0].due_at === iso('10:00'), 'ni más allá de la antelación máxima');
  ok((await post({ accion: 'cambiar', inicio: 'mañana' })).s === 400, 'una hora que no es hora: 400');
}

// ── Cancelar sigue igual ────────────────────────────────────────────────────
console.log('\nCancelar sigue funcionando\n');
{
  base();
  db.citas.push(cita({ due: iso('10:00') }));
  const { s, d } = await post({ accion: 'cancelar' });
  ok(s === 200 && d.cita.estado === 'cancelada' && !!db.citas[0].cancelled_at, 'se cancela');
  ok((await post({ accion: 'otra' })).s === 400, 'una acción desconocida: 400');
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
