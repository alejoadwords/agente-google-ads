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
// El título es la marca por la que se reconoce esta tarea: cambiarlo hace que
// deje de encontrar las anteriores y empiece a duplicarlas.
export const TITULO_VENTANA = 'Se cierra la ventana de WhatsApp';

export const DEFAULT_REGLA = {
  primer_contacto: true,   // crear tarea en cuanto el lead tiene comercial
  horas: 4,                // plazo para ese primer contacto
  titulo: 'Primer contacto',
  solo_calificados: false, // si el negocio solo quiere tareas de los que califican
  // Aviso antes de que se cierre la ventana de 24 h de WhatsApp. Es el momento
  // en el que de verdad se pierde dinero: pasada esa hora no se le puede
  // escribir libremente hasta que el cliente vuelva a hablar.
  ventana_24h: true,
  ventana_horas_antes: 4,
  // Aviso por correo cuando alguien del equipo deja una nota interna.
  avisar_notas: true,
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
    ventana_24h: r.ventana_24h !== false,
    // Entre 1 y 12 horas antes: avisar con 20 no es avisar, es duplicar el inbox
    ventana_horas_antes: Math.min(Math.max(Number(r.ventana_horas_antes) || DEFAULT_REGLA.ventana_horas_antes, 1), 12),
    avisar_notas: r.avisar_notas !== false,
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
      `${SUPABASE_URL}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&lead_id=eq.${lead.id}&done=is.false&cancelled_at=is.null&type=eq.task&select=id&limit=1`,
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

// Tarea de "se cierra la ventana". Se separa de la de primer contacto porque
// tiene otro título, otro plazo y otro motivo: aquí no se trata de atender
// rápido, sino de que después de esa hora ya no se puede escribir.
export async function crearTareaVentana(userId, lead, conv, quedan) {
  try {
    if (!lead?.id) return null;
    // Una sola por lead: si ya hay una viva, apilar otra es ruido.
    // El filtro por título se hace aquí y no en la consulta: PostgREST querría
    // el patrón codificado y un espacio mal escapado se traga la condición
    // entera, con lo que nunca encontraría la tarea previa y las duplicaría.
    const abiertas = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&lead_id=eq.${lead.id}` +
      `&done=is.false&cancelled_at=is.null&type=eq.task&select=id,title&limit=20`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if ((abiertas || []).some(t => String(t.title || '').startsWith(TITULO_VENTANA))) return null;

    const vence = new Date(new Date(conv.last_inbound_at).getTime() + 24 * 3600000).toISOString();
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({
        user_id: userId,
        client_id: lead.client_id || null,
        lead_id: lead.id,
        type: 'task',
        title: `${TITULO_VENTANA}: ${lead.name || conv.contact_name || 'Contacto'}`,
        description:
          `Quedan unas ${quedan} horas para poder escribirle libremente por WhatsApp.\n` +
          'Pasado ese plazo hay que esperar a que escriba él, o usar una plantilla aprobada por Meta.' +
          (lead.phone ? `\nTeléfono: ${lead.phone}` : ''),
        due_at: vence,
        done: false,
      }),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null);

    return rows?.[0] || null;
  } catch (e) {
    console.error('crearTareaVentana:', e);
    return null;
  }
}
