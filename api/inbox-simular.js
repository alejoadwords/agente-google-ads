// api/inbox-simular.js
// Mete un mensaje entrante como si lo hubiera enviado un cliente por WhatsApp,
// para poder probar el circuito completo —conversación, inbox, respuesta manual
// y entrada al CRM— sin depender de que Meta apruebe la app.
//
// El webhook ya tenía un modo simulador, pero exige CRON_SECRET, que no puede
// vivir en el navegador. Aquí se autentica con la sesión de Clerk y se
// comprueba que el canal es de quien pregunta: mismo efecto, sin repartir un
// secreto del servidor.
//
// Solo funciona con canales de prueba (external_id que empieza por 'sim_').
// Sobre un canal real no tendría sentido y podría ensuciar datos de verdad.
export const config = { runtime: 'edge' };

import { processIncoming } from './_inbox-engine.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

// Un id estable y legible a partir del nombre: sin tildes, sin espacios y
// acotado, para que quepa donde caben los ids reales de Meta.
function idDeNombre(nombre) {
  const base = String(nombre || 'contacto de prueba')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (base || 'contacto').slice(0, 40);
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  try {
    let userId = await getUserId(req);
    if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const tw = (await r.json())?.[0];
      if (tw && tw.owner_user_id) userId = tw.owner_user_id;
    } catch {
      return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const { connection_id, text, contact_name, contact_id, adjunto } = body || {};
    if (!connection_id) return jsonResp({ error: 'Falta el canal' }, 400);
    // Con adjunto no hace falta texto: el caso que más importa probar es
    // justamente el de la foto sin una palabra.
    if (!String(text || '').trim() && !adjunto?.url) {
      return jsonResp({ error: 'Escribe el mensaje o adjunta un archivo' }, 400);
    }

    const con = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${encodeURIComponent(connection_id)}` +
      `&user_id=eq.${encodeURIComponent(userId)}&select=channel,external_id`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
    if (!con) return jsonResp({ error: 'Canal no encontrado' }, 404);
    if (!String(con.external_id || '').startsWith('sim_')) {
      return jsonResp({ error: 'Solo se pueden simular mensajes en un canal de prueba.' }, 400);
    }

    const r = await processIncoming({
      channel: con.channel,
      externalId: con.external_id,
      // El contacto sale del NOMBRE. Antes era fijo ('sim_contacto_1'), así que
      // cambiar el nombre no abría una conversación nueva: todo caía en la
      // primera y parecía que el simulador ignoraba lo que se escribía. Con el
      // mismo nombre se sigue la misma conversación, que es lo que se espera
      // para probar varios turnos seguidos.
      contactId: String(contact_id || 'sim_' + idDeNombre(contact_name)),
      contactName: contact_name || 'Contacto de prueba',
      text: String(text || '').slice(0, 1000),
      // Entra por el mismo camino que un adjunto real de Messenger: se descarga
      // de la URL y se copia al almacén. Si esto funciona, el de verdad también.
      media: adjunto?.url
        ? { fuente: 'url', url: adjunto.url, tipo: adjunto.tipo || null, nombre: adjunto.nombre || null, mime: adjunto.mime || null }
        : null,
      providerMessageId: 'sim_' + Date.now(),
      send: null,              // no se envía nada a ninguna parte
      resolverNombre: null,
    });

    return jsonResp({ resultado: r });
  } catch (e) {
    return jsonResp({ error: 'No se pudo simular el mensaje: ' + (e?.message || 'error desconocido') }, 500);
  }
}
