// Google Calendar → reservas, por persona: node pruebas/reservas-google.mjs
//
// El agujero que cierra: una cita que Ana apuntó a mano en su Google no
// bloqueaba nada, y la página se la ofrecía a un cliente. Es el único fallo que
// un negocio de citas no perdona.
//
// Todo se EJECUTA: el lector de Google con una red de mentira, `ocupadoDe` y
// `ocupadoGoogle` sacados del endpoint real, el callback del OAuth con sus
// páginas, y lo que pinta la pantalla. Leer el código con una expresión
// regular no habría encontrado ninguno de los fallos que importan.

import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.LINK_SECRET = 'secreto-de-prueba';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
delete process.env.TOKENS_KEY;

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// ── Una red de mentira: Supabase y Google ───────────────────────────────────
let red = { calendarios: [], filas: {}, eventos: {}, googleFalla: {}, renovar: null, llamadas: [] };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const metodo = init.method || 'GET';
  red.llamadas.push({ u, metodo, body: init.body });
  if (u.includes('/booking_resource_calendars') && metodo === 'GET') {
    if (u.includes('select=resource_id')) return resp(red.calendarios.map(id => ({ resource_id: id })));
    const id = decodeURIComponent((u.match(/resource_id=eq\.([^&]+)/) || [])[1] || '');
    return resp(red.filas[id] ? [red.filas[id]] : []);
  }
  if (u.includes('/booking_resource_calendars')) return resp([], 204);
  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    return resp(red.renovar || { access_token: 'nuevo', expires_in: 3600 });
  }
  if (u.includes('googleapis.com/calendar/v3/calendars/primary/events')) {
    const tok = (init.headers?.Authorization || '').replace('Bearer ', '');
    if (red.googleFalla[tok]) return resp({ error: { message: 'Invalid Credentials' } }, red.googleFalla[tok]);
    return resp({ timeZone: 'America/Bogota', items: red.eventos[tok] || [] });
  }
  throw new Error('fetch inesperado: ' + metodo + ' ' + u);
};

const { tramosOcupados, ocupadoDeCalendarios, eventosGoogle } = await import('../api/_gcal.js');
const { franjasLibres } = await import('../api/_disponibilidad.js');
const T = (s) => new Date(s).getTime();

