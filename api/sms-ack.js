// api/sms-ack.js — confirmaciones de entrega de LabsMobile.
//
// LabsMobile llama por GET a la `ackurl` que le pasamos en cada envío, con
// subid, status (ok|ko), desc (DELIVRD, UNDELIV…) y acklevel (operator, que es
// «lo aceptó el operador», o handset, que es «llegó al teléfono»).
//
// La URL lleva una firma del subid (`k`): sin ella cualquiera podría marcar
// como entregados o fallidos los envíos de otro. No se devuelven créditos por
// un fallo de entrega: el operador ya cobró el mensaje. Pero sí se corrigen
// las cifras de la campaña: un rechazo deja de contar como enviado.
//
// Siempre responde 200 salvo firma mala: si respondiéramos error, LabsMobile
// reintentaría cinco veces un aviso que no vamos a poder usar.

export const config = { runtime: 'edge' };

import { firmaAck } from './_sms.js';
import { registrarError } from './_registro-errores.js';

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
  const H = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const reintentar = (donde, txt) => {
    // Aquí sí se pide el reintento: el aviso es bueno y lo que falló es la base.
    console.error('[sms-ack]', donde, String(txt).slice(0, 200));
    return new Response('reintentar', { status: 503 });
  };

  // Se lee antes de cambiarlo: lo que hay que corregir en la campaña depende
  // de dónde venía. enviado → fallido resta un enviado y suma un fallido; un
  // «entregado» tardío que desmiente un fallo lo deshace.
  const r1 = await fetch(`${SUPABASE_URL}/rest/v1/sms_envios?subid=eq.${subid}&select=id,estado,campaign_id,lead_id,user_id`, { headers: H });
  if (!r1.ok) return reintentar('leer', await r1.text());
  const [envio] = await r1.json();
  // Un «entregado» no se pisa con un aviso posterior; y el mismo aviso
  // repetido (LabsMobile reintenta) no vuelve a tocar las cifras.
  if (!envio || envio.estado === estado || !['enviado', 'simulado', 'fallido'].includes(envio.estado)) {
    return new Response('ok');
  }

  // El cambio solo vale si nadie lo cambió entretanto: el filtro por el estado
  // leído lo garantiza, y si no devuelve fila, otro aviso ya lo hizo.
  const r2 = await fetch(`${SUPABASE_URL}/rest/v1/sms_envios?id=eq.${envio.id}&estado=eq.${envio.estado}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ estado, detalle: ok ? null : `No entregado (${desc || nivel || 'sin detalle'})`, updated_at: new Date().toISOString() }),
  });
  if (!r2.ok) return reintentar('guardar', await r2.text());
  if (!(await r2.json()).length) return new Response('ok');

  // La campaña cuenta como «enviado» lo que la API aceptó. Si el operador lo
  // rechaza después, eso deja de ser verdad: se corrige la cifra y la fila del
  // destinatario. La suma se hace en la base para no pisarse con el motor.
  const deFallo = envio.estado === 'fallido';
  if (envio.campaign_id && (estado === 'fallido' || deFallo)) {
    try {
      const rs = await fetch(`${SUPABASE_URL}/rest/v1/rpc/campana_sumar_stats`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ p_id: envio.campaign_id, p_sent: deFallo ? 1 : -1, p_failed: deFallo ? -1 : 1 }),
      });
      if (!rs.ok) throw new Error('stats ' + rs.status + ': ' + (await rs.text()).slice(0, 150));
      if (envio.lead_id) {
        const rr = await fetch(`${SUPABASE_URL}/rest/v1/campaign_recipients?campaign_id=eq.${envio.campaign_id}&lead_id=eq.${envio.lead_id}&status=eq.${deFallo ? 'failed' : 'sent'}`, {
          method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify(deFallo ? { status: 'sent', detail: null } : { status: 'failed', detail: `El operador no lo entregó (${desc || 'rechazado'})` }),
        });
        if (!rr.ok) throw new Error('destinatario ' + rr.status + ': ' + (await rr.text()).slice(0, 150));
      }
    } catch (e) {
      // El envío ya quedó bien marcado; reintentar el aviso no arreglaría la
      // campaña (vería el estado ya cambiado). Se deja a la vista en el
      // registro de errores en vez de pedirle a LabsMobile que insista.
      await registrarError({ origen: 'sms-ack', donde: 'cifras de la campaña', error: e, usuario: envio.user_id,
        detalle: 'campaña ' + envio.campaign_id + ' · subid ' + subid });
    }
  }
  return new Response('ok');
}
