// api/_qualify.js
// Calificación de leads en la conversación, antes de molestar a un comercial.
//
// La idea: el agente ya está hablando con la persona, así que aprovecha esa
// conversación para averiguar lo que el negocio necesita saber (presupuesto,
// zona, cuándo compra…). Cuando tiene las respuestas, el código —no el modelo—
// decide si el lead pasa al comercial o se queda con el bot.
//
// Es por agente, no por canal: el mismo agente atiende WhatsApp, Messenger,
// Instagram, TikTok o lo que venga, y califica igual en todos.
//
// La config vive en user_profiles con un agent_key reservado, como el resto de
// la configuración sin esquema versionado.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const QUALIFY_KEY = '__qualify_rules__';

// Un criterio: qué preguntar y qué respuesta lo da por bueno.
// { clave: 'presupuesto', pregunta: '¿Qué presupuesto maneja?', condicion: 'más de 200 millones' }
export const DEFAULT_REGLA = {
  activo: false,
  criterios: [],
  minimo: 0,          // cuántos criterios debe cumplir; 0 = todos
  al_calificar: { escalar: true, etapa: 'calificado', etiqueta: 'calificado' },
  al_descartar: { etiqueta: 'no-calificado' },
};

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

function limpiarTexto(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

export function normalizarRegla(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const criterios = (Array.isArray(r.criterios) ? r.criterios : [])
    .map(c => ({
      clave: limpiarTexto(c?.clave, 30).toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'criterio',
      pregunta: limpiarTexto(c?.pregunta, 200),
      condicion: limpiarTexto(c?.condicion, 200),
    }))
    .filter(c => c.pregunta)
    .slice(0, 8); // más de 8 preguntas deja de ser una conversación
  const al = r.al_calificar && typeof r.al_calificar === 'object' ? r.al_calificar : {};
  const ad = r.al_descartar && typeof r.al_descartar === 'object' ? r.al_descartar : {};
  return {
    activo: !!r.activo && criterios.length > 0,
    criterios,
    minimo: Math.min(Math.max(parseInt(r.minimo || 0) || 0, 0), criterios.length),
    al_calificar: {
      escalar: al.escalar !== false,
      etapa: limpiarTexto(al.etapa, 40) || 'calificado',
      etiqueta: limpiarTexto(al.etiqueta, 30).toLowerCase() || 'calificado',
    },
    al_descartar: {
      etiqueta: limpiarTexto(ad.etiqueta, 30).toLowerCase() || 'no-calificado',
    },
  };
}

// Las reglas se guardan todas juntas: { [agentId]: regla }
async function leerBlob(userId) {
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${QUALIFY_KEY}&select=profile_data&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    return rows?.[0]?.profile_data || {};
  } catch { return {}; }
}

export async function getRegla(userId, agentId) {
  const blob = await leerBlob(userId);
  return normalizarRegla(blob[agentId]);
}

