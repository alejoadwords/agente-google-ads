// api/cron-programados.js
// Manda los mensajes que alguien dejó programados. Corre cada 5 minutos
// (vercel.json), así que un mensaje sale como mucho 5 minutos tarde — que para
// «escríbele el lunes a las 9» es de sobra.
//
// Es edge porque importa de api/_*.js, como el resto del inbox.
export const config = { runtime: 'edge' };

import { enviarPorCanal } from './_enviar-canal.js';
import { abrirConexion, cifrar } from './_cifrado.js';
import { pedirLista } from './_pedir.js';
import { latir } from './_latido.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
const LOTE = 40;
// Tope de tiempo: la función edge tiene 25 s. Antes se mandaban los 40 en
// serie sin mirar el reloj, y si la función se cortaba a mitad de un envío la
// fila se quedaba en «enviando» PARA SIEMPRE: solo se leen las «pendiente»
// (30-09-2026). Lo que no alcance, sale en la corrida siguiente (5 min).
export const TOPE_MS = 15 * 1000;
// Un «enviando» más viejo que esto es un envío que se cortó.
export const ATASCADO_MIN = 10;
export const MOTIVO_ATASCADO = 'Se interrumpió mientras se enviaba. Revisa en la conversación si le llegó antes de volver a mandarlo.';

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

  // La entrada, aparte de la salida: un latido que solo se escribe al terminar
  // no distingue «Vercel no lo llamó» de «lo llamó y se murió a mitad».
  await latir('cron-programados', { empezo: new Date().toISOString() });


  const t0 = Date.now();
  const hasta = t0 + (Number(process.env.PROGRAMADOS_TOPE_MS) || TOPE_MS);   // la variable solo existe en la prueba
  const ahora = new Date(t0).toISOString();

  // Los que se quedaron a medias en una corrida anterior. No se reenvían
  // solos: no hay forma de saber si el mensaje llegó antes del corte, y
  // mandarle dos veces lo mismo al cliente es peor que decirlo. Pasan a
  // «fallido» con el motivo a la vista, que es donde alguien los ve.
  let recuperados = 0;
  try {
    const limite = new Date(t0 - ATASCADO_MIN * 60000).toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_messages?estado=eq.enviando&or=(reservado_at.is.null,reservado_at.lt.${encodeURIComponent(limite)})`,
      { method: 'PATCH', headers: sb(), body: JSON.stringify({ estado: 'fallido', error: MOTIVO_ATASCADO }) }
    );
    if (r.ok) recuperados = ((await r.json()) || []).length;
  } catch {}

  // Si la base no contesta NO es que no haya nada programado. Antes se
  // confundían las dos cosas y un mensaje que debía salir se quedaba dentro
  // sin que nadie lo supiera. Ver api/_pedir.js.
  let pendientes;
  try {
    pendientes = await pedirLista(
      `${SUPABASE_URL}/rest/v1/scheduled_messages?estado=eq.pendiente&enviar_at=lte.${encodeURIComponent(ahora)}` +
      `&select=*&order=enviar_at.asc&limit=${LOTE}`,
      sb(), 'los mensajes programados pendientes'
    );
  } catch (e) {
    await latir('cron-programados', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'no se pudo leer los programados' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!pendientes.length) {
    await latir('cron-programados', { enviados: 0, sin_pendientes: true, recuperados }, recuperados ? recuperados + ' programado(s) se habían quedado a medias' : null);
    return new Response(JSON.stringify({ ok: true, enviados: 0, recuperados }));
  }

  let enviados = 0, fallidos = 0, cancelados = 0, sinTiempo = 0;

  for (const p of pendientes) {
    // Se corta ANTES de tomar uno nuevo, nunca a mitad de un envío.
    if (Date.now() >= hasta) { sinTiempo++; continue; }
    // Reserva: si otra pasada ya lo cogió, el filtro por estado no devuelve
    // fila y este se lo salta. Sin esto, dos crones solapados mandarían el
    // mismo mensaje dos veces al cliente.
    const reserva = await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_messages?id=eq.${p.id}&estado=eq.pendiente`,
      { method: 'PATCH', headers: sb(), body: JSON.stringify({ estado: 'enviando', reservado_at: new Date().toISOString() }) }
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
      ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).then(abrirConexion).catch(() => null) : null;

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

  const problemas = [fallidos ? fallidos + ' envío(s) fallaron' : '', recuperados ? recuperados + ' se habían quedado a medias' : ''].filter(Boolean).join(' · ');
  await latir('cron-programados', { enviados, fallidos, cancelados, recuperados, sinTiempo }, problemas || null);
  return new Response(JSON.stringify({ ok: true, enviados, fallidos, cancelados, recuperados, sinTiempo }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
