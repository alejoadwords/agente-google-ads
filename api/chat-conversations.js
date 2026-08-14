export const config = { runtime: 'edge' };

import { upsertLeadFromConversation, sugerirRespuesta } from './_inbox-engine.js';
import { getPolicy } from './_channel-policy.js';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
function sbHeaders() {
  return { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' };
}
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g,'+').replace(/_/g,'/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Quién escribe de verdad. Se guarda ANTES de resolver miembro→dueño: si no,
  // todas las notas del equipo aparecerían firmadas por el dueño de la cuenta.
  const actorId = userId;
  let actorNombre = null;

  // Equipo: si soy miembro activo de un workspace, opero sobre los datos del dueño
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,member_name,member_email&limit=1`, { headers: sbHeaders() });
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) { userId = _tw.owner_user_id; actorNombre = _tw.member_name || _tw.member_email || null; }
  } catch {}


  const url = new URL(req.url);

  // GET ?report=1&from= — datos agregados para el informe de Conversaciones
  if (req.method === 'GET' && url.searchParams.get('report')) {
    const from = url.searchParams.get('from');
    let cq = `${SUPABASE_URL}/rest/v1/chat_conversations?user_id=eq.${userId}&select=id,channel,status,unread_count,created_at,last_message_at,lead_id&order=created_at.desc&limit=1000`;
    if (from) cq += `&created_at=gte.${encodeURIComponent(from)}`;
    const convs = await fetch(cq, { headers: sbHeaders() }).then(r => r.ok ? r.json() : []).catch(() => []);

    // Mensajes de esas conversaciones, para medir el tiempo de primera respuesta
    let msgs = [];
    const ids = (convs || []).map(c => c.id).slice(0, 300);
    if (ids.length) {
      const mq = `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=in.(${ids.join(',')})` +
        `&select=conversation_id,role,created_at&order=created_at.asc&limit=5000`;
      msgs = await fetch(mq, { headers: sbHeaders() }).then(r => r.ok ? r.json() : []).catch(() => []);
    }
    const chans = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${userId}&select=channel,channel_name,is_active`,
      { headers: sbHeaders() }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    return jsonResp({ conversations: convs || [], messages: msgs || [], channels: chans || [] });
  }

  // GET — list conversations
  if (req.method === 'GET' && !url.searchParams.get('messages')) {
    const status = url.searchParams.get('status');
    const channel = url.searchParams.get('channel');
    const agentId = url.searchParams.get('agent_id');
    const leadId = url.searchParams.get('lead_id');
    let query = `${SUPABASE_URL}/rest/v1/chat_conversations?user_id=eq.${userId}&select=*&order=last_message_at.desc&limit=50`;
    if (status) query += `&status=eq.${encodeURIComponent(status)}`;
    if (channel) query += `&channel=eq.${encodeURIComponent(channel)}`;
    if (agentId) query += `&agent_id=eq.${encodeURIComponent(agentId)}`;
    if (leadId) query += `&lead_id=eq.${encodeURIComponent(leadId)}`;
    const res = await fetch(query, { headers: sbHeaders() });
    const rows = await res.json();
    return jsonResp({ conversations: rows || [] });
  }

  // GET — messages for a conversation
  if (req.method === 'GET' && url.searchParams.get('messages')) {
    const convId = url.searchParams.get('messages');
    // Verify ownership
    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${convId}&user_id=eq.${userId}&select=id`,
      { headers: sbHeaders() }
    );
    const ck = await check.json();
    if (!ck?.[0]) return jsonResp({ error: 'No autorizado' }, 403);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${convId}&select=*&order=created_at.asc`,
      { headers: sbHeaders() }
    );
    const rows = await res.json();

    // Las notas viajan aparte y el frontend las intercala por fecha. Si fallan,
    // el hilo se muestra igual: perder las notas no puede ocultar la conversación.
    const notas = await fetch(
      `${SUPABASE_URL}/rest/v1/conversation_notes?conversation_id=eq.${convId}&user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.asc`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);

    return jsonResp({ messages: rows || [], notas: notas || [] });
  }

  // POST ?action=nota — nota interna. No sale a ninguna parte: ni al cliente,
  // ni al canal, ni al historial que ve el agente.
  if (req.method === 'POST' && url.searchParams.get('action') === 'nota') {
    const body = await req.json().catch(() => ({}));
    const convId = body.conversation_id;
    const texto = String(body.texto || '').trim().slice(0, 2000);
    if (!convId) return jsonResp({ error: 'Falta la conversación' }, 400);
    if (!texto) return jsonResp({ error: 'La nota está vacía' }, 400);

    const ck = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${encodeURIComponent(convId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (!ck?.[0]) return jsonResp({ error: 'No autorizado' }, 403);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/conversation_notes`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({
        conversation_id: convId, user_id: userId,
        author_user_id: actorId, author_name: actorNombre, texto,
      }),
    });
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    return jsonResp({ nota: (await res.json())?.[0] || null }, 201);
  }

  // POST ?action=sugerir — qué contestaría el agente. No guarda ni envía nada.
  if (req.method === 'POST' && url.searchParams.get('action') === 'sugerir') {
    const body = await req.json().catch(() => ({}));
    if (!body.conversation_id) return jsonResp({ error: 'Falta la conversación' }, 400);
    const r = await sugerirRespuesta(userId, body.conversation_id);
    if (!r.ok) return jsonResp({ error: r.error }, 400);
    return jsonResp({ texto: r.texto });
  }

  // POST ?action=nota_borrar — solo quien la escribió puede quitarla
  if (req.method === 'POST' && url.searchParams.get('action') === 'nota_borrar') {
    const body = await req.json().catch(() => ({}));
    if (!body.id) return jsonResp({ error: 'Falta el id' }, 400);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/conversation_notes?id=eq.${encodeURIComponent(body.id)}` +
      `&user_id=eq.${encodeURIComponent(userId)}&author_user_id=eq.${encodeURIComponent(actorId)}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    if (!res.ok) return jsonResp({ error: (await res.text()).slice(0, 200) }, 500);
    const filas = await res.json().catch(() => []);
    if (!filas.length) return jsonResp({ error: 'Solo quien escribió la nota puede borrarla.' }, 403);
    return jsonResp({ ok: true });
  }

  // PUT — update conversation status / mark read
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id, status, unread_count } = body;
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const update = {};
    if (status) update.status = status;
    if (unread_count !== undefined) update.unread_count = unread_count;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ conversation: rows[0] });
  }

  // POST ?action=to_pipeline — la conversación entra al CRM como lead
  // Es la decisión manual: se elige la etapa y el lead queda vinculado a la
  // conversación (con su etiqueta de canal y las automatizaciones disparadas).
  if (req.method === 'POST' && url.searchParams.get('action') === 'to_pipeline') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { conversation_id, stage, name, phone, email, pipeline_id } = body || {};
    if (!conversation_id) return jsonResp({ error: 'Falta conversation_id' }, 400);

    const conv = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conversation_id}&user_id=eq.${userId}&select=*`,
      { headers: sbHeaders() }
    ).then(r => r.json()).then(r => r?.[0]).catch(() => null);
    if (!conv) return jsonResp({ error: 'No autorizado' }, 403);
    if (conv.lead_id) return jsonResp({ lead_id: conv.lead_id, ya_estaba: true });

    // El cliente y el pipeline por defecto salen del CANAL; el agente queda de
    // respaldo para los canales conectados antes de que el canal los guardara.
    const conexion = conv.connection_id ? await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${conv.connection_id}&select=client_id,pipeline_id`,
      { headers: sbHeaders() }
    ).then(r => r.json()).then(r => r?.[0]).catch(() => null) : null;
    const agent = conv.agent_id ? await fetch(
      `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${conv.agent_id}&select=client_id`,
      { headers: sbHeaders() }
    ).then(r => r.json()).then(r => r?.[0]).catch(() => null) : null;

    const policy = await getPolicy(userId, conv.channel);
    const leadId = await upsertLeadFromConversation(
      userId, conexion?.client_id || agent?.client_id || null, conv,
      { nombre: name || conv.contact_name, celular: phone || conv.contact_phone, email: email || conv.contact_email },
      // 'always' porque la decisión ya la tomó una persona
      { ...policy, mode: 'always', stage: stage || policy.stage },
      false,
      // Manda lo que elija quien atiende: la conversación puede empezar por
      // compra y acabar en arriendo, y esa decisión es suya, no del canal.
      pipeline_id || conexion?.pipeline_id || null
    );
    if (!leadId) return jsonResp({ error: 'No se pudo crear el lead' }, 500);
    return jsonResp({ lead_id: leadId }, 201);
  }

  // POST — send manual message (when human took over)
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { conversation_id, content } = body;
    // Con adjunto, el texto es opcional: casi nadie escribe pie de foto.
    const adjunto = body.adjunto && body.adjunto.url ? body.adjunto : null;
    if (!conversation_id) return jsonResp({ error: 'Faltan campos' }, 400);
    if (!content && !adjunto) return jsonResp({ error: 'Faltan campos' }, 400);

    // Verify ownership and get connection info
    const convRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conversation_id}&user_id=eq.${userId}&select=*`,
      { headers: sbHeaders() }
    );
    const convRows = await convRes.json();
    const conv = convRows?.[0];
    if (!conv) return jsonResp({ error: 'No autorizado' }, 403);

    // Get channel connection
    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${conv.connection_id}&select=*`,
      { headers: sbHeaders() }
    );
    const connRows = await connRes.json();
    const conn = connRows?.[0];

    // Save message
    const msgRes = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        conversation_id, role: 'assistant', content: content || '',
        ...(adjunto ? {
          adjunto_url: adjunto.url,
          adjunto_tipo: adjunto.tipo || 'document',
          adjunto_nombre: String(adjunto.nombre || '').slice(0, 200),
          adjunto_mime: adjunto.mime || null,
        } : {}),
      }),
    });
    if (!msgRes.ok) return jsonResp({ error: 'Error guardando mensaje' }, 500);

    // Update last_message
    await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conversation_id}`, {
      method: 'PATCH',
      headers: sbHeaders(),
      body: JSON.stringify({
        last_message: (content || (adjunto ? ({ image: '📷 Imagen', video: '🎬 Video', audio: '🎤 Audio' }[adjunto.tipo] || '📎 ' + (adjunto.nombre || 'Archivo')) : '')).slice(0, 200),
        last_message_at: new Date().toISOString(),
      }),
    });

    // Enviar por el canal que corresponda.
    // Un canal de prueba no tiene token real de Meta: intentar el envío solo
    // devolvía «Invalid OAuth access token» y dejaba el circuito manual sin
    // forma de probarse. El mensaje se guarda y ahí se queda, que es justo lo
    // que se está ensayando.
    const esPrueba = String(conn?.external_id || '').startsWith('sim_');
    if (conn && !esPrueba) {
      const envio = conv.channel === 'tiktok'
        ? (adjunto
            ? { ok: false, error: 'TikTok no admite enviar archivos desde el inbox.' }
            : await sendTikTokMessage(conn, conv.contact_id, content))
        : await sendMetaMessage(conn, conv.contact_id, conv.channel, content, adjunto);
      if (envio && envio.ok === false) {
        // Si el archivo SÍ salió y lo que falló fue el pie, el mensaje se queda:
        // borrarlo escondería un archivo que el cliente ya tiene.
        if (envio.parcial) return jsonResp({ error: envio.error, parcial: true }, 502);
        // Si no salio, NO puede quedar en el hilo como enviado: se quita el
        // mensaje guardado y se devuelve el motivo para que se pueda reintentar.
        const guardado = (await msgRes.json().catch(() => []))?.[0];
        if (guardado?.id) {
          await fetch(`${SUPABASE_URL}/rest/v1/chat_messages?id=eq.${guardado.id}`, {
            method: 'DELETE', headers: sbHeaders(),
          }).catch(() => {});
        }
        return jsonResp({ error: envio.error, no_enviado: true }, 502);
      }
    }

    return jsonResp({ ok: true }, 201);
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}

