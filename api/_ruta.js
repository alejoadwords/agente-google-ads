// api/_ruta.js — la ruta de arranque: lo que una cuenta nueva tiene que dejar
// funcionando en su primera semana para que Acuarius se vuelva imprescindible.
//
// Decisiones de Alejandro (15-10-2026):
//   · 7 días, como SUGERENCIA: todo se puede hacer en cualquier orden.
//   · Cada paso se marca SOLO, por lo que de verdad hay en la cuenta: no hay
//     casillas que tachar. Una ruta que se tacha a mano mide la voluntad de
//     tachar, no la cuenta.
//   · El dueño y los administradores ven la ruta completa; cada asesor, una
//     mini‑ruta de tres pasos.
//   · Completar los pasos esenciales durante la prueba da 7 días más de Pro.
//
// Lo usan api/ruta.js (la pantalla) y api/cron-ruta.js (el correo de cada
// día), así que los dos dicen siempre lo mismo. Solo se importa desde edge.

export const ETAPAS_POR_DEFECTO = ['Nuevo', 'Contactado', 'Calificado', 'Propuesta', 'Negociación', 'Ganado', 'Perdido'];

// `ir` es un destino de irA() en public/app.js; `hazlo`, una acción de un clic
// que la app sabe hacer (plantillas por sector). `academia`, la categoría.
export const PASOS = [
  { id: 'proceso', dia: 1, titulo: 'Ajusta tu proceso de venta',
    porque: 'Con las etapas de tu negocio sabes en qué va cada cliente de un vistazo.',
    ir: 'crm', boton: 'Ver mi proceso', hazlo: 'plantilla_proceso', esencial: true, academia: 'crm' },
  { id: 'contactos', dia: 1, titulo: 'Trae tus contactos',
    porque: 'Tus clientes y prospectos de siempre, en un solo lugar y con su historia.',
    ir: 'importar', boton: 'Importar contactos', esencial: true, academia: 'primeros-pasos' },

  { id: 'whatsapp', dia: 2, titulo: 'Conecta tu WhatsApp',
    porque: 'Cada mensaje que llega se vuelve un lead, sin copiar nada a mano.',
    ir: 'canales', boton: 'Conectar WhatsApp', entrada: true, academia: 'conversaciones' },
  { id: 'redes', dia: 2, titulo: 'Conecta Instagram y Messenger',
    porque: 'Los mensajes de tus redes llegan a la misma bandeja que WhatsApp.',
    ir: 'canales', boton: 'Conectar redes', entrada: true, academia: 'conversaciones' },
  { id: 'web', dia: 2, titulo: 'Recibe los leads de tu web',
    porque: 'Quien llena un formulario entra solo al proceso y con su responsable.',
    ir: 'fuentes', boton: 'Conectar mi web', entrada: true, academia: 'marketing' },

  { id: 'equipo', dia: 3, titulo: 'Invita a tu equipo',
    porque: 'Cada asesor ve sus leads y sus tareas, y tú ves todo.',
    ir: 'ajustes-equipo', boton: 'Invitar', academia: 'agencia' },
  { id: 'reparto', dia: 3, titulo: 'Reparte los leads solos',
    porque: 'Cada lead nuevo tiene dueño en segundos, por turnos o por reglas.',
    ir: 'ajustes-equipo', boton: 'Configurar reparto', academia: 'crm' },
  { id: 'celular', dia: 3, titulo: 'Lleva Acuarius en tu celular',
    porque: 'Te avisa al instante cuando entra un lead o te dejan una nota.',
    ir: 'celular', boton: 'Activar en el celular', esencial: true, academia: 'primeros-pasos' },

  { id: 'agente', dia: 4, titulo: 'Crea tu agente IA',
    porque: 'Responde a cualquier hora, califica y agenda mientras tu equipo descansa.',
    ir: 'agentes', boton: 'Crear mi agente', hazlo: 'plantilla_agente', academia: 'conversaciones' },
  { id: 'entrenar', dia: 4, titulo: 'Entrena a tu agente',
    porque: 'Con tu catálogo, tus precios y tus preguntas frecuentes responde como tú.',
    ir: 'agentes', boton: 'Entrenarlo', academia: 'conversaciones' },
  { id: 'agente_canal', dia: 4, titulo: 'Ponlo a atender un canal',
    porque: 'Desde ese momento nadie que te escriba se queda sin respuesta.',
    ir: 'canales', boton: 'Asignarle un canal', esencial: true, academia: 'conversaciones' },

  { id: 'bienvenida', dia: 5, titulo: 'Da la bienvenida automática',
    porque: 'Cada lead nuevo recibe un mensaje tuyo en el minuto uno.',
    ir: 'automatizaciones', boton: 'Crear bienvenida', hazlo: 'auto_bienvenida', esencial: true, academia: 'marketing' },
  { id: 'rescate', dia: 5, titulo: 'Rescata los leads que se enfrían',
    porque: 'Si nadie toca un lead en unos días, Acuarius lo retoma por ti.',
    ir: 'automatizaciones', boton: 'Crear rescate', hazlo: 'auto_rescate', academia: 'marketing' },
  { id: 'agenda', dia: 5, titulo: 'Conecta tu agenda',
    porque: 'Las citas quedan en tu calendario y tus clientes pueden reservar solos.',
    ir: 'integraciones', boton: 'Conectar calendario', academia: 'crm' },

  { id: 'propuesta', dia: 6, titulo: 'Envía tu primera propuesta',
    porque: 'Sabes cuándo la abren y la firman, sin perseguir a nadie.',
    ir: 'propuestas', boton: 'Crear propuesta', academia: 'crm' },
  { id: 'cierre', dia: 6, titulo: 'Cierra tu primer negocio aquí',
    porque: 'Cada venta registrada con su motivo te enseña qué funciona.',
    ir: 'crm', boton: 'Ir al tablero', academia: 'crm' },

  { id: 'analisis', dia: 7, titulo: 'Revisa tus números',
    porque: 'Ventas, equipo y marketing en una sola pantalla, al día.',
    ir: 'analisis', boton: 'Ver Análisis', academia: 'analisis' },
  { id: 'informe', dia: 7, titulo: 'Comparte un informe',
    porque: 'Tu jefe o tu socio ven los resultados en vivo, sin pedirte un Excel.',
    ir: 'analisis', boton: 'Compartir informe', academia: 'analisis' },
  { id: 'pauta', dia: 7, titulo: 'Conecta tu pauta',
    porque: 'Ves cuánto te cuesta cada lead y cada venta, anuncio por anuncio.',
    ir: 'pauta', boton: 'Conectar Google o Meta', academia: 'google-ads' },
];

