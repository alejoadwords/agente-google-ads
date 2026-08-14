// Webhook universal para Meta: WhatsApp, Messenger, Instagram DMs
// GET  → verificación de webhook por Meta
// POST → mensajes entrantes
//
// La conversación (agente, captura de datos y entrada al pipeline) vive en
// _inbox-engine.js, compartido con TikTok: aquí solo queda lo propio de Meta.

export const config = { runtime: 'edge' };

import { intakeLead } from '../_lead-intake.js';
import { processIncoming } from '../_inbox-engine.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb() {
  return { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' };
}

// ── Envío de respuesta por canal ──────────────────────────────────────────────
async function sendMeta(channel, connection, contactId, text) {
  if (channel === 'whatsapp') {
    await fetch(`https://graph.facebook.com/v19.0/${connection.external_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${connection.access_token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: contactId, type: 'text', text: { body: text } }),
    });
  } else {
    // Messenger e Instagram usan el mismo endpoint
    await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${connection.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: contactId }, message: { text } }),
    });
  }
}

// El evento de Meta trae el id del contacto pero no su nombre: hay que pedirlo
// aparte con el token de la página. Sin esto el lead nace como
// "Contacto messenger" y el comercial recibe una ficha sin nombre.
async function nombreDelContacto(connection, contactId) {
  if (!connection?.access_token || !contactId) return null;
  // Consultar /{psid} directamente devuelve "Object does not exist" salvo con
  // acceso avanzado. El nombre sí sale por las conversaciones de la página,
  // que es lo mismo que ve cualquiera en la bandeja de Meta.
  const pageId = connection.channel === 'instagram' ? null : connection.external_id;
  const base = pageId
    ? `https://graph.facebook.com/v19.0/${pageId}/conversations`
    : `https://graph.facebook.com/v19.0/me/conversations?platform=instagram`;
  const url = base + (base.includes('?') ? '&' : '?')
    + `user_id=${encodeURIComponent(contactId)}&fields=participants&access_token=${connection.access_token}`;
  const d = await fetch(url).then(r => r.json()).catch(() => null);
  if (!d || d.error) {
    if (d?.error) console.warn('[meta] no se pudo leer el nombre:', String(d.error.message).slice(0, 120));
    return null;
  }
  for (const c of d.data || []) {
    for (const p of c.participants?.data || []) {
      // El otro participante es el contacto; la página es la conexión
      if (String(p.id) !== String(connection.external_id) && p.name) {
        return String(p.name).slice(0, 120);
      }
    }
  }
  return null;
}

// WhatsApp no manda el archivo: manda un id con el que hay que ir a buscarlo.
function mediaDeWhatsApp(msg) {
  const tipos = { image: 'image', video: 'video', audio: 'audio', voice: 'audio', document: 'document', sticker: 'image' };
  const tipo = tipos[msg.type];
  if (!tipo) return null;
  const d = msg[msg.type];
  if (!d?.id) return null;
  return { fuente: 'whatsapp', id: d.id, tipo, mime: d.mime_type || null, nombre: d.filename || null };
}

// Messenger e Instagram mandan una URL directa, pero temporal: por eso se copia.
function mediaDeMessenger(message) {
  const a = (message.attachments || [])[0];
  const url = a?.payload?.url;
  if (!url) return null;
  const tipos = { image: 'image', video: 'video', audio: 'audio', file: 'document' };
  return { fuente: 'url', url, tipo: tipos[a.type] || 'document', nombre: a.payload?.title || null };
}

const processMessage = args => processIncoming({
  ...args,
  send: (connection, contactId, text) => sendMeta(args.channel, connection, contactId, text),
  resolverNombre: nombreDelContacto,
});

// ── Meta Lead Ads (formularios de anuncios) ──────────────────────────────────
// Requiere el permiso leads_retrieval de la app (en trámite) y suscripción al
// campo leadgen de la página. Cuando llegue el evento, trae el lead completo
// via Graph con el token de la página conectada y lo ingesta al CRM.
async function processLeadgen(value) {
  const pageId = String(value.page_id || '');
  const leadgenId = String(value.leadgen_id || '');
  if (!pageId || !leadgenId) return;
  const connRows = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?external_id=eq.${encodeURIComponent(pageId)}&is_active=eq.true&select=*&limit=1`,
    { headers: sb() }
  ).then(r => r.json()).catch(() => []);
  const connection = connRows?.[0];
  if (!connection || !connection.access_token) return;

  const lead = await fetch(`https://graph.facebook.com/v19.0/${leadgenId}?access_token=${connection.access_token}`)
    .then(r => r.json()).catch(() => null);
  if (!lead || lead.error || !Array.isArray(lead.field_data)) {
    console.error('[leadgen] no se pudo traer el lead:', JSON.stringify(lead?.error || {}).slice(0, 200));
    return;
  }
  const fields = {};
  for (const f of lead.field_data) fields[String(f.name || '').toLowerCase()] = (f.values || [])[0] || null;
  const name = fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(' ') || fields.nombre || null;
  const email = fields.email || fields.correo || null;
  const phone = fields.phone_number || fields.telefono || fields.whatsapp || null;
  if (!name && !email && !phone) return;

  // Nombre del formulario como etiqueta (best effort)
  let formName = null;
  if (value.form_id) {
    const form = await fetch(`https://graph.facebook.com/v19.0/${value.form_id}?fields=name&access_token=${connection.access_token}`)
      .then(r => r.json()).catch(() => null);
    if (form && form.name) formName = String(form.name);
  }
  const known = new Set(['full_name', 'first_name', 'last_name', 'nombre', 'email', 'correo', 'phone_number', 'telefono', 'whatsapp', 'company_name', 'empresa']);
  const extras = Object.entries(fields).filter(([k, v]) => !known.has(k) && v).map(([k, v]) => `${k}: ${String(v).slice(0, 150)}`).slice(0, 8);

  await intakeLead(connection.user_id, null, {
    name, email, phone,
    company: fields.company_name || fields.empresa || null,
    note: extras.join(' · ') || null,
    source: 'meta_lead_ads',
    sourceLabel: 'Meta Lead Ads',
    tags: ['meta lead ads', ...(formName ? [formName] : [])],
  });
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

  // Simulador, igual que el de TikTok: permite probar WhatsApp, Messenger e
  // Instagram sin una cuenta real conectada, que es lo que hace falta para
  // ensayar la puesta en marcha de un cliente antes de tener sus credenciales.
  // No llama a la API de Meta: la respuesta del agente vuelve en el JSON.
  const url0 = new URL(req.url);
  if (url0.searchParams.get('simulate') === '1') {
    if (!process.env.CRON_SECRET || req.headers.get('x-acuarius-secret') !== process.env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const canal = ['whatsapp', 'messenger', 'instagram'].includes(body.channel) ? body.channel : 'whatsapp';
    const r = await processIncoming({
      channel: canal,
      externalId: String(body.external_id || ''),
      contactId: String(body.contact_id || ''),
      contactName: body.contact_name || null,
      text: String(body.text || ''),
      providerMessageId: String(body.message_id || `${body.contact_id}-${Date.now()}`),
      send: null,
      resolverNombre: nombreDelContacto,
    }).catch(e => ({ ok: false, reason: String(e && e.message || e) }));
    return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Responder 200 a Meta inmediatamente para evitar reintentos.
  // Ojo con el nombre: llamar "process" a esta promesa dejaba el objeto global
  // process en zona muerta durante todo el handler, así que la verificación de
  // arriba (process.env.META_WEBHOOK_VERIFY_TOKEN) reventaba con 500 y Meta
  // nunca podía dar de alta el webhook.
  const procesar = (async () => {
    try {
      if (body.object === 'page') {
        // Formularios de clientes potenciales (Lead Ads)
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === 'leadgen' && change.value) await processLeadgen(change.value);
          }
        }
        // Messenger
        for (const entry of body.entry || []) {
          for (const msg of entry.messaging || []) {
            if (msg.message && !msg.message.is_echo) {
              await processMessage({
                channel: 'messenger',
                externalId: String(entry.id),
                contactId: String(msg.sender.id),
                text: msg.message.text || '',
                media: mediaDeMessenger(msg.message),
                providerMessageId: msg.message.mid,
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
                media: mediaDeMessenger(msg.message),
                providerMessageId: msg.message.mid,
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
              // Antes: 'if (msg.type !== "text") continue'. Una foto del cliente
              // se descartaba entera —sin mensaje, sin aviso, sin rastro— y el
              // comercial no sabía que había llegado algo.
              const media = mediaDeWhatsApp(msg);
              if (msg.type !== 'text' && !media) continue;   // estados, reacciones, ubicaciones
              const contact = val.contacts?.find(c => c.wa_id === msg.from);
              await processMessage({
                channel: 'whatsapp',
                externalId: String(phoneNumberId),
                contactId: String(msg.from),
                contactName: contact?.profile?.name || null,
                // El pie de foto viaja dentro del adjunto, no en msg.text
                text: msg.text?.body || msg[msg.type]?.caption || '',
                media,
                providerMessageId: msg.id,
              });
            }
          }
        }
      }
    } catch(e) { console.error('webhook process error', e); }
  })();

  // En Edge Runtime, awaiteamos el proceso (no tenemos waitUntil sin Cloudflare)
  await procesar;

  return new Response('EVENT_RECEIVED', { status: 200 });
}
