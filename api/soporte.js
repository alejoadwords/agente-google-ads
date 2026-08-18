// api/soporte.js
// Chat de soporte atendido por IA, con el conocimiento del producto y una
// radiografía de la propia cuenta de quien pregunta.
//
// La diferencia con un chatbot de FAQ está en esa radiografía: sin ella, ante
// "no me llegan leads" solo se puede recitar el manual; con ella se responde
// "tu canal de WhatsApp está inactivo desde el 3 de agosto".
//
// Qué se lee de la cuenta: SOLO configuración —canales, agentes, formularios,
// equipo, plan, procesos de venta— y conteos. Nunca el contenido de los
// mensajes ni los datos de contacto de sus leads. Es la misma línea que traza
// api/diagnostico.js, y aquí además cada quien ve únicamente lo suyo.
export const config = { runtime: 'edge' };

import { CONOCIMIENTO } from './_soporte-conocimiento.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TOPE_MENSAJES = 16;   // lo que se le pasa al modelo del hilo

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

async function getPayload(req) {
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
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, data)) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const cuenta = async (tabla, filtro) => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${filtro}&select=id`, {
      headers: { ...sb(), Prefer: 'count=exact', Range: '0-0' },
    });
    return parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10);
  } catch { return 0; }
};

// ── Radiografía de la cuenta ────────────────────────────────────────────────
// Se piden todas a la vez: en edge el tiempo es corto y encadenarlas costaría
// más que la propia respuesta del modelo.
async function radiografia(userId, plan) {
  const u = encodeURIComponent(userId);
  const q = async (ruta) => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: sb() });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  };

  const [canales, agentes, equipo, formularios, pipelines, catalogo, leads, convs] = await Promise.all([
    q(`channel_connections?user_id=eq.${u}&select=channel,channel_name,is_active,agent_id,client_id,external_id`),
    q(`chat_agents?user_id=eq.${u}&select=name,is_active,client_id`),
    q(`team_members?owner_user_id=eq.${u}&select=member_name,status`),
    q(`lead_forms?user_id=eq.${u}&select=name,tipo,active,submissions,last_submission_at`),
    q(`pipelines?user_id=eq.${u}&select=name,client_id&limit=20`),
    cuenta(`client_properties`, `user_id=eq.${u}`),
    cuenta(`leads`, `user_id=eq.${u}&deleted_at=is.null`),
    cuenta(`chat_conversations`, `user_id=eq.${u}`),
  ]);

  return {
    plan: plan || 'desconocido',
    leads, conversaciones: convs, propiedades_en_catalogo: catalogo,
    procesos_de_venta: (pipelines || []).map(p => p.name),
    canales: (canales || []).map(c => ({
      canal: c.channel,
      nombre: c.channel_name || null,
      activo: c.is_active,
      es_de_prueba: String(c.external_id || '').startsWith('sim_'),
      atendido_por: c.agent_id ? 'agente' : 'a mano',
    })),
    agentes: (agentes || []).map(a => ({ nombre: a.name, activo: a.is_active })),
    equipo: (equipo || []).map(m => ({ nombre: m.member_name, estado: m.status })),
    formularios: (formularios || []).map(f => ({
      nombre: f.name,
      tipo: f.tipo === 'conector' ? 'conexión a web externa' : 'formulario propio',
      activo: f.active,
      envios: f.submissions || 0,
      ultimo_envio: f.last_submission_at || null,
    })),
  };
}

function prompt(radio, contexto) {
  return `Eres el asistente de soporte de Acuarius. Ayudas a usuarios de la plataforma
a resolver dudas y a arreglar lo que no les funciona.

${CONOCIMIENTO}

═══ LA CUENTA DE QUIEN TE ESCRIBE ═══
Esto es real y está al día. Úsalo para responder con lo que de verdad le pasa a
esta persona en vez de dar instrucciones genéricas.
${JSON.stringify(radio, null, 1)}

${contexto?.seccion ? 'Ahora mismo está en la sección: ' + contexto.seccion : ''}
${contexto?.cliente ? 'Con el cliente activo: ' + contexto.cliente : 'Sin cliente activo seleccionado.'}

═══ CÓMO RESPONDES ═══
- En español de LatAm, de tú, breve y directo. Dos o tres frases y los pasos si
  hacen falta. Nada de parrafadas.
- Mira primero los datos de la cuenta. Si lo que pregunta tiene explicación ahí,
  dísela concreta: nombra su canal, su formulario o su plan por su nombre.
- Los pasos van con la ruta real de la app: "Marketing - Fuentes - Configurar
  canales". No te inventes menús ni botones que no estén en lo que sabes.
- Donde leas [POR COMPLETAR: ...] es que NO tenemos esa información escrita.
  Trátalo como algo que no sabes: no improvises precios, plazos ni políticas.
  Dilo con naturalidad y ofrece pasarlo al equipo. Nunca menciones el marcador
  ni digas que "está por completar": eso es una nota interna nuestra.
- Si no sabes algo o no está en tu conocimiento, DILO. No supongas cómo funciona
  una parte del producto que no conoces: es peor un dato inventado que un "no lo
  sé, te paso con el equipo".
- No prometas plazos, precios distintos a los que sabes, ni funciones futuras.
- Nunca pidas contraseñas ni datos de tarjeta.

