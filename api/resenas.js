// api/resenas.js
// Pedir reseñas de Google a los clientes que ya compraron.
//
// Tres cosas en un solo endpoint:
//   GET  ?config=1        → el enlace de reseñas y el mensaje, por cliente
//   PUT  ?config=1        → guardarlos (solo dueño o admin)
//   GET  ?t=<firma>       → PÚBLICO: registra el clic y redirige a Google
//
// El enlace que se le manda al cliente es nuestro, no el de Google. Así se sabe
// quién lo abrió sin pedirle nada a Google ni crear tablas: el clic queda como
// una actividad más en la ficha del lead. Va FIRMADO con HMAC porque un enlace
// adivinable dejaría que cualquiera inflara esa estadística — o peor, que
// fabricara actividad en fichas ajenas.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LINK_SECRET  = process.env.LINK_SECRET || process.env.CRON_SECRET || '';

// Clave reservada en user_profiles, como __agency_clients__. Sin tabla nueva.
export const RESENAS_KEY = '__resenas__';

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

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
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data))) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

// ── Firma del enlace ────────────────────────────────────────────────────────
// El token lleva los datos a la vista y una firma: no hay que guardarlo en
// ningún sitio para poder comprobarlo después.
async function firmar(datos) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(LINK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(datos));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function tokenResena(userId, leadId, clientId) {
  const datos = [userId, leadId, clientId || ''].join('|');
  return encodeURIComponent(datos) + '.' + (await firmar(datos));
}

async function abrirToken(t) {
  const i = String(t || '').lastIndexOf('.');
  if (i < 0) return null;
  const datos = decodeURIComponent(String(t).slice(0, i));
  const firma = String(t).slice(i + 1);
  if (!LINK_SECRET) return null;
  // Comparación en tiempo constante: una comparación normal filtra, byte a
  // byte, cuánto acertó quien lo intenta.
  const esperada = await firmar(datos);
  if (firma.length !== esperada.length) return null;
  let dif = 0;
  for (let k = 0; k < firma.length; k++) dif |= firma.charCodeAt(k) ^ esperada.charCodeAt(k);
  if (dif !== 0) return null;
  const [userId, leadId, clientId] = datos.split('|');
  return { userId, leadId, clientId: clientId || null };
}

// ── Configuración ───────────────────────────────────────────────────────────
async function leerConfig(userId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${RESENAS_KEY}&select=profile_data&limit=1`,
      { headers: sbHeaders() }
    );
    if (!r.ok) return {};
    const fila = (await r.json())?.[0];
    return fila?.profile_data || {};
  } catch { return {}; }
}

export async function configDe(userId, clientId) {
  const todo = await leerConfig(userId);
  return todo[clientId || '_cuenta'] || null;
}

// Solo enlaces de reseña reales. Sin esto, cualquier configuración descuidada
// mandaría a los clientes de un negocio a una web ajena — o a un `javascript:`.
export function urlResenaValida(u) {
  const s = String(u || '').trim();
  if (!/^https:\/\//i.test(s)) return null;
  try {
    const host = new URL(s).hostname.toLowerCase();
    const permitidos = ['g.page', 'search.google.com', 'www.google.com', 'google.com', 'maps.app.goo.gl', 'goo.gl'];
    return permitidos.some(h => host === h || host.endsWith('.' + h)) ? s : null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);

  // ── PÚBLICO: el cliente pincha el enlace del correo ──────────────────────
  if (req.method === 'GET' && url.searchParams.get('t')) {
    const datos = await abrirToken(url.searchParams.get('t'));
    if (!datos) return new Response('Enlace no válido', { status: 400, headers: CORS });
    const cfg = await configDe(datos.userId, datos.clientId);
    const destino = urlResenaValida(cfg?.url);
    if (!destino) return new Response('Este negocio todavía no configuró su enlace de reseñas', { status: 404, headers: CORS });

    // El clic queda en el historial del lead. Es lo que convierte «mandamos 40
    // correos» en «12 personas fueron a dejar la reseña».
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
        method: 'POST',
        headers: { ...sbHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: datos.userId, lead_id: datos.leadId, type: 'nota',
          content: 'Abrió el enlace para dejar la reseña en Google.',
          metadata: { resena: 'clic' },
        }),
      });
    } catch {}   // el registro nunca puede impedir que el cliente llegue a Google

    return new Response(null, { status: 302, headers: { ...CORS, Location: destino, 'Cache-Control': 'no-store' } });
  }

  // ── Privado: configuración ───────────────────────────────────────────────
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  let esMiembro = false, rolMiembro = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,role&limit=1`, { headers: sbHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) { userId = tw.owner_user_id; esMiembro = true; rolMiembro = tw.role || 'vendedor'; }
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }
  // El enlace es de la cuenta y sale en correos a nombre del negocio: lo cambia
  // quien manda, igual que las fuentes y los motivos de cierre.
  if (esMiembro && rolMiembro !== 'admin' && req.method !== 'GET') {
    return jsonResp({ error: 'Solo el administrador de la cuenta puede cambiar el enlace de reseñas.' }, 403);
  }

  if (req.method === 'GET') {
    return jsonResp({ config: await leerConfig(userId) });
  }

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const clave = body.client_id || '_cuenta';
    const enlace = String(body.url || '').trim();
    if (enlace && !urlResenaValida(enlace)) {
      return jsonResp({ error: 'El enlace tiene que ser el de tu ficha de Google (g.page, search.google.com o maps.app.goo.gl).' }, 400);
    }
    const todo = await leerConfig(userId);
    if (!enlace) delete todo[clave];
    else todo[clave] = { url: enlace, mensaje: String(body.mensaje || '').slice(0, 600) };

    // on_conflict obligatorio: sin él, el segundo guardado da 409.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, agent_key: RESENAS_KEY, profile_data: todo, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    return jsonResp({ ok: true, config: todo });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