// ── 1. Qué ocupa y qué no ───────────────────────────────────────────────────
console.log('\nQué cuenta como ocupado en Google\n');
{
  const ev = (o) => ({ id: o.id || Math.random().toString(36), status: 'confirmed',
    start: { dateTime: '2026-10-06T10:00:00-05:00' }, end: { dateTime: '2026-10-06T11:00:00-05:00' }, ...o });
  const t = tramosOcupados([ev({})], 'America/Bogota');
  ok(t.length === 1 && t[0].ini === T('2026-10-06T15:00:00Z') && t[0].fin === T('2026-10-06T16:00:00Z'),
     'una cita normal ocupa sus horas exactas', JSON.stringify(t));
  ok(tramosOcupados([ev({ transparency: 'transparent' })]).length === 0, 'lo marcado como «Disponible» no ocupa');
  ok(tramosOcupados([ev({ status: 'cancelled' })]).length === 0, 'lo cancelado no ocupa');
  ok(tramosOcupados([ev({ eventType: 'workingLocation' })]).length === 0, '«trabajo desde casa» no ocupa');
  ok(tramosOcupados([ev({ attendees: [{ self: true, responseStatus: 'declined' }] })]).length === 0,
     'una invitación rechazada no ocupa');
  ok(tramosOcupados([ev({ attendees: [{ self: true, responseStatus: 'accepted' }, { responseStatus: 'declined' }] })]).length === 1,
     'que OTRO la rechace no la libera');
  ok(tramosOcupados([ev({ extendedProperties: { private: { acuarius_cita: 'x' } } })]).length === 0,
     'una cita que escribimos nosotros no se cuenta dos veces');
  ok(tramosOcupados([ev({ id: 'viejo' })], 'America/Bogota', new Set(['viejo'])).length === 0,
     'ni una de antes de la marca, reconocida por su id');
  ok(tramosOcupados([ev({ eventType: 'outOfOffice' })]).length === 1, '«fuera de la oficina» SÍ ocupa');

  const dia = tramosOcupados([{ id: 'v', start: { date: '2026-10-06' }, end: { date: '2026-10-08' } }], 'America/Bogota');
  ok(dia.length === 1 && dia[0].ini === T('2026-10-06T05:00:00Z') && dia[0].fin === T('2026-10-08T05:00:00Z'),
     'un evento de todo el día ocupa de medianoche a medianoche en la zona del calendario, no en UTC',
     JSON.stringify(dia.map(x => [new Date(x.ini).toISOString(), new Date(x.fin).toISOString()])));
  const santiago = tramosOcupados([{ id: 'v', start: { date: '2026-09-06' }, end: { date: '2026-09-07' } }], 'America/Santiago');
  // En Santiago, el 6-sep-2026 la medianoche NO existe (se salta de 23:59 a
  // 01:00). El día de verdad va de 04:00Z a 03:00Z del 7. Lo que se exige es
  // que quede tapado ENTERO: sobrar una hora antes es inofensivo, faltar una
  // hora deja un hueco que no lo es.
  ok(santiago.length === 1 && santiago[0].ini <= T('2026-09-06T04:00:00Z') && santiago[0].fin >= T('2026-09-07T03:00:00Z')
     && santiago[0].fin - santiago[0].ini <= 25 * 3600000,
     'el día del cambio de hora en Santiago (6-sep-2026) queda tapado entero',
     santiago.length ? new Date(santiago[0].ini).toISOString() + ' → ' + new Date(santiago[0].fin).toISOString() : 'nada');
}

