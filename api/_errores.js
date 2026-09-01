// api/_errores.js
// Registro de errores de la plataforma.
//
// Existe porque hasta hoy el detector de errores era el cliente. Había 123
// `console.error` repartidos por api/ —cada uno un sitio donde alguien decidió
// dejar constancia de un fallo— y ninguno lo leía nadie. Los tres incidentes de
// esta semana estuvieron escribiendo ahí dentro sin que nadie los viera.
//
// Se agrupa por FIRMA, no por ocurrencia: un fallo que pasa 400 veces es una
// fila con veces=400, no 400 filas. Una alerta que manda 400 correos se deja de
// leer el primer día.
//
// Nunca lanza. Que falle el registro de un error no puede provocar otro.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Firma estable de un error. Se quitan los números, los identificadores y las
// comillas para que «lead abc-123 no existe» y «lead def-456 no existe» sean el
// mismo problema y no dos. Sin esto, cada error de un usuario distinto sería
// una alerta nueva.
function firmaDe(origen, donde, mensaje) {
  const base = [origen, donde || '', String(mensaje || '')]
    .join('|')
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/user_[a-z0-9]+/gi, '<usuario>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/["'`]/g, '')
    .slice(0, 400);
  // Hash corto y determinista (FNV-1a). No hace falta criptografía: solo que la
  // misma entrada dé siempre la misma salida.
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '-' + base.slice(0, 60).replace(/[^a-z0-9]+/g, '-');
}

/**
 * origen  — 'api' | 'cron' | 'navegador'
 * donde   — el endpoint, el cron o la vista donde pasó
 * error   — un Error, o un texto
 * usuario — la cuenta afectada, si se sabe
 */
export async function registrarError({ origen, donde, error, usuario, detalle }) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const mensaje = String(error?.message || error || 'error sin mensaje').slice(0, 500);
    const traza = String(detalle || error?.stack || '').slice(0, 4000);
    // Sigue yendo a la consola: cuando alguien mire los logs de Vercel, ahí está.
    console.error(`[${origen}] ${donde || ''}: ${mensaje}`);
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_error`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        p_firma: firmaDe(origen, donde, mensaje),
        p_origen: origen,
        p_donde: (donde || '').slice(0, 120),
        p_mensaje: mensaje,
        p_detalle: traza || null,
        p_usuario: usuario || null,
      }),
    });
  } catch (e) {
    // A propósito: si el registro de errores falla, se queda en la consola y ya.
    console.error('[errores] no se pudo registrar:', e?.message);
  }
}

// Envuelve un handler para que un error no capturado quede registrado en vez de
// convertirse en un 500 mudo. Se usa así:  export default conErrores('leads', handler)
export function conErrores(donde, handler) {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      await registrarError({ origen: 'api', donde, error: e });
      return new Response(JSON.stringify({ error: 'Error interno. Ya estamos avisados.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
