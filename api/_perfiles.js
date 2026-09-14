// api/_perfiles.js — quién es quien pregunta, y a qué tiene derecho.
//
// EL SERVIDOR ES LA VERDAD. Esconder una pestaña en el navegador no es un
// permiso: es una sugerencia. Quien sepa abrir la consola —o simplemente pegue
// una URL— llega igual al endpoint. Por eso el perfil se comprueba AQUÍ, y el
// cliente solo recibe la lista de lo que puede ver para pintar el menú.
//
// Solo para funciones EDGE. Ver la nota de CLAUDE.md sobre api/_*.js.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Los perfiles ────────────────────────────────────────────────────────────
//
// `vendedor` se mantiene como sinónimo de `ventas`: había invitaciones enviadas
// con ese nombre antes de que existieran los perfiles, y renombrarlas en la base
// habría dejado a esa gente sin entrar el día que aceptara. Se traduce al leer.
export const PERFILES = {
  admin: {
    etiqueta: 'Administrador',
    descripcion: 'Ve y hace todo en la cuenta, incluido invitar y cambiar perfiles. No toca el plan ni al dueño.',
    modulos: ['crm', 'marketing', 'conversaciones', 'analisis', 'agentes'],
    gestionaEquipo: true,
    soloLoSuyoEnReportes: false,
  },
  ventas: {
    etiqueta: 'Ventas',
    descripcion: 'Trabaja los leads y atiende conversaciones. No entra a Marketing ni a los agentes, y en los reportes solo ve su propia gestión.',
    modulos: ['crm', 'conversaciones', 'analisis'],
    gestionaEquipo: false,
    // En Análisis solo cuentan SUS leads y SUS tareas. Un comercial no tiene por
    // qué ver cuánto cerró el de al lado: eso es material de quien dirige.
    soloLoSuyoEnReportes: true,
  },
  mercadeo: {
    etiqueta: 'Mercadeo',
    descripcion: 'Todo lo de Ventas, más Marketing y los agentes. No toca el equipo ni los permisos.',
    modulos: ['crm', 'marketing', 'conversaciones', 'analisis', 'agentes'],
    gestionaEquipo: false,
    soloLoSuyoEnReportes: false,
  },
};

// El dueño de la cuenta no tiene fila en team_members: se le trata como admin,
// pero se marca aparte (`esDueno`) porque hay cosas que solo él puede tocar —el
// plan, la facturación— y porque nadie debe poder quitarle acceso.

export function normalizarPerfil(rol) {
  const r = String(rol || '').toLowerCase();
  if (r === 'vendedor') return 'ventas';          // nombre viejo
  return PERFILES[r] ? r : 'ventas';              // desconocido = el más limitado
}

/**
 * Resuelve quién pregunta. Devuelve siempre:
 *   userId    — la cuenta sobre la que se opera (la del DUEÑO si es un miembro)
 *   actorId   — quién pregunta de verdad
 *   esMiembro — true si actorId !== userId
 *   perfil    — 'admin' | 'ventas' | 'mercadeo'  (el dueño va como 'admin')
 *   nombre    — nombre del miembro, para firmar actividades
 *
 * Si la consulta falla LANZA. No se puede seguir: sin ella un miembro operaría
 * sobre su propia cuenta en vez de la del dueño y le devolveríamos datos de otra
 * cuenta como si fueran los suyos. Mejor un error que el tablero de otro.
 */
export async function quienPregunta(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}` +
    `&status=eq.active&select=owner_user_id,member_name,member_email,role&limit=1`,
    { headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error('No se pudo verificar la cuenta: HTTP ' + res.status);
  const fila = (await res.json())?.[0];

  if (!fila || !fila.owner_user_id) {
    return { userId, actorId: userId, esMiembro: false, perfil: 'admin', esDueno: true, nombre: null };
  }
  return {
    userId: fila.owner_user_id,
    actorId: userId,
    esMiembro: true,
    perfil: normalizarPerfil(fila.role),
    esDueno: false,
    nombre: fila.member_name || fila.member_email || null,
  };
}

/** ¿Este perfil llega a este módulo? El dueño siempre. */
export function puedeVer(perfil, modulo) {
  const p = PERFILES[normalizarPerfil(perfil)];
  return !!p && p.modulos.includes(modulo);
}

/** ¿Puede invitar, cambiar perfiles y quitar gente? */
export function gestionaEquipo(perfil) {
  const p = PERFILES[normalizarPerfil(perfil)];
  return !!p && p.gestionaEquipo;
}

/**
 * Corta la petición si el perfil no llega al módulo. Devuelve una Response para
 * devolver tal cual, o null si puede pasar.
 *
 * El mensaje dice QUÉ perfil hace falta, no solo «no autorizado»: quien lo vea
 * es un comercial al que su jefe no le dio ese acceso, y tiene que saber a quién
 * pedírselo en vez de pensar que la aplicación está rota.
 */
export function exigeModulo(quien, modulo) {
  if (puedeVer(quien.perfil, modulo)) return null;
  const etiqueta = PERFILES[normalizarPerfil(quien.perfil)]?.etiqueta || quien.perfil;
  return new Response(JSON.stringify({
    error: `Tu perfil (${etiqueta}) no tiene acceso a esta sección. Pídeselo al administrador de la cuenta.`,
    sin_permiso: true,
    modulo,
  }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

/** ¿Sus reportes se limitan a su propia gestión? */
export function soloLoSuyo(perfil) {
  return !!PERFILES[normalizarPerfil(perfil)]?.soloLoSuyoEnReportes;
}

/**
 * El plan, la facturación y la suscripción son SOLO del dueño. Un administrador
 * invitado gestiona el equipo y los módulos, pero no puede cambiar lo que se
 * paga ni dejar fuera a quien paga. Por eso `esDueno` va aparte del perfil.
 */
export function tocaElPlan(quien) {
  return !!quien && quien.esDueno === true;
}

/**
 * Nadie puede quitar, degradar ni tocar la fila del dueño. Como el dueño no
 * tiene fila en team_members, en la práctica esto protege de que un admin
 * invitado se quite de encima a otro admin y se quede solo con la cuenta: se
 * comprueba en /api/team antes de cualquier baja o cambio de perfil.
 */
export function puedeTocarA(quien, filaObjetivo) {
  if (!gestionaEquipo(quien.perfil) && !quien.esDueno) return false;
  if (!filaObjetivo) return false;
  // Nadie se cambia el perfil a sí mismo: subirse solo a admin vacía la regla.
  if (filaObjetivo.member_user_id && filaObjetivo.member_user_id === quien.actorId) return false;
  return true;
}

/** Lo que el cliente necesita para pintar el menú. Nunca para decidir permisos. */
export function paraElCliente(quien) {
  const p = PERFILES[normalizarPerfil(quien.perfil)];
  return {
    es_miembro: quien.esMiembro,
    perfil: normalizarPerfil(quien.perfil),
    perfil_etiqueta: quien.esDueno ? 'Dueño' : p.etiqueta,
    modulos: p.modulos,
    gestiona_equipo: quien.esDueno || p.gestionaEquipo,
    solo_lo_suyo: !!p.soloLoSuyoEnReportes,
    toca_el_plan: quien.esDueno === true,
  };
}
