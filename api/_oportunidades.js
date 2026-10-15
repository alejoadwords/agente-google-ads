// api/_oportunidades.js — una persona, varias oportunidades.
//
// Cada fila de `leads` es una OPORTUNIDAD dentro de un proceso de venta. Una
// misma persona puede tener varias —en Certain, la que quiere vender su
// apartamento y a la vez busca uno en arriendo— y quedan enlazadas por
// `contacto_id`. Decisión de Alejandro del 15-10-2026, frente a separar
// contactos y oportunidades en dos tablas (el modelo de HubSpot), que obligaba
// a reescribir casi todo lo que cuelga del lead.
//
// La regla del grupo: la primera oportunidad de la persona no lleva
// `contacto_id` (vale su propio `id`); las siguientes guardan el `id` de la
// primera. Así las 900 y pico filas que ya existían no hubo que tocarlas.
//
//   grupoDe(lead)            la clave del grupo
//   filtroDelGrupo(grupo)    el filtro de PostgREST que trae todo el grupo
//   CAMPOS_DE_CONTACTO       lo que es de la PERSONA y se sincroniza entre
//                            sus oportunidades; lo demás (etapa, valor,
//                            responsable, notas) es de cada oportunidad
//
// Solo se importa desde funciones edge.

export const CAMPOS_DE_CONTACTO = ['name', 'email', 'phone', 'company'];

export function grupoDe(lead) {
  return (lead && (lead.contacto_id || lead.id)) || null;
}

export function filtroDelGrupo(grupo) {
  const g = encodeURIComponent(grupo);
  return `or=(id.eq.${g},contacto_id.eq.${g})`;
}

/**
 * ¿Esta oportunidad es de este proceso? Un lead sin proceso es del principal:
 * así se migraron los de antes de que hubiera varios.
 */
export function esDelProceso(lead, pipelineId, principalId) {
  if (!pipelineId) return true;
  return lead.pipeline_id === pipelineId || (!lead.pipeline_id && pipelineId === principalId);
}

/**
 * De las oportunidades que ya tiene la persona, a cuál se suma lo que entra.
 *
 *   - Si la entrada dice a qué proceso va, a la oportunidad de ESE proceso.
 *     Si no tiene ninguna ahí, devuelve null: hay que abrirle una nueva.
 *   - Si no lo dice (un WhatsApp general, un webhook sin proceso), a la
 *     abierta más reciente; si todas están cerradas, a la más reciente.
 *
 * `cerrado` decide qué cuenta como cerrada (leadCerrado del servidor).
 */
export function aCualSeSuma(candidatos, { pipelineId = null, explicito = false, principalId = null, cerrado = () => false } = {}) {
  const lista = (candidatos || []).slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  if (!lista.length) return null;
  if (explicito) {
    const delProceso = lista.filter(l => esDelProceso(l, pipelineId, principalId));
    return delProceso.find(l => !cerrado(l)) || delProceso[0] || null;
  }
  return lista.find(l => !cerrado(l)) || lista[0];
}

/**
 * Las oportunidades que ya tiene una persona en este ámbito (cuenta + cliente),
 * por correo o por teléfono. El teléfono se compara por sus últimos 10 dígitos:
 * el mismo número llega con +57, con espacios o sin nada.
 *
 * `leer(ruta)` hace el GET a PostgREST (`/leads?...`) y devuelve la lista; cada
 * módulo pasa el suyo, con sus cabeceras.
 */
export async function oportunidadesDe(leer, userId, clientId, { email = null, phone = null } = {}) {
  const U = encodeURIComponent(userId);
  const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
  const vistas = new Map();
  if (email) {
    const filas = await leer(`/leads?user_id=eq.${U}${scope}&email=eq.${encodeURIComponent(email)}&deleted_at=is.null&select=*&limit=50`);
    (filas || []).forEach(l => vistas.set(l.id, l));
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 7) {
    // La base filtra por los dos últimos dígitos y aquí se compara el número
    // entero. Mirar solo los más recientes dejaba entrar duplicado a quien
    // volvía a escribir meses después.
    const cola = digits.slice(-2);
    for (let offset = 0; offset < 20000; offset += 1000) {
      const pagina = await leer(`/leads?user_id=eq.${U}${scope}&deleted_at=is.null&phone=like.*${cola}&select=*&order=created_at.desc,id.asc&limit=1000&offset=${offset}`);
      (pagina || []).filter(l => String(l.phone).replace(/\D/g, '').endsWith(digits.slice(-10))).forEach(l => vistas.set(l.id, l));
      if (!pagina || pagina.length < 1000) break;
    }
  }
  return [...vistas.values()];
}

/** Lo que el servidor considera una oportunidad cerrada (como leadCerrado). */
export function oportunidadCerrada(l) {
  return !!(l && (l.closed_at || ['ganado', 'perdido', 'won', 'lost', 'cerrado', 'descartado'].includes(String(l.stage || '').toLowerCase())));
}

/** La primera oportunidad de la persona: de ella salen los datos y el grupo. */
export function laPrimera(lista) {
  return (lista || []).slice().sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))[0] || null;
}