// Quien vende en línea: lo que mueve su negocio son los pedidos de su tienda.
// Conectarla es esencial (y cuenta como entrada de leads), y sus primeras
// automatizaciones son las de comercio: carrito, gracias y recompra.
export function esTienda(sector) { return /E-commerce/i.test(String(sector || '')); }

const PASOS_SOLO_TIENDA = {
  tienda: { id: 'tienda', dia: 1, titulo: 'Conecta tu tienda en línea',
    porque: 'Cada pedido entra solo con su cliente, y tu agente conoce tus productos, precios y stock.',
    ir: 'fuentes', boton: 'Conectar Shopify o WooCommerce', esencial: true, entrada: true, academia: 'marketing' },
  carrito: { id: 'carrito', dia: 5, titulo: 'Recupera los carritos abandonados',
    porque: 'Quien dejó productos sin pagar recibe un recordatorio con el enlace para terminar la compra.',
    ir: 'automatizaciones', boton: 'Activar recuperación', hazlo: 'auto_carrito', esencial: true, academia: 'marketing' },
  postcompra: { id: 'postcompra', dia: 5, titulo: 'Agradece cada compra',
    porque: 'Después de cada pedido pagado, un mensaje tuyo que invita a volver.',
    ir: 'automatizaciones', boton: 'Crear agradecimiento', hazlo: 'auto_postcompra', academia: 'marketing' },
  recompra: { id: 'recompra', dia: 6, titulo: 'Haz que vuelvan a comprar',
    porque: 'A los 30 días sin comprar, Acuarius le recuerda a cada cliente que lo esperas.',
    ir: 'automatizaciones', boton: 'Activar recompra', hazlo: 'auto_recompra', academia: 'marketing' },
};

