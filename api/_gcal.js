// api/_gcal.js — el puente con Google Calendar.
//
// Vivía dentro de api/agenda.js. Salió aquí cuando las reservas empezaron a
// crear citas: dos copias de la renovación del token acaban diciendo cosas
// distintas, y la que se quede vieja falla el día que caduca un permiso —
// justo el día en que nadie está mirando.
//
// Solo se importa desde funciones EDGE (ver CLAUDE.md).

import { abrirConexion, cifrar } from './_cifrado.js';
import { instanteDe } from './_disponibilidad.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

async function renovar(refreshToken) {
  const rr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return rr.json().catch(() => ({ error: 'HTTP ' + rr.status }));
}

/**
 * El token de Google del dueño de la cuenta, renovándolo si le queda poco.
 * Devuelve null si no hay conexión. Nunca lanza por un fallo de renovación: se
 * devuelve el token viejo y que falle la llamada de verdad, con su mensaje.
 */
export async function getGcalToken(userId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_calendar&select=access_token,refresh_token,token_expires_at,account_name`,
    { headers: sbHeaders() }
  );
  const conn = await abrirConexion((await r.json())?.[0]);
  if (!conn?.access_token) return null;

  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (exp - Date.now() > 5 * 60 * 1000) return { token: conn.access_token, email: conn.account_name };

  if (!conn.refresh_token) return { token: conn.access_token, email: conn.account_name };
  const fresh = await renovar(conn.refresh_token);
  if (!fresh.access_token) return { token: conn.access_token, email: conn.account_name };
  await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_calendar`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        access_token: await cifrar(fresh.access_token),
        token_expires_at: new Date(Date.now() + (fresh.expires_in || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }
  ).catch(() => {});
  return { token: fresh.access_token, email: conn.account_name };
}

/** El cuerpo del evento. Sin `end_at` se da por hecha una hora. */
export function gcalEventBody(activity, leadEmail, invite, zona) {
  const start = new Date(activity.due_at);
  const end = activity.end_at ? new Date(activity.end_at) : new Date(start.getTime() + 3600 * 1000);
  const tz = zona || 'America/Bogota';
  const body = {
    summary: activity.title,
    description: (activity.description || '') + '\n\n— Agendado desde Acuarius',
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
  };
  if (invite && leadEmail) body.attendees = [{ email: leadEmail }];
  return body;
}

export async function gcalRequest(token, method, path, body, sendUpdates) {
  const qs = sendUpdates ? '?sendUpdates=all' : '';
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const msg = data.error?.message || `Google Calendar ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

// ── El calendario de cada persona ───────────────────────────────────────────
//
// La conexión de arriba es UNA por cuenta, la del dueño, y sirve para escribir.
// Para reservas hace falta otra cosa: que lo que Ana apunte en SU Google la
// bloquee a ella y no a Luis. Por eso cada recurso guarda su propia conexión en
// `booking_resource_calendars`, colgada del recurso: si se borra el recurso, se
// va con él.
//
// El calendario de la cuenta NO se lee para bloquear a nadie. Ahí caen las
// citas de todos los que no tienen calendario propio, así que leerlo como
// «ocupado» taparía a cada persona con las citas de las demás.

const CAMPOS_EVENTO = 'timeZone,nextPageToken,items(id,status,transparency,eventType,start,end,attendees(self,responseStatus),extendedProperties)';

async function marcarErrorCalendario(resourceId, mensaje) {
  await fetch(`${SUPABASE_URL}/rest/v1/booking_resource_calendars?resource_id=eq.${encodeURIComponent(resourceId)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(mensaje
      ? { error: String(mensaje).slice(0, 300), error_at: new Date().toISOString() }
      : { error: null, error_at: null }),
  }).catch(() => {});
}

/**
 * El token del calendario de un recurso. null si no tiene calendario.
 *
 * A diferencia del de la cuenta, aquí un fallo de renovación SÍ lanza: con el
 * token caducado no se puede leer lo ocupado, y leerlo mal es peor que no
 * leerlo — quien llama decide qué hacer (tapar las horas de esa persona).
 */
