// api/_revisor-agente.js — «Mejorar el agente», fase 3: el revisor.
//
// Nadie tiene tiempo de leer todas las conversaciones de su agente buscando
// qué corregir. Esto lo hace solo: toma las conversaciones ya terminadas
// (sin mensajes en 2 horas), un revisor barato (Haiku) busca la respuesta del
// agente que salió mal y, si la hay, el mismo entrenador del probador propone
// el cambio y se ensaya cómo respondería. Queda como SUGERENCIA: el dueño la
// aplica o la descarta en el paso «Mejoras». Nada cambia el agente solo.
//
// Lo llama cron-revisor-agente cada 10 minutos. Solo se importa desde edge.

import { getRegla } from './_qualify.js';
import { ensayarAgente } from './_inbox-engine.js';
import { registrarUso } from './_uso-ia.js';
import { registrarError } from './_registro-errores.js';
import { planDeCuenta } from './_cupo-agente.js';
import { validarPropuesta, aplicarPropuesta, resumenDelCambio, CAMPOS_AGENTE,
  promptRevisor, transcripcionRevisor, validarRevision, limpiarBloques, cupoRevision, MAX_PENDIENTES } from './_mejoras-agente.js';
import { sb, llamarEntrenador } from './_mejoras-agente-red.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MODELO_REVISOR = 'claude-haiku-4-5';

const hoyUTC = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

async function contar(ruta) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact', Range: '0-0' } });
    const n = parseInt((r.headers.get('content-range') || '').split('/')[1], 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

async function marcarRevisada(convId) {
  await sb(`/chat_conversations?id=eq.${convId}`, { method: 'PATCH', prefer: 'return=minimal',
    body: JSON.stringify({ revision_agente_at: new Date().toISOString() }) });
}

async function llamarRevisor(system, texto) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELO_REVISOR, max_tokens: 500, system, messages: [{ role: 'user', content: 'CONVERSACIÓN:\n\n' + texto }] }),
  });
  if (!r.ok) throw new Error('Revisor: HTTP ' + r.status);
  const d = await r.json();
  return { texto: (d.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), uso: d.usage, modelo: d.model };
}

// Revisa UNA conversación. Devuelve qué pasó, para el latido y las pruebas.
export async function revisarConversacion(conv, { cuentaPlan } = {}) {
  const cuenta = conv.user_id;
  const [agent] = await sb(`/chat_agents?id=eq.${conv.agent_id}&user_id=eq.${encodeURIComponent(cuenta)}&select=*&limit=1`) || [];
  if (!agent || agent.revisar === false) { await marcarRevisada(conv.id); return 'sin-revisar'; }

  const pendientes = await contar(`/agente_sugerencias?agent_id=eq.${agent.id}&estado=eq.pendiente&select=id`);
  if (pendientes !== null && pendientes >= MAX_PENDIENTES) return 'pendientes-llenas';   // no se marca: se revisa cuando las miren

  const filas = await sb(`/chat_messages?conversation_id=eq.${conv.id}&select=id,role,autor,content,created_at&order=created_at.asc,id.asc&limit=80`) || [];
  const desde = conv.revision_agente_at ? Date.parse(conv.revision_agente_at) : 0;
  const mensajes = filas.filter(f => f.role === 'user' || f.role === 'assistant')
    .map(f => ({ ...f, nuevo: f.autor === 'agente' && Date.parse(f.created_at) > desde }));
  if (!mensajes.some(m => m.nuevo)) { await marcarRevisada(conv.id); return 'nada-del-agente'; }

  const descartadas = (await sb(`/agente_sugerencias?agent_id=eq.${agent.id}&estado=eq.descartada&select=problema&order=resuelto_at.desc&limit=15`) || []).map(d => d.problema);
  const rev = await llamarRevisor(promptRevisor(agent, descartadas, conv.channel || 'whatsapp'), transcripcionRevisor(mensajes));
  await registrarUso({ userId: cuenta, actorId: null, origen: 'revisor', agente: agent.id, modelo: rev.modelo || MODELO_REVISOR, uso: rev.uso });
  const hallazgo = validarRevision(rev.texto, mensajes);
  if (!hallazgo) { await marcarRevisada(conv.id); return 'bien'; }

  const cupo = cupoRevision(cuentaPlan);
  const hoy = await contar(`/agente_sugerencias?user_id=eq.${encodeURIComponent(cuenta)}&creado_at=gte.${hoyUTC()}&select=id`);
  if (hoy !== null && hoy >= cupo.sugerencias) { await marcarRevisada(conv.id); return 'cupo-sugerencias'; }

  // El entrenador recibe el problema como si lo hubiera escrito el dueño.
  const hasta = mensajes.slice(0, hallazgo.indice + 1).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 6000) })).slice(-40);
  const indice = hasta.length - 1;
  const regla = await getRegla(cuenta, agent.id).catch(() => null);
  const ent = await llamarEntrenador(agent, regla, hasta, indice, hallazgo.problema, 'CONVERSACIÓN REAL');
  if (ent.uso) await registrarUso({ userId: cuenta, actorId: null, origen: 'revisor-entrenador', agente: agent.id, modelo: ent.modelo, uso: ent.uso });
  if (ent.error) throw new Error('Entrenador: ' + ent.error);
  const v = validarPropuesta(ent.texto, agent, regla);
  // Si el entrenador necesita preguntar algo, no hay a quién: se deja.
  if (v.error || v.propuesta.pregunta) { await marcarRevisada(conv.id); return 'sin-propuesta'; }
  const propuesta = v.propuesta;

  // Una sugerencia igual a otra pendiente no aporta nada.
  const iguales = await sb(`/agente_sugerencias?agent_id=eq.${agent.id}&estado=eq.pendiente&select=propuesta&limit=20`) || [];
  if (iguales.some(s => JSON.stringify(s.propuesta?.cambio) === JSON.stringify(propuesta.cambio))) { await marcarRevisada(conv.id); return 'repetida'; }

  let despues = null;
  if (propuesta.tipo !== 'fallo_plataforma') {
    const nuevo = aplicarPropuesta(agent, regla, propuesta);
    const cambiado = {};
    for (const k of CAMPOS_AGENTE) cambiado[k] = nuevo.agente[k];
    const e = await ensayarAgente({ userId: cuenta, agentId: agent.id, canal: conv.channel || 'whatsapp',
      mensajes: indice > 0 ? hasta.slice(0, indice) : [{ role: 'user', content: 'Hola' }],
      origen: 'revisor-ensayo', agenteCambiado: cambiado, reglaCambiada: nuevo.regla }).catch(() => null);
    despues = e?.ok ? e.texto : null;
  } else {
    // Un fallo nuestro detectado solo: que lo veamos nosotros también, no solo el cliente.
    await registrarError({ origen: 'servidor', donde: 'revisor.fallo_plataforma', usuario: cuenta,
      error: new Error('El revisor detectó un fallo de Acuarius: ' + (propuesta.cambio.asunto || '')), detalle: propuesta.cambio.detalle });
  }

  await sb('/agente_sugerencias', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
    user_id: cuenta, agent_id: agent.id, conversation_id: conv.id, mensaje_id: mensajes[hallazgo.indice].id,
    problema: hallazgo.problema, propuesta, resumen: resumenDelCambio(agent, regla, propuesta),
    conversacion: hasta.map(m => ({ role: m.role, content: limpiarBloques(m.content) })),
    respuesta_antes: limpiarBloques(mensajes[hallazgo.indice].content), respuesta_despues: despues,
  }) });
  await marcarRevisada(conv.id);
  return 'sugerencia';
}