export async function saveRegla(userId, agentId, regla) {
  const blob = await leerBlob(userId);
  // on_conflict obligatorio: sin él el segundo guardado choca con el índice
  // único (user_id, agent_key).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
    method: 'POST',
    headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      agent_key: QUALIFY_KEY,
      profile_data: { ...blob, [agentId]: normalizarRegla(regla) },
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

// ── Lo que se le añade al prompt del agente ─────────────────────────────────
// No le pedimos al modelo que decida si el lead sirve: le pedimos que averigüe
// y reporte. Quién pasa al comercial se decide abajo, en código, que es
// auditable y no cambia de opinión entre mensajes.
export function bloqueDePrompt(regla) {
  if (!regla?.activo) return '';
  const lista = regla.criterios
    .map((c, i) => `${i + 1}. ${c.clave} — averigua: ${c.pregunta}${c.condicion ? `\n   Se considera que cumple si: ${c.condicion}` : ''}`)
    .join('\n');
  const json = regla.criterios
    .map(c => `"${c.clave}": {"valor": "lo que te dijo", "cumple": true|false}`)
    .join(', ');

  return `

LO QUE NECESITAS AVERIGUAR EN ESTA CONVERSACIÓN:
${lista}

Cómo hacerlo:
- Una pregunta a la vez, cuando venga a cuento. Nunca sueltes el cuestionario entero de golpe
- Primero responde lo que te preguntaron; la pregunta tuya va después, encadenada
- Si la persona no quiere responder algo, no insistas más de una vez: márcalo como no cumplido y sigue
- Si ya te dieron el dato antes en la conversación, no lo vuelvas a preguntar

En CADA mensaje tuyo, incluye al final este bloque (invisible para el usuario):
[CALIFICACION: {${json}}]

Reglas del bloque, importantes:
- Repite SIEMPRE todos los puntos que ya tengas respondidos, no solo el último. El bloque es la foto completa de lo que sabes hasta ahora
- Omite únicamente los puntos que todavía no te hayan respondido
- Si la persona ya te dio el dato en cualquier mensaje anterior, cuenta como respondido aunque no lo hayas preguntado tú
- Marca "cumple" según la condición de cada punto, sin adornar: si la respuesta no llega a lo pedido, es false`;
}

export function extraerCalificacion(text) {
  const match = String(text || '').match(/\[CALIFICACION:\s*(\{.*?\})\]/s);
  if (!match) return {};
  try {
    const raw = JSON.parse(match[1]);
    const out = {};
    for (const k of Object.keys(raw || {})) {
      const v = raw[k];
      if (v && typeof v === 'object') out[k] = { valor: limpiarTexto(v.valor, 200), cumple: !!v.cumple };
    }
    return out;
  } catch { return {}; }
}

// Veredicto determinista: 'pendiente' mientras falten respuestas,
// 'calificado' o 'descartado' cuando ya están todas.
export function evaluar(regla, respuestas) {
  if (!regla?.activo) return { estado: 'inactivo' };
  const claves = regla.criterios.map(c => c.clave);
  const contestadas = claves.filter(k => respuestas?.[k]);
  const cumplidas = claves.filter(k => respuestas?.[k]?.cumple);
  const minimo = regla.minimo > 0 ? regla.minimo : claves.length;

  // Nada de descartar antes de tener todas las respuestas: el modelo a veces
  // reporta como respondido-y-no-cumple algo que todavía no ha preguntado, y
  // etiquetar a alguien de "no calificado" por eso es peor que preguntar de más.
  if (contestadas.length < claves.length) {
    return { estado: 'pendiente', cumplidas: cumplidas.length, total: claves.length, minimo };
  }
  return {
    estado: cumplidas.length >= minimo ? 'calificado' : 'descartado',
    cumplidas: cumplidas.length, total: claves.length, minimo,
  };
}

export function resumenLegible(regla, respuestas) {
  return (regla?.criterios || [])
    .filter(c => respuestas?.[c.clave])
    .map(c => `${c.pregunta} → ${respuestas[c.clave].valor || '—'} ${respuestas[c.clave].cumple ? '✅' : '❌'}`)
    .join('\n');
}

// ── Efectos sobre el lead ───────────────────────────────────────────────────
// Silencioso a propósito: que falle esto no puede tumbar la respuesta al
// contacto, que es lo único que la persona del otro lado está esperando.
export async function aplicarVeredicto({ userId, leadId, regla, veredicto, respuestas, canal }) {
  if (!leadId || !regla?.activo) return;
  const califica = veredicto.estado === 'calificado';
  const etiqueta = califica ? regla.al_calificar.etiqueta : regla.al_descartar.etiqueta;

  try {
    const lead = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=*`, { headers: sb() })
      .then(r => r.json()).then(r => r?.[0]);
    if (!lead) return;

    // Un veredicto puede cambiar si la persona da un dato mejor más adelante, así
    // que la etiqueta contraria se quita: nadie debe quedar marcado como las dos.
    const contraria = califica ? regla.al_descartar.etiqueta : regla.al_calificar.etiqueta;
    const tags = Array.from(new Set(
      [...(lead.tags || []).filter(t => t !== contraria), etiqueta].filter(Boolean)
    ));
    const update = {
      tags,
      custom_fields: {
        ...(lead.custom_fields || {}),
        calificacion: {
          estado: veredicto.estado,
          cumplidas: veredicto.cumplidas,
          total: veredicto.total,
          respuestas,
          canal,
          fecha: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    };
    // La etapa solo se mueve hacia adelante y solo si califica: bajar de etapa
    // a alguien que un comercial ya movió a mano sería pisarle el trabajo.
    if (califica && regla.al_calificar.etapa && lead.stage === 'nuevo') {
      update.stage = regla.al_calificar.etapa;
    }
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
      method: 'PATCH', headers: sb(), body: JSON.stringify(update),
    });

    await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({
        lead_id: leadId, user_id: userId, type: 'nota',
        content: (califica
          ? `Calificado por el agente de ${canal} (${veredicto.cumplidas} de ${veredicto.total})`
          : `No calificado por el agente de ${canal} (${veredicto.cumplidas} de ${veredicto.total})`)
          + '\n' + resumenLegible(regla, respuestas),
        metadata: { sistema: true, calificacion: veredicto.estado, canal },
      }),
    }).catch(() => {});

    return { ...lead, ...update };
  } catch (e) {
    console.error('aplicarVeredicto:', e);
  }
}
