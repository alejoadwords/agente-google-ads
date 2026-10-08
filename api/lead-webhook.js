// api/lead-webhook.js
// Webhook de entrada genérico por usuario (independiente de automatizaciones):
// GET devuelve (o crea) la URL única y a qué tablero llegan sus leads;
// POST {regenerate:true} rota el token; POST {client_id} elige el cliente.
// El token vive en platform_connections (platform 'lead_webhook') y lo consume
// api/hook/[token].js como fallback cuando el token no es de una automatización.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

function newToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Los ámbitos de la cuenta salen de sus pipelines, no de la cartera: un
// cliente sin tablero no puede recibir leads, y un tablero sin cliente en la
// cartera (pro_main, el ámbito nulo) sí. De la cartera solo se toma el nombre.
async function ambitosDe(userId) {
  const [pipes, perfil] = await Promise.all([
    sbGet(`/pipelines?user_id=eq.${encodeURIComponent(userId)}&select=client_id,name,is_default,position&order=position.asc`),
    sbGet(`/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.__agency_clients__&select=profile_data&limit=1`).catch(() => []),
  ]);
  const cartera = perfil?.[0]?.profile_data?.clients || [];
  const nombre = (id) => {
    const c = cartera.find(x => String(x.id) === String(id));
    const n = c && String(c.client_name || c.name || '').trim();
    if (n) return n;
    if (id === 'pro_main') return 'Mi negocio';
    return id ? 'Cliente sin nombre' : 'General (sin cliente)';
  };
  const porAmbito = new Map();
  for (const p of (pipes || [])) {
    const k = p.client_id || null;
    if (!porAmbito.has(k)) porAmbito.set(k, []);
    porAmbito.get(k).push(p);
  }
  return [...porAmbito.entries()].map(([client_id, ps]) => ({
    client_id,
    nombre: nombre(client_id),
    tablero: (ps.find(p => p.is_default) || ps[0]).name || 'Principal',
  }));
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const sesion = await verificarSesion(req);
  let userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'lead-webhook'), 401);

  // Equipo: el webhook es del dueño del workspace. Un miembro acotado a un
  // cliente no puede mover el webhook de toda la cuenta ni ver los nombres
  // de los demás clientes.
  let acotadoA = null;
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,client_id&limit=1`, { headers: sbHeaders() });
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) { userId = _tw.owner_user_id; acotadoA = _tw.client_id || null; }
  } catch {}

  const existing = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.lead_webhook&select=access_token,client_id&limit=1`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);

  let regenerate = false;
  let cambiarCliente = false;
  let clienteNuevo = null;
  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch {}
    regenerate = !!body.regenerate;
    if ('client_id' in body) {
      cambiarCliente = true;
      clienteNuevo = body.client_id ? String(body.client_id).slice(0, 120) : null;
    }
    if (!regenerate && !cambiarCliente) return jsonResp({ error: 'Método no permitido' }, 405);
  }

  if (cambiarCliente) {
    if (acotadoA) return jsonResp({ error: 'Solo el dueño de la cuenta puede cambiar a qué cliente llega el webhook.' }, 403);
    if (!clienteNuevo) return jsonResp({ error: 'Elige un cliente.' }, 400);
    // Que el cliente sea de ESTA cuenta: tiene que tener tableros suyos. Sin
    // esto se podría apuntar el webhook a un client_id cualquiera y los leads
    // caerían en un ámbito que nadie de la cuenta ve.
    let pipes;
    try {
      pipes = await sbGet(`/pipelines?user_id=eq.${encodeURIComponent(userId)}&client_id=eq.${encodeURIComponent(clienteNuevo)}&select=id&limit=1`);
    } catch {
      return jsonResp({ error: 'No se pudo comprobar el cliente. Reintenta en unos segundos.' }, 503);
    }
    if (!Array.isArray(pipes) || !pipes.length) return jsonResp({ error: 'Ese cliente no tiene tableros en tu cuenta.' }, 400);
  }

  let token = existing?.[0]?.access_token;
  let clienteActual = existing?.[0]?.client_id || null;
  if (!token || regenerate || cambiarCliente) {
    if (!token || regenerate) token = newToken();
    const fila = {
      user_id: userId, platform: 'lead_webhook', access_token: token,
      account_name: 'Webhook de entrada de leads', updated_at: new Date().toISOString(),
    };
    // Solo se escribe client_id cuando se elige: con merge-duplicates una
    // columna que no va en el cuerpo se queda como estaba, así que rotar el
    // token no le borra el cliente a nadie.
    if (cambiarCliente) fila.client_id = clienteNuevo;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?on_conflict=user_id,platform`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(fila),
    });
    if (!r.ok) return jsonResp({ error: 'No se pudo guardar el webhook: ' + (await r.text()).slice(0, 120) }, 500);
    if (cambiarCliente) clienteActual = clienteNuevo;
  }

  // A dónde llegan los leads, resuelto igual que api/hook/[token].js: el
  // cliente de la conexión y, si no tiene, pro_main. Si esto falla se dice:
  // la pantalla no puede afirmar un destino que no comprobó.
  let ambitos = null;
  try { ambitos = await ambitosDe(userId); } catch {}
  if (!ambitos) {
    return jsonResp({ url: 'https://app.acuarius.app/api/hook/' + token, token, client_id: acotadoA ? undefined : clienteActual, destino_error: 'No se pudo leer a qué tablero llegan los leads.' });
  }
  const tieneProMain = ambitos.some(a => a.client_id === 'pro_main');
  const efectivo = clienteActual || (tieneProMain ? 'pro_main' : null);
  const dest = ambitos.find(a => a.client_id === efectivo) || null;
  // «Cae en vacío»: sin cliente elegido, sin pro_main, y la cuenta trabaja en
  // clientes. Si su único ámbito es el nulo, ese tablero es el suyo.
  const vacio = (!clienteActual && !tieneProMain && ambitos.some(a => a.client_id))
    // Un cliente elegido que ya no tiene tableros (lo borraron) también.
    || (!!clienteActual && !dest);

  const visibles = acotadoA ? ambitos.filter(a => a.client_id === acotadoA) : ambitos;
  const verDestino = !acotadoA || efectivo === acotadoA;
  return jsonResp({
    url: 'https://app.acuarius.app/api/hook/' + token, token,
    client_id: verDestino ? clienteActual : undefined,
    destino: verDestino && dest ? { client_id: dest.client_id, cliente: dest.nombre, tablero: dest.tablero } : null,
    vacio: verDestino ? vacio : false,
    puede_elegir: !acotadoA,
    ambitos: visibles,
  });
}