// Una vuelta del cron: las conversaciones por revisar, de la más vieja a la más
// nueva, hasta agotar el tiempo. El cupo diario es por cuenta.
export async function revisarPendientes({ presupuestoMs = 20000, limite = 30 } = {}) {
  const empezo = Date.now();
  const r = { revisadas: 0, sugerencias: 0, fallidas: 0, saltadas: 0, resultados: {} };
  const convs = await sb('/rpc/conversaciones_por_revisar', { method: 'POST', body: JSON.stringify({ limite }) }) || [];
  const planes = new Map(), usadas = new Map();
  for (const conv of convs) {
    if (Date.now() - empezo > presupuestoMs) break;
    try {
      if (!planes.has(conv.user_id)) {
        const p = await planDeCuenta(conv.user_id).catch(() => ({ ok: false }));
        planes.set(conv.user_id, p.ok ? (p.plan || 'free') : null);
      }
      const plan = planes.get(conv.user_id);
      if (plan === null) { r.saltadas++; continue; }          // Clerk no respondió: se reintenta en la próxima vuelta
      const cupo = cupoRevision(plan);
      if (!usadas.has(conv.user_id)) {
        usadas.set(conv.user_id, await contar(`/ai_usage?user_id=eq.${encodeURIComponent(conv.user_id)}&origen=eq.revisor&created_at=gte.${hoyUTC()}&select=id`) ?? cupo.conversaciones);
      }
      if (cupo.conversaciones === 0) { await marcarRevisada(conv.id); r.saltadas++; continue; }
      if (usadas.get(conv.user_id) >= cupo.conversaciones) { r.saltadas++; continue; }   // mañana
      const res = await revisarConversacion(conv, { cuentaPlan: plan });
      if (!['sin-revisar', 'nada-del-agente', 'pendientes-llenas'].includes(res)) usadas.set(conv.user_id, usadas.get(conv.user_id) + 1);
      r.resultados[res] = (r.resultados[res] || 0) + 1;
      r.revisadas++;
      if (res === 'sugerencia') r.sugerencias++;
    } catch (e) {
      r.fallidas++;
      // Se da por revisada igual: reintentarla en cada vuelta sería pagar el
      // mismo fallo cada 10 minutos. Queda en error_log para verlo.
      await marcarRevisada(conv.id).catch(() => {});
      await registrarError({ origen: 'servidor', donde: 'revisor.conversacion', usuario: conv.user_id, error: e, detalle: conv.id });
    }
  }
  return r;
}
