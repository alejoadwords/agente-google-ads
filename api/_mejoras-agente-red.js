// api/_mejoras-agente-red.js — «Mejorar el agente», lo que toca la red.
//
// Lo comparten el endpoint (api/agente-mejorar.js: el cliente corrige) y el
// revisor (api/cron-revisor-agente.js: el sistema detecta solo). La lógica
// pura sigue en _mejoras-agente.js. Solo se importa desde funciones edge.

import { saveRegla } from './_qualify.js';
import { aplicarPropuesta, fotoDelAgente, CAMPOS_AGENTE, promptEntrenador } from './_mejoras-agente.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
export const MODELO_ENTRENADOR = 'claude-sonnet-5';
const MODELO = MODELO_ENTRENADOR;

const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
export async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { ...init, headers: sbH(init.prefer ? { Prefer: init.prefer } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}

export const limpio = (t) => String(t || '')
  .replace(/\[(CAPTURA|CALIFICACION|ESCALAR|RESERVA|CANCELAR_CITA|CAMBIAR_CITA|FOTOS)\b[\s\S]*?\](\s*\])?/g, '').trim();

// La conversación real hasta el mensaje corregido (incluido), como la vio el
// agente: en bruto y con los 40 anteriores como mucho. Solo se corrige lo que
// escribió el agente: un mensaje del equipo o un texto fijo del sistema no se
// arregla cambiando su configuración.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function conversacionReal(cuenta, convId, mensajeId) {
  if (!UUID.test(String(convId || '')) || !UUID.test(String(mensajeId || ''))) return { error: 'Falta el mensaje a corregir.' };
  const [conv] = await sb(`/chat_conversations?id=eq.${convId}&user_id=eq.${encodeURIComponent(cuenta)}&select=id,agent_id&limit=1`) || [];
  if (!conv) return { error: 'Esa conversación no existe en tu cuenta.', status: 404 };
  if (!conv.agent_id) return { error: 'Esta conversación no la atiende un agente de IA.' };
  const [msg] = await sb(`/chat_messages?id=eq.${mensajeId}&conversation_id=eq.${convId}&select=id,role,autor,created_at&limit=1`) || [];
  if (!msg) return { error: 'Ese mensaje no está en la conversación.', status: 404 };
  if (msg.role !== 'assistant' || msg.autor !== 'agente') return { error: 'Solo se pueden corregir los mensajes que escribió el agente.' };
  const filas = await sb(`/chat_messages?conversation_id=eq.${convId}&created_at=lte.${encodeURIComponent(msg.created_at)}` +
    `&select=id,role,content&order=created_at.desc,id.desc&limit=60`) || [];
  // Con la misma hora puede colarse uno posterior: se corta en el corregido.
  const hasta = filas.findIndex(f => f.id === msg.id);
  const mensajes = filas.slice(Math.max(hasta, 0)).slice(0, 40).reverse()
    .filter(f => f.role === 'user' || f.role === 'assistant')
    .map(f => ({ role: f.role, content: String(f.content || '').slice(0, 6000) }));
  return { agentId: conv.agent_id, mensajes, indice: mensajes.length - 1 };
}

export async function cargarAgente(cuenta, agentId) {
  if (!agentId) return null;
  return (await sb(`/chat_agents?id=eq.${encodeURIComponent(agentId)}&user_id=eq.${encodeURIComponent(cuenta)}&select=*&limit=1`))?.[0] || null;
}

// La conversación hasta el mensaje corregido, en texto, marcándolo.
export function transcripcion(mensajes, indice) {
  return (mensajes || []).slice(0, indice + 1).map((m, i) =>
    (m.role === 'user' ? 'CLIENTE' : 'AGENTE') + (i === indice ? ' ← ESTA ES LA RESPUESTA QUE HAY QUE CORREGIR' : '') + ':\n' + limpio(m.content)
  ).join('\n\n');
}

export async function llamarEntrenador(agent, regla, mensajes, indice, correccion, titulo = 'CONVERSACIÓN DE PRUEBA') {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'Falta la clave de la IA en el servidor.' };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO, max_tokens: 2000,
      system: promptEntrenador(agent, regla),
      messages: [{ role: 'user', content: titulo + ':\n\n' + transcripcion(mensajes, indice) +
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

// Guarda una propuesta ya validada: los campos del agente que cambian, la
// calificación si cambia, y la fila del historial con la foto de antes y de
// después (la que permite deshacer). `fila` trae el resto de columnas.
export async function aplicarYGuardar({ cuenta, agent, regla, propuesta, fila }) {
  const nuevo = aplicarPropuesta(agent, regla, propuesta);
  const patch = { updated_at: new Date().toISOString() };
  for (const k of CAMPOS_AGENTE) if (JSON.stringify(nuevo.agente[k] ?? null) !== JSON.stringify(agent[k] ?? null)) patch[k] = nuevo.agente[k];
  if (Object.keys(patch).length > 1) {
    await sb(`/chat_agents?id=eq.${agent.id}&user_id=eq.${encodeURIComponent(cuenta)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(patch) });
  }
  if (JSON.stringify(nuevo.regla ?? null) !== JSON.stringify(regla ?? null) && nuevo.regla) await saveRegla(cuenta, agent.id, nuevo.regla);
  const [m] = await sb('/agente_mejoras', { method: 'POST', prefer: 'return=representation', body: JSON.stringify({
    ...fila, user_id: cuenta, agent_id: agent.id, tipo: propuesta.tipo, explicacion: propuesta.explicacion || null,
    cambio: propuesta.cambio, antes: fotoDelAgente(agent, regla), despues: fotoDelAgente(nuevo.agente, nuevo.regla),
  }) }) || [];
  return { id: m?.id || null, nuevo };
}
