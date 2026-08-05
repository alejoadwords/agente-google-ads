// api/_assign.js
// Reparto automático de leads entre los comerciales del equipo.
//
// Regla por fuente (whatsapp, formulario web, meta_ads…): repartir en turnos
// entre los miembros activos, mandar todo a una persona fija, o no asignar y
// dejar que el dueño lo haga a mano. La regla y el puntero del turno viven en
// user_profiles, como la política de canal — el esquema no está versionado y
// no conviene añadir columnas sin necesidad.
//
// El guion bajo evita que Vercel lo publique como endpoint.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const ASSIGN_KEY = '__assign_rules__';
export const MODOS = ['off', 'turnos', 'fijo'];
export const DEFAULT_REGLA = { modo: 'off', fijo: null };

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
  const modo = MODOS.includes(r.modo) ? r.modo : 'off';
  return { modo, fijo: modo === 'fijo' ? (r.fijo || null) : null };
}

async function leerBlob(userId) {
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${ASSIGN_KEY}&select=profile_data&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    return rows?.[0]?.profile_data || {};
  } catch { return {}; }
}

async function guardarBlob(userId, data) {
  // on_conflict obligatorio: sin él el segundo guardado choca con el índice
  // único (user_id, agent_key).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
    method: 'POST',
    headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      agent_key: ASSIGN_KEY,
      profile_data: data,
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

export async function getReglas(userId) {
  const blob = await leerBlob(userId);
  const reglas = blob.reglas || {};
  const out = {};
  for (const k of Object.keys(reglas)) out[k] = normalizarRegla(reglas[k]);
  // 'default' cubre cualquier fuente sin regla propia
  if (!out.default) out.default = { ...DEFAULT_REGLA };
  return out;
}

export async function saveReglas(userId, reglas) {
  const blob = await leerBlob(userId);
  const limpias = {};
  for (const k of Object.keys(reglas || {})) limpias[String(k).slice(0, 40)] = normalizarRegla(reglas[k]);
  return guardarBlob(userId, { ...blob, reglas: limpias });
}

// Miembros que pueden recibir leads: activos y con cuenta ya creada
export async function comercialesActivos(userId) {
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=member_user_id,member_name,member_email&order=created_at.asc`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    return (rows || [])
      .filter(m => m.member_user_id)
      .map(m => ({ id: m.member_user_id, nombre: m.member_name || m.member_email || 'Comercial', email: m.member_email }));
  } catch { return []; }
}

// Devuelve { id, nombre } o null si no toca asignar.
// El turno avanza por fuente, no global: así una fuente con mucho volumen no
// deja a los demás sin repartir en las otras.
export async function siguienteComercial(userId, fuente) {
  const clave = String(fuente || 'default').toLowerCase().slice(0, 40);
  const blob = await leerBlob(userId);
  const reglas = blob.reglas || {};
  const regla = normalizarRegla(reglas[clave] || reglas.default);
  if (regla.modo === 'off') return null;

  const equipo = await comercialesActivos(userId);
  if (!equipo.length) return null;

  if (regla.modo === 'fijo') {
    const uno = equipo.find(m => m.id === regla.fijo);
    return uno || null;
  }

  const turnos = blob.turnos || {};
  const idx = Number.isInteger(turnos[clave]) ? turnos[clave] : -1;
  const elegido = equipo[(idx + 1) % equipo.length];
  await guardarBlob(userId, { ...blob, turnos: { ...turnos, [clave]: (idx + 1) % equipo.length } });
  return elegido;
}


// Aviso al comercial. Si no hay Resend configurado simplemente no se manda:
// el lead ya quedó asignado, que es lo importante.
async function avisarComercial(com, lead, fuente) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !com?.email) return;
  const nombre = lead.name || 'Sin nombre';
  const contacto = [lead.email, lead.phone].filter(Boolean).join(' · ') || 'sin datos de contacto';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Acuarius <crm@app.acuarius.app>',
      to: com.email,
      subject: `Nuevo lead para ti: ${nombre}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <h2 style="color:#111;margin-bottom:4px">Te asignaron un lead</h2>
          <p style="color:#444;margin-top:0">Llegó por <strong>${fuente || 'el CRM'}</strong> y quedó a tu nombre.</p>
          <div style="border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px;margin:16px 0">
            <div style="font-size:16px;font-weight:700;color:#111">${nombre}</div>
            <div style="color:#666;font-size:13px;margin-top:4px">${contacto}</div>
          </div>
          <a href="https://app.acuarius.app/crm" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Abrir el CRM</a>
        </div>`,
    }),
  }).catch(() => {});
}

// Aplica la asignación sobre un lead ya creado. Silencioso a propósito: que
// falle el reparto no puede tumbar la creación del lead.
export async function asignarLead(userId, lead, fuente) {
  try {
    if (!lead?.id || lead.assigned_to) return null;
    const com = await siguienteComercial(userId, fuente || lead.source);
    if (!com) return null;
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
      method: 'PATCH',
      headers: sb(),
      body: JSON.stringify({ assigned_to: com.id, assigned_name: com.nombre, updated_at: new Date().toISOString() }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
      method: 'POST',
      headers: sb(),
      body: JSON.stringify({
        lead_id: lead.id, user_id: userId, type: 'nota',
        content: `Asignado automáticamente a ${com.nombre}`,
        metadata: { asignacion: 'automatica', fuente: fuente || lead.source || null },
      }),
    }).catch(() => {});
    await avisarComercial(com, lead, fuente || lead.source);
    return com;
  } catch (e) {
    console.error('asignarLead:', e);
    return null;
  }
}