// ── 2. El lector, contra una red de mentira ─────────────────────────────────
console.log('\nEl lector de calendarios\n');
const futuro = new Date(Date.now() + 3600000).toISOString();
const DESDE = '2026-10-06T05:00:00.000Z', HASTA = '2026-10-07T05:00:00.000Z';
{
  red = { calendarios: ['ana'], llamadas: [], googleFalla: {},
    filas: { ana: { access_token: 'tok-ana', refresh_token: 'rt', token_expires_at: futuro, email: 'ana@x.co', error: null } },
    eventos: { 'tok-ana': [{ id: 'e1', start: { dateTime: '2026-10-06T10:00:00-05:00' }, end: { dateTime: '2026-10-06T11:00:00-05:00' } }] } };
  const r = await ocupadoDeCalendarios(['ana', 'luis'], DESDE, HASTA, new Set());
  ok(Array.isArray(r.ana) && r.ana.length === 1, 'lo de Ana llega como ocupado de Ana', JSON.stringify(r));
  ok(!('luis' in r), 'y Luis, sin calendario, no recibe nada: lo de Ana no bloquea a Luis');
  const q = red.llamadas.find(l => l.u.includes('/events?'));
  const p = new URL(q.u).searchParams;
  ok(p.get('timeMin') === DESDE && p.get('timeMax') === HASTA,
     'se le pide a Google por solape (timeMin/timeMax), no por «empieza dentro»');
  ok(p.get('singleEvents') === 'true', 'las citas repetidas llegan una por una (singleEvents)');
}
{
  // Sin calendarios, ni se pregunta a Google ni se gasta la consulta de ignorar.
  red = { calendarios: [], filas: {}, eventos: {}, googleFalla: {}, llamadas: [] };
  let pidioIgnorar = false;
  await ocupadoDeCalendarios(['ana'], DESDE, HASTA, async () => { pidioIgnorar = true; return new Set(); });
  ok(!pidioIgnorar && !red.llamadas.some(l => l.u.includes('googleapis')),
     'una cuenta sin calendarios no gasta ni una llamada más');
}
{
  // Token caducado: se renueva y se guarda.
  red = { calendarios: ['ana'], llamadas: [], googleFalla: {},
    filas: { ana: { access_token: 'viejo', refresh_token: 'rt', token_expires_at: new Date(Date.now() - 1000).toISOString(), email: 'a' } },
    eventos: { nuevo: [{ id: 'e', start: { dateTime: '2026-10-06T10:00:00Z' }, end: { dateTime: '2026-10-06T11:00:00Z' } }] } };
  const r = await ocupadoDeCalendarios(['ana'], DESDE, HASTA, new Set());
  ok(Array.isArray(r.ana) && r.ana.length === 1, 'con el token caducado se renueva y se lee', JSON.stringify(r));
  ok(red.llamadas.some(l => l.metodo === 'PATCH' && l.u.includes('booking_resource_calendars') && String(l.body).includes('access_token')),
     'y el token nuevo se guarda');
}
{
  // Permiso retirado en Google: se dice que falló y queda escrito para la pantalla.
  red = { calendarios: ['ana'], llamadas: [], googleFalla: {},
    filas: { ana: { access_token: 'viejo', refresh_token: 'rt', token_expires_at: '2020-01-01T00:00:00Z', email: 'a' } },
    eventos: {}, renovar: { error: 'invalid_grant' } };
  const r = await ocupadoDeCalendarios(['ana'], DESDE, HASTA, new Set());
  ok(r.ana && r.ana.fallo, 'con el permiso retirado, el resultado dice «fallo», no «libre»', JSON.stringify(r));
  const marca = red.llamadas.find(l => l.metodo === 'PATCH' && String(l.body).includes('"error"'));
  ok(marca && JSON.parse(marca.body).error, 'y el error queda escrito en la fila, para que la pantalla lo enseñe');
}
{
  // Un fallo pasajero al renovar: se tapa igual (no se sabe qué hay), pero NO
  // se pinta en rojo — no hay nada que reconectar.
  red = { calendarios: ['ana'], llamadas: [], googleFalla: {},
    filas: { ana: { access_token: 'viejo', refresh_token: 'rt', token_expires_at: '2020-01-01T00:00:00Z', email: 'a' } },
    eventos: {}, renovar: { error: 'server_error' } };
  const r = await ocupadoDeCalendarios(['ana'], DESDE, HASTA, new Set());
  ok(r.ana && r.ana.fallo, 'un fallo pasajero al renovar también es «fallo»');
  ok(!red.llamadas.some(l => l.metodo === 'PATCH' && String(l.body).includes('"error"')),
     'pero no se anota como permiso perdido');
}
{
  red = { calendarios: ['ana'], llamadas: [], googleFalla: { 'tok-ana': 401 },
    filas: { ana: { access_token: 'tok-ana', refresh_token: 'rt', token_expires_at: futuro, email: 'a' } }, eventos: {} };
  const r = await ocupadoDeCalendarios(['ana'], DESDE, HASTA, new Set());
  ok(r.ana && r.ana.fallo, 'Google contesta 401 al leer: fallo');
  ok(red.llamadas.some(l => l.metodo === 'PATCH' && String(l.body).includes('"error"')), 'y también se anota');
}
{
  red = { calendarios: ['ana'], llamadas: [], googleFalla: {},
    filas: { ana: { access_token: 'tok-ana', refresh_token: 'rt', token_expires_at: futuro, email: 'a', error: 'viejo error' } },
    eventos: { 'tok-ana': [] } };
  await ocupadoDeCalendarios(['ana'], DESDE, HASTA, new Set());
  const limpia = red.llamadas.find(l => l.metodo === 'PATCH' && String(l.body).includes('"error":null'));
  ok(!!limpia, 'cuando vuelve a leerse bien, el aviso rojo se quita solo');
}