export async function tokenDeRecurso(resourceId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/booking_resource_calendars?resource_id=eq.${encodeURIComponent(resourceId)}` +
    `&select=access_token,refresh_token,token_expires_at,email,error`,
    { headers: sbHeaders() }
  );
  if (!r.ok) throw new Error('calendario del recurso: HTTP ' + r.status);
  const conn = await abrirConexion((await r.json())?.[0]);
  if (!conn) return null;

  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token && exp - Date.now() > 5 * 60 * 1000) {
    return { token: conn.access_token, email: conn.email, error: conn.error || null };
  }
  if (!conn.refresh_token) throw new Error('El calendario de Google no dejó permiso para seguir conectado. Hay que volver a conectarlo.');

  const fresh = await renovar(conn.refresh_token);
  if (!fresh.access_token) {
    // `invalid_grant` = la persona quitó el permiso en su cuenta de Google o
    // cambió la contraseña. No se arregla solo, y por eso sale como 401: quien
    // lo recibe lo deja escrito para que Reservas lo enseñe en rojo. Cualquier
    // otro fallo de renovación es pasajero y no merece asustar a nadie.
    const perdido = fresh.error === 'invalid_grant';
    const e = new Error(perdido
      ? 'Google retiró el permiso. Hay que volver a conectar el calendario.'
      : 'Google no renovó el acceso (' + (fresh.error || 'sin detalle') + ').');
    if (perdido) e.status = 401;
    throw e;
  }
  await fetch(`${SUPABASE_URL}/rest/v1/booking_resource_calendars?resource_id=eq.${encodeURIComponent(resourceId)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      access_token: await cifrar(fresh.access_token),
      token_expires_at: new Date(Date.now() + (fresh.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});
  return { token: fresh.access_token, email: conn.email, error: conn.error || null };
}

/** Los eventos del calendario principal que SOLAPAN con el rango. */
export async function eventosGoogle(token, desdeISO, hastaISO) {
  const items = [];
  let zona = null, pagina = '';
  // `timeMin` corta por el FINAL del evento y `timeMax` por el principio: es
  // un filtro por solape, que es lo que hace falta. Unas vacaciones que
  // empezaron el lunes pasado tapan también este jueves.
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const q = new URLSearchParams({
      timeMin: desdeISO, timeMax: hastaISO,
      singleEvents: 'true', maxResults: '2500', fields: CAMPOS_EVENTO,
    });
    if (pagina) q.set('pageToken', pagina);
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(d.error?.message || `Google Calendar ${r.status}`);
      e.status = r.status;
      throw e;
    }
    zona = zona || d.timeZone || null;
    items.push(...(d.items || []));
    pagina = d.nextPageToken || '';
    if (!pagina) return { items, zona };
  }
  // Más de 10.000 eventos en dos semanas no es un calendario, es un error. Se
  // dice en vez de devolver media lista, que dejaría huecos que no lo son.
  throw new Error('El calendario tiene demasiados eventos en ese rango para leerlo entero.');
}

/**
 * Los tramos ocupados que salen de los eventos de Google. Pura, sin red.
 *
 * Lo que NO ocupa:
 *  - lo marcado como «Disponible» en Google (`transparent`). Los eventos de
 *    todo el día nacen así por defecto: un cumpleaños no cierra la agenda. Si
 *    alguien quiere que sus vacaciones bloqueen, las marca como «Ocupado».
 *  - las invitaciones que la persona rechazó.
 *  - el lugar de trabajo del día («en casa», «en la oficina»).
 *  - las citas que pusimos nosotros: ya cuentan por su lado, y si están en un
 *    calendario compartido taparían a otra persona con citas que no son suyas.
 */