// Devuelve {ok} o {ok:false, error}. Antes lanzaba la peticion y no miraba la
// respuesta: si Meta rechazaba el mensaje —fuera de la ventana de 24 horas,
// token vencido, numero no registrado— el comercial veia su mensaje en el hilo
// como enviado y el cliente no recibia nada. Es el peor fallo silencioso
// posible en un inbox: crees que respondiste.
async function sendMetaMessage(conn, contactId, channel, text, adjunto = null) {
  try {
    // Meta no recibe el archivo: recibe la URL y va él a descargarla. Por eso el
    // bucket tiene que ser público y la URL tiene que existir ya.
    const cuerpo = channel === 'whatsapp'
      ? cuerpoWhatsApp(contactId, text, adjunto)
      : cuerpoMessenger(contactId, text, adjunto);

    const res = channel === 'whatsapp'
      ? await fetch(`https://graph.facebook.com/v19.0/${conn.external_id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conn.access_token}` },
          body: JSON.stringify(cuerpo),
        })
      : await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${conn.access_token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
        });
    if (res.ok) {
      // Messenger no lleva pie de foto dentro del adjunto: va detrás, como
      // mensaje propio. Si esta segunda parte falla hay que decirlo, aunque la
      // imagen sí saliera.
      if (channel !== 'whatsapp' && adjunto && text) {
        const dos = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${conn.access_token}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: contactId }, message: { text } }),
        });
        if (!dos.ok) {
          const f2 = await dos.json().catch(() => ({}));
          return { ok: false, parcial: true, error: 'El archivo se envió, pero el texto que lo acompaña no: ' + motivoEnEspanol(f2?.error?.message || ('HTTP ' + dos.status), f2?.error?.code) };
        }
      }
      return { ok: true };
    }
    const fallo = await res.json().catch(() => ({}));
    const msg = fallo?.error?.message || ('HTTP ' + res.status);
    const cod = fallo?.error?.code;
    // 131047: fuera de la ventana de 24 horas. Es el caso mas frecuente y el
    // que mas confunde, asi que se explica en vez de soltar el mensaje de Meta.
    return { ok: false, error: motivoEnEspanol(msg, cod) };
  } catch (e) {
    return { ok: false, error: 'No se pudo contactar con WhatsApp: ' + (e?.message || 'error de red') };
  }
}

