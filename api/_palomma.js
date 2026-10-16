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

// ── Paso 2: traducir un lead de Palomma a Acuarius ──────────────────────────
//
// Decisiones de Alejandro (13 y 15-10-2026):
//   · Arriendo → tablero Arriendo, venta → Venta, embudo de captación → Captación.
//   · Descartado, cerrado e inactivo en Palomma son solo una NOTA: no mueven a
//     perdido ni a ganado (lo decide la asesora).
//   · La conversación se copia como nota en la ficha.
//   · Embudos de Mantenimiento, Administrativo y Cartera se ignoran.
//   · Palomma solo ADELANTA un lead, nunca lo retrocede ni pisa a una asesora.
//   · Sin asesor en Palomma, el lead entra sin asignar (lo atiende su agente);
//     con un asesor que no está en Acuarius, va por el reparto normal.

// Embudos de Palomma que no son ventas.
export function embudoIgnorado(pipelineName) {
  return /mantenimiento|administrativ|cartera/i.test(String(pipelineName || ''));
}

// ¿Captación (propietarios) o arriendo/venta? Palomma llama al de captación
// «sourceproperties» por dentro y «Captación» en el portal.
export function esCaptacion(lead) {
  return /captaci|sourceproperties/i.test(String(lead?.pipelineName || ''));
}

// A qué tablero va: devuelve 'captacion' | 'venta' | 'arriendo' | null (aún no se sabe).
// «rent_and_sale» (busca las dos) va a Arriendo: es lo más común y la asesora
// lo mueve si resulta ser compra.
export function tableroDe(lead) {
  if (esCaptacion(lead)) return 'captacion';
  const op = String(lead?.profile?.listingType || '').toLowerCase();
  if (op === 'sale') return 'venta';
  if (op === 'rent' || op === 'rent_and_sale' || op === 'both') return 'arriendo';
  return null;
}

// La etapa de Acuarius a la que lleva un estado de Palomma (claves de Certain:
// contactado = «Cliente contactado», propuesta = «Cita de inmueble»). Los que
// no están aquí solo dejan nota.
const ETAPA_DE_PALOMMA = { appointmentIntent: 'contactado', appointmentPending: 'propuesta', redirected: 'contactado' };
export function etapaDe(pipelinePositionId) {
  return ETAPA_DE_PALOMMA[pipelinePositionId] || null;
}

const fechaCO = (iso) => {
  try {
    return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
  } catch { return iso; }
};

// La nota que deja cada estado en la ficha. null = no deja nota.
export function notaDeEstado(estado, data = {}) {
  const L = data.lead || {};
  const asesor = data.employeeAssigned?.name;
  const cita = data.appointment;
  switch (estado) {
    case 'appointmentIntent': return 'Palomma: mostró interés en agendar una visita.';
    case 'appointmentPending':
      return 'Palomma: agendó una visita' + (cita?.startAt ? ' para el ' + fechaCO(cita.startAt) : '') +
        (cita?.listingCode ? ' al inmueble ' + cita.listingCode : '') + (cita?.branchName ? ' (' + cita.branchName + ')' : '') +
        (asesor ? ', con ' + asesor : '') + '.';
    case 'appointmentConfirmed': return 'Palomma: la persona confirmó la visita.';
    case 'appointmentCancelled': return 'Palomma: la visita se canceló.';
    case 'redirected': return 'Palomma: pasó la conversación a ' + (asesor || 'un asesor') + '.' + (L.transferReason ? ' Motivo: ' + L.transferReason : '');
    case 'discarded': return 'Palomma: el agente descartó el prospecto.' + (L.discardedReason ? ' Motivo: ' + L.discardedReason : '');
    case 'inactive': return 'Palomma: la conversación quedó inactiva (la persona dejó de responder).';
    case 'closed': return 'Palomma: marcó el negocio como cerrado.';
    case 'propertyInfoCollected': return 'Palomma: recogió la información del inmueble del propietario.';
    default: return null;
  }
}

