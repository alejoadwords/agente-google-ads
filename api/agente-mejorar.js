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
import { inicioDelMes, planDeCuenta } from './_cupo-agente.js';
import { promptEntrenador, validarPropuesta, aplicarPropuesta, resumenDelCambio, fotoDelAgente, CAMPOS_AGENTE } from './_mejoras-agente.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MODELO = 'claude-sonnet-5';
const ORIGEN = 'mejora';

// Cada propuesta es una llamada al modelo más caro: con cupo, como todo lo de IA.
export const CUPO_MEJORAS = { free: 0, trial: 20, pro: 60, individual: 60, agency: 200, agencia: 200, admin: 1000 };
export function cupoMejoras(plan) {
  const p = String(plan || '').toLowerCase().trim();
  return CUPO_MEJORAS[p] !== undefined ? CUPO_MEJORAS[p] : CUPO_MEJORAS.pro;
}

const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { ...init, headers: sbH(init.prefer ? { Prefer: init.prefer } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const limpio = (t) => String(t || '')
  .replace(/\[(CAPTURA|CALIFICACION|ESCALAR|RESERVA|CANCELAR_CITA|CAMBIAR_CITA|FOTOS)\b[\s\S]*?\](\s*\])?/g, '').trim();

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

async function cargarAgente(cuenta, agentId) {
  if (!agentId) return null;
  return (await sb(`/chat_agents?id=eq.${encodeURIComponent(agentId)}&user_id=eq.${encodeURIComponent(cuenta)}&select=*&limit=1`))?.[0] || null;
}

// La conversación del probador hasta el mensaje corregido, en texto, marcándolo.
function transcripcion(mensajes, indice) {
  return (mensajes || []).slice(0, indice + 1).map((m, i) =>
    (m.role === 'user' ? 'CLIENTE' : 'AGENTE') + (i === indice ? ' ← ESTA ES LA RESPUESTA QUE HAY QUE CORREGIR' : '') + ':\n' + limpio(m.content)
  ).join('\n\n');
}

async function llamarEntrenador(agent, regla, mensajes, indice, correccion) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'Falta la clave de la IA en el servidor.' };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO, max_tokens: 2000,
      system: promptEntrenador(agent, regla),
      messages: [{ role: 'user', content: 'CONVERSACIÓN DE PRUEBA:\n\n' + transcripcion(mensajes, indice) +
        '\n\nLO QUE DICE EL CLIENTE QUE ESTUVO MAL O QUE DEBIÓ DECIR:\n' + correccion }],
    }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e?.message || e) }));
  if (!r.ok) {
    return { error: r.status === 529 || r.status === 429 ? 'La IA está saturada en este momento. Vuelve a intentarlo en unos minutos.' : 'El entrenador no respondió. Vuelve a intentarlo en un momento.' };
  }
  const d = await r.json();
  const texto = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (d.stop_reason === 'max_tokens') return { error: 'La propuesta llegó incompleta. Vuelve a intentarlo.', uso: d.usage, modelo: d.model };
  return { texto, uso: d.usage, modelo: d.model };
}

export default async function handler(req) {
  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'agente-mejorar'), 401);
  let quien;
  try { quien = await quienPregunta(sesion.id); } catch { return json({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }
  const corte = exigeModulo(quien, 'agentes');
  if (corte) return corte;
  const cuenta = quien.userId;

  // ── Historial, reglas y cupo ─────────────────────────────────────────────
  if (req.method === 'GET') {
    const agentId = new URL(req.url).searchParams.get('agent_id');
    const agent = await cargarAgente(cuenta, agentId);
    if (!agent) return json({ error: 'Ese agente no existe en tu cuenta.' }, 404);
    const historial = await sb(`/agente_mejoras?agent_id=eq.${agent.id}&user_id=eq.${encodeURIComponent(cuenta)}` +
      `&select=id,tipo,correccion,explicacion,cambio,respuesta_antes,respuesta_despues,creado_at,deshecho_at,actor_id&order=creado_at.desc&limit=60`) || [];
    const plan = await planDe(cuenta);
    const n = await usadas(cuenta);
    return json({ reglas: agent.reglas || [], historial, cupo: { cupo: cupoMejoras(plan), usadas: n } });
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

  const agent = await cargarAgente(cuenta, body.agent_id);
  if (!agent) return json({ error: 'Ese agente no existe en tu cuenta.' }, 404);
  const regla = await getRegla(cuenta, agent.id).catch(() => null);
  const mensajes = Array.isArray(body.mensajes) ? body.mensajes.filter(m => m && (m.role === 'user' || m.role === 'assistant')).slice(-40)
    .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 6000) })) : [];
  const indice = Number.isInteger(body.indice) ? body.indice : -1;
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
    };

    if (propuesta.tipo === 'fallo_plataforma') {
      // No se toca el agente: es nuestro. Ticket con la conversación dentro.
      const [t] = await sb('/support_tickets', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({
        user_id: cuenta, author_user_id: quien.actorId,
        email: await correoDe(quien.actorId), plan: (await planDe(cuenta)) || null,
        asunto: 'Agente: ' + propuesta.cambio.asunto,
        detalle: propuesta.cambio.detalle + '\n\nLo que escribió el cliente: ' + correccion,
        contexto: { origen: 'mejorar-agente', agente: agent.id, agente_nombre: agent.name, conversacion: fila.conversacion },
      }) }) || [];
      fila.ticket_id = t?.id || null;
      await sb('/agente_mejoras', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(fila) });
      if (!t?.id) return json({ error: 'No se pudo crear el reporte. Inténtalo de nuevo o escríbenos por soporte.' }, 502);
      return json({ ok: true, ticket: t.id });
    }

    const nuevo = aplicarPropuesta(agent, regla, propuesta);
    const patch = { updated_at: new Date().toISOString() };
    for (const k of CAMPOS_AGENTE) if (JSON.stringify(nuevo.agente[k] ?? null) !== JSON.stringify(agent[k] ?? null)) patch[k] = nuevo.agente[k];
    if (Object.keys(patch).length > 1) {
      await sb(`/chat_agents?id=eq.${agent.id}&user_id=eq.${encodeURIComponent(cuenta)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(patch) });
    }
    if (JSON.stringify(nuevo.regla ?? null) !== JSON.stringify(regla ?? null) && nuevo.regla) await saveRegla(cuenta, agent.id, nuevo.regla);
    fila.despues = fotoDelAgente(nuevo.agente, nuevo.regla);
    const [m] = await sb('/agente_mejoras', { method: 'POST', prefer: 'return=representation', body: JSON.stringify(fila) }) || [];
    return json({ ok: true, id: m?.id || null, reglas: nuevo.agente.reglas || [] });
  }

  return json({ error: 'Acción desconocida' }, 400);
}