/** Los pasos de la ruta para este negocio. */
export function pasosPara(sector) {
  if (!esTienda(sector)) return PASOS;
  const out = [];
  for (const p of PASOS) {
    if (p.id === 'cierre') { out.push(PASOS_SOLO_TIENDA.recompra); out.push({ ...p, titulo: 'Tu primera venta registrada', porque: 'Cada pedido pagado de la tienda queda como venta ganada, con su valor.', boton: 'Ver mis ventas' }); continue; }
    out.push(p);
    if (p.id === 'contactos') out.push(PASOS_SOLO_TIENDA.tienda);
    if (p.id === 'rescate') { out.push(PASOS_SOLO_TIENDA.carrito); out.push(PASOS_SOLO_TIENDA.postcompra); }
  }
  return out;
}

export const DIAS = {
  1: { titulo: 'Tu base', meta: 'Que el CRM se parezca a tu negocio' },
  2: { titulo: 'Que entren solos', meta: 'Ningún prospecto se escribe a mano' },
  3: { titulo: 'Tu equipo', meta: 'Cada lead con dueño en minutos' },
  4: { titulo: 'Tu agente IA', meta: 'Respuesta 24/7 desde el primer mensaje' },
  5: { titulo: 'Que trabaje solo', meta: 'Seguimiento sin depender de la memoria' },
  6: { titulo: 'Vender', meta: 'Tu primer cierre dentro de Acuarius' },
  7: { titulo: 'Medir', meta: 'Decidir con tus datos' },
};

// La mini‑ruta de cada asesor invitado.
export const PASOS_EQUIPO = [
  { id: 'm_celular', dia: 1, titulo: 'Activa los avisos en tu celular',
    porque: 'Te enteras al instante cuando te asignan un lead.', ir: 'celular', boton: 'Activar' },
  { id: 'm_actividad', dia: 1, titulo: 'Registra tu primer contacto',
    porque: 'Una llamada o una nota en la ficha: así tu jefe ve que lo atendiste.', ir: 'crm', boton: 'Ver mis leads' },
  { id: 'm_etapa', dia: 1, titulo: 'Mueve un lead de etapa',
    porque: 'Así el tablero siempre dice la verdad de cómo va cada cliente.', ir: 'crm', boton: 'Ir al tablero' },
];

// Lo que se ajusta por negocio. Un paso opcional se puede saltar sin que la
// ruta quede «incompleta»: quien trabaja solo no tiene equipo que invitar, y un
// restaurante rara vez manda propuestas.
export function opcionales(sector = '', empleados = '') {
  const s = String(sector || ''), fuera = new Set(['pauta', 'informe']);
  if (empleados === 'Solo yo') { fuera.add('equipo'); fuera.add('reparto'); }
  if (/E-commerce|Restaurantes/.test(s)) fuera.add('propuesta');
  // En una tienda, el rescate de leads inactivos lo hacen el carrito y la
  // recompra; queda como extra para quien también vende por chat.
  if (esTienda(s)) fuera.add('rescate');
  if (/Industria|Tecnología/.test(s)) fuera.add('redes');
  // Cada negocio entra por donde entra: basta con UNA entrada (ver esenciales).
  ['whatsapp', 'redes', 'web'].forEach(p => fuera.add(p));
  return fuera;
}

/** ¿Cumplió los esenciales? Los marcados `esencial` y al menos UNA entrada. */
export function esencialesCumplidos(hechos, pasos = PASOS) {
  const base = pasos.filter(p => p.esencial).every(p => hechos[p.id]);
  const entrada = pasos.filter(p => p.entrada).some(p => hechos[p.id]);
  return base && entrada;
}

