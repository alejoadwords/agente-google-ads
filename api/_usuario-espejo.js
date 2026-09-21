// api/_usuario-espejo.js — la fila de `users` que Clerk no crea por su cuenta.
//
// La identidad vive en Clerk, pero la base guarda un espejo en `public.users`, y
// hay cuatro tablas que dependen de él por clave foránea: `user_profiles`,
// `chat_history`, `activity_logs` y `billing`.
//
// El espejo se creaba solo en dos sitios: al aceptar una invitación de equipo y
// al sincronizar a mano desde el panel de administración. **Un registro normal
// no lo creaba.** Resultado: quien se daba de alta y guardaba cualquier
// preferencia recibía un 500 con un `23503` —una violación de clave foránea— que
// no le decía nada. Cinco cuentas entre el 10 y el 21 de septiembre de 2026.
//
// Por eso esto vive aparte y no dentro de un endpoint: el que lo necesite lo
// llama, y hay un solo sitio que arreglar el día que cambie.
//
// Solo se importa desde funciones EDGE (ver CLAUDE.md).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(prefer) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: prefer || 'return=minimal',
  };
}

/** El correo verificado y el nombre, de Clerk. '' si no se pueden leer. */
export async function datosDeClerk(userId) {
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + encodeURIComponent(userId), {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    if (!r.ok) return { correo: '', nombre: '' };
    const u = await r.json();
    const lista = u.email_addresses || [];
    const principal = lista.find(e => e.id === u.primary_email_address_id) || lista[0];
    const elegido = (principal && principal.verification?.status === 'verified')
      ? principal
      : lista.find(e => e.verification?.status === 'verified');
    return {
      correo: (elegido?.email_address || '').toLowerCase(),
      nombre: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
    };
  } catch { return { correo: '', nombre: '' }; }
}

/**
 * Se asegura de que exista la fila espejo. Devuelve true si está.
 *
 * Primero mira si ya está, y solo entonces pregunta a Clerk: si no, cada
 * guardado de una preferencia costaría una llamada de red a Clerk, y son
 * muchas al día por usuario.
 *
 * Nunca lanza. Quien la llama la usa para no chocar con la clave foránea, no
 * para decidir si el usuario existe — eso ya lo dijo el token.
 */
export async function asegurarUsuario(userId, correo, nombre) {
  if (!userId) return false;
  try {
    const hay = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
      { headers: sb('return=representation') }
    ).then(r => (r.ok ? r.json() : null));
    // Si la consulta falla NO se da por hecho que falta: insertar a ciegas con
    // un correo vacío dejaría una fila peor que ninguna.
    if (hay === null) return false;
    if (hay.length) return true;

    let c = correo, n = nombre;
    if (!c) ({ correo: c, nombre: n } = await datosDeClerk(userId));
    // Sin correo no se crea: `users.email` es lo que identifica a la persona en
    // soporte, en el panel y en los avisos. Una fila sin él es un fantasma.
    if (!c) return false;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?on_conflict=id`, {
      method: 'POST',
      headers: sb('resolution=ignore-duplicates,return=minimal'),
      body: JSON.stringify({ id: userId, email: c, name: n || null }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