// ── 3. `ocupadoDe` y `ocupadoGoogle`, sacados del endpoint real ─────────────
console.log('\nLa página pública suma lo de Google y, si no puede leerlo, tapa\n');
const fuente = readFileSync(new URL('../api/_reservas.js', import.meta.url), 'utf8');
function funcion(firma) {
  const i = fuente.indexOf(firma);
  if (i < 0) throw new Error('No encontré «' + firma + '» en _reservas.js: revisa esta prueba');
  let prof = 0, j = i + firma.length - 1;
  for (; j < fuente.length; j++) {
    if (fuente[j] === '{') prof++;
    else if (fuente[j] === '}' && --prof === 0) break;
  }
  return fuente.slice(i, j + 1);
}
const srcOcupadoDe = funcion('async function ocupadoDe(neg, ids, desdeISO, hastaISO, ignorar = null) {');
const srcOcupadoGoogle = funcion('async function ocupadoGoogle(neg, ids, desdeISO, hastaISO) {');

async function correOcupadoGoogle(lecturas, ids) {
  const errores = [];
  const entorno = {
    sb: async () => [],
    registrarError: async (e) => { errores.push(e); },
    ocupadoDeCalendarios: async (i, d, h, ign) => {
      if (lecturas instanceof Error) throw lecturas;
      ok(typeof ign === 'function', 'la lista de citas propias se pide solo si hace falta (llega como función)');
      return lecturas;
    },
  };
  const n = Object.keys(entorno);
  const f = new Function(...n, srcOcupadoGoogle + '\n; return ocupadoGoogle;')(...n.map(k => entorno[k]));
  return { res: await f({ user_id: 'u1' }, ids, DESDE, HASTA), errores };
}
{
  const { res } = await correOcupadoGoogle({ ana: [{ ini: T('2026-10-06T15:00:00Z'), fin: T('2026-10-06T16:00:00Z') }] }, ['ana', 'luis']);
  ok(res.ana.length === 1 && !res.luis, 'lo leído pasa tal cual, y solo a quien es');
}
{
  const { res, errores } = await correOcupadoGoogle({ ana: { fallo: 'Invalid Credentials' } }, ['ana', 'luis']);
  ok(res.ana.length === 1 && res.ana[0].ini === T(DESDE) && res.ana[0].fin === T(HASTA),
     'si el calendario de Ana no se puede leer, Ana queda OCUPADA todo el rango', JSON.stringify(res.ana));
  ok(!res.luis, 'y Luis sigue atendiendo');
  ok(errores.length === 1, 'y queda en el registro de errores');
}
{
  const { res } = await correOcupadoGoogle(new Error('base caída'), ['ana', 'luis']);
  ok(res.ana?.[0]?.ini === T(DESDE) && res.luis?.[0]?.ini === T(DESDE),
     'si ni se sabe quién tiene calendario, se tapa a todos');
}
{
  const entorno = {
    sb: async (ruta) => ruta.startsWith('/booking_blocks') ? [] :
      [{ due_at: '2026-10-06T20:00:00Z', end_at: '2026-10-06T21:00:00Z', resource_id: 'ana' }],
    filtroCliente: (c) => (c ? `client_id=eq.${c}` : 'client_id=is.null'),
    ocupadoGoogle: async () => ({ ana: [{ ini: T('2026-10-06T15:00:00Z'), fin: T('2026-10-06T16:00:00Z') }] }),
  };
  const n = Object.keys(entorno);
  const f = new Function(...n, srcOcupadoDe + '\n; return ocupadoDe;')(...n.map(k => entorno[k]));
  const res = await f({ user_id: 'u1', client_id: null }, ['ana', 'luis'], DESDE, HASTA);
  ok(res.ana.length === 2, 'Ana tiene su reserva Y lo de su Google', JSON.stringify(res.ana));
  ok(res.luis.length === 0, 'Luis no hereda nada de Ana');

  // Y el efecto que importa: esa hora no se ofrece.
  const reglas = (ocupado) => ({
    dia: '2026-10-06', zona: 'America/Bogota', horario: { 2: [['09:00', '13:00']] }, excepciones: {},
    ocupado, minutos: 30, margen: 0, paso: 30, ahora: new Date('2026-10-01T00:00:00Z'), antelacionMinHoras: 0,
  });
  const horasAna = franjasLibres(reglas(res.ana)).map(x => x.inicio);
  const horasLuis = franjasLibres(reglas(res.luis)).map(x => x.inicio);
  ok(!horasAna.includes('2026-10-06T15:00:00.000Z') && !horasAna.includes('2026-10-06T15:30:00.000Z'),
     'a las 10 y 10:30 de Bogotá Ana NO se ofrece (lo tiene en Google)', horasAna.join(' '));
  ok(horasLuis.includes('2026-10-06T15:00:00.000Z'), 'Luis a las 10 sí');
}

