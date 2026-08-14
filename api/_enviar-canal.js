// api/_enviar-canal.js
// El único sitio donde Acuarius le habla a un canal. Lo usan la respuesta
// manual del inbox y el cron de mensajes programados: con dos copias, en un mes
// una arregla un error de Meta y la otra no.

// Devuelve {ok} o {ok:false, error}. Antes lanzaba la peticion y no miraba la
// respuesta: si Meta rechazaba el mensaje —fuera de la ventana de 24 horas,
// token vencido, numero no registrado— el comercial veia su mensaje en el hilo
// como enviado y el cliente no recibia nada. Es el peor fallo silencioso
// posible en un inbox: crees que respondiste.
export async function sendMetaMessage(conn, contactId, channel, text, adjunto = null) {
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
export function motivoEnEspanol(msg, cod) {
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
export async function sendTikTokMessage(conn, contactId, text) {
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

// Punto de entrada único: decide el canal y devuelve {ok} o {ok:false,error}.
export async function enviarPorCanal(conn, channel, contactId, content, adjunto = null) {
  // Un canal de prueba no tiene token real: intentar el envío solo devolvía
  // «Invalid OAuth access token» y el circuito no se podía ensayar.
  if (String(conn?.external_id || '').startsWith('sim_')) return { ok: true, simulado: true };
  if (channel === 'tiktok') {
    if (adjunto) return { ok: false, error: 'TikTok no admite enviar archivos desde el inbox.' };
    return sendTikTokMessage(conn, contactId, content);
  }
  return sendMetaMessage(conn, contactId, channel, content, adjunto);
}
