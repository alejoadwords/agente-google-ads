// api/_soporte.js
// Modo soporte: un administrador de Acuarius puede abrir la cuenta de un
// cliente para ayudarle a configurar o para diagnosticar un problema.
//
// Decisiones deliberadas, porque esto toca datos de terceros:
//   · Solo lectura por defecto. Escribir exige pedirlo explícitamente.
//   · La sesión caduca (1 h) y va firmada: el navegador no puede fabricarla ni
//     alargarla.
//   · Todo acceso queda registrado en la cuenta visitada, así que si un cliente
//     pregunta quién entró y cuándo, la respuesta está.
//
// El guion bajo evita que Vercel lo publique como endpoint.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const LOG_KEY = '__soporte_log__';
export const DURACION_MIN = 60;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function deB64url(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), c => c.charCodeAt(0));
}

async function firmar(datos) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(process.env.SOPORTE_SECRET || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(datos))));
}

// El vale es {payload}.{firma}: sin el secreto del servidor no se puede
// fabricar ni cambiarle la cuenta, el permiso de escritura o la caducidad.
export async function emitirVale({ adminId, adminEmail, cuenta, escritura }) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    a: adminId, e: adminEmail, c: cuenta, w: !!escritura,
    exp: Date.now() + DURACION_MIN * 60000,
  })));
  return `${payload}.${await firmar(payload)}`;
}

export async function leerVale(vale) {
  try {
    if (!vale || !process.env.SOPORTE_SECRET) return null;
    const [payload, firma] = String(vale).split('.');
    if (!payload || !firma) return null;
    if (await firmar(payload) !== firma) return null;
    const d = JSON.parse(new TextDecoder().decode(deB64url(payload)));
    if (!d.exp || d.exp < Date.now()) return null;
    return { adminId: d.a, adminEmail: d.e, cuenta: d.c, escritura: !!d.w };
  } catch { return null; }
}

export function esAdmin(email) {
  const lista = String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && lista.includes(String(email).toLowerCase());
}

export async function emailDeClerk(userId) {
  try {
    const u = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    }).then(r => (r.ok ? r.json() : null));
    return u?.email_addresses?.[0]?.email_address || null;
  } catch { return null; }
}

// El registro vive en la cuenta VISITADA, no en la del administrador: así, si
// un cliente pregunta quién entró a su cuenta, la respuesta está en un solo
// sitio. Se guardan los últimos 300 accesos.
export async function registrar(cuenta, entrada) {
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(cuenta)}&agent_key=eq.${LOG_KEY}&select=profile_data&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    const previos = rows?.[0]?.profile_data?.accesos || [];
    const accesos = [{ ...entrada, fecha: new Date().toISOString() }, ...previos].slice(0, 300);
    await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
      method: 'POST',
      headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: cuenta, agent_key: LOG_KEY,
        profile_data: { accesos }, updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) { console.error('registrar soporte:', e); }
}

// ── Lo que usan los endpoints ───────────────────────────────────────────────
// Devuelve sobre qué cuenta hay que operar. Si viene un vale de soporte válido,
// es la del cliente; si no, la de quien llama.
// Un endpoint que escribe debe pasar { escribe: true }: si el vale es de solo
// lectura, aquí se corta.
export async function resolverSoporte(req, userId, { escribe = false } = {}) {
  const vale = req.headers.get ? req.headers.get('x-acuarius-soporte') : req.headers?.['x-acuarius-soporte'];
  if (!vale) return { userId, soporte: null };
  const s = await leerVale(vale);
  if (!s || s.adminId !== userId) return { userId, soporte: null, invalido: true };
  if (escribe && !s.escritura) {
    return { userId, soporte: s, bloqueado: 'La sesión de soporte es de solo lectura. Habilita la edición para cambiar datos.' };
  }
  return { userId: s.cuenta, soporte: s };
}