═══ CUANDO NO PUEDAS RESOLVERLO ═══
Si es un fallo del producto, algo que requiere que alguien mire por dentro, o
sencillamente no lo sabes, ofrécele pasar el caso al equipo. Si acepta —o si te
lo pide directamente— termina tu mensaje con este bloque, en una línea aparte:

[TICKET: asunto corto | qué le pasa, con el detalle técnico que ya sabes]

El bloque no se le muestra: la app lo convierte en un ticket. Escribe antes, con
tus palabras, que ya lo estás pasando al equipo y que le responderán por correo.
No uses el bloque para dudas que sí puedes resolver.`;
}

async function llamarClaude(system, mensajes) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 900, system, messages: mensajes }),
  });
  if (!res.ok) throw new Error('Claude ' + res.status);
  const data = await res.json();
  return data.content?.find(b => b.type === 'text')?.text || '';
}

// El bloque de ticket se saca del texto ANTES de enseñarlo. Si se colara, el
// usuario leería instrucciones internas en mitad de la respuesta.
function extraerTicket(texto) {
  const m = String(texto || '').match(/\[TICKET:\s*([^\]|]+?)\s*\|\s*([\s\S]*?)\]/);
  const limpio = String(texto || '').replace(/\[TICKET:[\s\S]*?\]/g, '').trim();
  if (!m) return { limpio, ticket: null };
  return { limpio, ticket: { asunto: m[1].trim().slice(0, 120), detalle: m[2].trim().slice(0, 2000) } };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST' && req.method !== 'GET') return jsonResp({ error: 'Método no permitido' }, 405);

  try {
    const payload = await getPayload(req);
    if (!payload?.sub) return jsonResp({ error: 'No autorizado' }, 401);

    // ── Mis casos ─────────────────────────────────────────────────────────
    // Abrir un ticket y no volver a saber nada es lo que hace que la gente
    // escriba tres veces lo mismo. Aquí cada quien ve el estado de los suyos.
    if (req.method === 'GET') {
      let duenoId = payload.sub;
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(payload.sub)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
        const tw = r.ok ? (await r.json())?.[0] : null;
        if (tw?.owner_user_id) duenoId = tw.owner_user_id;
      } catch {}
      const rows = await fetch(
        `${SUPABASE_URL}/rest/v1/support_tickets?user_id=eq.${encodeURIComponent(duenoId)}` +
        `&select=id,asunto,detalle,estado,respuesta,created_at,updated_at&order=created_at.desc&limit=30`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      return jsonResp({ tickets: rows || [] });
    }

    if (!ANTHROPIC_KEY) return jsonResp({ error: 'El asistente no está disponible ahora mismo.' }, 503);

    const actorId = payload.sub;
    const email = payload.email || payload.primary_email_address || null;

    // El soporte es de la persona que escribe, no de la cuenta del dueño: si es
    // miembro de un equipo, su radiografía es la del espacio donde trabaja.
    let userId = actorId;
    let esMiembro = false;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(actorId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
      const tw = r.ok ? (await r.json())?.[0] : null;
      if (tw?.owner_user_id) { userId = tw.owner_user_id; esMiembro = true; }
    } catch {}

    const body = await req.json().catch(() => ({}));
    const texto = String(body.mensaje || '').trim().slice(0, 2000);
    const historial = Array.isArray(body.historial) ? body.historial.slice(-TOPE_MENSAJES) : [];
    if (!texto) return jsonResp({ error: 'Escribe tu pregunta' }, 400);

    const radio = await radiografia(userId, body.plan);
    if (esMiembro) radio.nota = 'Quien escribe es un MIEMBRO del equipo, no el dueño de la cuenta.';

    const mensajes = [
      ...historial
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
      { role: 'user', content: texto },
    ];

    let bruto;
    try {
      bruto = await llamarClaude(prompt(radio, body.contexto || {}), mensajes);
    } catch (e) {
      return jsonResp({ error: 'El asistente no pudo responder ahora mismo. Reintenta en un momento.' }, 502);
    }

    const { limpio, ticket } = extraerTicket(bruto);
    let ticketId = null;

    if (ticket) {
      // El ticket se crea con la radiografía dentro: quien lo atienda no
      // necesita pedirle nada al usuario para empezar a mirar.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
        method: 'POST', headers: sb(),
        body: JSON.stringify({
          user_id: userId, email, plan: body.plan || null,
          asunto: ticket.asunto, detalle: ticket.detalle,
          contexto: { ...radio, seccion: body.contexto?.seccion || null, escribe: actorId },
        }),
      }).catch(() => null);
      const fila = res && res.ok ? (await res.json().catch(() => []))?.[0] : null;
      ticketId = fila?.id || null;
    }

    return jsonResp({
      respuesta: limpio || 'No supe qué responder. ¿Puedes contármelo de otra forma?',
      // Si el modelo pidió ticket y no se pudo crear, se dice: prometer que el
      // equipo lo verá cuando no se guardó es la peor forma de fallar aquí.
      ticket: ticket ? { creado: !!ticketId, id: ticketId } : null,
    });
  } catch (e) {
    return jsonResp({ error: 'Error en el soporte: ' + (e?.message || 'desconocido') }, 500);
  }
}
