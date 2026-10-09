// api/_api-llaves.js — llaves de la API pública, permisos y avisos salientes
//
// Lo comparten api/v1.js (la API que usa un sistema externo), api/llaves-api.js
// (la pantalla de Configuración que crea y revoca llaves) y
// api/cron-webhooks.js (quien entrega los avisos). Un solo sitio que sepa qué
// permisos existen y qué URL se acepta: si cada uno tuviera su lista, el día
// que difieran la pantalla prometería un permiso que la API no respeta.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Permisos ─────────────────────────────────────────────────────────────────
// Cada llave lleva los que su dueño marcó. No hay permiso de borrar: un agente
// externo nunca borra nada en Acuarius, ni leads ni tareas ni notas.
export const PERMISOS = [
  { clave: 'leads:leer',          nombre: 'Ver prospectos',            detalle: 'Prospectos con su historial, procesos y etapas, equipo, etiquetas y motivos de cierre.' },
  { clave: 'leads:escribir',      nombre: 'Crear y editar prospectos', detalle: 'Crear prospectos, cambiar sus datos y etiquetas, y dejar notas en el historial.' },
  { clave: 'leads:etapa',         nombre: 'Mover de etapa',            detalle: 'Mover prospectos entre etapas y procesos, y cerrarlos como ganados o perdidos.' },
  { clave: 'leads:asignar',       nombre: 'Asignar responsable',       detalle: 'Cambiar quién del equipo lleva cada prospecto. La persona recibe el aviso.' },
  { clave: 'tareas:leer',         nombre: 'Ver tareas y citas',        detalle: 'Las tareas y citas de la agenda.' },
  { clave: 'tareas:escribir',     nombre: 'Crear tareas y citas',      detalle: 'Crear tareas y citas, cambiarlas y marcarlas como hechas.' },
  { clave: 'conversaciones:leer', nombre: 'Leer conversaciones',       detalle: 'Las conversaciones del inbox y sus mensajes.' },
];
export const CLAVES_PERMISOS = PERMISOS.map(p => p.clave);

// ── Eventos que se avisan hacia afuera ──────────────────────────────────────
// Los encolan disparadores de la base (sql/2026-10-api-publica.sql): si se
// añade uno aquí, hay que añadirlo también allí o la pantalla ofrecerá un
// aviso que nunca llega.
export const EVENTOS = [
  { clave: 'lead.creado',                   nombre: 'Entra un prospecto' },
  { clave: 'lead.etapa_cambiada',           nombre: 'Un prospecto cambia de etapa' },
  { clave: 'lead.asignado',                 nombre: 'Un prospecto cambia de responsable' },
  { clave: 'mensaje.recibido',              nombre: 'Llega un mensaje al inbox' },
  { clave: 'conversacion.estado_cambiado',  nombre: 'Una conversación pasa a agente, a persona o a resuelta' },
];
export const CLAVES_EVENTOS = EVENTOS.map(e => e.clave);

// Tope de llaves y webhooks vivos por cuenta. Holgado para cualquier uso real
// (un agente por proceso, uno por concesionario) y evita que un error de
// programación del otro lado llene la tabla.
export const MAX_LLAVES = 20;
export const MAX_WEBHOOKS = 10;

// Planes que pueden usar la API. La prueba de 14 días cuenta como Pro: es
// cuando se decide comprar, y probar una integración es parte de decidir.
export const PLANES_CON_API = ['pro', 'individual', 'agency', 'agencia', 'trial'];

export function sbHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

// ── La llave ─────────────────────────────────────────────────────────────────
// «acu_live_» + 32 bytes aleatorios en base64url (43 caracteres). Se guarda
// solo el SHA-256: con la base entera en la mano nadie puede usar una llave.
// El prefijo visible (los primeros 17 caracteres) sirve para reconocerla en la
// lista sin poder usarla.
export const PREFIJO_LLAVE = 'acu_live_';

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generarLlave() {
  const llave = PREFIJO_LLAVE + base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { llave, prefijo: llave.slice(0, 17), hash: await sha256Hex(llave) };
}

export function pareceLlave(texto) {
  return /^acu_live_[A-Za-z0-9_-]{43}$/.test(String(texto || ''));
}

// Secreto con el que se firma cada aviso saliente. El receptor lo usa para
// comprobar que el aviso salió de Acuarius y no de cualquiera que conozca su URL.
export function generarSecretoWebhook() {
  return 'whsec_' + base64url(crypto.getRandomValues(new Uint8Array(24)));
}

