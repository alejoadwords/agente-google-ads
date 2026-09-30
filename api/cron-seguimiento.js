// api/cron-seguimiento.js — retoma la conversación que se quedó a medias.
//
// El agente responde, la persona se distrae, y la conversación muere ahí. No es
// un fallo de nadie: pasa a todo el mundo, y el lead se pierde igual. Lo pidió
// el cliente mirando sus propias pruebas: «hay casos en los que el usuario
// puede demorarse minutos o hasta horas en responder».
//
// A los 10 minutos de silencio, un mensaje que retoma. Y no uno cualquiera: la
// pregunta que FALTA para calificar a esa persona. Un «¿sigues ahí?» no acerca
// nada; «¿en qué zona busca?» sí.
//
// Corre cada 10 minutos (vercel.json).
export const config = { runtime: 'edge' };

import { latir } from './_latido.js';
import { extraerCalificacion } from './_qualify.js';
import { extractCapturedData, telefonoDelCanal } from './_inbox-engine.js';
import { estadoDeCupo, sumarUno } from './_cupo-agente.js';
import { abrirConexion } from './_cifrado.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const ESPERA_MIN = 10;          // minutos de silencio antes de retomar
const VENTANA_HORAS = 24;       // fuera de la ventana de WhatsApp no se puede escribir
// Páginas de candidatas y un tope de tiempo: la función edge tiene 25 s.
//
// Antes se tomaban las 60 calladas MÁS ANTIGUAS y se saltaban sin marcar las
// que ya tenían su seguimiento, las que terminan en un mensaje de la persona,
// las sin agente o sin canal y las de cuentas sin cupo. Esas se quedaban
// ocupando los 60 puestos durante 24 h: con más de 60, las conversaciones
// nuevas no se miraban nunca (30-09-2026). Ahora van primero las que se
// callaron hace MENOS —las que más vale retomar— y se recorren páginas hasta
// el tope de tiempo.
export const PAGINA = 200;
export const TOPE_MS = 18 * 1000;
// Horario en el que se puede retomar, hora de Colombia. A nadie le gusta que le
// escriban a las tres de la mañana, y un mensaje así no lo contesta nadie: es
// gastar un mensaje del cupo para molestar.
const HORA_DESDE = 7, HORA_HASTA = 21, TZ = -5;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

export function enHorario(ahora = new Date()) {
  const h = (ahora.getUTCHours() + TZ + 24) % 24;
  return h >= HORA_DESDE && h < HORA_HASTA;
}

