// api/agente-mejorar.js — «Mejorar el agente».
//
// El cliente corrige su agente desde el probador, sin pasar por nosotros:
//   POST { accion: 'proponer', agent_id, mensajes, indice, correccion }
//        → el entrenador (Sonnet) clasifica la corrección y propone UN cambio
//   POST { accion: 'probar',   agent_id, mensajes, indice, propuesta }
//        → repite la conversación con el cambio, sin guardar nada
//   POST { accion: 'aplicar',  agent_id, propuesta, correccion, mensajes, indice, respuesta_despues }
//        → lo guarda (o, si es un fallo de Acuarius, nos abre un ticket)
//   GET  ?agent_id=…           → reglas aprendidas, historial y cupo del mes
//   POST { accion: 'deshacer', id } → vuelve al estado anterior a esa mejora
//
// La lógica pura está en _mejoras-agente.js. Solo el dueño y los perfiles con
// acceso a «agentes» (administrador, mercadeo) pueden usarlo.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, exigeModulo } from './_perfiles.js';
import { getRegla, saveRegla } from './_qualify.js';
import { ensayarAgente } from './_inbox-engine.js';
import { registrarUso } from './_uso-ia.js';
import { registrarError } from './_registro-errores.js';
import { inicioDelMes, planDeCuenta } from './_cupo-agente.js';
import { validarPropuesta, aplicarPropuesta, resumenDelCambio, fotoDelAgente, CAMPOS_AGENTE } from './_mejoras-agente.js';
import { sb, limpio, conversacionReal, cargarAgente, llamarEntrenador, aplicarYGuardar, MODELO_ENTRENADOR } from './_mejoras-agente-red.js';
export { conversacionReal };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MODELO = MODELO_ENTRENADOR;
const ORIGEN = 'mejora';

// Cada propuesta es una llamada al modelo más caro: con cupo, como todo lo de IA.
export const CUPO_MEJORAS = { free: 0, trial: 20, pro: 60, individual: 60, agency: 200, agencia: 200, admin: 1000 };
export function cupoMejoras(plan) {
  const p = String(plan || '').toLowerCase().trim();
  return CUPO_MEJORAS[p] !== undefined ? CUPO_MEJORAS[p] : CUPO_MEJORAS.pro;
}

const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function usadas(cuenta) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${encodeURIComponent(cuenta)}&origen=eq.${ORIGEN}` +
      `&created_at=gte.${encodeURIComponent(inicioDelMes().toISOString())}&select=id&limit=0`, { headers: sbH({ Prefer: 'count=exact' }) });
    const n = parseInt((r.headers.get('content-range') || '').split('/')[1], 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

// undefined = no se pudo saber (Clerk caído): no es lo mismo que «free».
async function planDe(cuenta) {
  const r = await planDeCuenta(cuenta).catch(() => ({ ok: false }));
  return r.ok ? r.plan : undefined;
}

// Un fallo de Acuarius: ticket con la conversación dentro. OJO: la columna
// support_tickets.conversation_id es el hilo de «Ayuda», no la conversación del
// inbox; esa va en contexto.
async function crearReporte({ cuenta, quien, agent, propuesta, correccion, conversacion, extra = {} }) {
  const [t] = await sb('/support_tickets', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({
    user_id: cuenta, author_user_id: quien.actorId,
    email: await correoDe(quien.actorId), plan: (await planDe(cuenta)) || null,
    asunto: 'Agente: ' + propuesta.cambio.asunto,
    detalle: propuesta.cambio.detalle + '\n\nLo que escribió el cliente: ' + correccion,
    contexto: { origen: 'mejorar-agente', agente: agent.id, agente_nombre: agent.name, conversacion, ...extra },
  }) }) || [];
  return t || null;
}

async function correoDe(userId) {
  if (!process.env.CLERK_SECRET_KEY) return null;
  return fetch(`https://api.clerk.com/v1/users/${userId}`, { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } })
    .then(r => (r.ok ? r.json() : null)).then(u => u?.email_addresses?.[0]?.email_address || null).catch(() => null);
}

