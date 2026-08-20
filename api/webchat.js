// api/webchat.js — cara pública del widget de chat web (public/w.js).
//
//   GET  ?key=…                 configuración pública del canal
//   POST ?key=…                 { v, text } → entra al motor del inbox
//   GET  ?key=…&v=…&since=…     mensajes nuevos de ESA conversación
//
// Sin autenticación, como api/form-public.js: quien escribe es un visitante
// anónimo de la web del cliente.
//
// SEGURIDAD — la clave del sitio está a la vista en el HTML de cualquiera, así
// que el diseño la trata como pública:
//   · la clave SOLO permite escribir en su propio canal;
//   · leer exige además el visitorId, que es aleatorio y vive únicamente en el
//     navegador de esa persona, y se cruza contra la conversación;
//   · si el canal tiene dominios declarados, se comprueba el Origin.
//
// La configuración del widget (dominios, color, saludo) se guarda en la columna
// access_token de channel_connections como JSON. No es elegante: es que no
// podemos crear columnas nuevas con la clave de servicio, y en este canal esa
// columna no guarda ningún token.

export const config = { runtime: 'edge' };

import { processIncoming, cleanForUser } from './_inbox-engine.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const MAX_TEXTO = 2000;
const LIMITE_MENSAJES = 30;      // por visitante y ventana
const VENTANA_MS = 5 * 60 * 1000;

function sb() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=representation' };
}

// Mejor esfuerzo: cada instancia edge tiene su propio contador. No frena a un
// atacante decidido —para eso están el tope de longitud y el honeypot— pero sí
// evita que un bucle accidental en la web del cliente dispare la factura.
const _visitas = new Map();
function pasaLimite(clave) {
  const ahora = Date.now();
  const v = _visitas.get(clave);
  if (!v || ahora - v.desde > VENTANA_MS) { _visitas.set(clave, { desde: ahora, n: 1 }); return true; }
  v.n++;
  return v.n <= LIMITE_MENSAJES;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
}

function ajustes(conn) {
  try { const a = JSON.parse(conn.access_token || '{}'); return a && typeof a === 'object' ? a : {}; }
  catch { return {}; }
}

// example.com permite example.com y sus subdominios; nada más.
function dominioPermitido(origin, dominios) {
  if (!dominios || !dominios.length) return true;   // sin lista, no se restringe
  if (!origin) return false;
  let host;
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return false; }
  return dominios.some(d => {
    const base = String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    return host === base || host.endsWith('.' + base);
  });
}

// ¿Está cerrada la oficina? Sin horario configurado, nunca: quien no lo declara
// atiende siempre, que es lo que espera quien no tocó ese campo.
//   horario = { dias:[1..7], desde:'09:00', hasta:'18:00', zona:'America/Bogota' }
// dias: 1 = lunes … 7 = domingo.
function fueraDeHorario(h) {
  if (!h || !Array.isArray(h.dias) || !h.dias.length || !h.desde || !h.hasta) return false;
  try {
    const zona = h.zona || 'America/Bogota';
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zona, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const parte = t => f.find(p => p.type === t)?.value || '';
    const dias = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const dia = dias[parte('weekday')];
    if (!dia || !h.dias.includes(dia)) return true;

    const ahora = parseInt(parte('hour'), 10) * 60 + parseInt(parte('minute'), 10);
    const aMin = s => {
      const [hh, mm] = String(s).split(':').map(n => parseInt(n, 10));
      return (hh || 0) * 60 + (mm || 0);
    };
    const desde = aMin(h.desde), hasta = aMin(h.hasta);
    // Turno que cruza la medianoche (22:00 a 06:00): dentro es fuera de los topes
    return desde <= hasta ? (ahora < desde || ahora >= hasta) : (ahora < desde && ahora >= hasta);
  } catch {
    // Una zona horaria inválida no puede dejar el chat cerrado para siempre
    return false;
  }
}

