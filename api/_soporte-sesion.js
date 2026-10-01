// api/_soporte-sesion.js — ¿esta sesión es del equipo dentro de la cuenta de un cliente?
//
// Hasta el 01-10-2026 se entraba con un «actor token» de Clerk, y la respuesta
// la daba el propio token: el claim `act.sub`, firmado por Clerk. Pero el plan
// de Clerk solo permite CINCO suplantaciones al mes (el complemento que las
// libera cuesta 100 USD/mes), y se agotaron el primer día.
//
// Ahora se entra con un token de inicio de sesión normal, que no tiene tope.
// La sesión que se abre es la del cliente igual que antes, pero ya no trae
// `act`: quién está detrás lo sabe Acuarius, en `acceso_cuentas.session_id`,
// que se ata en el canje (accion 'vincular' de api/cuentas.js).
//
// Las sesiones viejas con `act` se siguen reconociendo: el claim es la
// respuesta más fuerte que hay, y no cuesta nada mirarlo primero.
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLERK = 'https://api.clerk.com/v1';

// Una hora, como el `session_max_duration` que tenía el actor token.
export const DURACION_SOPORTE_MS = 3600 * 1000;

const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });

export async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Quién del equipo está detrás de esta sesión, o null si es el propio cliente.
 *
 * @returns {Promise<null | {admin: string, origen: 'clerk'|'acuarius', fila?: object, vencida: boolean}>}
 *
 * Si no se puede mirar (Supabase no responde), devuelve `{admin: null,
 * desconocido: true}`, que es VERDADERO: quien usa esto para frenar algo
 * —arrancar la prueba, canjear una invitación— prefiere frenar de más. Lo que
 * no puede pasar es que un fallo de red convierta al equipo en el cliente.
 */
export async function soporteDe(sesion) {
  const act = sesion?.datos?.act?.sub;
  if (act) return { admin: act, origen: 'clerk', vencida: false };
  const sid = sesion?.datos?.sid;
  if (!sid) return null;
  let filas;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/acceso_cuentas?session_id=eq.${encodeURIComponent(sid)}` +
      `&select=id,admin_id,admin_email,cuenta_id,inicio,fin&limit=1`, { headers: sbH() });
    if (!r.ok) throw new Error('Supabase ' + r.status);
    filas = await r.json();
  } catch (e) {
    return { admin: null, desconocido: true, vencida: false, error: e.message };
  }
  const f = filas && filas[0];
  if (!f) return null;
  // La fila tiene que ser de ESTA cuenta: un session_id ajeno no convierte a
  // nadie en sesión de soporte de otro.
  if (f.cuenta_id !== sesion.id) return null;
  const vencida = !!f.fin || Date.now() - Date.parse(f.inicio) > DURACION_SOPORTE_MS;
  return { admin: f.admin_id, origen: 'acuarius', fila: f, vencida };
}

/** Cierra la sesión en Clerk. Si falla, se dice: una sesión de soporte abierta sin querer no se calla. */
export async function revocarSesionClerk(sid) {
  if (!sid) return false;
  const r = await fetch(`${CLERK}/sessions/${encodeURIComponent(sid)}/revoke`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
  }).catch(() => null);
  // 404/400: la sesión ya no existe o ya estaba cerrada, que es lo que se quería.
  return !!r && (r.ok || r.status === 404 || r.status === 400);
}

/** Marca el fin de la entrada. */
export async function cerrarEntrada(id) {
  await fetch(`${SUPABASE_URL}/rest/v1/acceso_cuentas?id=eq.${encodeURIComponent(id)}&fin=is.null`, {
    method: 'PATCH', headers: sbH(), body: JSON.stringify({ fin: new Date().toISOString() }),
  }).catch(() => {});
}

/**
 * Las sesiones de soporte que ya no deben estar vivas en Clerk: las que
 * pasaron su hora y las que terminaron con «Volver a mi cuenta» (el
 * navegador cierra la suya al volver, pero si ese cierre fallara la sesión
 * seguiría abierta sin que nadie lo supiera). La llama un cron cada hora: una
 * pestaña olvidada no puede dejar abierta la cuenta de un cliente, que es lo
 * que garantizaba el actor token por sí solo.
 */
export async function cerrarSoportesVencidos() {
  const corte = new Date(Date.now() - DURACION_SOPORTE_MS).toISOString();
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/acceso_cuentas?metodo=eq.propio&revocada=eq.false` +
    `&or=(fin.not.is.null,inicio.lt.${encodeURIComponent(corte)})` +
    `&select=id,session_id,fin&limit=200`, { headers: sbH() });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' al buscar entradas vencidas');
  const filas = await r.json();
  let cerradas = 0, fallidas = 0;
  for (const f of filas) {
    const ok = f.session_id ? await revocarSesionClerk(f.session_id) : true;
    // Si Clerk no la cerró, la fila queda pendiente para la próxima vuelta en
    // vez de anotar un cierre que no pasó.
    if (!ok) { fallidas++; continue; }
    const cambio = { revocada: true };
    if (!f.fin) cambio.fin = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/acceso_cuentas?id=eq.${encodeURIComponent(f.id)}`, {
      method: 'PATCH', headers: sbH(), body: JSON.stringify(cambio),
    }).catch(() => {});
    cerradas++;
  }
  return { revisadas: filas.length, cerradas, fallidas };
}
