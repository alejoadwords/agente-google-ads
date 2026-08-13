// api/_inbox-engine.js
// Motor común del inbox: agente que contesta, captura de datos y entrada al
// pipeline. Lo usan los webhooks de Meta (WhatsApp, Messenger, Instagram) y el
// de TikTok, para que un canal nuevo no implique reescribir la conversación.
// El guion bajo evita que Vercel lo publique como endpoint.
//
// El envío al canal lo pone quien llama (cada plataforma tiene su API), así el
// motor no sabe nada de Graph ni de TikTok.

import { ensureCatalog, enqueueAutomations, pipelinePrincipal } from './_lead-intake.js';
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

// ── Inventario del cliente en el contexto ───────────────────────────────────
// La regla de "no inventes" solo sirve si el agente tiene donde mirar. Aqui se
// le pasan las propiedades que encajan con lo que YA sabe de la conversacion.
// No se le pasan las 485: seria caro, lento y le costaria mas encontrar la
// buena. Es un filtro, no una busqueda semantica: deterministico y auditable.
const TOPE_PROPIEDADES = 25;

export async function propiedadesParaPrompt(userId, clientId, pistas = {}) {
  if (!userId) return { lineas: [], total: 0 };
  let q = `${SUPABASE_URL}/rest/v1/client_properties?user_id=eq.${encodeURIComponent(userId)}` +
    (clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null') +
    `&select=codigo,operacion,tipo,ciudad,barrio,habitaciones,banos,precio,url&limit=${TOPE_PROPIEDADES}`;

  // La operacion sale del enrutado: si el agente ya dedujo 'arriendo', no tiene
  // sentido ofrecerle ventas. 'Arriendo/Venta' vale para las dos.
  if (pistas.operacion) {
    const op = String(pistas.operacion).toLowerCase();
    if (op.includes('arriend') || op.includes('alquil')) q += '&operacion=in.(Arriendo,"Arriendo/Venta")';
    else if (op.includes('vent') || op.includes('compr')) q += '&operacion=in.(Venta,"Arriendo/Venta")';
  }
  if (pistas.ciudad) q += `&ciudad=ilike.*${encodeURIComponent(pistas.ciudad)}*`;
  if (pistas.barrio) q += `&barrio=ilike.*${encodeURIComponent(pistas.barrio)}*`;
  if (pistas.presupuesto) q += `&precio=lte.${Math.round(pistas.presupuesto * 1.15)}`;  // 15% de margen
  q += '&order=precio.asc';

  try {
    const filas = await fetch(q, { headers: sb() }).then(r => (r.ok ? r.json() : [])).catch(() => []);
    const lineas = (filas || []).map(f => [
      f.codigo,
      f.operacion,
      f.tipo,
      [f.barrio, f.ciudad].filter(Boolean).join(', '),
      f.habitaciones ? f.habitaciones + ' hab' : null,
      f.banos ? f.banos + ' baños' : null,
      f.precio ? '$' + Number(f.precio).toLocaleString('es-CO') : 'precio a confirmar',
    ].filter(Boolean).join(' · '));
    return { lineas, total: lineas.length };
  } catch { return { lineas: [], total: 0 }; }
}

export function buildSystemPrompt(agent, capturedData, reglaCalificacion = null, propiedades = null) {
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
- Nunca uses listas de puntos ni numeraciones innecesarias, salvo al enumerar opciones concretas del inventario
- Para resaltar usa UN solo asterisco alrededor de la palabra, que es como se pone negrita en WhatsApp. Con dos asteriscos el cliente ve los asteriscos
- No menciones que eres IA, bot ni asistente virtual. Si alguien pregunta directamente si eres IA o humano, responde con naturalidad sin confirmar ni negar, como haría alguien que quiere mantener la conversación
- Si no sabes algo, dilo con naturalidad y ofrece ayudar de otra forma
- Cuando alguien muestre interés genuino, busca conocer su nombre de forma natural en la conversación
- Para conseguir su contacto (${(agent.capture_fields || ['nombre', 'celular']).join(', ')}), hazlo dentro del flujo natural, no como formulario
- Si alguien quiere hablar con una persona real, responde: "${agent.escalate_phrase || 'Claro, en un momento te comunico con un asesor. ¿Me das un segundo?'}" y en ese caso incluye [ESCALAR] al final de tu mensaje
- Nunca seas agresivo ni insistente con la venta

LO QUE NO PUEDES INVENTAR — ESTO ES INNEGOCIABLE:
- Solo puedes afirmar precios, disponibilidad, direcciones, medidas, plazos y condiciones si aparecen literalmente aqui arriba, en tu contexto o en las preguntas frecuentes
- Si no aparecen, NO los estimes, NO des rangos, NO digas lo que suele costar ni lo que normalmente hay. Tampoco menciones nombres de productos, inmuebles, proyectos o sectores concretos que no esten en tu contexto
- Cuando te pregunten algo asi, di con naturalidad que eso te lo confirma un asesor y ofrece pasarle la conversacion. En ese caso incluye [ESCALAR] al final de tu mensaje
- Puedes hablar de lo general que si este en tu contexto, y puedes preguntar lo que necesites para entender que busca la persona
- Vale mucho mas decir "eso te lo confirmo con un asesor" que dar un dato que luego resulte falso: un precio inventado lo tiene que desmentir despues una persona

${propiedades && propiedades.lineas.length ? `LO QUE HAY DISPONIBLE AHORA MISMO (${propiedades.total} opciones que encajan con lo que te dijeron):
${propiedades.lineas.join('\n')}

Sobre esta lista:
- Es lo unico que puedes ofrecer. Si te preguntan por algo que no esta aqui, no lo inventes: dilo y ofrece pasar la conversacion a un asesor
- Menciona como mucho tres opciones por mensaje y pregunta cual le interesa
- Cada opcion va en SU PROPIA LINEA, no seguidas dentro de un parrafo. Una linea de presentacion, las opciones debajo separadas por salto de linea, y la pregunta al final. Asi se lee de un vistazo en el movil
- En cada linea: el barrio, las habitaciones, el precio y el codigo entre parentesis
- Los precios son los de la lista, sin redondear ni estimar` : ''}

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
export async function upsertLeadFromConversation(userId, clientId, conv, captureData = {}, policy = null, esperarCalificacion = false, pipelineId = null) {
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
    // Sin pipeline el lead no se pinta en ninguna columna del tablero, que
    // filtra por pipeline. Se usa el del canal o, si no, el principal de su
    // cliente.
    pipeline_id: pipelineId || await pipelinePrincipal(userId, clientId || null),
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
// resolverNombre: (connection, contactId) => Promise<string|null> — lo pone el
// webhook del canal. Meta no manda el nombre en el evento, solo el id, así que
// sin esto el lead entra como "Contacto messenger" y el comercial recibe una
// ficha sin nombre.
export async function processIncoming({ channel, externalId, contactId, contactName, text, providerMessageId, send, resolverNombre }) {
  if (!text || !externalId || !contactId) return { ok: false, reason: 'payload incompleto' };

  const connection = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?channel=eq.${encodeURIComponent(channel)}&external_id=eq.${encodeURIComponent(externalId)}&is_active=eq.true&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).catch(() => null);
  if (!connection) return { ok: false, reason: 'canal no conectado' };

  // Un canal puede atenderse de dos formas: con un agente que contesta solo, o
  // a mano desde el inbox. Sin agente —porque el canal se conecto sin uno o
  // porque esta desactivado— NO se descarta el mensaje: se guarda y se marca la
  // conversacion como humana. Antes se devolvia aqui mismo y el mensaje del
  // cliente se perdia entero: ni conversacion, ni aviso, ni rastro.
  const agent = connection.agent_id ? await fetch(
    `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${connection.agent_id}&is_active=eq.true&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).catch(() => null) : null;
  const aMano = !agent;

  // El cliente lo manda el CANAL. El del agente queda de respaldo para los
  // canales conectados antes de que existiera esta columna.
  const clienteDelCanal = connection.client_id || (agent ? agent.client_id : null) || null;

  const policy = await getPolicy(connection.user_id, channel);
  const reglaCal = connection.agent_id
    ? await getRegla(connection.user_id, connection.agent_id)
    : { activo: false };

  let conv = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?connection_id=eq.${connection.id}&contact_id=eq.${encodeURIComponent(contactId)}&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).catch(() => null);

  if (!conv && !contactName && typeof resolverNombre === 'function') {
    contactName = await resolverNombre(connection, contactId).catch(() => null);
  }

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
        status: aMano ? 'human' : 'bot',
        last_inbound_at: new Date().toISOString(),
        unread_count: 1,
      }),
    }).then(r => r.json()).then(r => r?.[0]).catch(() => null);
    if (!conv) return { ok: false, reason: 'no se pudo crear la conversación' };
    // Regla "siempre": el lead nace con la conversación, sin esperar datos
    if (policy.mode === 'always') {
      const leadId = await upsertLeadFromConversation(connection.user_id, clienteDelCanal, conv, {}, policy,
        reglaCal.activo, connection.pipeline_id || null).catch(() => null);
      if (leadId) conv.lead_id = leadId;
    }
  }

  // A mano, o ya escalado a una persona: se guarda el mensaje y ahi acaba. El
  // comercial responde desde el inbox.
  if (aMano || conv.status === 'human') {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: text, meta_message_id: providerMessageId }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
      method: 'PATCH', headers: sb(),
      body: JSON.stringify({
        last_message: text.slice(0, 200),
        last_message_at: new Date().toISOString(),
        // La ventana de 24h se cuenta desde el mensaje del CLIENTE, no desde
        // el último mensaje a secas: si no, escribirle nosotros la reiniciaría.
        last_inbound_at: new Date().toISOString(),
        unread_count: (conv.unread_count || 0) + 1,
      }),
    });
    return { ok: true, escalated: true, manual: aMano, conversationId: conv.id };
  }

  // Conversaciones creadas antes de tener el nombre: se rellena al vuelo
  if (conv && !conv.contact_name && typeof resolverNombre === 'function') {
    const n = await resolverNombre(connection, contactId).catch(() => null);
    if (n) {
      conv.contact_name = n;
      await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
        method: 'PATCH', headers: sb(), body: JSON.stringify({ contact_name: n }),
      }).catch(() => {});
    }
  }

  const msgRows = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { ...sb(), Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: text, meta_message_id: providerMessageId }),
  }).then(r => r.json()).catch(() => null);
  if (!msgRows?.[0]) return { ok: true, duplicate: true, conversationId: conv.id };

  // La ventana de 24h se reinicia AQUI, con el mensaje del cliente. Sin esto,
  // una conversación atendida por el agente parecería caducada aunque el
  // cliente acabara de escribir.
  await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
    method: 'PATCH', headers: sb(),
    body: JSON.stringify({ last_inbound_at: new Date().toISOString() }),
  }).catch(() => {});

  const hist = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${conv.id}&select=role,content&order=created_at.desc&limit=12`,
    { headers: sb() }
  ).then(r => r.json()).then(r => (r || []).reverse()).catch(() => []);
  const messages = hist.map(m => ({ role: m.role, content: m.content }));

  const capturedData = extractCapturedData(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n'));
  // Pistas: lo que el agente ya dedujo. La operacion sale del enrutado; el resto,
  // de lo que haya capturado. Sin pistas se le pasan las primeras del inventario.
  const previas = extraerCalificacion(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n'));
  const inventario = await propiedadesParaPrompt(connection.user_id, clienteDelCanal, {
    operacion: previas._ruta || null,
    ciudad: capturedData.ciudad || null,
    barrio: capturedData.zona || capturedData.barrio || null,
    presupuesto: Number(String(capturedData.presupuesto || '').replace(/[^\d]/g, '')) || null,
  }).catch(() => ({ lineas: [], total: 0 }));

  const reply = await callClaude(
    buildSystemPrompt(agent, { ...capturedData, ...(conv.contact_name ? { nombre: conv.contact_name } : {}) }, reglaCal, inventario),
    messages
  );

  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: sb(),
    // OJO: se guarda la respuesta EN BRUTO, con sus bloques ocultos. No es
    // descuido: el motor relee esos bloques del historial para acumular lo
    // capturado y lo calificado entre mensajes. Limpiar aquí haría que la
    // conversación se quedara 'pendiente' para siempre. Se limpia al MOSTRAR,
    // en el inbox.
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
      // last_inbound_at NO se toca aquí: esto es nuestra respuesta. Se fijó al
    // guardar el mensaje del cliente, unas líneas más arriba.
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
      connection.user_id, clienteDelCanal, conv, newCapture, politicaEfectiva,
      reglaCal.activo && veredicto.estado !== 'calificado',
      connection.pipeline_id || null
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
