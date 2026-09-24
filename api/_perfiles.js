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
    soloSusLeads: false,
  },
  ventas: {
    etiqueta: 'Ventas',
    descripcion: 'Trabaja los leads y atiende conversaciones. No entra a Marketing ni a los agentes, y en los reportes solo ve su propia gestión.',
    modulos: ['crm', 'conversaciones', 'analisis'],
    gestionaEquipo: false,
    // En Análisis solo cuentan SUS leads y SUS tareas. Un comercial no tiene por
    // qué ver cuánto cerró el de al lado: eso es material de quien dirige.
    soloLoSuyoEnReportes: true,
    // Y en el TABLERO solo ve los leads que le asignaron. Los que no tienen
    // dueño tampoco: un asesor nuevo no debe encontrarse la cartera entera el
    // día que entra. Quien reparte es el administrador, a mano o con el reparto
    // automático.
    soloSusLeads: true,
  },
  mercadeo: {
    etiqueta: 'Mercadeo',
    descripcion: 'Todo lo de Ventas, más Marketing y los agentes. No toca el equipo ni los permisos.',
    modulos: ['crm', 'marketing', 'conversaciones', 'analisis', 'agentes'],
    gestionaEquipo: false,
    soloLoSuyoEnReportes: false,
    soloSusLeads: false,
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
// La lista de cuentas suspendidas, refrescada cada minuto. Si no se puede
// leer, NO se suspende a nadie: dejar fuera a toda la clientela por un
// tropiezo de la base sería mucho peor que el problema que resuelve.
let _suspendidos = null, _suspendidosHasta = 0;
export async function estaSuspendido(userId) {
  if (!userId) return false;
  if (!_suspendidos || Date.now() > _suspendidosHasta) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/users?status=eq.suspended&select=id`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (!r.ok) return false;
      _suspendidos = new Set((await r.json() || []).map(u => u.id));
      _suspendidosHasta = Date.now() + 60000;
    } catch { return false; }
  }
  return _suspendidos.has(userId);
}

export async function quienPregunta(userId) {
  // Esta consulta la hace CADA endpoint en CADA petición, así que al abrir una
  // pantalla salen diez a la vez. Un tropiezo de un segundo en Supabase dejaba
  // media pantalla en blanco con un 503 y un mensaje que no decía nada: 20
  // veces en tres horas, tres cuentas distintas.
  //
  // Un reintento corto. Es una lectura de UNA fila, sin efectos: repetirla no
  // puede estropear nada, y evita que un parpadeo se le note al usuario.
  let res = null, fallo = null;
  for (let intento = 0; intento < 2; intento++) {
    if (intento) await new Promise(r => setTimeout(r, 200));
    try {
      res = await fetch(
        `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}` +
        `&status=eq.active&select=owner_user_id,member_name,member_email,role,client_id&limit=1`,
        { headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (res.ok) break;
      // El cuerpo dice QUÉ pasó. Sin él solo quedaba «HTTP 500», que no se
      // puede investigar tres horas después.
      fallo = 'HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200);
      res = null;
    } catch (e) {
      fallo = 'sin respuesta: ' + String(e && e.message || e).slice(0, 200);
      res = null;
    }
  }
  if (!res) {
    // Se anota del lado del SERVIDOR, con el motivo real. Lo que llega al
    // navegador sigue siendo el mensaje amable; lo que hace falta para
    // arreglarlo queda aquí.
    try {
      const { registrarError } = await import('./_registro-errores.js');
      await registrarError({
        origen: 'api', donde: 'quienPregunta',
        error: new Error('team_members no respondió tras 2 intentos'),
        usuario: userId, detalle: fallo || 'sin detalle',
      });
    } catch {}
    throw new Error('No se pudo verificar la cuenta: ' + (fallo || 'sin detalle'));
  }
  // ── ¿Está suspendida esta cuenta? ───────────────────────────────────────
  //
  // Suspender existía solo de nombre: se marcaba `status: 'suspended'` y no lo
  // leía nadie, así que la cuenta seguía funcionando igual. Se vio el
  // 22-09-2026 al suspender la cuenta que mandó phishing — y encima el `ban`
  // de Clerk es una función de su plan de pago (402) y su `lock` caduca a la
  // hora, así que el corte tiene que hacerlo nuestro código.
  //
  // Se comprueba aquí porque es lo único por lo que pasan todos: doce
  // endpoints en cada petición. La lista se guarda un minuto — una cuenta
  // suspendida es rara y esto no puede costar una consulta por llamada.
  if (await estaSuspendido(userId)) {
    const e = new Error('Esta cuenta está suspendida. Escríbenos a soporte@acuarius.app.');
    e.suspendida = true;
    throw e;
  }

  const fila = (await res.json())?.[0];

  if (!fila || !fila.owner_user_id) {
    return { userId, actorId: userId, esMiembro: false, perfil: 'admin', esDueno: true, nombre: null, cliente: null };
  }
  return {
    userId: fila.owner_user_id,
    actorId: userId,
    esMiembro: true,
    perfil: normalizarPerfil(fila.role),
    esDueno: false,
    nombre: fila.member_name || fila.member_email || null,
    // A qué cliente está acotado. NULL = a todos, que es como funcionaba antes.
    cliente: fila.client_id || null,
  };
}

/**
 * Con qué cliente se trabaja en esta petición.
 *
 * Un miembro acotado a un cliente NO puede salirse de él, pida lo que pida el
 * navegador. La comprobación vive aquí y no en la pantalla porque la pantalla
 * se puede saltar: basta cambiar un parámetro en la barra de direcciones.
 *
 * Quien no está acotado —el dueño, o un miembro sin cliente— trabaja con el
 * que pidió, exactamente como hasta ahora.
 */
/**
 * ¿Esta persona pertenece a esta cuenta?
 *
 * Para validar un destinatario que llega del navegador —una mención con `@`,
 * por ejemplo—. Sin esto, cualquiera podría mandar un identificador cualquiera
 * y hacer que a un usuario de OTRA cuenta le llegara un correo y un aviso al
 * teléfono con el texto que quisiera y el nombre de un lead ajeno dentro.
 *
 * El dueño cuenta: no tiene fila en `team_members`, y aun así se le menciona.
 */
export async function esDelEquipo(cuenta, userId) {
  if (!cuenta || !userId) return false;
  if (userId === cuenta) return true;                 // el dueño
  try {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(cuenta)}` +
      `&member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=member_user_id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    ).then(r => (r.ok ? r.json() : []));
    return !!filas?.[0];
  } catch {
    // Ante la duda NO se deja pasar: es una comprobación de permisos, y
    // fallar abierto aquí es dejar que le escriban a quien no toca.
    return false;
  }
}

export function alcanceDeCliente(quien, pedido) {
  if (quien && quien.cliente) return quien.cliente;
  return pedido || null;
}

/** ¿Está intentando entrar a un cliente que no es el suyo? */
export function clienteAjeno(quien, pedido) {
  return !!(quien && quien.cliente && pedido && pedido !== quien.cliente);
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

/** ¿Solo ve en el tablero los leads que tiene asignados? */
export function soloSusLeads(perfil) {
  return !!PERFILES[normalizarPerfil(perfil)]?.soloSusLeads;
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
    solo_sus_leads: !!p.soloSusLeads,
    toca_el_plan: quien.esDueno === true,
    // La pantalla lo usa para enseñar un solo cliente en el selector en vez de
    // la cartera entera. No es la defensa —esa está en el servidor— pero sin
    // esto el miembro vería los nombres de todos los clientes de la agencia.
    cliente: quien.cliente || null,
  };
}