// ── Detección ───────────────────────────────────────────────────────────────
// Cada señal es la prueba MÁS DIRECTA de que el paso está hecho: un WhatsApp
// conectado de prueba (sim_) no cuenta, un formulario creado que nunca recibió
// nada tampoco.
export function detectar(d) {
  const etiquetas = new Set(ETAPAS_POR_DEFECTO);
  const activos = (d.canales || []).filter(c => c.is_active && !String(c.external_id || '').startsWith('sim_'));
  const autos = (d.automatizaciones || []).filter(a => a.active);
  const tipoDe = (a) => (a.trigger && (a.trigger.type || a.trigger.tipo)) || '';
  const agentes = d.agentes || [];
  return {
    proceso: (d.etapas || []).some(e => !etiquetas.has(String(e.label || '').trim()))
      || (d.pipelines || []).some(p => String(p.name || '').trim() !== 'Principal'),
    contactos: (d.leads || 0) > 0,
    whatsapp: activos.some(c => c.channel === 'whatsapp'),
    redes: activos.some(c => c.channel === 'instagram' || c.channel === 'messenger'),
    web: (d.formularios || []).some(f => (f.submissions || 0) > 0) || (d.leadsDeWeb || 0) > 0,
    equipo: (d.equipo || []).some(m => m.status === 'active' || m.status === 'invited'),
    reparto: !!d.reparto,
    celular: (d.celulares || 0) > 0,
    agente: agentes.length > 0,
    entrenar: agentes.some(a => String(a.business_ctx || '').trim().length > 80 || (Array.isArray(a.faqs) ? a.faqs.length : String(a.faqs || '').trim().length > 0))
      || (d.catalogo || 0) > 0,
    agente_canal: activos.some(c => c.agent_id),
    bienvenida: autos.some(a => tipoDe(a) === 'lead_created'),
    rescate: autos.some(a => tipoDe(a) === 'lead_inactive'),
    agenda: !!d.calendario || !!d.reservas,
    propuesta: (d.propuestas || 0) > 0 || (d.plantillas || 0) > 0,
    cierre: (d.ganados || 0) > 0,
    analisis: (d.vistasAnalisis || 0) > 0,
    informe: (d.informes || 0) > 0,
    pauta: !!d.pauta,
    tienda: (d.tiendas || []).some(t => t.activo),
    carrito: autos.some(a => tipoDe(a) === 'carrito_abandonado'),
    postcompra: autos.some(a => ['pedido_pagado', 'primera_compra'].includes(tipoDe(a))),
    recompra: autos.some(a => tipoDe(a) === 'sin_comprar'),
  };
}

export function detectarEquipo(d) {
  return {
    m_celular: (d.celulares || 0) > 0,
    m_actividad: (d.actividades || 0) > 0,
    m_etapa: (d.movimientos || 0) > 0,
  };
}

// ── Lectura de la cuenta ────────────────────────────────────────────────────
function cabeceras(key) {
  return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
}