// WhatsApp mete el pie de foto DENTRO del adjunto. Mandarlo como mensaje
// aparte llegaría suelto y descolgado de la imagen.
function cuerpoWhatsApp(to, text, adjunto) {
  const base = { messaging_product: 'whatsapp', to };
  if (!adjunto) return { ...base, type: 'text', text: { body: text } };
  const pie = text ? { caption: text } : {};
  if (adjunto.tipo === 'image') return { ...base, type: 'image', image: { link: adjunto.url, ...pie } };
  if (adjunto.tipo === 'video') return { ...base, type: 'video', video: { link: adjunto.url, ...pie } };
  // El audio no admite pie; el documento necesita el nombre o llega como
  // 'file.pdf' y nadie sabe qué abrió.
  if (adjunto.tipo === 'audio') return { ...base, type: 'audio', audio: { link: adjunto.url } };
  return { ...base, type: 'document', document: { link: adjunto.url, filename: adjunto.nombre || 'documento', ...pie } };
}

// Messenger e Instagram no admiten adjunto y texto en el mismo mensaje. El pie
// se manda aparte justo después (ver sendMetaMessage): tragárselo en silencio
// haría que el comercial creyera que el cliente leyó algo que nunca salió.
function cuerpoMessenger(id, text, adjunto) {
  if (!adjunto) return { recipient: { id }, message: { text } };
  const tipo = ['image', 'video', 'audio'].includes(adjunto.tipo) ? adjunto.tipo : 'file';
  return {
    recipient: { id },
    message: { attachment: { type: tipo, payload: { url: adjunto.url, is_reusable: true } } },
  };
}

