// api/probar-publico.js
// El mismo probador del agente, pero abierto con un enlace firmado.
//
// Para qué: que el cliente apruebe a su agente antes de encenderlo. Hasta ahora
// el visto bueno llegaba después del primer reclamo, porque la primera
// conversación de verdad la tenía un cliente suyo.
//
// Quien abre esto NO tiene cuenta, así que:
//   - No se devuelve nada de la configuración salvo el nombre del agente.
//   - No se devuelve la radiografía. A quien prueba le importa si la
//     conversación sirve, no a qué tablero va el lead ni qué etiqueta le
//     ponemos: son nuestras tripas y las de su proceso comercial.
//   - Hay tope diario, porque un chat con IA abierto a internet es una puerta a
//     gastar y el enlace acaba en un grupo de WhatsApp.
export const config = { runtime: 'edge' };

import { ensayarAgente } from './_inbox-engine.js';
import { abrirToken } from './_enlace-probar.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TOPE_DIARIO = 150;   // mensajes por cuenta y día desde enlaces públicos

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

// Se cuenta sobre ai_usage, que es donde consta el gasto: no hay un contador
// aparte que pueda desincronizarse de la factura.
async function usadosHoy(userId) {
  const desde = new Date(); desde.setUTCHours(0, 0, 0, 0);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${encodeURIComponent(userId)}` +
      `&origen=eq.ensayo-publico&created_at=gte.${desde.toISOString()}&select=id`,
      { headers: { ...sbHeaders(), Prefer: 'count=exact', Range: '0-0' } }
    );
    return parseInt((res.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
  } catch {
    // Si no se puede contar, se deja pasar: dejar a un cliente sin poder probar
    // por un fallo de lectura es peor que un ensayo de más.
    return 0;
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let cuerpo = {};
  if (req.method === 'POST') {
    try { cuerpo = await req.json(); } catch { return jsonResp({ error: 'Petición inválida' }, 400); }
  }
  // En el GET viaja en la URL; en el POST, en el cuerpo, para que no quede
  // escrito en los registros del servidor en cada mensaje.
  const abierto = await abrirToken(new URL(req.url).searchParams.get('t') || cuerpo.t);
  if (!abierto) return jsonResp({ error: 'Este enlace no es válido.' }, 403);
  if (abierto.caducado) {
    return jsonResp({ error: 'Este enlace caducó. Pídele uno nuevo a quien te lo compartió.' }, 410);
  }
  const { userId, agentId } = abierto;

  // GET — lo mínimo para pintar la página: cómo se llama el agente.
  if (req.method === 'GET') {
    const agente = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${encodeURIComponent(agentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}&select=name,is_active`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
    if (!agente) return jsonResp({ error: 'Este agente ya no existe.' }, 404);
    return jsonResp({ nombre: agente.name });
  }

  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  if (await usadosHoy(userId) >= TOPE_DIARIO) {
    return jsonResp({
      error: 'Se agotaron las pruebas de hoy para este enlace. Vuelve mañana.',
    }, 429);
  }

  const r = await ensayarAgente({
    userId, agentId,
    canal: 'whatsapp',
    mensajes: cuerpo.mensajes,
    origen: 'ensayo-publico',
  });
  if (!r.ok) return jsonResp({ error: r.error }, 400);

  // La radiografía va también en el enlace: quien prueba es el dueño del
  // negocio, no un comprador, y lo que quiere ver es justo si el agente
  // entendió —qué datos recogió, a qué proceso manda, si califica—. Al
  // principio se dejó fuera por prudencia y resultó ser lo que hacía falta.
  //
  // Lo único que no sale son las líneas del catálogo: son muchas y no aportan
  // nada al juicio. El número y los filtros sí, que es lo que explica por qué
  // ofreció lo que ofreció.
  return jsonResp({
    texto: r.texto,
    bruto: r.bruto,
    capturado: r.capturado,
    escalar: r.escalar,
    calificacion: r.calificacion,
    ruta: r.ruta,
    catalogo: { pistas: r.catalogo?.pistas || {}, ofrecidas: r.catalogo?.ofrecidas || 0 },
  });
}
