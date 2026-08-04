// Regla de entrada al pipeline por canal.
//
// Decide qué pasa con una conversación nueva del inbox: si crea lead sola, si
// espera a tener datos de contacto, o si no crea nada hasta que alguien lo
// decida a mano desde Conversaciones.
//
// Se guarda en user_profiles con un agent_key reservado (mismo truco que la
// cartera de clientes): así no hace falta migrar el esquema, que no está
// versionado en el repo.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const POLICY_KEY = '__channel_policy__';
export const CHANNELS = ['whatsapp', 'messenger', 'instagram', 'tiktok'];
export const MODES = ['manual', 'on_contact', 'always'];

// Por defecto se mantiene lo que la plataforma ya hacía: el lead nace cuando el
// agente consigue nombre, teléfono o correo.
export const DEFAULT_POLICY = { mode: 'on_contact', stage: 'nuevo', tag: '' };

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

export function normalizePolicy(raw, channel) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const mode = MODES.includes(p.mode) ? p.mode : DEFAULT_POLICY.mode;
  const stage = String(p.stage || DEFAULT_POLICY.stage).trim().slice(0, 40) || 'nuevo';
  // Etiqueta vacía = se usa el nombre del canal, que es el comportamiento previo
  const tag = String(p.tag ?? '').trim().toLowerCase().slice(0, 30) || String(channel || '').toLowerCase();
  return { mode, stage, tag };
}

// Devuelve { whatsapp: {...}, messenger: {...}, instagram: {...}, tiktok: {...} }
export async function getPolicies(userId) {
  const out = {};
  let stored = {};
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${POLICY_KEY}&select=profile_data&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    stored = rows?.[0]?.profile_data?.policies || {};
  } catch {}
  for (const ch of CHANNELS) out[ch] = normalizePolicy(stored[ch], ch);
  return out;
}

export async function getPolicy(userId, channel) {
  const all = await getPolicies(userId);
  return all[channel] || normalizePolicy(null, channel);
}

export async function savePolicies(userId, policies) {
  const clean = {};
  for (const ch of CHANNELS) {
    if (policies && policies[ch]) clean[ch] = normalizePolicy(policies[ch], ch);
  }
  // on_conflict obligatorio: sin él PostgREST infiere ON CONFLICT (id) y el
  // segundo guardado revienta contra el índice único (user_id, agent_key).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
    method: 'POST',
    headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      agent_key: POLICY_KEY,
      profile_data: { policies: clean },
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}
