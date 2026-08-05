// api/_inbox-engine.js
// Motor común del inbox: agente que contesta, captura de datos y entrada al
// pipeline. Lo usan los webhooks de Meta (WhatsApp, Messenger, Instagram) y el
// de TikTok, para que un canal nuevo no implique reescribir la conversación.
// El guion bajo evita que Vercel lo publique como endpoint.
//
// El envío al canal lo pone quien llama (cada plataforma tiene su API), así el
// motor no sabe nada de Graph ni de TikTok.

import { ensureCatalog, enqueueAutomations } from './_lead-intake.js';
import { getPolicy } from './_channel-policy.js';
import { asignarLead } from './_assign.js';
import { getRegla, bloqueDePrompt, extraerCalificacion, evaluar, aplicarVeredicto } from './_qualify.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

// En WhatsApp el identificador del contacto ES su número (E.164 sin el +). Si
// no se aprovecha, el comercial recibe el lead sin teléfono y no tiene por
// dónde llamarlo, que es justo lo que un negocio de WhatsApp necesita.
export function telefonoDelCanal(channel, contactId) {
  if (channel !== 'whatsapp') return null;
  const d = String(contactId || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15 ? '+' + d : null;
}

export function cleanForUser(text) {
  return String(text || '')
    .replace(/\[CAPTURA:.*?\]/gs, '')
    .replace(/\[ESCALAR\]/g, '')
    .replace(/\[CALIFICACION:.*?\]/gs, '')
    // Si la respuesta se cortó a mitad de un bloque, fuera igual
    .replace(/\[(CAPTURA|CALIFICACION|ESCALAR)\b[\s\S]*$/, '')
    .trim();
}

export function extractCapturedData(text) {
  const match = String(text || '').match(/\[CAPTURA:\s*(\{.*?\})\]/s);
  if (!match) return {};
  try { return JSON.parse(match[1]); } catch { return {}; }
}

export function buildSystemPrompt(agent, capturedData, reglaCalificacion = null) {
  const faqs = (agent.faqs || []).map(f => `P: ${f.q}\nR: ${f.a}`).join('\n\n');
  const captured = Object.entries(capturedData || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'Ninguno aún';

  return `Eres ${agent.name}. ${agent.persona || ''}

${agent.business_ctx || ''}

${faqs ? `PREGUNTAS FRECUENTES:\n${faqs}` : ''}

CÓMO DEBES COMPORTARTE:
- Habla como una persona real, cálida y natural. ${agent.tone === 'formal' ? 'Usa "usted".' : 'Usa "tú", sin exagerar la informalidad.'}
- Respuestas cortas (1-3 oraciones), como en una conversación de chat real
- Nunca uses listas de puntos ni numeraciones innecesarias
- No menciones que eres IA, bot ni asistente virtual. Si alguien pregunta directamente si eres IA o humano, responde con naturalidad sin confirmar ni negar, como haría alguien que quiere mantener la conversación
- Si no sabes algo, dilo con naturalidad y ofrece ayudar de otra forma
- Cuando alguien muestre interés genuino, busca conocer su nombre de forma natural en la conversación
- Para conseguir su contacto (${(agent.capture_fields || ['nombre', 'celular']).join(', ')}), hazlo dentro del flujo natural, no como formulario
- Si alguien quiere hablar con una persona real, responde: "${agent.escalate_phrase || 'Claro, en un momento te comunico con un asesor. ¿Me das un segundo?'}" y en ese caso incluye [ESCALAR] al final de tu mensaje
- Nunca seas agresivo ni insistente con la venta

DATOS CAPTURADOS HASTA AHORA:
${captured}

Cuando detectes nombre o dato de contacto nuevo en la conversación, incluye al final de tu respuesta (invisible para el usuario):
[CAPTURA: {"nombre": "...", "celular": "...", "email": "...", "interes": "..."}]
Solo incluye los campos que tengas. Omite este bloque si no hay datos nuevos.${bloqueDePrompt(reglaCalificacion)}`;
}

async function callClaude(systemPrompt, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      // Con la calificación activa el mensaje lleva dos bloques ocultos además
      // del texto; con 300 se truncaba a mitad y el bloque se le escapaba al
      // contacto.
      max_tokens: 700,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const data = await res.json();
  return data.content?.find(b => b.type === 'text')?.text || '';
}

// ── Entrada al pipeline ───────────────────────────────────────────────────────
// La regla del canal decide: 'manual' no crea nada (la conversación se queda en
// el inbox esperando decisión), 'on_contact' crea cuando hay nombre/teléfono/
// correo, y 'always' crea en cuanto llega el primer mensaje.
export async function upsertLeadFromConversation(userId, clientId, conv, captureData = {}, policy = null, esperarCalificacion = false) {
  const pol = policy || { mode: 'on_contact', stage: 'nuevo', tag: conv.channel };
  const hasContact = !!(captureData.nombre || captureData.celular || captureData.email);

  if (conv.lead_id) {
    const update = {};
    if (captureData.nombre && !conv.contact_name) update.name = captureData.nombre;
    if (captureData.celular && !conv.contact_phone) update.phone = captureData.celular;
    if (captureData.email && !conv.contact_email) update.email = captureData.email;
    if (Object.keys(update).length) {
      update.updated_at = new Date().toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${conv.lead_id}`, {
        method: 'PATCH', headers: sb(), body: JSON.stringify(update),
      });
    }
    return conv.lead_id;
  }

  if (pol.mode === 'manual') return null;
  if (pol.mode === 'on_contact' && !hasContact) return null;

  const channelTag = String(pol.tag || conv.channel || '').toLowerCase().slice(0, 30);
  const leadPayload = {
    user_id: userId,
    client_id: clientId || null,
    name: captureData.nombre || conv.contact_name || `Contacto ${conv.channel}`,
    phone: captureData.celular || conv.contact_phone || telefonoDelCanal(conv.channel, conv.contact_id) || null,
    email: captureData.email || conv.contact_email || null,
    stage: pol.stage || 'nuevo',
    stage_position: Date.now(),
    source: conv.channel,
    tags: channelTag.length >= 2 ? [channelTag] : [],
    notes: captureData.interes ? `Interés: ${captureData.interes}` : null,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST', headers: sb(), body: JSON.stringify(leadPayload),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const leadId = rows?.[0]?.id;
  if (!leadId) return null;

  await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
    method: 'PATCH', headers: sb(),
    body: JSON.stringify({
      lead_id: leadId,
      contact_name: captureData.nombre || conv.contact_name,
      contact_phone: captureData.celular || conv.contact_phone,
      contact_email: captureData.email || conv.contact_email,
    }),
  });
  await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
    method: 'POST', headers: sb(),
    body: JSON.stringify({
      lead_id: leadId, user_id: userId,
      type: 'creacion',
      content: `Lead capturado automáticamente desde ${conv.channel}`,
      metadata: { conversation_id: conv.id, channel: conv.channel },
    }),
  });
  // Reparto entre comerciales según la regla de la fuente.
  // Si el agente califica, el reparto espera al veredicto: repartir antes
  // significaría darle tarea y correo a un comercial por alguien que todavía
  // no sabemos si sirve — justo lo que la calificación existe para evitar.
  if (!esperarCalificacion) await asignarLead(userId, rows[0], conv.channel).catch(() => {});
  if (leadPayload.tags.length) await ensureCatalog(userId, clientId || null, leadPayload.tags, channelTag).catch(() => {});
  await enqueueAutomations(userId, rows[0], 'lead_created').catch(() => {});
  if (leadPayload.tags.length) await enqueueAutomations(userId, rows[0], 'tag_added', leadPayload.tags).catch(() => {});
  return leadId;
}

// ── Mensaje entrante ──────────────────────────────────────────────────────────
// send: (connection, contactId, texto) => Promise — lo pone el webhook del canal
export async function processIncoming({ channel, externalId, contactId, contactName, text, providerMessageId, send }) {
  if (!text || !externalId || !contactId) return { ok: false, reason: 'payload incompleto' };

  const connection = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?channel=eq.${encodeURIComponent(channel)}&external_id=eq.${encodeURIComponent(externalId)}&is_active=eq.true&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).catch(() => null);
  if (!connection) return { ok: false, reason: 'canal no conectado' };

  const agent = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${connection.agent_id}&is_active=eq.true&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).catch(() => null);
  if (!agent) return { ok: false, reason: 'agente inactivo' };

  const policy = await getPolicy(connection.user_id, channel);
  const reglaCal = await getRegla(connection.user_id, connection.agent_id);

  let conv = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?connection_id=eq.${connection.id}&contact_id=eq.${encodeURIComponent(contactId)}&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).catch(() => null);

  if (!conv) {
    conv = await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({
        user_id: connection.user_id,
        agent_id: connection.agent_id,
        connection_id: connection.id,
        channel,
        contact_id: contactId,
        contact_name: contactName || null,
        contact_phone: telefonoDelCanal(channel, contactId),
        status: 'bot',
        unread_count: 1,
      }),
    }).then(r => r.json()).then(r => r?.[0]).catch(() => null);
    if (!conv) return { ok: false, reason: 'no se pudo crear la conversación' };
    // Regla "siempre": el lead nace con la conversación, sin esperar datos
    if (policy.mode === 'always') {
      const leadId = await upsertLeadFromConversation(connection.user_id, agent.client_id, conv, {}, policy, reglaCal.activo).catch(() => null);
      if (leadId) conv.lead_id = leadId;
    }
  } else if (conv.status === 'human') {
    // Escalado a una persona: el bot no contesta, solo se guarda el mensaje
    await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: text, meta_message_id: providerMessageId }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
      method: 'PATCH', headers: sb(),
      body: JSON.stringify({
        last_message: text.slice(0, 200),
        last_message_at: new Date().toISOString(),
        unread_count: (conv.unread_count || 0) + 1,
      }),
    });
    return { ok: true, escalated: true, conversationId: conv.id };
  }

  const msgRows = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { ...sb(), Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: text, meta_message_id: providerMessageId }),
  }).then(r => r.json()).catch(() => null);
  if (!msgRows?.[0]) return { ok: true, duplicate: true, conversationId: conv.id };

  const hist = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${conv.id}&select=role,content&order=created_at.desc&limit=12`,
    { headers: sb() }
  ).then(r => r.json()).then(r => (r || []).reverse()).catch(() => []);
  const messages = hist.map(m => ({ role: m.role, content: m.content }));

  const capturedData = extractCapturedData(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n'));
  const reply = await callClaude(
    buildSystemPrompt(agent, { ...capturedData, ...(conv.contact_name ? { nombre: conv.contact_name } : {}) }, reglaCal),
    messages
  );

  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: sb(),
    body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: reply }),
  });

  // Las respuestas se acumulan: cada mensaje del agente aporta las nuevas y las
  // anteriores siguen valiendo.
  const respuestas = {
    ...extraerCalificacion(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n')),
    ...extraerCalificacion(reply),
  };
  const veredicto = evaluar(reglaCal, respuestas);

  // Pedir un humano siempre manda: si alguien lo pide, lo pide. Y un lead que
  // califica pasa al comercial, que es justo el objetivo de calificar.
  const needsEscalation = reply.includes('[ESCALAR]')
    || (veredicto.estado === 'calificado' && reglaCal.al_calificar.escalar);
  await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
    method: 'PATCH', headers: sb(),
    body: JSON.stringify({
      last_message: cleanForUser(reply).slice(0, 200),
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      ...(needsEscalation ? { status: 'human' } : {}),
    }),
  });

  const newCapture = extractCapturedData(reply);
  let leadId = conv.lead_id || null;
  // Un lead que califica entra al pipeline aunque la regla del canal fuese
  // 'manual': no tiene sentido calificarlo y dejarlo fuera del CRM.
  const politicaEfectiva = veredicto.estado === 'calificado'
    ? { ...policy, mode: 'always', stage: reglaCal.al_calificar.etapa || policy.stage }
    : policy;
  if (Object.values(newCapture).some(v => v) || veredicto.estado === 'calificado') {
    leadId = await upsertLeadFromConversation(
      connection.user_id, agent.client_id, conv, newCapture, politicaEfectiva,
      reglaCal.activo && veredicto.estado !== 'calificado'
    ).catch(() => leadId);
  }

  if (reglaCal.activo && leadId && (veredicto.estado === 'calificado' || veredicto.estado === 'descartado')) {
    const lead = await aplicarVeredicto({
      userId: connection.user_id, leadId, regla: reglaCal, veredicto, respuestas, canal: channel,
    });
    // Si califica y todavía no tiene dueño, se reparte ahora: el aviso al
    // comercial es lo que hace que la calificación sirva de algo.
    if (veredicto.estado === 'calificado' && lead && !lead.assigned_to) {
      await asignarLead(connection.user_id, lead, channel).catch(() => {});
    }
  }

  if (typeof send === 'function') {
    try { await send(connection, contactId, cleanForUser(reply)); } catch (e) { console.error('send error', e); }
  }

  return { ok: true, conversationId: conv.id, leadId, reply: cleanForUser(reply), escalated: needsEscalation, calificacion: veredicto };
}