// Meta contesta en inglés y en su jerga. Quien atiende el inbox no tiene por
// qué saber qué es un OAuth token: necesita saber qué hacer ahora.
function motivoEnEspanol(msg, cod) {
  const m = String(msg || '');
  if (cod === 131047 || /24 hours|re-engagement/i.test(m)) {
    return 'Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp no permite escribirle libremente: tiene que escribir él primero, o hay que usar una plantilla aprobada.';
  }
  if (/parse access token|invalid oauth|malformed/i.test(m)) {
    return 'La conexión con Meta no es válida. Vuelve a conectar el canal en Marketing → Fuentes → Configurar canales.';
  }
  if (cod === 190 || /session has expired|access token.*expired/i.test(m)) {
    return 'La conexión con Meta caducó. Reconecta el canal en Marketing → Fuentes → Configurar canales.';
  }
  if (cod === 131026 || /not.*whatsapp user|recipient.*not/i.test(m)) {
    return 'Ese número no tiene WhatsApp o no puede recibir mensajes.';
  }
  if (cod === 10 || cod === 200 || /permission/i.test(m)) {
    return 'A la app le falta permiso de Meta para enviar por este canal. Revisa la conexión del canal.';
  }
  if (cod === 4 || cod === 613 || /rate limit|too many/i.test(m)) {
    return 'Meta está limitando los envíos por volumen. Espera unos minutos y reintenta.';
  }
  return m;
}

// TikTok Business Messaging: el envío manual desde el inbox usa el mismo
// endpoint que el webhook cuando el agente contesta solo.
async function sendTikTokMessage(conn, contactId, text) {
  try {
    const res = await fetch(process.env.TIKTOK_SEND_URL || 'https://business-api.tiktok.com/open_api/v1.3/business/message/send/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': conn.access_token },
      body: JSON.stringify({ business_id: conn.external_id, to_user_id: contactId, message: { type: 'text', text } }),
    });
    if (!res.ok) return { ok: false, error: 'TikTok respondió ' + res.status };
    // TikTok responde 200 con un codigo de error dentro del cuerpo
    const cuerpo = await res.json().catch(() => ({}));
    if (cuerpo && cuerpo.code && cuerpo.code !== 0) {
      return { ok: false, error: cuerpo.message || ('TikTok devolvió el código ' + cuerpo.code) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'No se pudo contactar con TikTok: ' + (e?.message || 'error de red') };
  }
}