async function canalDe(key) {
  if (!/^[a-f0-9]{32}$/i.test(String(key || ''))) return null;
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?channel=eq.webchat&external_id=eq.${encodeURIComponent(key)}&select=*`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return filas?.[0] || null;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const origin = req.headers.get('Origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

  const key = url.searchParams.get('key');
  const conn = await canalDe(key);
  // Misma respuesta para clave inexistente y canal apagado: no se le confirma a
  // nadie qué claves existen.
  if (!conn || !conn.is_active) return json({ activo: false }, 200, origin);

  const cfg = ajustes(conn);
  if (!dominioPermitido(origin, cfg.dominios)) return json({ activo: false }, 200, origin);

  // ── Configuración pública ────────────────────────────────────────────────
  // Nunca datos de la cuenta: solo lo que hace falta para pintar la burbuja.
  if (req.method === 'GET' && !url.searchParams.get('v')) {
    let nombre = cfg.titulo || conn.channel_name || 'Chat';
    if (!cfg.titulo && conn.agent_id) {
      const ag = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${conn.agent_id}&select=name&limit=1`, { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      if (ag?.[0]?.name) nombre = ag[0].name;
    }
    return json({
      activo: true,
      titulo: nombre,
      saludo: cfg.saludo || '¡Hola! ¿En qué te puedo ayudar?',
      color: cfg.color || '#1E2BCC',
      posicion: cfg.posicion === 'izquierda' ? 'izquierda' : 'derecha',
      // El horario se resuelve AQUÍ, no en el navegador: el reloj del visitante
      // puede estar en otro huso o sencillamente mal, y quien decide si la
      // oficina está abierta es la oficina.
      fuera_horario: fueraDeHorario(cfg.horario),
      aviso_horario: cfg.horario?.aviso
        || 'Ahora mismo no hay nadie conectado. Déjanos tu mensaje y tu correo o celular, y te respondemos apenas volvamos.',
    }, 200, origin);
  }

  // ── Sondeo ───────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const v = String(url.searchParams.get('v') || '');
    if (!/^[a-f0-9]{32}$/i.test(v)) return json({ mensajes: [] }, 200, origin);
    const desde = url.searchParams.get('since') || '1970-01-01T00:00:00Z';

    // El cruce clave + visitante es lo que impide leer la conversación de otro
    const conv = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?connection_id=eq.${conn.id}&contact_id=eq.${encodeURIComponent(v)}&select=id&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (!conv?.[0]) return json({ mensajes: [] }, 200, origin);

    const msgs = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${conv[0].id}&role=eq.assistant&created_at=gt.${encodeURIComponent(desde)}&select=content,created_at&order=created_at.asc&limit=20`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);

    return json({ mensajes: (msgs || []).map(m => ({ texto: cleanForUser(m.content), fecha: m.created_at })) }, 200, origin);
  }

  // ── Mensaje del visitante ────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Body inválido' }, 400, origin); }

    if (body._hp) return json({ ok: true, mensajes: [] }, 200, origin);   // honeypot
    const v = String(body.v || '');
    if (!/^[a-f0-9]{32}$/i.test(v)) return json({ error: 'Sesión inválida' }, 400, origin);

    const texto = String(body.text || '').trim().slice(0, MAX_TEXTO);
    if (!texto) return json({ error: 'Mensaje vacío' }, 400, origin);
    if (!pasaLimite(key + ':' + v)) return json({ error: 'Demasiados mensajes. Espera un momento.' }, 429, origin);

    const antes = new Date().toISOString();
    // El motor hace todo lo demás: conversación, agente, calificación y —según
    // la política del canal, que por defecto es on_contact— el lead cuando
    // aparece un dato de contacto. No al primer "hola".
    const r = await processIncoming({
      channel: 'webchat',
      externalId: key,
      contactId: v,
      contactName: String(body.nombre || '').trim().slice(0, 80) || null,
      text: texto,
      send: async () => ({ ok: true }),   // en la web nadie empuja: el widget sondea
    }).catch(e => ({ ok: false, reason: e.message }));

    if (!r || r.ok === false) return json({ ok: false, error: 'No se pudo entregar el mensaje' }, 502, origin);

    // La respuesta del bot, si la hubo, vuelve en la misma llamada para que el
    // visitante no espere al siguiente sondeo.
    const conv = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?connection_id=eq.${conn.id}&contact_id=eq.${encodeURIComponent(v)}&select=id&limit=1`,
      { headers: sb() }
    ).then(x => (x.ok ? x.json() : [])).catch(() => []);
    let mensajes = [];
    if (conv?.[0]) {
      const msgs = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${conv[0].id}&role=eq.assistant&created_at=gte.${encodeURIComponent(antes)}&select=content,created_at&order=created_at.asc&limit=5`,
        { headers: sb() }
      ).then(x => (x.ok ? x.json() : [])).catch(() => []);
      mensajes = (msgs || []).map(m => ({ texto: cleanForUser(m.content), fecha: m.created_at }));
    }
    return json({ ok: true, mensajes }, 200, origin);
  }

  return json({ error: 'Método no permitido' }, 405, origin);
}
