// api/_una-vez.js — que un cron no le mande dos veces lo mismo a la misma persona
//
// Ninguno de los crons que manda correo comprobaba si ya lo había mandado.
// Vercel reintenta un cron que falla, y basta con dispararlo a mano una vez
// para duplicarlo todo: el 22-09-2026, revisando el sistema, ocho clientes
// recibieron su resumen de tareas dos veces y fuera de hora.
//
// Un correo repetido de algo que ya leíste es la forma más rápida de que dejen
// de abrirlo — y con el proveedor de correo en su plan más pequeño, además
// gasta cuota que necesitan los avisos de verdad.
//
// La marca se pone ANTES de enviar, a propósito. Si el envío falla después, el
// aviso de ese período se pierde; es preferible a mandarlo dos veces, y el del
// período siguiente sale igual.

/**
 * @param {string} sbUrl
 * @param {string} sbKey
 * @param {string} clave   qué y a quién — p. ej. 'tareas:user_123'
 * @param {string} periodo el tramo que no se repite: '2026-09-22' (día),
 *                         '2026-W38' (semana) o '2026-09' (mes)
 * @returns {Promise<boolean>} true si YA se hizo en ese período
 */
export async function yaSeHizo(sbUrl, sbKey, clave, periodo) {
  try {
    const r = await fetch(`${sbUrl}/rest/v1/cron_envios`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ clave: `${clave}:${periodo}`, dia: new Date().toISOString().slice(0, 10) }),
    });
    // 409 = la clave ya estaba = ya se hizo en este período.
    return r.status === 409;
  } catch {
    // Si no se puede ni escribir la marca, se deja pasar: perder un aviso por
    // no poder guardar una fila sería peor que un duplicado ocasional.
    return false;
  }
}

/** El período de hoy, en los tres tramos que usan los crons. */
export function periodoDe(tipo, ahora = new Date()) {
  const iso = ahora.toISOString();
  if (tipo === 'mes') return iso.slice(0, 7);
  if (tipo === 'semana') {
    // Semana ISO: el jueves de esa semana decide el año, que es lo que evita
    // que el 31 de diciembre y el 1 de enero caigan en semanas distintas.
    const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const eneroUno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const semana = Math.ceil(((d - eneroUno) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
  }
  return iso.slice(0, 10);
}
