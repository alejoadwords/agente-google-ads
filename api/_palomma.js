// api/_palomma.js — integración con Palomma (lo que no depende de la red).
//
// Palomma nos avisa por webhook de lo que pasa con los leads de Certain. Su
// documentación (v1.0, sept-2026) fija tres cosas que mandan aquí:
//   · Autentica con un secreto compartido en el header X-Palomma-Secret (no
//     firma el cuerpo, no sale de IPs fijas).
//   · NO reintenta. Un aviso que no guardamos se pierde para siempre.
//   · Puede repetir un evento y desordenarlos; la clave es tipo + lead + timestamp.
// Este módulo solo se importa desde funciones edge.

/** SHA-256 en hex. Del secreto solo se guarda esto. */
export async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Compara dos cadenas en tiempo constante (para el mismo largo). */
export function igualesSeguro(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/**
 * ¿El secreto recibido es el de la conexión? Se acepta también el anterior,
 * para poder rotarlo sin perder avisos mientras Palomma hace el cambio.
 */
export async function secretoValido(recibido, conexion) {
  if (!recibido || !conexion) return false;
  const h = await sha256Hex(recibido);
  return igualesSeguro(h, conexion.secreto_hash) ||
    (!!conexion.secreto_hash_anterior && igualesSeguro(h, conexion.secreto_hash_anterior));
}

/**
 * La fila que se guarda por cada aviso. No interpreta nada: eso es el paso 2.
 * Devuelve { fila } o { error } si el cuerpo no es un evento de Palomma.
 */
export function filaDeEvento(evento, conexion) {
  if (!evento || typeof evento !== 'object' || Array.isArray(evento)) return { error: 'el cuerpo no es un objeto JSON' };
  const tipo = typeof evento.type === 'string' ? evento.type.trim().slice(0, 80) : '';
  if (!tipo) return { error: 'falta type' };
  const leadId = evento.data && evento.data.lead && typeof evento.data.lead.id === 'string'
    ? evento.data.lead.id.slice(0, 64) : null;
  if (!leadId) return { error: 'falta data.lead.id' };
  return {
    fila: {
      conexion_id: conexion.id,
      user_id: conexion.user_id,
      tipo,
      palomma_lead_id: leadId,
      ts: typeof evento.timestamp === 'string' ? evento.timestamp.slice(0, 40) : null,
      payload: evento,
    },
  };
}
