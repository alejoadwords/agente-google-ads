// public/movil-datos.js — de lo que devuelve la API a lo que pinta el móvil
//
// El boceto de `movil.html` dibuja con datos de ejemplo. Este módulo es el
// puente: convierte lo que responden los endpoints en las formas que esperan
// las funciones de pintado, sin que ninguna de ellas sepa de dónde salió.
//
// Vive aparte por dos motivos. Uno, el mapeo es donde se esconden los fallos
// —un campo que se llama distinto, una fecha nula, un cero que es un cero de
// verdad y no un «no se pudo mirar»— y aquí se puede probar sin navegador.
// Dos, la misma pieza sirve al boceto suelto y al móvil ya metido en la
// aplicación: una sola traducción, no dos que se separan con el tiempo.
//
// NO trae `fetchAuth`: se lo inyecta quien lo use. En la aplicación es el de
// `app.js`; en una prueba, uno de mentira. Así no arrastra la sesión.

// ── Etapas ──────────────────────────────────────────────────────────────────
// Las claves que el CRM usa por debajo. `nuevo`, `ganado` y `perdido` son
// fijas —otros módulos las miran por nombre—; el resto las pone cada cuenta.
export const ETIQUETA_ETAPA = {
  nuevo: 'Nuevo', contactado: 'Contactado', calificado: 'Calificado',
  propuesta: 'Propuesta', negociacion: 'Negociación',
  'periodo-de-prueba': 'Periodo de prueba', ganado: 'Ganado', perdido: 'Perdido',
};

export function etiquetaEtapa(k, etapasDeLaCuenta) {
  if (etapasDeLaCuenta) {
    for (const e of etapasDeLaCuenta) if (e.key === k) return e.label || k;
  }
  return ETIQUETA_ETAPA[k] || k;
}

