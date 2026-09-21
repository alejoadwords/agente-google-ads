// api/whatsapp-templates.js — las plantillas de WhatsApp de la cuenta.
//
//   GET  → lista las plantillas de la WABA del cliente, con su estado
//
// Por qué existe: para escribirle a alguien que NO te ha escrito en las últimas
// 24 horas, Meta exige una plantilla aprobada. Sin esto, una «campaña masiva de
// WhatsApp» solo llega a quien ya estaba conversando contigo, que no es una
// campaña: es una respuesta.
//
// No se guardan en nuestra base a propósito. El estado lo decide Meta y cambia
// solo —una plantilla aprobada se puede pausar por calidad de un día para
// otro—, así que una copia nuestra estaría mintiendo la mitad del tiempo. Se
// pregunta en el momento, y antes de cada envío se vuelve a comprobar.

export const config = { runtime: 'edge' };

import { conexionWhatsapp, plantillasDeMeta, huecosDe, cuentaDe, clienteDe,
         revisarBorrador, crearPlantilla, borrarPlantilla } from './_whatsapp.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return jsonResp({ error: 'Método no permitido' }, 405);

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const url = new URL(req.url);
  // Un miembro acotado a un cliente no se sale de el, pida lo que pida el
  // navegador. Ver alcanceDeCliente en _perfiles.js.
  const clientId = (await clienteDe(userId)) || url.searchParams.get('client_id') || null;

  // Un miembro opera sobre la cuenta del DUEÑO. Sin esto vería su propia
  // cuenta, que no tiene ningún canal, y creería que no hay plantillas.
  const cuenta = await cuentaDe(userId);

  const conn = await conexionWhatsapp(cuenta, clientId);
  if (!conn) {
    return jsonResp({ plantillas: [], motivo: 'sin_canal',
      aviso: 'No hay un canal de WhatsApp conectado en esta cuenta.' });
  }
  if (!conn.waba_id || !conn.access_token) {
    // Caso real: las conexiones creadas antes de que guardáramos el waba_id, y
    // los canales manuales, que no tienen token. Decirlo con el remedio, no con
    // un error genérico.
    return jsonResp({ plantillas: [], motivo: 'sin_waba',
      aviso: 'Para usar plantillas falta el WhatsApp Business Account ID de este canal. Reconéctalo en Ajustes → Canales: te lo pedirá junto al Phone Number ID.'});
  }

  // ── POST: escribir una plantilla y mandarla a revisión ────────────────────
  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }

    // ?revisar=1 solo revisa y devuelve, sin mandar nada a Meta. Lo usa la
    // pantalla mientras se escribe: ver el problema al teclear vale mucho más
    // que verlo tres días después en un rechazo.
    const { errores, avisos } = revisarBorrador(b);
    if (url.searchParams.get('revisar')) return jsonResp({ errores, avisos });
    if (errores.length) return jsonResp({ error: errores[0], errores, avisos }, 400);

    const r = await crearPlantilla(conn, b);
    if (!r.ok) return jsonResp({ error: 'Meta no la aceptó: ' + r.aviso }, 400);
    // La categoría que devuelve Meta puede no ser la que se pidió: recategoriza
    // por el contenido, y eso cambia lo que le cuesta al cliente cada envío.
    return jsonResp({
      ok: true, id: r.id, status: r.status, category: r.category,
      recategorizada: r.category && r.category !== b.category ? r.category : null,
      avisos,
    });
  }

  // ── DELETE: borrar una plantilla ──────────────────────────────────────────
  // Hace falta de verdad: Meta no deja reutilizar el nombre de una plantilla
  // rechazada hasta borrarla, así que sin esto el cliente se queda sin poder
  // rehacerla con el mismo nombre.
  if (req.method === 'DELETE') {
    const nombre = url.searchParams.get('name');
    if (!nombre) return jsonResp({ error: 'Falta el nombre de la plantilla' }, 400);
    const r = await borrarPlantilla(conn, nombre);
    if (!r.ok) return jsonResp({ error: 'No se pudo borrar: ' + r.aviso }, 400);
    return jsonResp({ ok: true });
  }

  const res = await plantillasDeMeta(conn);
  if (!res.ok) {
    return jsonResp({ plantillas: [], motivo: 'meta',
      aviso: 'Meta no devolvió las plantillas: ' + res.aviso }, 502);
  }

  // Se devuelven TODAS, no solo las aprobadas: ver una rechazada con su motivo
  // es justo lo que hace falta para arreglarla. `usable` dice cuál se puede
  // enviar hoy — lo decide el estado, no nosotros.
  const plantillas = res.plantillas.map(t => ({
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    usable: t.status === 'APPROVED',
    calidad: t.quality_score?.score || null,
    motivo_rechazo: t.rejected_reason || null,
    ...huecosDe(t.components),
  }));

  plantillas.sort((a, b) => (b.usable - a.usable) || a.name.localeCompare(b.name));

  return jsonResp({
    plantillas,
    canal: conn.channel_name || 'WhatsApp',
    aprobadas: plantillas.filter(p => p.usable).length,
  });
}