// ── 4. El enlace firmado ────────────────────────────────────────────────────
console.log('\nEl enlace para conectar\n');
{
  const { crearEnlaceCalendario, abrirEnlaceCalendario } = await import('../api/_enlace-calendario.js');
  const t = await crearEnlaceCalendario('u1', 'ana');
  const a = await abrirEnlaceCalendario(t);
  ok(a && a.userId === 'u1' && a.resourceId === 'ana', 'ida y vuelta');
  const falso = t.replace(encodeURIComponent('ana'), encodeURIComponent('otro'));
  ok(falso !== t && (await abrirEnlaceCalendario(falso)) === null, 'cambiar el recurso en la URL invalida la firma');
  const viejo = await crearEnlaceCalendario('u1', 'ana', -1);
  ok((await abrirEnlaceCalendario(viejo))?.caducado === true, 'uno caducado se dice caducado');
  const { crearToken } = await import('../api/_enlace-probar.js');
  const deProbar = await crearToken('u1', 'agente');
  ok((await abrirEnlaceCalendario(deProbar)) === null, 'un enlace de «probar el agente» no sirve aquí');
}

// ── 5. El callback del OAuth ────────────────────────────────────────────────
console.log('\nConectar desde el enlace\n');
{
  const { crearEnlaceCalendario } = await import('../api/_enlace-calendario.js');
  const { default: callback } = await import('../api/oauth/gcal-callback.js');
  const t = await crearEnlaceCalendario('u1', 'ana');

  async function correCallback({ recurso = true, token = {}, googleLee = true, query = {} } = {}) {
    const guardados = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('/booking_resources?')) {
        return resp(recurso && u.includes('user_id=eq.u1') ? [{ id: 'ana', nombre: 'Ana' }] : []);
      }
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return resp({ access_token: 'at', refresh_token: 'rt', expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email', ...token });
      }
      if (u.includes('/calendar/v3/')) return googleLee ? resp({ items: [] }) : resp({ error: { message: 'no' } }, 403);
      if (u.includes('/oauth2/v2/userinfo')) return resp({ email: 'ana@x.co' });
      if (u.includes('/booking_resource_calendars')) { guardados.push(JSON.parse(init.body)); return resp(null, 201); }
      throw new Error('fetch inesperado ' + u);
    };
    let out = { status: 200, html: '', redirect: null };
    const res = {
      setHeader() {}, status(s) { out.status = s; return this; },
      send(b) { out.html = b; return this; }, json(b) { out.html = JSON.stringify(b); return this; },
      redirect(u) { out.redirect = u; return this; },
    };
    await callback({ query: { code: 'c', state: JSON.stringify({ nonce: 'gcal_recurso', r: t }), ...query } }, res);
    return { ...out, guardados };
  }

  const bien = await correCallback();
  ok(bien.status === 200 && bien.html.includes('Calendario conectado'), 'el camino bueno termina en «Calendario conectado»', bien.html.slice(0, 200));
  ok(!bien.redirect, 'y no manda a la app (quien conecta puede no tener cuenta)');
  ok(bien.guardados.length === 1 && bien.guardados[0].resource_id === 'ana' && bien.guardados[0].user_id === 'u1',
     'se guarda colgado del recurso y la cuenta que dice la FIRMA', JSON.stringify(bien.guardados));
  ok(bien.guardados[0]?.refresh_token === 'rt' && bien.guardados[0]?.error === null, 'con su refresh_token y sin error');

  const sinScope = await correCallback({ token: { scope: 'https://www.googleapis.com/auth/userinfo.email' } });
  ok(sinScope.status === 400 && sinScope.html.includes('Falta el permiso del calendario') && !sinScope.guardados.length,
     'si desmarcó el permiso del calendario, se le dice y no se guarda nada');

  const noLee = await correCallback({ googleLee: false });
  ok(noLee.status === 400 && !noLee.guardados.length, 'si no se puede leer el calendario, no se dice «listo»');

  const ajeno = await correCallback({ recurso: false });
  ok(ajeno.status === 404 && !ajeno.guardados.length, 'si el recurso ya no es de esa cuenta, no se guarda');

  const sinPermiso = await correCallback({ query: { error: 'access_denied', code: undefined } });
  ok(sinPermiso.status === 400 && !sinPermiso.redirect && !sinPermiso.guardados.length,
     'si dijo que no en Google, se le explica aquí, sin mandarlo a la app');

  const trucado = await correCallback({ query: { state: JSON.stringify({ nonce: 'gcal_recurso', r: t.replace('ana', 'otro') }) } });
  ok(trucado.status === 400 && !trucado.guardados.length, 'un state manipulado entre Google y nosotros no guarda nada');
}

