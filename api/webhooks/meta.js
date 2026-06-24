// Webhook universal para Meta: WhatsApp, Messenger, Instagram DMs
// GET  → verificación de webhook por Meta
// POST → mensajes entrantes

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function sb() {
  return { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' };
}

// ── Sistema de prompts para el agente ────────────────────────────────────────
function buildSystemPrompt(agent, capturedData) {
  const faqs = (agent.faqs || []).map(f => `P: ${f.q}\nR: ${f.a}`).join('\n\n');
  const captured = Object.entries(capturedData || {})
    .filter(([,v]) => v)
    .map(([k,v]) => `${k}: ${v}`)
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
- Para conseguir su contacto (${(agent.capture_fields || ['nombre','celular']).join(', ')}), hazlo dentro del flujo natural, no como formulario
- Si alguien quiere hablar con una persona real, responde: "${agent.escalate_phrase || 'Claro, en un momento te comunico con un asesor. ¿Me das un segundo?'}" y en ese caso incluye [ESCALAR] al final de tu mensaje
- Nunca seas agresivo ni insistente con la venta

DATOS CAPTURADOS HASTA AHORA:
${captured}

Cuando detectes nombre o dato de contacto nuevo en la conversación, incluye al final de tu respuesta (invisible para el usuario):
[CAPTURA: {"nombre": "...", "celular": "...", "email": "...", "interes": "..."}]
Solo incluye los campos que tengas. Omite este bloque si no hay datos nuevos.`;
}

// ── Llamada a Claude ──────────────────────────────────────────────────────────
async function callClaude(systemPrompt, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ── Envío de respuesta por canal ──────────────────────────────────────────────
async function sendReply(channel, connection, contactId, text) {
  const cleanText = text
    .replace(/\[CAPTURA:.*?\]/gs, '')
    .replace(/\[ESCALAR\]/g, '')
    .trim();

  try {
    if (channel === 'whatsapp') {
      await fetch(`https://graph.facebook.com/v19.0/${connection.external_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${connection.access_token}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: contactId, type: 'text', text: { body: cleanText } }),
      });
    } else {
      // Messenger y Instagram usan el mismo endpoint
      await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${connection.access_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: contactId }, message: { text: cleanText } }),
      });
    }
  } catch(e) { console.error('sendReply error', e); }
}