// Qué preguntar para retomar.
//
// Se mira lo que ya se sabe de esa persona y se pregunta lo PRIMERO que falta,
// en el orden en que hace falta: sin teléfono no se la puede llamar, y sin zona
// ni presupuesto no se le puede enseñar nada.
export function preguntaQueFalta(capturado = {}, respuestas = {}, tono = 'formal') {
  const usted = tono !== 'informal';
  const hay = (...claves) => claves.some(k => {
    const v = capturado[k];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
  const tieneCriterio = (texto) => Object.entries(respuestas || {}).some(([k, r]) =>
    k !== '_ruta' && r?.valor && k.toLowerCase().includes(texto));

  if (!hay('celular', 'telefono', 'phone')) {
    return usted
      ? '¿Me confirma un número de contacto para que un asesor le escriba?'
      : '¿Me confirmas un número de contacto para que un asesor te escriba?';
  }
  if (!hay('ciudad', 'zona') && !tieneCriterio('zona') && !tieneCriterio('ciudad')) {
    return usted ? '¿En qué zona o barrio le interesa buscar?' : '¿En qué zona o barrio te interesa buscar?';
  }
  if (!hay('presupuesto') && !tieneCriterio('presupuesto')) {
    return usted ? '¿Qué presupuesto tiene en mente?' : '¿Qué presupuesto tienes en mente?';
  }
  if (!hay('nombre')) {
    return usted ? '¿Me dice su nombre para dejarlo anotado?' : '¿Me dices tu nombre para dejarlo anotado?';
  }
  // Ya está todo: entonces lo que falta es dar el paso siguiente.
  return usted
    ? '¿Quiere que le agende una visita o prefiere que un asesor le escriba?'
    : '¿Quieres que te agende una visita o prefieres que un asesor te escriba?';
}

export function textoDeSeguimiento(capturado, respuestas, tono) {
  const usted = tono !== 'informal';
  const entrada = usted
    ? 'Sigo por aquí por si quiere continuar.'
    : 'Sigo por aquí por si quieres continuar.';
  return entrada + '\n\n' + preguntaQueFalta(capturado, respuestas, tono);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const secreto = url.searchParams.get('secret');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}` && secreto !== CRON_SECRET) {
    return new Response('no', { status: 401 });
  }

  // La entrada, aparte de la salida: un latido que solo se escribe al terminar
  // no distingue «Vercel no lo llamó» de «lo llamó y se murió a mitad».
  await latir('cron-seguimiento', { empezo: new Date().toISOString() });

  const resumen = { miradas: 0, enviados: 0, sinCupo: 0, fueraDeHora: 0 };
  try {
    if (!enHorario()) {
      resumen.fueraDeHora = 1;
      await latir('cron-seguimiento', resumen);
      return new Response(JSON.stringify(resumen), { headers: { 'Content-Type': 'application/json' } });
    }

    const ahora = Date.now();
    const calladasDesde = new Date(ahora - ESPERA_MIN * 60000).toISOString();
    const dentroDeVentana = new Date(ahora - VENTANA_HORAS * 3600000).toISOString();

    const hasta = ahora + (Number(process.env.SEGUIMIENTO_TOPE_MS) || TOPE_MS);   // la variable solo existe en la prueba
    // El canal y el agente se leen una vez por corrida, no una por conversación.
    const conexiones = new Map(), agentes = new Map();
    resumen.sinTiempo = false;

    for (let desde = 0; ; desde += PAGINA) {
      if (Date.now() >= hasta) { resumen.sinTiempo = true; break; }
      // Solo las que atiende el agente. Si ya está en manos de una persona, el
      // seguimiento le toca a ella: un mensaje nuestro por encima sería peor.
      const r0 = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_conversations?status=eq.bot` +
        `&last_message_at=lt.${encodeURIComponent(calladasDesde)}` +
        `&last_inbound_at=gt.${encodeURIComponent(dentroDeVentana)}` +
        `&select=id,user_id,agent_id,connection_id,channel,contact_id,lead_id,last_inbound_at,last_message_at,seguimiento_at` +
        `&order=last_message_at.desc,id.asc&limit=${PAGINA}&offset=${desde}`,
        { headers: sb() }
      );
      // Un fallo se dice: con una lista vacía el latido diría «0 miradas, todo
      // bien» y nadie sabría que no se retomó ninguna conversación.
      if (!r0.ok) throw new Error('no se pudieron leer las conversaciones (Supabase ' + r0.status + ')');
      const convs = await r0.json();

    for (const conv of convs || []) {
      if (Date.now() >= hasta) { resumen.sinTiempo = true; break; }
      // Uno por cada mensaje de la persona: si ya se le retomó y sigue callada,
      // no se insiste. Insistir dos veces es acoso, no seguimiento. Se descarta
      // aquí, sin ninguna consulta.
      if (conv.seguimiento_at && conv.seguimiento_at >= conv.last_inbound_at) continue;
      resumen.miradas++;

      // El último mensaje tiene que ser del agente. Si el último es de la
      // persona, no está callada: es que algo falló al responderle, y eso se
      // arregla en otro sitio.
      const ultimos = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${conv.id}` +
        `&select=role,content&order=created_at.desc&limit=12`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      if (!ultimos?.length || ultimos[0].role !== 'assistant') continue;

      // Cupo: un seguimiento es un mensaje del agente y cuesta como tal. Si la
      // cuenta lo agotó, no se manda — y no se marca, para que salga cuando
      // recupere cupo si la ventana sigue abierta.
      const cupo = await estadoDeCupo(conv.user_id, { cacheado: true }).catch(() => ({ error: true }));
      if (cupo && !cupo.error && cupo.agotado) { resumen.sinCupo++; continue; }

      if (!conexiones.has(conv.connection_id)) {
        conexiones.set(conv.connection_id, fetch(
          `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${conv.connection_id}&is_active=eq.true&select=*`,
          { headers: sb() }
        ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).then(abrirConexion).catch(() => null));
      }
      const conexion = await conexiones.get(conv.connection_id);
      if (!conexion) continue;

      if (conv.agent_id && !agentes.has(conv.agent_id)) {
        agentes.set(conv.agent_id, fetch(
          `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${conv.agent_id}&is_active=eq.true&select=tone`,
          { headers: sb() }
        ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null));
      }
      const agente = conv.agent_id ? await agentes.get(conv.agent_id) : null;
      // Sin agente activo, el canal se atiende a mano: no le corresponde a este cron.
      if (!agente) continue;

      const deAsistente = ultimos.filter(m => m.role === 'assistant').map(m => m.content).join('\n');
      const texto = textoDeSeguimiento(
        extractCapturedData(deAsistente),
        extraerCalificacion(deAsistente),
        agente.tone
      );

      // El único sitio donde Acuarius le habla a un canal: con dos copias, en un
      // mes una arregla un error de Meta y la otra no.
      const { sendMetaMessage } = await import('./_enviar-canal.js');
      const r = await sendMetaMessage(conexion, conv.contact_id, conv.channel, texto).catch(() => ({ ok: false }));
      const salio = !!r?.ok;
      // Se marca aunque el envío falle: reintentar cada diez minutos contra un
      // canal caído acabaría mandando seis mensajes de golpe cuando vuelva.
      await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({ seguimiento_at: new Date().toISOString() }),
      }).catch(() => {});
      if (!salio) continue;

      await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
        method: 'POST', headers: sb(),
        body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: texto }),
      }).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({ last_message: texto.slice(0, 200), last_message_at: new Date().toISOString() }),
      }).catch(() => {});
      sumarUno(conv.user_id);
      resumen.enviados++;
    }
      if (resumen.sinTiempo || (convs || []).length < PAGINA) break;
    }

    await latir('cron-seguimiento', resumen);
    return new Response(JSON.stringify(resumen), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-seguimiento', { error: e?.message || String(e) });
    return new Response(JSON.stringify({ error: e?.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