export function tramosOcupados(items, zonaCalendario, ignorar) {
  const out = [];
  for (const ev of items || []) {
    if (!ev || ev.status === 'cancelled') continue;
    if (ev.transparency === 'transparent') continue;
    if (ev.eventType === 'workingLocation') continue;
    if (ev.extendedProperties?.private?.acuarius_cita) continue;
    if (ignorar && ignorar.has(ev.id)) continue;
    const yo = (ev.attendees || []).find(a => a && a.self);
    if (yo && yo.responseStatus === 'declined') continue;

    let ini, fin;
    if (ev.start?.dateTime) {
      ini = Date.parse(ev.start.dateTime);
      fin = Date.parse(ev.end?.dateTime || '');
    } else if (ev.start?.date) {
      // Un evento de todo el día no trae hora: son días del CALENDARIO de esa
      // persona, de medianoche a medianoche en su zona. Tomarlos en UTC
      // bloquearía en Bogotá desde las siete de la tarde del día anterior.
      const zona = zonaCalendario || 'UTC';
      try {
        ini = instanteDe(zona, ev.start.date, '00:00').getTime();
        fin = instanteDe(zona, ev.end?.date || ev.start.date, '00:00').getTime();
      } catch { continue; }
      if (fin <= ini) fin = ini + 86400000;
    } else continue;
    if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) continue;
    out.push({ ini, fin });
  }
  return out;
}

/**
 * Lo ocupado en Google de cada recurso que tenga calendario propio.
 *
 * Devuelve { [resourceId]: [{ini, fin}] } para los que se pudieron leer y
 * { [resourceId]: { fallo } } para los que no. Los que no tienen calendario no
 * aparecen. Qué hacer con un fallo lo decide quien llama.
 */
export async function ocupadoDeCalendarios(ids, desdeISO, hastaISO, ignorar) {
  const out = {};
  if (!ids.length) return out;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/booking_resource_calendars?resource_id=in.(${ids.map(encodeURIComponent).join(',')})&select=resource_id`,
    { headers: sbHeaders() }
  );
  if (!r.ok) throw new Error('calendarios: HTTP ' + r.status);
  const conCalendario = ((await r.json()) || []).map(f => f.resource_id);
  if (!conCalendario.length) return out;
  // `ignorar` puede llegar como función para no gastar la consulta en las
  // cuentas que no tienen ningún calendario conectado, que hoy son casi todas.
  if (typeof ignorar === 'function') ignorar = await ignorar();

  await Promise.all(conCalendario.map(async (id) => {
    try {
      const c = await tokenDeRecurso(id);
      if (!c) return;
      const { items, zona } = await eventosGoogle(c.token, desdeISO, hastaISO);
      out[id] = tramosOcupados(items, zona, ignorar);
      // Se leyó bien: si arrastraba un error de antes, ya no es verdad.
      if (c.error) await marcarErrorCalendario(id, null);
    } catch (e) {
      // 401/403: el permiso ya no vale. Se anota para la pantalla; un 500 de
      // Google es pasajero y no merece asustar a nadie.
      if (e.status === 401 || (e.status === 403 && !/limit|quota/i.test(e.message || ''))) {
        // El texto de Google viene en inglés y lo va a leer el dueño de una
        // barbería: se le dice en su idioma qué pasa y qué hacer.
        await marcarErrorCalendario(id, e.status === 401
          ? 'Google ya no acepta esta conexión. Hay que volver a conectar el calendario.'
          : 'Google no deja leer este calendario. Hay que volver a conectarlo con el permiso del calendario marcado.');
      }
      out[id] = { fallo: String(e.message || e) };
    }
  }));
  return out;
}

/**
 * Una operación sobre el evento de una cita, esté donde esté.
 *
 * Una cita pudo escribirse en el calendario de su persona o, si esa persona
 * aún no lo tenía conectado, en el de la cuenta. No se guarda en cuál: se
 * prueba primero en el de la persona y, si allí no existe (404/410), en el de
 * la cuenta. Devuelve null si no hay ningún calendario conectado.
 */
export async function gcalEnSuCalendario(userId, resourceId, method, path, body, sendUpdates) {
  const fuentes = [];
  if (resourceId) fuentes.push(() => tokenDeRecurso(resourceId));
  fuentes.push(() => getGcalToken(userId));
  let ultimo = null;
  for (const fuente of fuentes) {
    const conn = await fuente().catch(() => null);
    if (!conn?.token) continue;
    try { return await gcalRequest(conn.token, method, path, body, sendUpdates); }
    catch (e) {
      ultimo = e;
      if (e.status === 404 || e.status === 410) continue;
      throw e;
    }
  }
  if (ultimo) throw ultimo;
  return null;
}
