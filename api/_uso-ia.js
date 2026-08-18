// api/_uso-ia.js
// Registra cada llamada al modelo con sus tokens y su costo.
//
// Existe para poder responder tres preguntas que hoy no tienen respuesta: cuánto
// gasta cada cuenta, en qué se le va, y a partir de qué punto un cupo tendría
// sentido. Sin esto, cualquier límite que se ponga es adivinar.
//
// Nunca lanza: que falle el registro no puede tumbar la respuesta que el usuario
// está esperando. Un dato de consumo perdido cuesta mucho menos que un chat roto.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// USD por millón de tokens. Precios de lista de Anthropic — al cambiarlos, el
// histórico NO se recalcula: cada fila guarda el costo del momento en que pasó.
const TARIFAS = {
  'claude-sonnet-5':             { in: 3,  out: 15, cw: 3.75, cr: 0.30 },
  'claude-sonnet-4-6':           { in: 3,  out: 15, cw: 3.75, cr: 0.30 },
  'claude-haiku-4-5':            { in: 1,  out: 5,  cw: 1.25, cr: 0.10 },
  'claude-haiku-4-5-20251001':   { in: 1,  out: 5,  cw: 1.25, cr: 0.10 },
};
// Un modelo nuevo no debe registrarse a costo cero: se cobra como Sonnet, que es
// lo caro, para que el número peque de prudente y no de optimista.
const POR_DEFECTO = { in: 3, out: 15, cw: 3.75, cr: 0.30 };

export function costoDe(modelo, u = {}) {
  const t = TARIFAS[modelo] || POR_DEFECTO;
  return (
    (u.input_tokens || 0) * t.in +
    (u.output_tokens || 0) * t.out +
    (u.cache_creation_input_tokens || 0) * t.cw +
    (u.cache_read_input_tokens || 0) * t.cr
  ) / 1e6;
}

// A qué cuenta se le imputa el gasto: la del dueño, no la del miembro que lo
// hizo. Se resuelve al registrar y no al consultar para que el histórico no
// cambie si alguien deja el equipo.
export async function cuentaDe(actorId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(actorId)}&status=eq.active&select=owner_user_id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const tw = r.ok ? (await r.json())?.[0] : null;
    return tw?.owner_user_id || actorId;
  } catch { return actorId; }
}

/**
 * userId  — la cuenta a la que se imputa (el dueño, no el miembro)
 * actorId — quién la hizo, cuando es un miembro del equipo
 * origen  — agente | whatsapp | soporte | copiloto | propuesta
 * uso     — el objeto 'usage' tal como lo devuelve Anthropic
 */
export async function registrarUso({ userId, actorId, origen, agente, modelo, uso }) {
  try {
    if (!userId || !uso) return;
    const costo = costoDe(modelo, uso);
    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        actor_id: actorId || null,
        origen,
        agente: agente || null,
        modelo: modelo || null,
        tokens_in: uso.input_tokens || 0,
        tokens_out: uso.output_tokens || 0,
        cache_write: uso.cache_creation_input_tokens || 0,
        cache_read: uso.cache_read_input_tokens || 0,
        costo: Number(costo.toFixed(6)),
      }),
    });
  } catch (e) {
    console.error('registrarUso:', e?.message);
  }
}
