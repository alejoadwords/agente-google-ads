// api/oauth/gcal-callback.js
// Recibe el código de Google Calendar, guarda tokens en platform_connections
// (con on_conflict — lección aprendida del callback de Ads) y redirige a la app.

import { cifrar } from '../_cifrado.js';
import { abrirEnlaceCalendario, abrirEnlaceCuenta } from '../_enlace-calendario.js';
import { paginaCalendario } from '../_pagina-calendario.js';
import { eventosGoogle } from '../_gcal.js';
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveGcalConnection(userId, tokens, email, platform = 'google_calendar') {
  if (!userId || !SUPABASE_URL) return false;
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id:          userId,
      platform,
      access_token:     await cifrar(tokens.access_token),
      // Solo incluir refresh_token si Google lo devolvió (no sobreescribir con null)
      ...(tokens.refresh_token ? { refresh_token: await cifrar(tokens.refresh_token) } : {}),
      token_expires_at: expiresAt,
      account_name:     email || '',
      updated_at:       new Date().toISOString(),
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error('saveGcalConnection error:', r.status, errText.slice(0, 300));
  }
  return r.ok;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  let nonce = '', enlace = '', firmado = '';
  try { const s = JSON.parse(state || '{}'); nonce = s.nonce || ''; enlace = s.r || ''; firmado = s.c || ''; } catch {}

  // El calendario de una persona de las reservas: otra historia, con su propia
  // respuesta (quien lo conecta puede no tener cuenta en Acuarius).
  if (nonce === 'gcal_recurso') return conectarRecurso(req, res, enlace);

  // El mismo callback sirve a Calendar y a YouTube: el state dice cuál es.
  const esYoutube = nonce === 'yt_connect';
  const plataforma = esYoutube ? 'youtube' : 'google_calendar';

  // DE QUIÉN es la conexión lo dice la FIRMA, nunca un userId del state: el
  // state viaja por el navegador y se puede cambiar entre Google y nosotros.
  // Sin firma válida no se guarda nada, aunque Google haya dado permiso.
  const firma = await abrirEnlaceCuenta(firmado, esYoutube ? 'youtube' : 'calendario');
  if (!firma || firma.caducado) {
    return res.redirect('https://app.acuarius.app/?gcal_error=' + (firma?.caducado ? 'enlace_caducado' : 'enlace_invalido'));
  }
  const userId = firma.userId;

  if (error) return res.redirect('https://app.acuarius.app/?gcal_error=access_denied');
  if (!code)  return res.status(400).json({ error: 'Código de autorización faltante' });

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  'https://app.acuarius.app/api/oauth/gcal-callback',
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.redirect('https://app.acuarius.app/?gcal_error=token_failed');

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userRes.json();

    const saved = await saveGcalConnection(userId, tokens, userInfo.email, plataforma);
    const clave = esYoutube ? 'yt' : 'gcal';
    return res.redirect(
      `https://app.acuarius.app/?${clave}_connected=${saved ? 'true' : 'partial'}&${clave}_email=${encodeURIComponent(userInfo.email || '')}`
    );
  } catch (err) {
    console.error('gcal-callback error:', err);
    return res.redirect('https://app.acuarius.app/?gcal_error=server_error');
  }
}

// ── El calendario de una persona de las reservas ────────────────────────────

const SCOPE_EVENTOS = 'https://www.googleapis.com/auth/calendar.events';