// «Probar el cambio» es un ensayo más: comparte el tope diario del probador
// (agent-probar.js), que cuenta las filas de ai_usage con origen 'ensayo'.
const TOPE_ENSAYOS = 300;
async function ensayosDeHoy(cuenta) {
  const desde = new Date(); desde.setUTCHours(0, 0, 0, 0);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${encodeURIComponent(cuenta)}&origen=eq.ensayo&created_at=gte.${desde.toISOString()}&select=id`,
      { headers: sbH({ Prefer: 'count=exact', Range: '0-0' }) });
    return parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
  } catch { return 0; }
}

// Un error sin capturar llegaba al navegador como un 500 mudo («No se pudo
// completar») y no dejaba rastro: así pasó un ReferenceError del 16-10 que
// rompió «Corregir» para todos. Ahora queda en error_log y se dice qué pasó.
export default async function handler(req) {
  try {
    return await manejar(req);
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'agente-mejorar', error: e }).catch(() => {});
    return json({ error: 'El entrenador tuvo un error de nuestro lado y ya nos llegó el aviso. Inténtalo de nuevo en unos minutos.' }, 500);
  }
}

async function manejar(req) {
  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'agente-mejorar'), 401);
  let quien;
  try { quien = await quienPregunta(sesion.id); } catch { return json({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }
  const corte = exigeModulo(quien, 'agentes');
  if (corte) return corte;
  const cuenta = quien.userId;

  // ── Historial, reglas y cupo ─────────────────────────────────────────────
  if (req.method === 'GET') {
    // Cuántas sugerencias esperan en cada agente, para el aviso en la lista.
    if (new URL(req.url).searchParams.get('pendientes')) {
      const filas = await sb(`/agente_sugerencias?user_id=eq.${encodeURIComponent(cuenta)}&estado=eq.pendiente&select=agent_id&limit=500`) || [];
      const por = {};
      for (const f of filas) por[f.agent_id] = (por[f.agent_id] || 0) + 1;
      return json({ pendientes: por });
    }
    const agentId = new URL(req.url).searchParams.get('agent_id');
    const agent = await cargarAgente(cuenta, agentId);
    if (!agent) return json({ error: 'Ese agente no existe en tu cuenta.' }, 404);
    const historial = await sb(`/agente_mejoras?agent_id=eq.${agent.id}&user_id=eq.${encodeURIComponent(cuenta)}` +
      `&select=id,tipo,origen,conversation_id,correccion,explicacion,cambio,respuesta_antes,respuesta_despues,creado_at,deshecho_at,actor_id&order=creado_at.desc&limit=60`) || [];
    const plan = await planDe(cuenta);
    const n = await usadas(cuenta);
    const sugerencias = await sb(`/agente_sugerencias?agent_id=eq.${agent.id}&user_id=eq.${encodeURIComponent(cuenta)}&estado=eq.pendiente` +
      `&select=id,conversation_id,problema,propuesta,resumen,respuesta_antes,respuesta_despues,creado_at&order=creado_at.desc&limit=20`) || [];
    return json({ reglas: agent.reglas || [], historial, sugerencias, revisar: agent.revisar !== false, cupo: { cupo: cupoMejoras(plan), usadas: n } });
  }

  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Cuerpo inválido' }, 400); }
  const accion = body.accion;

  // ── Deshacer ──────────────────────────────────────────────────────────────
  if (accion === 'deshacer') {
    const [m] = await sb(`/agente_mejoras?id=eq.${encodeURIComponent(body.id || '')}&user_id=eq.${encodeURIComponent(cuenta)}&select=*&limit=1`) || [];
    if (!m) return json({ error: 'Esa mejora no existe.' }, 404);
    if (m.deshecho_at) return json({ error: 'Esa mejora ya estaba deshecha.' }, 409);
    // Solo la más reciente: deshacer una del medio pisaría las de después.
    const [ultima] = await sb(`/agente_mejoras?agent_id=eq.${m.agent_id}&user_id=eq.${encodeURIComponent(cuenta)}&deshecho_at=is.null&tipo=neq.reporte&select=id&order=creado_at.desc&limit=1`) || [];
    if (m.tipo !== 'reporte' && ultima?.id !== m.id) return json({ error: 'Deshaz primero los cambios más recientes: este se hizo antes que otros.' }, 409);
    if (m.tipo !== 'reporte') {
      const patch = {};
      for (const k of CAMPOS_AGENTE) if (m.antes?.agente && k in m.antes.agente) patch[k] = m.antes.agente[k];
      patch.updated_at = new Date().toISOString();
      await sb(`/chat_agents?id=eq.${m.agent_id}&user_id=eq.${encodeURIComponent(cuenta)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(patch) });
      if (m.antes?.regla) await saveRegla(cuenta, m.agent_id, m.antes.regla);
    }
    await sb(`/agente_mejoras?id=eq.${m.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ deshecho_at: new Date().toISOString(), deshecho_por: quien.actorId }) });
    return json({ ok: true });
  }

  // ── Sugerencias del revisor (fase 3) ─────────────────────────────────────
  if (accion === 'revisar') {
    const agent = await cargarAgente(cuenta, body.agent_id);
    if (!agent) return json({ error: 'Ese agente no existe en tu cuenta.' }, 404);
    await sb(`/chat_agents?id=eq.${agent.id}&user_id=eq.${encodeURIComponent(cuenta)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ revisar: !!body.activo }) });
    return json({ ok: true, revisar: !!body.activo });
  }
  if (accion === 'descartar_sugerencia' || accion === 'aplicar_sugerencia') {
    const [sug] = await sb(`/agente_sugerencias?id=eq.${encodeURIComponent(body.id || '')}&user_id=eq.${encodeURIComponent(cuenta)}&select=*&limit=1`) || [];
    if (!sug) return json({ error: 'Esa sugerencia no existe.' }, 404);
    if (sug.estado !== 'pendiente') return json({ error: 'Esa sugerencia ya se resolvió.' }, 409);
    const cerrar = (estado, extra = {}) => sb(`/agente_sugerencias?id=eq.${sug.id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: JSON.stringify({ estado, resuelto_at: new Date().toISOString(), resuelto_por: quien.actorId, ...extra }) });
    if (accion === 'descartar_sugerencia') { await cerrar('descartada'); return json({ ok: true }); }

    const agent = await cargarAgente(cuenta, sug.agent_id);
    if (!agent) { await cerrar('caducada'); return json({ error: 'Ese agente ya no existe.' }, 404); }
    const regla = await getRegla(cuenta, agent.id).catch(() => null);
    // Se detectó con la configuración de entonces: si cambió y ya no cuadra
    // (el texto a reemplazar ya no está, la regla a editar se quitó), caduca.
    const v = validarPropuesta(sug.propuesta, agent, regla);
    if (v.error) { await cerrar('caducada'); return json({ error: 'El agente cambió desde que se detectó esto y la sugerencia ya no aplica. La quitamos.' }, 409); }
    const fila = { actor_id: quien.actorId, correccion: sug.problema, origen: 'revisor', conversation_id: sug.conversation_id,
      mensaje_id: sug.mensaje_id, conversacion: sug.conversacion, respuesta_antes: sug.respuesta_antes, respuesta_despues: sug.respuesta_despues };
    if (v.propuesta.tipo === 'fallo_plataforma') {
      const t = await crearReporte({ cuenta, quien, agent, propuesta: v.propuesta, correccion: 'Detectado por el revisor: ' + sug.problema,
        conversacion: sug.conversacion, extra: { conversation_id: sug.conversation_id, mensaje_id: sug.mensaje_id, sugerencia: sug.id } });
      if (!t?.id) return json({ error: 'No se pudo crear el reporte. Inténtalo de nuevo o escríbenos por soporte.' }, 502);
      const [m] = await sb('/agente_mejoras', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({
        ...fila, user_id: cuenta, agent_id: agent.id, tipo: 'reporte', explicacion: v.propuesta.explicacion || null,
        cambio: v.propuesta.cambio, antes: fotoDelAgente(agent, regla), ticket_id: t.id }) }) || [];
      await cerrar('aplicada', { mejora_id: m?.id || null });
      return json({ ok: true, ticket: t.id });
    }
    const { id } = await aplicarYGuardar({ cuenta, agent, regla, propuesta: v.propuesta, fila });
    await cerrar('aplicada', { mejora_id: id });
    return json({ ok: true, id });
  }

  // Desde el inbox (fase 2) llega una conversación de verdad: los mensajes los
  // lee el servidor, y el agente es el que la atendió, no el que diga el body.
  let real = null;
  if (body.conversation_id) {
    real = await conversacionReal(cuenta, body.conversation_id, body.mensaje_id);
    if (real.error) return json({ error: real.error }, real.status || 400);
  }
  const agent = await cargarAgente(cuenta, real ? real.agentId : body.agent_id);
  if (!agent) return json({ error: real ? 'El agente que atendió esta conversación ya no existe.' : 'Ese agente no existe en tu cuenta.' }, 404);
  const regla = await getRegla(cuenta, agent.id).catch(() => null);
  const mensajes = real ? real.mensajes : Array.isArray(body.mensajes) ? body.mensajes.filter(m => m && (m.role === 'user' || m.role === 'assistant')).slice(-40)
    .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 6000) })) : [];
  const indice = real ? real.indice : Number.isInteger(body.indice) ? body.indice : -1;
  const valido = indice >= 0 && indice < mensajes.length && mensajes[indice].role === 'assistant';

  // ── Proponer ─────────────────────────────────────────────────────────────
  if (accion === 'proponer') {
    const correccion = String(body.correccion || '').trim().slice(0, 2000);
    if (!correccion) return json({ error: 'Cuéntale al entrenador qué estuvo mal o qué debió decir.' }, 400);
    if (!valido) return json({ error: 'Elige una respuesta del agente para corregir.' }, 400);
    const plan = await planDe(cuenta);
    if (plan === undefined) return json({ error: 'No se pudo comprobar tu plan. Reintenta en unos segundos.' }, 503);
    const cupo = cupoMejoras(plan), n = await usadas(cuenta);
    if (cupo === 0) return json({ error: 'Mejorar el agente con IA está disponible desde el plan Pro.' }, 403);
    if (n !== null && n >= cupo) return json({ error: `Usaste las ${cupo} mejoras con IA de este mes. Se renuevan el día 1.` }, 429);

    const r = await llamarEntrenador(agent, regla, mensajes, indice, correccion);
    if (r.uso) await registrarUso({ userId: cuenta, actorId: quien.actorId, origen: ORIGEN, agente: agent.id, modelo: r.modelo || MODELO, uso: r.uso });
    if (r.error) return json({ error: r.error }, 502);
    const v = validarPropuesta(r.texto, agent, regla);
    if (v.error) return json({ error: v.error }, 422);
    if (v.propuesta.pregunta) return json({ propuesta: v.propuesta, pregunta: v.propuesta.pregunta });
    return json({ propuesta: v.propuesta, resumen: resumenDelCambio(agent, regla, v.propuesta) });
  }

  // La propuesta vuelve del navegador: se valida OTRA vez contra lo guardado.
  // Lo que se aplica es lo que el servidor comprobó, no lo que diga el cliente.
  const v = validarPropuesta(body.propuesta, agent, regla);
  if (v.error) return json({ error: v.error }, 422);
  const propuesta = v.propuesta;
  if (propuesta.pregunta) return json({ error: 'A la propuesta le falta un dato: respóndele al entrenador primero.' }, 400);

  // ── Probar ───────────────────────────────────────────────────────────────
  if (accion === 'probar') {
    if (!valido) return json({ error: 'Elige una respuesta del agente para corregir.' }, 400);
    if (propuesta.tipo === 'fallo_plataforma') return json({ error: 'Un fallo de Acuarius no se prueba: se reporta al equipo.' }, 400);
    if (await ensayosDeHoy(cuenta) >= TOPE_ENSAYOS) return json({ error: `Llegaste al tope de ${TOPE_ENSAYOS} mensajes de prueba por día. Puedes aplicar el cambio sin probarlo o volver mañana.` }, 429);
    // El saludo no tiene mensaje anterior que repetir: se prueba con un «Hola».
    const previos = indice > 0 ? mensajes.slice(0, indice) : [{ role: 'user', content: 'Hola' }];
    const nuevo = aplicarPropuesta(agent, regla, propuesta);
    const cambiado = {};
    for (const k of CAMPOS_AGENTE) cambiado[k] = nuevo.agente[k];
    const e = await ensayarAgente({
      userId: cuenta, agentId: agent.id, canal: 'whatsapp', mensajes: previos,
      agenteCambiado: cambiado, reglaCambiada: nuevo.regla,
    });
    if (!e.ok) return json({ error: e.error || 'No se pudo probar el cambio.' }, 502);
    return json({ texto: e.texto, bruto: e.bruto });
  }

  // ── Aplicar ──────────────────────────────────────────────────────────────
  if (accion === 'aplicar') {
    const correccion = String(body.correccion || '').trim().slice(0, 2000);
    const antes = fotoDelAgente(agent, regla);
    const fila = {
      user_id: cuenta, agent_id: agent.id, actor_id: quien.actorId,
      tipo: propuesta.tipo === 'fallo_plataforma' ? 'reporte' : propuesta.tipo,
      correccion, explicacion: propuesta.explicacion || null, cambio: propuesta.cambio, antes,
      conversacion: valido ? mensajes.slice(0, indice + 1).map(m => ({ role: m.role, content: limpio(m.content) })) : null,
      respuesta_antes: valido ? limpio(mensajes[indice].content).slice(0, 4000) : null,
      respuesta_despues: String(body.respuesta_despues || '').slice(0, 4000) || null,
      ...(real ? { origen: 'inbox', conversation_id: body.conversation_id, mensaje_id: body.mensaje_id } : {}),
    };

    if (propuesta.tipo === 'fallo_plataforma') {
      // No se toca el agente: es nuestro. Ticket con la conversación dentro.
      const t = await crearReporte({ cuenta, quien, agent, propuesta, correccion, conversacion: fila.conversacion,
        extra: real ? { conversation_id: body.conversation_id, mensaje_id: body.mensaje_id } : {} });
      fila.ticket_id = t?.id || null;
      await sb('/agente_mejoras', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(fila) });
      if (!t?.id) return json({ error: 'No se pudo crear el reporte. Inténtalo de nuevo o escríbenos por soporte.' }, 502);
      return json({ ok: true, ticket: t.id });
    }

    const { id, nuevo } = await aplicarYGuardar({ cuenta, agent, regla, propuesta, fila });
    return json({ ok: true, id, reglas: nuevo.agente.reglas || [] });
  }

  return json({ error: 'Acción desconocida' }, 400);
}