// ── Plan de la cuenta ────────────────────────────────────────────────────────
// Siempre el del DUEÑO: el plan de un miembro no dice nada (cada miembro arranca
// su propia prueba al aceptar la invitación). Se lee en cada petición, cacheado
// un minuto POR CUENTA en un Map — nunca en una variable suelta del módulo, que
// compartirían todas las cuentas que caen en la misma instancia.
const _cuentaCache = new Map();
export async function cuentaConApi(cuenta) {
  if (!cuenta || !process.env.CLERK_SECRET_KEY) return { ok: false };
  const hit = _cuentaCache.get(cuenta);
  if (hit && hit.exp > Date.now()) return hit.valor;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + encodeURIComponent(cuenta), {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    if (r.status === 404) return { ok: true, plan: null, permitido: false };
    if (!r.ok) return { ok: false };
    const u = await r.json();
    const plan = String(u.public_metadata?.plan || '').toLowerCase() || null;
    const correos = (u.email_addresses || []).map(e => String(e.email_address || '').toLowerCase());
    const admins = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const esAdmin = correos.some(c => admins.includes(c));
    const valor = {
      ok: true, plan, esAdmin,
      permitido: esAdmin || PLANES_CON_API.includes(plan),
      leadsExtra: parseInt(u.public_metadata?.leads_extra || 0) || 0,
    };
    _cuentaCache.set(cuenta, { valor, exp: Date.now() + 60000 });
    return valor;
  } catch { return { ok: false }; }
}

// ── URL de un webhook ────────────────────────────────────────────────────────
// Acuarius va a hacer una petición a la URL que escriba el cliente. Sin este
// filtro, alguien podría apuntarla a una dirección interna y usarnos para
// tocar puertas que desde fuera no alcanza. No viaja ningún secreto nuestro en
// esa petición, pero igual se corta: solo HTTPS, sin IP privadas ni nombres
// locales, sin puerto raro y sin usuario:contraseña en la URL.
export function validarUrlWebhook(texto) {
  let u;
  try { u = new URL(String(texto || '').trim()); } catch { return { ok: false, error: 'La URL no es válida.' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'La URL tiene que empezar por https://.' };
  if (u.username || u.password) return { ok: false, error: 'La URL no puede llevar usuario ni contraseña.' };
  if (u.port && u.port !== '443') return { ok: false, error: 'Solo se admite el puerto 443.' };
  if (String(texto).length > 500) return { ok: false, error: 'La URL es demasiado larga.' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) {
    return { ok: false, error: 'La URL tiene que ser una dirección pública de internet.' };
  }
  if (esIpPrivada(host)) return { ok: false, error: 'La URL apunta a una dirección privada.' };
  if (/(^|\.)acuarius\.app$/.test(host)) return { ok: false, error: 'La URL no puede ser de Acuarius.' };
  return { ok: true, url: u.toString() };
}

function esIpPrivada(host) {
  // IPv6: cualquier literal se rechaza salvo que sea claramente global. Más
  // simple y más seguro que reconocer cada rango especial.
  if (host.includes(':')) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19));
}

// Firma de un aviso: HMAC-SHA256 de «<marca de tiempo>.<cuerpo>». La marca de
// tiempo dentro de la firma impide que alguien que capture un aviso lo vuelva
// a mandar días después.
export async function firmarAviso(secreto, marca, cuerpo) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(marca + '.' + cuerpo));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Entregar un aviso ────────────────────────────────────────────────────────
// Lo usan el cron (api/cron-webhooks.js) y el botón «Probar» de Configuración.
// Devuelve siempre { ok, estado, error }: quien llama decide si reintenta.
//
// · Ocho segundos como mucho: un receptor lento no puede frenar la cola de
//   todas las cuentas.
// · Sin seguir redirecciones: una URL pública que redirige a una interna
//   esquivaría el filtro de arriba.
// · El cuerpo de la respuesta no se lee ni se guarda: no es nuestro.
export async function entregarAviso(webhook, { evento, evento_id, created_at, datos }) {
  const v = validarUrlWebhook(webhook.url);
  if (!v.ok) return { ok: false, estado: null, error: v.error };
  const { descifrar } = await import('./_cifrado.js');
  let secreto;
  try { secreto = await descifrar(webhook.secreto); }
  catch (e) { return { ok: false, estado: null, error: 'No se pudo abrir el secreto del webhook: ' + e.message }; }
  const cuerpo = JSON.stringify({ id: evento_id, evento, creado: created_at, datos });
  const marca = String(Math.floor(Date.now() / 1000));
  const firma = await firmarAviso(secreto, marca, cuerpo);
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(v.url, {
      method: 'POST', redirect: 'manual', signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Acuarius-Webhooks/1 (+https://app.acuarius.app/api-docs.html)',
        'X-Acuarius-Evento': evento,
        'X-Acuarius-Entrega': String(evento_id),
        'X-Acuarius-Firma': `t=${marca},v1=${firma}`,
      },
      body: cuerpo,
    });
    try { await r.body?.cancel(); } catch {}
    if (r.status >= 200 && r.status < 300) return { ok: true, estado: r.status, error: null };
    if (r.status >= 300 && r.status < 400) return { ok: false, estado: r.status, error: `Respondió con una redirección (${r.status}); los avisos no siguen redirecciones.` };
    return { ok: false, estado: r.status, error: `Respondió ${r.status}.` };
  } catch (e) {
    return { ok: false, estado: null, error: e?.name === 'AbortError' ? 'No respondió en 8 segundos.' : 'No se pudo conectar: ' + (e?.message || e) };
  } finally {
    clearTimeout(reloj);
  }
}
