// api/_sin-respuesta.js — «nadie le respondió».
//
// Una persona escribe y no le contesta nadie: ni el agente (que debía hacerlo)
// ni el equipo (si la conversación ya se había pasado a una persona). En el
// inbox solo se nota si alguien entra a mirar, y cron-ventana avisa cuando la
// ventana de 24 h está por cerrarse: demasiado tarde para quien escribió hace
// media hora. Visto en una conversación de Certain: «me interesa el de
// Miramar» y ningún mensaje después.
//
//   status bot   (agente encendido) + 10 min → el agente falló: es un fallo
//                nuestro, va a error_log, y se avisa a quien atiende para
//                que conteste ya.
//   status human (ya escalada)      + 30 min → nadie del equipo contestó.
//
// Aviso por campana, celular y correo a quien tiene el lead (o al dueño de la
// cuenta si no hay lead o no tiene dueño). Una vez por mensaje de la persona.
// Lo llama cron-revisor-agente. Solo se importa desde edge.

import { enviarPushA } from './_push.js';
import { registrarError } from './_registro-errores.js';
import { comercialesActivos, duenoComoComercial } from './_assign.js';
import { emailHtml, bloque, esc, RESPONDER_A } from './_email-layout.js';
import { enviarResend } from './_correo.js';
import { sb } from './_mejoras-agente-red.js';

const minutosDesde = (iso, ahora = Date.now()) => Math.max(1, Math.round((ahora - Date.parse(iso)) / 60000));
const hace = (min) => (min < 60 ? min + ' min' : Math.round(min / 60) + (Math.round(min / 60) === 1 ? ' hora' : ' horas'));
const limpio = (t) => String(t || '').replace(/\[[A-Z_]+[\s\S]*?\]/g, '').replace(/\s+/g, ' ').trim();

// El texto del aviso, igual en los tres canales. Puro, para las pruebas.
export function textoDelAviso(c, ahora = Date.now()) {
  const quien = c.contact_name || c.contact_phone || 'Un contacto';
  const min = minutosDesde(c.ultimo_at, ahora);
  const dijo = limpio(c.ultimo_texto).slice(0, 140);
  if (c.status === 'bot') {
    return {
      titulo: 'El agente no le respondió a ' + quien,
      texto: quien + ' escribió hace ' + hace(min) + ' y el agente no le contestó' + (dijo ? ': «' + dijo + '»' : '') +
        '. Respóndele tú desde Conversaciones; ya estamos revisando qué le pasó al agente.',
    };
  }
  return {
    titulo: 'Nadie le ha respondido a ' + quien,
    texto: quien + ' escribió hace ' + hace(min) + ' y nadie del equipo le ha contestado' + (dijo ? ': «' + dijo + '»' : '') + '.',
  };
}

async function correoA(com, aviso, convId) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !com?.email) return false;
  const r = await enviarResend('_sin-respuesta', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Acuarius <crm@app.acuarius.app>', reply_to: RESPONDER_A, to: com.email,
      subject: aviso.titulo,
      html: emailHtml({
        titulo: aviso.titulo,
        intro: 'Alguien está esperando respuesta.',
        preheader: aviso.texto.slice(0, 120),
        cuerpo: bloque(`<div style="font-size:14px;line-height:1.55">${esc(aviso.texto)}</div>`),
        cta: { texto: 'Abrir la conversación', url: 'https://app.acuarius.app/conversaciones?c=' + encodeURIComponent(convId) },
        pie: 'Te avisamos una sola vez por mensaje.',
      }),
    }),
  }).catch(() => null);
  return !!r?.ok;
}

async function avisar(c, aviso) {
  const hechos = [];
  let lead = null;
  if (c.lead_id) lead = (await sb(`/leads?id=eq.${c.lead_id}&select=id,assigned_to&limit=1`).catch(() => []))?.[0] || null;
  const para = lead?.assigned_to || c.user_id;

  if (lead) {
    try {
      await sb('/lead_activities', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
        lead_id: lead.id, user_id: c.user_id, type: 'nota', content: aviso.texto,
        metadata: { sistema: true, evento: 'sin_respuesta', conversation_id: c.id, para, actor: 'Acuarius' } }) });
      hechos.push('campana');
    } catch (e) { await registrarError({ origen: 'servidor', donde: 'sin-respuesta.campana', error: e, usuario: c.user_id }); }
  }
  try {
    const r = await enviarPushA(para, { titulo: aviso.titulo, texto: aviso.texto.slice(0, 120), url: '/conversaciones?c=' + c.id, etiqueta: 'sin-respuesta-' + c.id });
    if (r?.enviados) hechos.push('celular');
  } catch (e) { await registrarError({ origen: 'servidor', donde: 'sin-respuesta.push', error: e, usuario: c.user_id }); }
  try {
    const com = (await comercialesActivos(c.user_id)).find(m => m.id === para)
      || (para === c.user_id ? await duenoComoComercial(c.user_id) : null);
    if (await correoA(com, aviso, c.id)) hechos.push('correo');
  } catch (e) { await registrarError({ origen: 'servidor', donde: 'sin-respuesta.correo', error: e, usuario: c.user_id }); }
  return hechos;
}

export async function detectarSinRespuesta({ presupuestoMs = 8000, limite = 50 } = {}) {
  const empezo = Date.now();
  const r = { agente: 0, equipo: 0, avisos: 0 };
  const filas = await sb('/rpc/conversaciones_sin_respuesta', { method: 'POST', body: JSON.stringify({ limite }) }) || [];
  for (const c of filas) {
    if (Date.now() - empezo > presupuestoMs) break;
    // Se marca primero: un aviso repetido cada 10 minutos es peor que uno perdido,
    // y el fallo de un canal ya queda en error_log.
    await sb(`/chat_conversations?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: JSON.stringify({ sin_respuesta_aviso_at: new Date().toISOString() }) });
    if (c.status === 'bot') {
      r.agente++;
      await registrarError({ origen: 'servidor', donde: 'agente.sin_respuesta', usuario: c.user_id,
        error: new Error('El agente no respondió en 10 minutos'), detalle: 'conversación ' + c.id + ' · ' + c.channel });
    } else r.equipo++;
    const hechos = await avisar(c, textoDelAviso(c));
    if (hechos.length) r.avisos++;
  }
  return r;
}