// Lo que busca, en una línea para la ficha.
export function resumenDePerfil(p) {
  if (!p || typeof p !== 'object') return '';
  const op = { rent: 'arriendo', sale: 'compra', rent_and_sale: 'arriendo o compra', both: 'arriendo o compra' }[String(p.listingType || '').toLowerCase()];
  const tipos = { apartment: 'apartamento', studio: 'apartaestudio', house: 'casa', room: 'habitación', office: 'oficina', medical_office: 'consultorio', commercial_space: 'local', warehouse: 'bodega', building: 'edificio', lot: 'lote', farm: 'finca', hotel: 'hotel', parking: 'parqueadero' };
  const plata = (n) => '$' + Number(n).toLocaleString('es-CO');
  const precio = p.price || p.priceRange;
  return [
    op,
    (p.propertyTypes || []).map(t => tipos[t] || t).join('/') || null,
    (p.neighborhoods || p.neighborhoodList || []).length ? 'en ' + (p.neighborhoods || p.neighborhoodList).join(', ') : null,
    (p.cities || []).length ? (p.cities || []).join(', ') : null,
    p.bedrooms ? p.bedrooms + ' hab' : null,
    precio?.max ? 'hasta ' + plata(precio.max) : precio?.min ? 'desde ' + plata(precio.min) : null,
    p.propertyCode ? 'inmueble ' + p.propertyCode : null,
  ].filter(Boolean).join(' · ');
}

// El teléfono en el formato de Acuarius. Primero el campo de Palomma (57300…,
// sin +). Si viene vacío —pasa cuando WhatsApp atiende por nombre de usuario
// (whatsappUserId «CO.139…») y no por número—, el que la persona escribió en la
// conversación: Palomma siempre lo pide antes de pasarla a un asesor, pero no
// lo copia al campo. Sin esto el lead llegaba sin teléfono, no se cruzaba con
// el que ya existía y se duplicaba (Certain, 16-10-2026).
export function telefonoDe(lead) {
  const d = String(lead?.phone || '').replace(/\D/g, '');
  if (d.length >= 7) return '+' + d;
  return telefonoDeConversacion(lead?.conversation?.content);
}

// Solo lo que escribió la persona («Usuario: …»): el agente de Palomma pone un
// número de ejemplo (3001234567) al pedirlo. Celular colombiano, el último que
// dio (si se corrige, vale el corregido).
export function telefonoDeConversacion(contenido) {
  const partes = String(contenido || '').split(/\n(?=(?:Usuario|Agente|Asesor)[^:\n]{0,20}:)/);
  let ultimo = null;
  for (const t of partes) {
    if (!/^Usuario/.test(t)) continue;
    for (const m of t.matchAll(/(?<!\d)(?:\+?57[\s-]?)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/g)) ultimo = m[1].replace(/\D/g, '');
  }
  return ultimo ? '+57' + ultimo : null;
}

// «SOLO se deben pasar a Acuarius usuarios de Palomma que en realidad se hayan
// calificado» (Alejandro, 16-10-2026). Calificado = Palomma lo pasó a un
// asesor, le agendó o va a agendar una cita, o recogió los datos del inmueble
// (captación). Antes se creaba el lead con el primer mensaje, y quien escribía
// «hola» y se iba quedaba como lead sin teléfono.
const CALIFICADO = ['redirected', 'appointmentIntent', 'appointmentPending', 'appointmentConfirmed', 'propertyInfoCollected'];
export function estaCalificado(L, data = {}) {
  return CALIFICADO.includes(L?.pipelinePositionId) || !!data?.employeeAssigned;
}
export function estadoCalificado(estado) {
  return CALIFICADO.includes(estado);
}

// Qué completar en un contacto que YA existía en Acuarius con lo que trae
// Palomma (Alejandro, 16-10: «actualizar la info del contacto con lo que venga
// de Palomma»). Se llena lo vacío; lo que la asesora ya escribió no se pisa. El
// nombre solo si el que hay es genérico: el de WhatsApp suele ser un apodo
// («Alejo ❤️‍🔥») y el de la ficha, el real.
const NOMBRE_GENERICO = /^(contacto de whatsapp|sin nombre|cliente|lead)?$/i;
export function camposParaActualizar(lead, L, telefono) {
  const cambios = {};
  if (telefono && !lead.phone) cambios.phone = telefono;
  if (L?.email && !lead.email) cambios.email = String(L.email).toLowerCase();
  if (L?.name && NOMBRE_GENERICO.test(String(lead.name || '').trim())) cambios.name = L.name;
  return cambios;
}