// ── Auto-creación de lead ─────────────────────────────────────────────────────
async function upsertLead(userId, clientId, conv, captureData) {
  const hasContact = captureData.nombre || captureData.celular || captureData.email;
  if (!hasContact) return null;

  // Si la conversación ya tiene lead vinculado, actualiza
  if (conv.lead_id) {
    const update = {};
    if (captureData.nombre && !conv.contact_name) update.name = captureData.nombre;
    if (captureData.celular && !conv.contact_phone) update.phone = captureData.celular;
    if (captureData.email && !conv.contact_email) update.email = captureData.email;
    if (Object.keys(update).length > 0) {
      update.updated_at = new Date().toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${conv.lead_id}`, {
        method: 'PATCH', headers: sb(), body: JSON.stringify(update),
      });
    }
    return conv.lead_id;
  }

  // Crear nuevo lead
  const leadPayload = {
    user_id: userId,
    client_id: clientId || null,
    name: captureData.nombre || conv.contact_name || `Contacto ${conv.channel}`,
    phone: captureData.celular || conv.contact_phone || null,
    email: captureData.email || conv.contact_email || null,
    stage: 'nuevo',
    stage_position: Date.now(),
    source: conv.channel,
    notes: captureData.interes ? `Interés: ${captureData.interes}` : null,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST', headers: sb(), body: JSON.stringify(leadPayload),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const leadId = rows?.[0]?.id;

  if (leadId) {
    // Vincula lead a conversación
    await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
      method: 'PATCH', headers: sb(),
      body: JSON.stringify({
        lead_id: leadId,
        contact_name: captureData.nombre || conv.contact_name,
        contact_phone: captureData.celular || conv.contact_phone,
        contact_email: captureData.email || conv.contact_email,
      }),
    });
    // Actividad de creación
    await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({
        lead_id: leadId, user_id: userId,
        type: 'creacion',
        content: `Lead capturado automáticamente desde ${conv.channel}`,
        metadata: { conversation_id: conv.id, channel: conv.channel },
      }),
    });
  }
  return leadId;
}

// ── Proceso principal de mensaje ──────────────────────────────────────────────
async function processMessage({ channel, externalId, contactId, contactName, text, metaMessageId }) {
  if (!text || !externalId || !contactId) return;

  // 1. Buscar channel_connection
  const connRes = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?channel=eq.${channel}&external_id=eq.${encodeURIComponent(externalId)}&is_active=eq.true&select=*`,
    { headers: sb() }
  );
  const connRows = await connRes.json();
  const connection = connRows?.[0];
  if (!connection) return; // canal no conectado a ningún agente

  // 2. Cargar agente
  const agentRes = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${connection.agent_id}&is_active=eq.true&select=*`,
    { headers: sb() }
  );
  const agentRows = await agentRes.json();
  const agent = agentRows?.[0];
  if (!agent) return;

  // 3. Upsert conversación
  const convUpsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?connection_id=eq.${connection.id}&contact_id=eq.${encodeURIComponent(contactId)}&select=*`,
    { headers: sb() }
  );
  const convRows = await convUpsertRes.json();
  let conv = convRows?.[0];

  if (!conv) {
    const createRes = await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations`, {
      method: 'POST',
      headers: sb(),
      body: JSON.stringify({
        user_id: connection.user_id,
        agent_id: connection.agent_id,
        connection_id: connection.id,
        channel,
        contact_id: contactId,
        contact_name: contactName || null,
        status: 'bot',
        unread_count: 1,
      }),
    });
    const created = await createRes.json();
    conv = created?.[0];
  } else {
    // Si está escalado a humano, no responde el bot
    if (conv.status === 'human') {
      // Solo guarda el mensaje entrante
      await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
        method: 'POST', headers: sb(),
        body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: text, meta_message_id: metaMessageId }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({ last_message: text.slice(0, 200), last_message_at: new Date().toISOString(), unread_count: (conv.unread_count || 0) + 1 }),
      });
      return;
    }
  }
  if (!conv) return;

  // 4. Guardar mensaje del usuario (dedup por meta_message_id)
  const msgRes = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { ...sb(), 'Prefer': 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: text, meta_message_id: metaMessageId }),
  });
  const msgRows = await msgRes.json();
  if (!msgRows?.[0]) return; // duplicado, ya procesado

  // 5. Cargar últimos 12 mensajes para contexto
  const histRes = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${conv.id}&select=role,content&order=created_at.desc&limit=12`,
    { headers: sb() }
  );
  const histRows = (await histRes.json() || []).reverse();
  const messages = histRows.map(m => ({ role: m.role, content: m.content }));

  // 6. Extraer datos capturados de mensajes anteriores del agente para el system prompt
  const capturedData = extractCapturedData(histRows.filter(m => m.role === 'assistant').map(m => m.content).join('\n'));

  // 7. Llamar a Claude
  const systemPrompt = buildSystemPrompt(agent, { ...capturedData, ...(contactName ? { nombre: conv.contact_name } : {}) });
  const reply = await callClaude(systemPrompt, messages);

  // 8. Guardar respuesta
  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: sb(),
    body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: reply }),
  });

  // 9. Actualizar conversación
  const needsEscalation = reply.includes('[ESCALAR]');
  await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
    method: 'PATCH', headers: sb(),
    body: JSON.stringify({
      last_message: reply.replace(/\[CAPTURA:.*?\]/gs, '').replace(/\[ESCALAR\]/g, '').trim().slice(0, 200),
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      ...(needsEscalation ? { status: 'human' } : {}),
    }),
  });

  // 10. Detectar y guardar datos capturados → auto-crear lead
  const newCapture = extractCapturedData(reply);
  if (Object.values(newCapture).some(v => v)) {
    await upsertLead(connection.user_id, agent.client_id, conv, newCapture);
  }

  // 11. Enviar respuesta al usuario por Meta API
  await sendReply(channel, connection, contactId, reply);
}

function extractCapturedData(text) {
  const match = text.match(/\[CAPTURA:\s*(\{.*?\})\]/s);
  if (!match) return {};
  try { return JSON.parse(match[1]); } catch { return {}; }
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req) {
  // Verificación de webhook por Meta
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response('Bad request', { status: 400 }); }

  // Responder 200 a Meta inmediatamente para evitar reintentos
  const process = (async () => {
    try {
      if (body.object === 'page') {
        // Messenger
        for (const entry of body.entry || []) {
          for (const msg of entry.messaging || []) {
            if (msg.message && !msg.message.is_echo) {
              await processMessage({
                channel: 'messenger',
                externalId: String(entry.id),
                contactId: String(msg.sender.id),
                text: msg.message.text || '',
                metaMessageId: msg.message.mid,
              });
            }
          }
        }
      } else if (body.object === 'instagram') {
        // Instagram DMs
        for (const entry of body.entry || []) {
          for (const msg of (entry.messaging || [])) {
            if (msg.message && !msg.message.is_echo) {
              await processMessage({
                channel: 'instagram',
                externalId: String(entry.id),
                contactId: String(msg.sender.id),
                text: msg.message.text || '',
                metaMessageId: msg.message.mid,
              });
            }
          }
        }
      } else if (body.object === 'whatsapp_business_account') {
        // WhatsApp
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field !== 'messages') continue;
            const val = change.value;
            const phoneNumberId = val.metadata?.phone_number_id;
            for (const msg of val.messages || []) {
              if (msg.type !== 'text') continue;
              const contact = val.contacts?.find(c => c.wa_id === msg.from);
              await processMessage({
                channel: 'whatsapp',
                externalId: String(phoneNumberId),
                contactId: String(msg.from),
                contactName: contact?.profile?.name || null,
                text: msg.text?.body || '',
                metaMessageId: msg.id,
              });
            }
          }
        }
      }
    } catch(e) { console.error('webhook process error', e); }
  })();

  // En Edge Runtime, awaiteamos el proceso (no tenemos waitUntil sin Cloudflare)
  await process;

  return new Response('EVENT_RECEIVED', { status: 200 });
}