// ── 6. Lo que pinta la pantalla ─────────────────────────────────────────────
console.log('\nLo que ve el negocio\n');
{
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const trozo = js.slice(js.indexOf('// ══ RESERVAS ═'), js.indexOf('// ══ FICHA DEL LEAD A PÁGINA COMPLETA'));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = new Function('esc', 'icn', 'emptyAgua', 'crmAmbitoCliente', 'fetchAuth', 'showToast', 'document', 'crmSetView', 'NAV_TABS',
    trozo + '\n; return { rsvChipCalendario, rsvAvisoCalendarios, rsvPintarRecursos, setDatos: (d) => { rsvDatos = d; } };');
  const m = f(esc, (n) => '<i data-icn="' + n + '"></i>', () => '', () => null, null, null, {}, () => {}, undefined);

  const datos = { recursos: [
    { id: 'ana', nombre: 'Ana', activo: true, calendario: { email: 'ana@x.co', error: null } },
    { id: 'luis', nombre: 'Luis', activo: true, calendario: { email: 'l@x.co', error: 'Google retiró el permiso.' } },
    { id: 'pedro', nombre: 'Pedro', activo: true, calendario: null },
  ] };
  m.setDatos(datos);
  const lista = m.rsvPintarRecursos(true);
  ok(lista.includes('ana@x.co'), 'la fila de Ana enseña su Google');
  ok(lista.includes('Google no responde'), 'la de Luis dice en rojo que su Google no responde');
  ok(lista.includes('Sin Google Calendar'), 'la de Pedro dice que no tiene');
  ok((lista.match(/rsvCalendario\('/g) || []).length === 3, 'cada uno tiene su botón «Calendario»');
  ok(!m.rsvPintarRecursos(false).includes('rsvCalendario('), 'quien no es administrador no ve el botón');

  const aviso = m.rsvAvisoCalendarios(true);
  ok(aviso.includes('Luis') && !aviso.includes('Ana'), 'arriba se avisa de Luis, y solo de Luis');
  ok(aviso.includes('no se ofrecen sus horas'), 'y se dice la consecuencia: sus horas no se ofrecen');
  datos.recursos[1].activo = false;
  ok(m.rsvAvisoCalendarios(true) === '', 'si Luis está inactivo no hay nada que avisar');
}

// ── 7. La trastienda no filtra tokens ───────────────────────────────────────
console.log('\nLos tokens no salen hacia el navegador\n');
{
  const bk = readFileSync(new URL('../api/bookings.js', import.meta.url), 'utf8');
  const sel = (bk.match(/booking_resource_calendars\(([^)]*)\)/) || [])[1] || '';
  ok(sel && !/token/.test(sel), 'la lista de recursos solo pide email y error del calendario', sel);
}

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
