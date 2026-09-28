// api/agent-probar.js
// Probar un agente antes de encenderlo.
//
// Hasta ahora un agente se publicaba a ciegas: la primera conversación de
// verdad era también la primera prueba, y la hacía un cliente del cliente. Este
// endpoint responde con el MISMO prompt, el MISMO inventario y la MISMA regla
// que la conversación real, pero sin escribir nada en el CRM.
//
// El historial lo manda el navegador. Es a propósito: así no hay conversación
// que crear ni que limpiar después. Y viaja EN BRUTO, con los bloques ocultos
// dentro de los mensajes del agente, porque el motor los relee para acumular lo
// capturado entre turnos.
//
// Tope diario: el ensayo gasta tokens de verdad. Sin tope, una pestaña abierta
// en bucle es una factura.
export const config = { runtime: 'edge' };

import { ensayarAgente } from './_inbox-engine.js';
import { crearToken, DIAS_ENLACE } from './_enlace-probar.js';
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TOPE_DIARIO = 300;  // mensajes de ensayo por cuenta y día

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Cuántos ensayos lleva hoy esta cuenta. Se cuenta sobre ai_usage, que es donde
// consta el gasto: no hay un contador aparte que pueda desincronizarse.
async function ensayosDeHoy(userId) {
  const desde = new Date(); desde.setUTCHours(0, 0, 0, 0);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${encodeURIComponent(userId)}` +
      `&origen=eq.ensayo&created_at=gte.${desde.toISOString()}&select=id`,
      { headers: { ...sbHeaders(), Prefer: 'count=exact', Range: '0-0' } }
    );
    const rango = res.headers.get('content-range') || '';
    return parseInt(rango.split('/')[1] || '0', 10) || 0;
  } catch {
    // Si no se puede contar, no se bloquea: dejar a alguien sin poder probar su
    // agente por un fallo de lectura es peor que un ensayo de más.
    return 0;
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResp({ error: 'Método no permitido' }, 405);
  }

  const sesion = await verificarSesion(req);
  let userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'agent-probar'), 401);

  // Un miembro prueba el agente de la cuenta del dueño, que es donde vive. Si
  // la comprobación falla no se sigue: con la identidad equivocada buscaríamos
  // el agente en otra cuenta y diríamos que no existe.
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}` +
      `&status=eq.active&select=owner_user_id&limit=1`,
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const fila = (await res.json())?.[0];
    if (fila?.owner_user_id) userId = fila.owner_user_id;
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  // GET — el enlace para que lo pruebe el cliente, sin cuenta.
  if (req.method === 'GET') {
    const agentId = new URL(req.url).searchParams.get('agent_id');
    if (!agentId) return jsonResp({ error: 'Falta el agente' }, 400);
    // Que el agente sea de esta cuenta se comprueba aquí y no al abrir el
    // enlace: firmar un token para el agente de otro sería regalar su agente.
    const suyo = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${encodeURIComponent(agentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
    if (!suyo) return jsonResp({ error: 'Ese agente no existe en tu cuenta.' }, 404);

    const token = await crearToken(userId, agentId);
    if (!token) return jsonResp({ error: 'Los enlaces compartidos no están configurados.' }, 503);
    return jsonResp({
      url: `${new URL(req.url).origin}/probar/${token}`,
      dias: DIAS_ENLACE,
    });
  }

  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }

  const usados = await ensayosDeHoy(userId);
  if (usados >= TOPE_DIARIO) {
    return jsonResp({
      error: `Llegaste al tope de ${TOPE_DIARIO} mensajes de prueba por día. Vuelve mañana o escríbenos si necesitas más.`,
    }, 429);
  }

  const r = await ensayarAgente({
    userId,
    agentId: body.agent_id,
    canal: body.canal || 'whatsapp',
    mensajes: body.mensajes,
  });
  if (!r.ok) return jsonResp({ error: r.error }, 400);

  return jsonResp({ ...r, restantes: Math.max(0, TOPE_DIARIO - usados - 1) });
}
