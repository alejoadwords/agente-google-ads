// api/_followup.js
// Tareas de seguimiento automáticas.
//
// El problema que resuelve: con la calificación y el reparto ya funcionando, el
// lead llega al comercial pero nada garantiza que lo trabaje. Aquí se crea sola
// la tarea de primer contacto en cuanto el lead tiene dueño, con un plazo, para
// que aparezca en su lista de pendientes y en el resumen diario.
//
// La regla es por cuenta y vive en user_profiles, como el resto de la
// configuración sin esquema versionado.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const FOLLOWUP_KEY = '__followup_rules__';

export const DEFAULT_REGLA = {
  primer_contacto: true,   // crear tarea en cuanto el lead tiene comercial
  horas: 4,                // plazo para ese primer contacto
  titulo: 'Primer contacto',
  solo_calificados: false, // si el negocio solo quiere tareas de los que califican
};

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

export function normalizarRegla(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    primer_contacto: r.primer_contacto !== false,
    // De media hora a una semana: fuera de ahí deja de ser un plazo
    horas: Math.min(Math.max(Number(r.horas) || DEFAULT_REGLA.horas, 0.5), 168),
    titulo: String(r.titulo || DEFAULT_REGLA.titulo).trim().slice(0, 80) || DEFAULT_REGLA.titulo,
    solo_calificados: !!r.solo_calificados,
  };
}

export async function getRegla(userId) {
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${FOLLOWUP_KEY}&select=profile_data&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    return normalizarRegla(rows?.[0]?.profile_data);
  } catch { return normalizarRegla(null); }
}

export async function saveRegla(userId, regla) {
  // on_conflict obligatorio: sin él el segundo guardado choca con el índice
  // único (user_id, agent_key).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
    method: 'POST',
    headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      agent_key: FOLLOWUP_KEY,
      profile_data: normalizarRegla(regla),
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

// Crea la tarea de primer contacto. Silenciosa: que falle no puede tumbar la
// creación ni la asignación del lead.
export async function crearTareaPrimerContacto(userId, lead, comercial) {
  try {
    if (!lead?.id) return null;
    const regla = await getRegla(userId);
    if (!regla.primer_contacto) return null;
    if (regla.solo_calificados && lead.custom_fields?.calificacion?.estado !== 'calificado') return null;

    // Si ya tiene una tarea pendiente no se le apila otra: el comercial vería
    // dos recordatorios de lo mismo cada vez que el lead se reasigna.
    const yaHay = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&lead_id=eq.${lead.id}&done=is.false&type=eq.task&select=id&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (yaHay?.length) return null;

    const vence = new Date(Date.now() + regla.horas * 3600000).toISOString();
    const quien = comercial?.nombre ? ` (${comercial.nombre})` : '';
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({
        user_id: userId,
        client_id: lead.client_id || null,
        lead_id: lead.id,
        type: 'task',
        title: `${regla.titulo}: ${lead.name || 'Lead nuevo'}`,
        description: `Lead de ${lead.source || 'origen desconocido'}${quien}.`
          + (lead.phone ? `\nTeléfono: ${lead.phone}` : '')
          + (lead.email ? `\nEmail: ${lead.email}` : ''),
        due_at: vence,
        done: false,
      }),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null);

    return rows?.[0] || null;
  } catch (e) {
    console.error('crearTareaPrimerContacto:', e);
    return null;
  }
}
