// api/cron-programados.js
// Manda los mensajes que alguien dejó programados. Corre cada 5 minutos
// (vercel.json), así que un mensaje sale como mucho 5 minutos tarde — que para
// «escríbele el lunes a las 9» es de sobra.
//
// Es edge porque importa de api/_*.js, como el resto del inbox.
export const config = { runtime: 'edge' };

import { enviarPorCanal } from './_enviar-canal.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
const LOTE = 40;

function sb() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

async function marcar(id, campos) {
  await fetch(`${SUPABASE_URL}/rest/v1/scheduled_messages?id=eq.${id}`, {
    method: 'PATCH', headers: sb(), body: JSON.stringify(campos),
  }).catch(() => {});
}

export default async function handler(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  const ahora = new Date().toISOString();
  const pendientes = await fetch(
    `${SUPABASE_URL}/rest/v1/scheduled_messages?estado=eq.pendiente&enviar_at=lte.${encodeURIComponent(ahora)}` +
    `&select=*&order=enviar_at.asc&limit=${LOTE}`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);

  if (!pendientes.length) return new Response(JSON.stringify({ ok: true, enviados: 0 }));

  let enviados = 0, fallidos = 0, cancelados = 0;

  for (const p of pendientes) {
    // Reserva: si otra pasada ya lo cogió, el filtro por estado no devuelve
    // fila y este se lo salta. Sin esto, dos crones solapados mandarían el
    // mismo mensaje dos veces al cliente.
    const reserva = await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_messages?id=eq.${p.id}&estado=eq.pendiente`,
      { method: 'PATCH', headers: sb(), body: JSON.stringify({ estado: 'enviando' }) }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (!reserva?.length) continue;

    try {
      const conv = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${p.conversation_id}&select=*`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);

      // La conversación pudo borrarse entre programar y enviar.
      if (!conv) {
        await marcar(p.id, { estado: 'cancelado', error: 'La conversación ya no existe' });
        cancelados++; continue;
      }

      const conn = conv.connection_id ? await fetch(
        `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${conv.connection_id}&select=*`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null) : null;

      const adjunto = p.adjunto_url ? {
        url: p.adjunto_url, tipo: p.adjunto_tipo, nombre: p.adjunto_nombre, mime: p.adjunto_mime,
      } : null;

      const envio = conn
        ? await enviarPorCanal(conn, conv.channel, conv.contact_id, p.texto || '', adjunto)
        : { ok: false, error: 'El canal ya no está conectado' };

      if (envio.ok === false && !envio.parcial) {
        // No se guarda el mensaje: si no salió, no puede aparecer en el hilo
        // como enviado. El motivo queda para que se vea en la conversación.
        await marcar(p.id, { estado: 'fallido', error: String(envio.error || '').slice(0, 300) });
        fallidos++; continue;
      }

      await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
        method: 'POST', headers: sb(),
        body: JSON.stringify({
          conversation_id: conv.id, role: 'assistant', content: p.texto || '',
          ...(adjunto ? {
            adjunto_url: adjunto.url, adjunto_tipo: adjunto.tipo,
            adjunto_nombre: adjunto.nombre, adjunto_mime: adjunto.mime,
          } : {}),
        }),
      }).catch(() => {});

      await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({
          last_message: (p.texto || (adjunto ? '📎 ' + (adjunto.nombre || 'Archivo') : '')).slice(0, 200),
          last_message_at: new Date().toISOString(),
          // OJO: aquí NO se toca last_inbound_at. La ventana de 24 h la abre el
          // cliente al escribir, no nosotros al contestarle.
        }),
      }).catch(() => {});

      await marcar(p.id, {
        estado: 'enviado', sent_at: new Date().toISOString(),
        error: envio.parcial ? String(envio.error || '').slice(0, 300) : null,
      });
      enviados++;
    } catch (e) {
      // Nunca dejar una fila en 'enviando': se quedaría atascada para siempre.
      await marcar(p.id, { estado: 'fallido', error: ('Error inesperado: ' + (e?.message || '')).slice(0, 300) });
      fallidos++;
    }
  }

  return new Response(JSON.stringify({ ok: true, enviados, fallidos, cancelados }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
