// api/agenda.js
// Agenda del CRM: tareas y reuniones vinculadas a leads.
// Las reuniones se sincronizan con Google Calendar (crear/editar/eliminar el
// evento, con invitación al lead como asistente opcional). Conexión estable:
// platform_connections 'google_calendar' con refresh_token y auto-renovación.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TZ = 'America/Bogota';

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

// Verificación completa del JWT de Clerk (mismo patrón que api/leads.js)
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Google Calendar: token con auto-renovación ───────────────────────────────
async function getGcalToken(userId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_calendar&select=access_token,refresh_token,token_expires_at,account_name`,
    { headers: sbHeaders() }
  );
  const conn = (await r.json())?.[0];
  if (!conn?.access_token) return null;

  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (exp - Date.now() > 5 * 60 * 1000) return { token: conn.access_token, email: conn.account_name };

  if (!conn.refresh_token) return { token: conn.access_token, email: conn.account_name };
  const rr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  const fresh = await rr.json();
  if (!fresh.access_token) return { token: conn.access_token, email: conn.account_name };
  await fetch(
    `${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_calendar`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        access_token: fresh.access_token,
        token_expires_at: new Date(Date.now() + (fresh.expires_in || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }
  ).catch(() => {});
  return { token: fresh.access_token, email: conn.account_name };
}

function gcalEventBody(activity, leadEmail, invite) {
  const start = new Date(activity.due_at);
  const end = activity.end_at ? new Date(activity.end_at) : new Date(start.getTime() + 3600 * 1000);
  const body = {
    summary: activity.title,
    description: (activity.description || '') + '\n\n— Agendado desde Acuarius',
    start: { dateTime: start.toISOString(), timeZone: TZ },
    end:   { dateTime: end.toISOString(),   timeZone: TZ },
  };
  if (invite && leadEmail) body.attendees = [{ email: leadEmail }];
  return body;
}

async function gcalRequest(token, method, path, body, sendUpdates) {
  const qs = sendUpdates ? '?sendUpdates=all' : '';
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}${qs}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;
  const scope = clientId ? `&client_id=eq.${clientId}` : '&client_id=is.null';

  // GET ?gcal_status=1 — estado de la conexión de Google Calendar
  if (req.method === 'GET' && url.searchParams.get('gcal_status')) {
    const conn = await getGcalToken(userId);
    return jsonResp({ connected: !!conn, email: conn?.email || null });
  }

  // GET ?lead_id= — actividades de un lead
  if (req.method === 'GET' && url.searchParams.get('lead_id')) {
    const leadId = url.searchParams.get('lead_id');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?user_id=eq.${userId}&lead_id=eq.${leadId}&select=*&order=due_at.asc`,
      { headers: sbHeaders() }
    );
    return jsonResp({ activities: (await res.json()) || [] });
  }

  // GET ?from=&to= — actividades por rango (vista calendario)
  if (req.method === 'GET') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    let q = `${SUPABASE_URL}/rest/v1/activities?user_id=eq.${userId}${scope}&select=*&order=due_at.asc&limit=500`;
    if (from) q += `&due_at=gte.${encodeURIComponent(from)}`;
    if (to) q += `&due_at=lte.${encodeURIComponent(to)}`;
    const res = await fetch(q, { headers: sbHeaders() });
    return jsonResp({ activities: (await res.json()) || [] });
  }

  // POST — crear actividad (reunión → evento en Google Calendar)
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { type, title, description, due_at, end_at, lead_id, invite_lead } = body;
    if (!title || !String(title).trim()) return jsonResp({ error: 'El título es requerido' }, 400);
    if (!['task', 'meeting'].includes(type)) return jsonResp({ error: 'Tipo inválido' }, 400);
    if (!due_at) return jsonResp({ error: 'La fecha es requerida' }, 400);

    const activity = {
      user_id: userId,
      client_id: clientId,
      lead_id: lead_id || null,
      type,
      title: String(title).trim(),
      description: description || null,
      due_at,
      end_at: end_at || null,
      done: false,
    };

    // Sincronizar reunión con Google Calendar
    let gcalWarning = null;
    if (type === 'meeting') {
      const conn = await getGcalToken(userId);
      if (conn) {
        let leadEmail = null;
        if (lead_id && invite_lead) {
          const lr = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}&user_id=eq.${userId}&select=email`, { headers: sbHeaders() });
          leadEmail = (await lr.json())?.[0]?.email || null;
        }
        try {
          const ev = await gcalRequest(conn.token, 'POST', '', gcalEventBody(activity, leadEmail, invite_lead), !!leadEmail);
          activity.gcal_event_id = ev.id;
        } catch (e) {
          gcalWarning = e.status === 403
            ? 'Google Calendar API no está habilitada en el proyecto de Google Cloud — habilítala para sincronizar reuniones.'
            : 'No se pudo crear el evento en Google Calendar: ' + e.message;
        }
      } else {
        gcalWarning = 'Google Calendar no está conectado — la reunión quedó solo en Acuarius.';
      }
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(activity),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ activity: rows[0], gcal_synced: !!activity.gcal_event_id, gcal_warning: gcalWarning }, 201);
  }

  // PUT — actualizar (incluye marcar como hecha)
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.id) return jsonResp({ error: 'Falta id' }, 400);

    const allowed = ['title', 'description', 'due_at', 'end_at', 'done', 'type', 'lead_id'];
    const update = { updated_at: new Date().toISOString() };
    for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k]; }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?id=eq.${body.id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    const act = rows[0];

    // Reflejar cambios de la reunión en Google Calendar
    let gcalWarning = null;
    if (act?.gcal_event_id && (update.title || update.description || update.due_at || update.end_at)) {
      const conn = await getGcalToken(userId);
      if (conn) {
        try {
          await gcalRequest(conn.token, 'PATCH', '/' + act.gcal_event_id, gcalEventBody(act, null, false));
        } catch (e) { gcalWarning = 'El evento de Google Calendar no se pudo actualizar: ' + e.message; }
      }
    }
    return jsonResp({ activity: act, gcal_warning: gcalWarning });
  }

  // DELETE — eliminar (y su evento de Google Calendar)
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const pre = await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${id}&user_id=eq.${userId}&select=gcal_event_id`, { headers: sbHeaders() });
    const gcalId = (await pre.json())?.[0]?.gcal_event_id;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    if (gcalId) {
      const conn = await getGcalToken(userId);
      if (conn) { try { await gcalRequest(conn.token, 'DELETE', '/' + gcalId, null, true); } catch {} }
    }
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
