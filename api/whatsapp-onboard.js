// api/whatsapp-onboard.js
// Alta de WhatsApp por el "registro insertado" de Meta (Embedded Signup).
//
// El usuario pulsa Conectar, elige su cuenta y su número dentro de la ventana de
// Facebook, y Meta nos devuelve waba_id, phone_number_id y un código de un solo
// uso que caduca en 30 segundos. Aquí se cambia ese código por el token del
// negocio, se suscribe la cuenta a la app para que lleguen los webhooks y se
// guarda el canal. El usuario no copia ni pega nada.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GRAPH = 'https://graph.facebook.com/v21.0';

function sb() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
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
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data)) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    return await manejar(req);
  } catch (e) {
    return jsonResp({ error: 'No se pudo completar la conexión: ' + (e?.message || 'error desconocido') }, 500);
  }
}

async function manejar(req) {
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: un miembro conecta canales de la cuenta del dueño.
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) userId = tw.owner_user_id;
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  // GET — lo que el navegador necesita para abrir la ventana de Meta
  if (req.method === 'GET') {
    const appId = process.env.META_APP_ID || null;
    const configId = process.env.META_WA_CONFIG_ID || null;
    return jsonResp({ app_id: appId, config_id: configId, disponible: !!(appId && configId) });
  }

  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  const body = await req.json().catch(() => ({}));
  const { code, waba_id, phone_number_id, agent_id } = body || {};
  if (!code || !waba_id || !phone_number_id) {
    return jsonResp({ error: 'Meta no devolvió los datos del número. Vuelve a intentar la conexión.' }, 400);
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return jsonResp({ error: 'Faltan las credenciales de la app de Meta' }, 500);

  // 1. El código dura 30 segundos: se cambia por el token del negocio
  const tokRes = await fetch(`${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`);
  const tok = await tokRes.json().catch(() => ({}));
  if (!tokRes.ok || !tok.access_token) {
    return jsonResp({ error: 'Meta rechazó el código de conexión: ' + (tok?.error?.message || 'sin detalle') +
      '. Suele pasar si pasaron más de 30 segundos; vuelve a intentarlo.' }, 502);
  }
  const token = tok.access_token;

  // 2. Suscribir la cuenta de WhatsApp a la app. Sin esto los mensajes del
  //    cliente nunca llegan a nuestro webhook y el canal parece conectado pero
  //    está mudo — que es justo el fallo que no queremos repetir.
  const subRes = await fetch(`${GRAPH}/${encodeURIComponent(waba_id)}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  });
  if (!subRes.ok) {
    const det = await subRes.text().catch(() => '');
    return jsonResp({ error: 'El número se conectó pero Meta no aceptó la suscripción a los mensajes, ' +
      'así que no entrarían conversaciones. Detalle: ' + det.slice(0, 300) }, 502);
  }

  // 3. Nombre del número, para que el canal se reconozca en la lista
  let nombre = null;
  try {
    const inf = await fetch(`${GRAPH}/${encodeURIComponent(phone_number_id)}?fields=display_phone_number,verified_name`, {
      headers: { 'Authorization': `Bearer ${token}` },
    }).then(r => r.json());
    nombre = [inf?.verified_name, inf?.display_phone_number].filter(Boolean).join(' · ') || null;
  } catch {}

  // 4. Guardar el canal. external_id es el phone_number_id: es lo que llega en
  //    el webhook y por lo que se busca la conexión al entrar un mensaje.
  const fila = {
    user_id: userId,
    agent_id: agent_id || null,      // sin agente = lo atiende el equipo
    channel: 'whatsapp',
    external_id: String(phone_number_id),
    access_token: token,
    channel_name: nombre || 'WhatsApp',
    is_active: true,
  };
  // Reconectar el mismo número debe actualizar, no duplicar. Se mira primero y
  // se decide: un upsert por 'on_conflict' exigiría acertar el nombre de la
  // restricción única de la tabla, y adivinar nombres de objetos de base de
  // datos ya salió mal antes.
  const previa = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&channel=eq.whatsapp&external_id=eq.${encodeURIComponent(String(phone_number_id))}&select=id&limit=1`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);

  let res;
  if (previa?.[0]?.id) {
    // Al reconectar no se pisa quién atiende el canal si ya estaba decidido
    const cambios = { access_token: token, channel_name: fila.channel_name, is_active: true };
    if (agent_id !== undefined) cambios.agent_id = agent_id || null;
    res = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${encodeURIComponent(previa[0].id)}`, {
      method: 'PATCH', headers: sb(), body: JSON.stringify(cambios),
    });
  } else {
    res = await fetch(`${SUPABASE_URL}/rest/v1/channel_connections`, {
      method: 'POST', headers: sb(), body: JSON.stringify(fila),
    });
  }
  if (!res.ok) return jsonResp({ error: 'No se pudo guardar el canal: ' + (await res.text()).slice(0, 300) }, 500);
  const filas = await res.json().catch(() => []);
  return jsonResp({ connection: filas?.[0] || null, waba_id, reconectado: !!previa?.[0]?.id });
}
