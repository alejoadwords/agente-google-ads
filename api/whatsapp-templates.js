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

import { conexionWhatsapp, plantillasDeMeta, huecosDe, cuentaDe } from './_whatsapp.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  if (req.method !== 'GET') return jsonResp({ error: 'Método no permitido' }, 405);

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;

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
      aviso: 'Este canal se conectó antes de que gestionáramos plantillas. Vuelve a conectarlo en Ajustes → Canales para habilitarlas.' });
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