// ── Cuánto hace ─────────────────────────────────────────────────────────────
// Se dice en la unidad que se entiende de un vistazo. «hace 2 h» y «ayer» se
// leen sin pensar; «hace 7200 segundos» no.
export function hace(iso, ahora = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const m = Math.round((ahora - t) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return 'hace ' + m + ' min';
  const h = Math.round(m / 60);
  if (h < 24) return 'hace ' + h + ' h';
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return 'hace ' + d + ' d';
  return new Date(t).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

/** Importe en pesos, sin decimales. Devuelve '' si no hay valor: un «$ 0» se
 *  lee como «vale cero», que no es lo mismo que «no se ha puesto». */
export function plata(v) {
  const n = Number(v);
  if (!v || isNaN(n) || n === 0) return '';
  return '$ ' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

/**
 * Una fecha SIN hora («2026-09-30»), legible y en el día correcto.
 *
 * `new Date('2026-09-30')` la interpreta como medianoche UTC. A cinco horas de
 * Colombia eso es el 29 a las 19:00, así que la fecha de cierre de un negocio
 * se pintaba un día antes de lo que dice la base. No falla nada: solo adelanta
 * todos los cierres un día, y nadie lo nota hasta que alguien llama tarde.
 */
export function diaSuelto(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  // Construida con los números sueltos: así es medianoche LOCAL, no UTC.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

// ── Leads ───────────────────────────────────────────────────────────────────
/**
 * Un lead de la API a la tarjeta y la ficha del móvil.
 * Los campos de pauta viven en `custom_fields` y los pone `camposDePauta()`
 * en el servidor; aquí solo se leen por su nombre exacto.
 */
export function aLead(l, ahora = Date.now()) {
  const cf = l.custom_fields || {};
  return {
    id: l.id,
    pipeline: l.pipeline_id || null,
    nom: l.name || 'Sin nombre',
    etapa: l.stage || 'nuevo',
    // `updated_at` y no `created_at`: es el campo del que cuelga todo lo de
    // inactividad en el resto de la aplicación, y usar otro aquí haría que el
    // móvil y el Pulso dijeran cosas distintas del mismo lead.
    hace: hace(l.updated_at || l.created_at, ahora),
    // Las marcas en crudo, además del texto: el Pulso necesita comparar
    // fechas, y «hace 2 h» no se puede comparar con nada.
    tocado: Date.parse(l.updated_at || l.created_at) || 0,
    creado: Date.parse(l.created_at) || 0,
    cerrado: ['ganado','perdido','won','lost','descartado'].indexOf(String(l.stage||'').toLowerCase()) >= 0,
    origen: l.source || 'Sin fuente',
    tel: l.phone || '',
    email: l.email || '',
    empresa: l.company || '',
    valor: plata(l.value),
    resp: l.assigned_name || 'Sin asignar',
    tags: Array.isArray(l.tags) ? l.tags : [],
    interes: l.notes || '',
    campana: cf['Campaña'] || '',
    pagina: cf['Página'] || '',
    cierre: diaSuelto(l.expected_close_date),
  };
}

// ── Tareas y citas ──────────────────────────────────────────────────────────
// `/api/agenda` devuelve TODAS las actividades del contacto, citas incluidas.
// Pintarlas juntas convertía una reserva del propio cliente en un pendiente
// que alguien se apuntó: se separan por `type`.
export const esCita = (a) => !!a && a.type === 'meeting';

export function aTarea(a, ahora = Date.now()) {
  const vence = a.due_at ? new Date(a.due_at).getTime() : null;
  const hoy = new Date(ahora); hoy.setHours(23, 59, 59, 999);
  const ayer = new Date(ahora); ayer.setHours(0, 0, 0, 0);
  return {
    id: a.id,
    lead: a.lead_id || null,
    t: a.title || 'Tarea',
    s: vence
      ? new Date(vence).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Sin fecha',
    // Vencida, hoy o próxima. Sin fecha NO es vencida: nadie la incumplió.
    cuando: !vence ? 'proxima'
      : vence < ayer.getTime() ? 'vencida'
      : vence <= hoy.getTime() ? 'hoy' : 'proxima',
    hecha: !!a.done,
  };
}

export function aCita(a) {
  const ini = a.due_at ? new Date(a.due_at) : null;
  const fin = a.end_at ? new Date(a.end_at) : null;
  const mins = ini && fin ? Math.round((fin - ini) / 60000) : null;
  return {
    id: a.id,
    h: ini ? ini.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—',
    dur: mins ? (mins >= 60 ? (mins / 60) + ' h' : mins + ' min') : '',
    t: a.title || 'Cita',
    s: a.description || '',
    pasada: ini ? ini.getTime() < Date.now() : false,
  };
}

// ── Conversaciones ──────────────────────────────────────────────────────────
export function aConversacion(c, ahora = Date.now()) {
  const ultimo = c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : null;
  return {
    id: c.id,
    nom: c.contact_name || c.contact_phone || 'Sin nombre',
    canal: c.channel || 'whatsapp',
    // Los tres valores reales de la columna, sin colapsar. Antes 'resolved' se
    // traducía a 'human', y desde que la hoja de estado deja elegir «Resuelta»
    // eso significaba que al reabrir la conversación la marca había saltado
    // sola a «Lo atiendo yo»: la pantalla contradiciendo lo que acabas de
    // guardar. Cualquier otro valor cae a 'human', que es el lado seguro —el
    // agente callado— y nunca a 'bot'.
    quien: c.status === 'bot' ? 'bot' : c.status === 'resolved' ? 'resolved' : 'human',
    nolei: Number(c.unread_count) || 0,
    cuando: hace(c.last_message_at, ahora),
    prev: c.last_message || '',
    // Las horas desde el último mensaje DEL CLIENTE, que es lo que abre la
    // ventana de 24 h. Contarlo desde el último mensaje a secas la reiniciaría
    // cada vez que escribimos nosotros, y el aviso mentiría.
    horas: ultimo ? Math.floor((ahora - ultimo) / 3600000) : 999,
  };
}

// ── Módulos ─────────────────────────────────────────────────────────────────
// Las siete pantallas de módulo —chatbots, campañas, listas, automatizaciones,
// fuentes, propuestas y reservas— enseñaban los datos de EJEMPLO a cuentas
// reales: «3 campañas este mes» y «Arriendos Envigado · 412 visitas» eran
// inventados. Un cliente no tiene forma de saber que lo que lee no es suyo.
//
// Todos pintan con la misma fila: {nom, sub, est?, n?, on?, res?}.

/** El chip de estado solo tiene cuatro colores en el CSS. Cualquier estado que
 *  no caiga en uno se pintaría sin color y parecería roto, así que aquí se
 *  traduce TODO lo que devuelve la API a esos cuatro. */
export function chipEstado(v) {
  const s = String(v || '').toLowerCase();
  if (['sent', 'enviada', 'completed', 'done'].includes(s)) return 'enviada';
  if (['draft', 'borrador'].includes(s)) return 'borrador';
  if (['paused', 'pausada', 'inactive', 'cancelled', 'canceled'].includes(s)) return 'pausada';
  if (['queued', 'sending', 'active', 'activa', 'running', 'viewed', 'accepted', 'paid'].includes(s)) return 'activa';
  return 'borrador';
}

export function aCampana(c, ahora = Date.now()) {
  const s = c.stats || {};
  const programada = c.status === 'queued' && c.scheduled_at && Date.parse(c.scheduled_at) > ahora;
  const canal = c.channel === 'whatsapp' ? 'WhatsApp' : 'Correo';
  const cuenta = c.status === 'draft' ? 'sin programar'
    : programada ? 'sale el ' + new Date(c.scheduled_at).toLocaleString('es-CO',
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : (s.sent || 0) + ' de ' + (s.total || 0) + ' enviados';
  return {
    nom: c.name || 'Sin nombre',
    est: programada ? 'activa' : chipEstado(c.status),
    sub: canal + ' · ' + cuenta,
    // Los porcentajes solo cuando hay base para calcularlos: un «0 %» sobre
    // cero envíos se lee como una campaña que fracasó.
    res: (s.sent > 0) ? {
      Entregados: Math.round(((s.delivered != null ? s.delivered : s.sent) / s.sent) * 100),
      Abiertos: Math.round(((s.opened || 0) / s.sent) * 100),
      Clics: Math.round(((s.clicked || 0) / s.sent) * 100),
    } : null,
  };
}

export function aLista(l) {
  const estatica = l.kind === 'static';
  return {
    nom: l.name || 'Sin nombre',
    // Una lista dinámica NO tiene un número fijo: poner uno sería inventarlo.
    n: estatica ? (l.lead_ids || []).length : undefined,
    sub: l.type === 'exclusion' || l.kind === 'exclusion'
      ? 'Exclusión · nunca reciben campañas'
      : estatica ? 'Lista fija' : 'Dinámica · se actualiza sola',
  };
}

export function aAutomatizacion(a) {
  const on = a.is_active != null ? !!a.is_active : !!a.active;
  return {
    // El id viaja hasta la fila: sin él el interruptor no sabe a quién apagar.
    id: a.id,
    nom: a.name || 'Sin nombre',
    on,
    sub: (a.trigger ? String(a.trigger).replace(/_/g, ' ') : 'Sin disparador')
      + (on ? '' : ' · apagada'),
  };
}

export function aFuente(s) {
  return {
    nom: s.label || s.key || 'Sin nombre',
    // `count` puede venir sin definir: dejarlo en 0 diría «esta fuente no trae
    // a nadie», que no es lo mismo que «no sé cuántos trae».
    n: Number.isFinite(Number(s.count)) ? Number(s.count) : undefined,
    sub: s.key ? 'Clave: ' + s.key : 'Fuente de la cuenta',
  };
}

export function aPropuesta(p) {
  const monto = plata(p.amount);
  return {
    nom: (p.lead_name ? p.lead_name + ' · ' : '') + (p.title || 'Sin título'),
    est: chipEstado(p.status),
    sub: (monto || 'Sin importe') + ' · ' + (hace(p.created_at) || 'sin fecha'),
  };
}

export function aServicio(s) {
  const activo = s.activo !== false;
  return {
    nom: s.nombre || s.name || 'Sin nombre',
    est: activo ? 'activa' : 'pausada',
    sub: (s.duracion_min ? s.duracion_min + ' min' : 'Sin duración')
      + (activo ? '' : ' · pausado, no se puede reservar'),
  };
}

export function aAgente(a) {
  const on = a.is_active != null ? !!a.is_active : !!a.active;
  return {
    id: a.id,
    nom: a.name || 'Sin nombre',
    on,
    canal: a.channel || 'Sin canal',
    // Nunca un recuento inventado: si la API no lo manda, se dice el estado.
    convs: on ? 'Encendido' : 'Apagado',
  };
}

/**
 * Trae UN módulo, cuando se abre. Los siete de golpe al arrancar serían siete
 * peticiones más antes de ver nada, y la mayoría de las veces no se abre
 * ninguno: quien saca el teléfono va a los leads y a los chats.
 *
 * Devuelve null si no se pudo mirar —igual que `cargarTodo`—, nunca [].
 */
export const MODULOS_API = {
  chatbots: { ruta: '/api/chat-agents',  clave: 'agents',      mapa: aAgente },
  campanas: { ruta: '/api/campaigns',    clave: 'campaigns',   mapa: aCampana },
  listas:   { ruta: '/api/lead-lists',   clave: 'lists',       mapa: aLista },
  autos:    { ruta: '/api/automations',  clave: 'automations', mapa: aAutomatizacion },
  fuentes:  { ruta: '/api/lead-sources', clave: 'sources',     mapa: aFuente },
  props:    { ruta: '/api/proposals',    clave: 'proposals',   mapa: aPropuesta },
  reservas: { ruta: '/api/bookings',     clave: 'servicios',   mapa: aServicio },
};

export async function cargarModulo(fetchAuth, id, { clientId } = {}) {
  const def = MODULOS_API[id];
  if (!def) return null;
  try {
    const q = clientId ? '?client_id=' + encodeURIComponent(clientId) : '';
    const r = await fetchAuth(def.ruta + q);
    if (!r || !r.ok) return null;
    const d = await r.json();
    const lista = d[def.clave];
    // Si la clave no viene, es que la respuesta no tiene la forma esperada. Eso
    // es «no se pudo mirar», no «no hay nada».
    if (!Array.isArray(lista)) return null;
    return lista.map(def.mapa);
  } catch { return null; }
}

// ── Carga ───────────────────────────────────────────────────────────────────
/**
 * Pide lo que necesita el móvil. Devuelve SIEMPRE un objeto con las claves
 * esperadas: lo que no se pudo traer viene como null, nunca como lista vacía.
 *
 * La diferencia importa. Una lista vacía significa «no hay»; null significa
 * «no se pudo mirar», y la pantalla tiene que decirlo en vez de afirmar que
 * el asesor no tiene tareas cuando lo que pasó fue que se cayó la consulta.
 */
export async function cargarTodo(fetchAuth, { clientId } = {}) {
  const uno = async (ruta, saca) => {
    try {
      const r = await fetchAuth(ruta);
      if (!r || !r.ok) return null;
      return saca(await r.json());
    } catch { return null; }
  };
  const q = clientId ? '&client_id=' + encodeURIComponent(clientId) : '';
  const [leads, actividades, convs, pipelines] = await Promise.all([
    uno('/api/leads?limit=200' + q, (d) => (d.leads || []).map((l) => aLead(l))),
    uno('/api/agenda?proximos=1' + q, (d) => d.actividades || d.items || []),
    uno('/api/chat-conversations?' + q.slice(1), (d) => (d.conversations || d.convs || []).map(aConversacion)),
    // Una cuenta puede tener varios tableros —Certain tiene cuatro, y sus
    // leads viven en «Arriendo», no en el principal—. Sin poder elegir, el
    // móvil enseña todo revuelto o el tablero equivocado.
    uno('/api/pipelines' + (clientId ? '?client_id=' + encodeURIComponent(clientId) : ''),
        (d) => (d.pipelines || []).map((p) => ({ id: p.id, nom: p.name || 'Sin nombre', principal: !!p.is_default }))),
  ]);
  return {
    pipelines,
    leads,
    tareas: actividades ? actividades.filter((a) => !esCita(a)).map((a) => aTarea(a)) : null,
    citas: actividades ? actividades.filter(esCita).map(aCita) : null,
    convs,
  };
}
