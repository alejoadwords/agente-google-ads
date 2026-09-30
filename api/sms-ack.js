// api/sms-ack.js — confirmaciones de entrega de LabsMobile.
//
// LabsMobile llama por GET a la `ackurl` que le pasamos en cada envío, con
// subid, status (ok|ko), desc (DELIVRD, UNDELIV…) y acklevel (operator, que es
// «lo aceptó el operador», o handset, que es «llegó al teléfono»).
//
// La URL lleva una firma del subid (`k`): sin ella cualquiera podría marcar
// como entregados o fallidos los envíos de otro. No se devuelven créditos por
// un fallo de entrega: el operador ya cobró el mensaje.
//
// Siempre responde 200 salvo firma mala: si respondiéramos error, LabsMobile
// reintentaría cinco veces un aviso que no vamos a poder usar.

export const config = { runtime: 'edge' };

import { firmaAck } from './_sms.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req) {
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k) || '';
  const subid = q('subid');
  if (!/^[0-9a-f]{20}$/.test(subid) || q('k') !== await firmaAck(subid)) {
    return new Response('firma inválida', { status: 403 });
  }

  const ok = q('status').toLowerCase() === 'ok';
  const nivel = q('acklevel').toLowerCase();
  const desc = q('desc').toUpperCase().slice(0, 20);
  // «Aceptado por el operador» no cambia nada: ya estaba como enviado.
  if (ok && nivel !== 'handset') return new Response('ok');

  const estado = ok ? 'entregado' : 'fallido';
  // Un «entregado» no se pisa con un aviso posterior de otro nivel.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/sms_envios?subid=eq.${subid}&estado=in.(enviado,simulado,fallido)`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' },
    body: JSON.stringify({ estado, detalle: ok ? null : `No entregado (${desc || nivel || 'sin detalle'})`, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    // Aquí sí se pide el reintento: el aviso es bueno y lo que falló es la base.
    console.error('[sms-ack] no se pudo guardar:', (await r.text()).slice(0, 200));
    return new Response('reintentar', { status: 503 });
  }
  return new Response('ok');
}
