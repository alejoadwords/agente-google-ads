// api/_gcal.js — el puente con Google Calendar.
//
// Vivía dentro de api/agenda.js. Salió aquí cuando las reservas empezaron a
// crear citas: dos copias de la renovación del token acaban diciendo cosas
// distintas, y la que se quede vieja falla el día que caduca un permiso —
// justo el día en que nadie está mirando.
//
// Solo se importa desde funciones EDGE (ver CLAUDE.md).

import { abrirConexion, cifrar } from './_cifrado.js';

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
  const rr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const fresh = await rr.json();
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