function pagina(res, status, datos) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(paginaCalendario(datos));
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function conectarRecurso(req, res, enlace) {
  const { code, error } = req.query;
  // La firma se vuelve a comprobar aquí: el `state` viaja por el navegador y
  // cualquiera puede cambiarlo entre Google y nosotros.
  const e = await abrirEnlaceCalendario(enlace);
  if (!e || e.caducado) {
    return pagina(res, 400, { ok: false, titulo: 'Este enlace ya no vale',
      texto: 'Pídele a quien te lo mandó que saque uno nuevo desde Reservas → Quién atiende.' });
  }
  if (error || !code) {
    return pagina(res, 400, { ok: false, titulo: 'No se conectó el calendario',
      texto: 'No diste permiso en Google. Si fue sin querer, abre otra vez el enlace.' });
  }

  // El recurso tiene que seguir existiendo y ser de esa cuenta. Si lo borraron
  // mientras el enlace esperaba en un chat, no hay a quién colgarle nada.
  const rr = await sb(`/booking_resources?id=eq.${encodeURIComponent(e.resourceId)}` +
    `&user_id=eq.${encodeURIComponent(e.userId)}&select=id,nombre&limit=1`);
  const recurso = rr.ok ? (await rr.json())?.[0] : null;
  if (!recurso) {
    return pagina(res, 404, { ok: false, titulo: 'Ya no está en las reservas',
      texto: 'La persona a la que iba este enlace ya no está dada de alta. Pide uno nuevo.' });
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  'https://app.acuarius.app/api/oauth/gcal-callback',
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error || !tokens.access_token) {
      return pagina(res, 400, { ok: false, titulo: 'Google no terminó la conexión',
        texto: 'Abre otra vez el enlace e inténtalo de nuevo.', detalle: tokens.error_description || tokens.error });
    }
    // Google deja desmarcar permisos sueltos en la pantalla de consentimiento.
    // Sin el del calendario, la conexión «funciona» y no puede leer nada: se
    // dice ahora, no el día que se cuele una cita encima de otra.
    if (tokens.scope && !String(tokens.scope).split(' ').includes(SCOPE_EVENTOS)) {
      return pagina(res, 400, { ok: false, titulo: 'Falta el permiso del calendario',
        texto: 'En la pantalla de Google hay que dejar marcada la casilla del calendario. Abre otra vez el enlace y márcala.' });
    }
    // Sin refresh_token la conexión muere en una hora. Con prompt=consent Google
    // siempre lo manda; si no llega, algo raro pasó y mejor saberlo ya.
    if (!tokens.refresh_token) {
      return pagina(res, 400, { ok: false, titulo: 'Google no dejó la conexión abierta',
        texto: 'Quita el acceso de Acuarius en tu cuenta de Google (Seguridad → Apps con acceso) y abre otra vez el enlace.' });
    }

    // Una lectura de verdad antes de decir «listo»: es lo que va a hacer la
    // página de reservas cada vez que alguien mire horas.
    const ahora = new Date();
    try {
      await eventosGoogle(tokens.access_token, ahora.toISOString(), new Date(ahora.getTime() + 86400000).toISOString());
    } catch (err) {
      return pagina(res, 400, { ok: false, titulo: 'No pudimos leer tu calendario',
        texto: 'Google dio permiso, pero al leer el calendario contestó con un error. Inténtalo otra vez.', detalle: err.message });
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const email = (await userRes.json().catch(() => ({})))?.email || '';

    const g = await sb('/booking_resource_calendars?on_conflict=resource_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        resource_id:      recurso.id,
        user_id:          e.userId,
        email,
        access_token:     await cifrar(tokens.access_token),
        refresh_token:    await cifrar(tokens.refresh_token),
        token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        error:            null,
        error_at:         null,
        updated_at:       new Date().toISOString(),
      }),
    });
    if (!g.ok) {
      const txt = await g.text().catch(() => '');
      console.error('gcal recurso: no se guardó', g.status, txt.slice(0, 300));
      return pagina(res, 500, { ok: false, titulo: 'No se pudo guardar la conexión',
        texto: 'Google dio permiso pero no pudimos guardarlo. Inténtalo otra vez en unos minutos.' });
    }

    return pagina(res, 200, { ok: true, titulo: 'Calendario conectado',
      texto: `Desde ahora, lo que tengas ocupado en tu Google Calendar deja de ofrecerse en las reservas de «${recurso.nombre}», y cada cita nueva te llega allí. Ya puedes cerrar esta página.`,
      detalle: email });
  } catch (err) {
    console.error('gcal recurso error:', err);
    return pagina(res, 500, { ok: false, titulo: 'Algo falló al conectar',
      texto: 'Inténtalo otra vez en unos minutos.', detalle: String(err?.message || err) });
  }
}