export async function datosDeLaCuenta(userId, { url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY } = {}) {
  const U = encodeURIComponent(userId);
  const h = cabeceras(key);
  const q = async (ruta) => {
    try { const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: h }); return r.ok ? await r.json() : []; }
    catch { return []; }
  };
  const cuenta = async (tabla, filtro) => {
    try {
      const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}&select=id`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } });
      return parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
    } catch { return 0; }
  };
  const [pipelines, etapas, leads, leadsDeWeb, canales, formularios, equipo, reparto, celulares, agentes,
         fuentesSaber, propiedades, productos, automatizaciones, calendario, reservas, propuestas, plantillas,
         ganados, vistasAnalisis, informes, reportes, pauta, tiendas] = await Promise.all([
    q(`pipelines?user_id=eq.${U}&select=id,name`),
    q(`pipeline_stages?user_id=eq.${U}&select=label&limit=200`),
    cuenta('leads', `user_id=eq.${U}&deleted_at=is.null`),
    cuenta('leads', `user_id=eq.${U}&deleted_at=is.null&source=in.(web,webhook,formulario,pagina)`),
    q(`channel_connections?user_id=eq.${U}&select=channel,is_active,agent_id,external_id`),
    q(`lead_forms?user_id=eq.${U}&select=submissions`),
    q(`team_members?owner_user_id=eq.${U}&select=status`),
    q(`user_profiles?user_id=eq.${U}&agent_key=eq.__assign_rules__&select=profile_data&limit=1`),
    cuenta('push_subs', `user_id=eq.${U}`),
    q(`chat_agents?user_id=eq.${U}&select=business_ctx,faqs`),
    cuenta('client_knowledge_sources', `user_id=eq.${U}`),
    cuenta('client_properties', `user_id=eq.${U}`),
    cuenta('client_products', `user_id=eq.${U}`),
    q(`automations?user_id=eq.${U}&select=active,trigger`),
    cuenta('platform_connections', `user_id=eq.${U}&platform=eq.google_calendar`),
    cuenta('booking_settings', `user_id=eq.${U}&activo=is.true`),
    cuenta('proposals', `user_id=eq.${U}`),
    cuenta('email_templates', `user_id=eq.${U}&deleted_at=is.null`),
    cuenta('leads', `user_id=eq.${U}&deleted_at=is.null&stage=eq.ganado`),
    cuenta('uso_pantallas', `user_id=eq.${U}&pantalla=like./analisis*`),
    cuenta('informes_compartidos', `user_id=eq.${U}`),
    cuenta('reportes_programados', `user_id=eq.${U}`),
    cuenta('platform_connections', `user_id=eq.${U}&platform=in.(google_ads,meta_ads)`),
    q(`tiendas?user_id=eq.${U}&activo=is.true&select=activo`),
  ]);
  const reglas = reparto?.[0]?.profile_data;
  return {
    pipelines, etapas, leads, leadsDeWeb, canales, formularios, equipo,
    reparto: !!(reglas && (Array.isArray(reglas) ? reglas.length : Object.keys(reglas).length)),
    celulares, agentes, catalogo: fuentesSaber + propiedades + productos, automatizaciones,
    calendario: calendario > 0, reservas: reservas > 0, propuestas, plantillas, ganados,
    vistasAnalisis, informes: informes + reportes, pauta: pauta > 0, tiendas,
  };
}

export async function datosDelAsesor(ownerId, actorId, { url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY } = {}) {
  const h = cabeceras(key);
  const cuenta = async (tabla, filtro) => {
    try {
      const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}&select=id`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0' } });
      return parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
    } catch { return 0; }
  };
  const O = encodeURIComponent(ownerId), A = encodeURIComponent(actorId);
  const [celulares, actividades, movimientos] = await Promise.all([
    cuenta('push_subs', `user_id=eq.${A}`),
    cuenta('lead_activities', `user_id=eq.${O}&metadata->>actor_id=eq.${A}&type=in.(nota,llamada,email,reunion,visita,tarea)`),
    cuenta('lead_activities', `user_id=eq.${O}&metadata->>actor_id=eq.${A}&type=eq.stage_change`),
  ]);
  return { celulares, actividades, movimientos };
}

// ── El armado de la ruta (lo usan la pantalla y el cron) ──────────────────
// Solo para cuentas de la era del alta guiada: a una cuenta de hace meses,
// ya funcionando, ver «Día 1» un buen día sería ruido.
export const RUTA_DESDE = Date.parse('2026-09-30T00:00:00Z');
export const DIA = 86400000;
export function armarRuta({ pasos, hechos, hitos, opc = new Set(), inicio, ahora = Date.now() }) {
  const lista = pasos.map(p => ({
    id: p.id, dia: p.dia, titulo: p.titulo, porque: p.porque, ir: p.ir, boton: p.boton,
    hazlo: p.hazlo || null, academia: p.academia || null, esencial: !!p.esencial, entrada: !!p.entrada,
    opcional: opc.has(p.id), hecho: !!hechos[p.id], cuando: (hitos || {})[p.id] || null,
  }));
  // Lo que cuenta para el porcentaje: lo no opcional, y las entradas (WhatsApp,
  // redes, web) como UNA sola: basta con que entren leads por alguna.
  const obligatorios = lista.filter(p => !p.opcional);
  const entradas = lista.filter(p => p.entrada);
  const total = obligatorios.length + (entradas.length ? 1 : 0);
  const hechosN = obligatorios.filter(p => p.hecho).length + (entradas.some(p => p.hecho) ? 1 : 0);
  const dia = Math.min(7, Math.max(1, Math.floor((ahora - inicio) / DIA) + 1));
  // El siguiente: el primero sin hacer del día en curso o anterior; si no hay,
  // el primero sin hacer que quede.
  const pend = lista.filter(p => !p.hecho && !(p.opcional && !p.entrada));
  const siguiente = pend.find(p => p.dia <= dia) || pend[0] || null;
  return { pasos: lista, dia_actual: dia, progreso: { hechos: hechosN, total, pct: total ? Math.round(hechosN / total * 100) : 100 }, siguiente: siguiente && siguiente.id };
}
