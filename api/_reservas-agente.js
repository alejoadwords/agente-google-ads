// api/_reservas-agente.js — el agente del chat agenda citas.
//
// El agente del inbox no usa herramientas: escribe bloques ocultos al final de
// su respuesta y el motor (api/_inbox-engine.js) los ejecuta. Esto añade uno:
//
//   [RESERVA: {"servicio": "3f2a9c1d", "dia": "2026-09-30", "hora": "10:00", "nombre": "Laura", "con": "Ana"}]
//
// Dos decisiones que sostienen todo lo de aquí:
//
//  1. SOLO los servicios marcados («el agente puede reservar esto»). Se mira en
//     el prompt Y al ejecutar: que el modelo se salte la instrucción no puede
//     bastar para cerrar una cita que el negocio no quería cerrar sola.
//
//  2. La hora la COMPRUEBA el sistema, no el modelo. Entre que el agente ofreció
//     las 10:00 y la persona dijo «sí» pueden pasar minutos, y la cita se guarda
//     por el mismo camino que la página pública (`guardarCita`), que vuelve a
//     mirar el hueco y tiene detrás el índice único contra el choque. Si no está
//     libre, el mensaje del agente —que ya decía «te agendo»— NO se envía: se
//     sustituye por uno que lo dice y ofrece otras horas.
//
// Solo se importa desde funciones EDGE (ver CLAUDE.md).

import { franjasLibres, instanteDe, diaLocal, diaDeLaSemana } from './_disponibilidad.js';
import { negocioDe, cargarCatalogo, ocupadoDe, reglasDe, elegibles, guardarCita, fechaLarga, cancelarCita, moverCita, comprobarHueco } from './_reservas.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Lo que se le enseña al modelo. Cada hora es texto en el prompt de CADA
// mensaje: con 30 horas por día y seis servicios el prompt se come la
// conversación. Es una muestra, y el prompt lo dice: cualquier otra hora dentro
// del horario se puede pedir igual, porque la comprobación es del sistema.
const MAX_SERVICIOS = 6;
const DIAS_CON_HUECO = 5;
const DIAS_A_MIRAR = 14;
const HORAS_POR_DIA = 8;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** La clave corta con la que el modelo nombra un servicio: 8 hex del id. */
export const claveDe = (id) => String(id || '').replace(/-/g, '').slice(0, 8).toLowerCase();

/** El día siguiente, como cadena. Sumar 24 h a un instante se salta días cuando cambia la hora. */
function diaSiguiente(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Como mucho `n` horas, repartidas por el día: no las n primeras de la mañana. */
function muestra(horas, n) {
  if (horas.length <= n) return horas;
  const out = [];
  for (let k = 0; k < n; k++) out.push(horas[Math.round(k * (horas.length - 1) / (n - 1))]);
  return [...new Set(out)];
}

const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Lo que el agente puede agendar ahora mismo, con sus próximos huecos.
 * null si no hay nada que agendar (sin configuración o sin servicios marcados):
 * entonces el prompt ni lo menciona.
 */
export async function reservasParaAgente(userId, clientId, ahora = new Date()) {
  const neg = await negocioDe(userId, clientId);
  if (!neg) return null;
  const { servicios, recursos } = await cargarCatalogo(neg, { conAgente: true });
  const suyos = servicios.filter(s => s.agente_reserva === true).slice(0, MAX_SERVICIOS);
  if (!suyos.length) return null;

  const zona = neg.zona_horaria || 'America/Bogota';
  const maxDias = Math.min(DIAS_A_MIRAR, (neg.antelacion_max_dias | 0) || 60);
  const ids = [...new Set(suyos.flatMap(s => s.recursos))];
  const hasta = new Date(ahora.getTime() + (maxDias + 1) * 86400000);
  // Una sola lectura de lo ocupado —citas, bloqueos y Google— para todos.
  const ocupado = await ocupadoDe(neg, ids, ahora.toISOString(), hasta.toISOString());
  const topeDia = diaLocal(zona, new Date(ahora.getTime() + ((neg.antelacion_max_dias | 0) || 60) * 86400000));

  const lista = suyos.map(s => {
    const puede = elegibles(s, recursos);
    const huecos = [];
    let dia = diaLocal(zona, ahora);
    for (let k = 0; k < maxDias && huecos.length < DIAS_CON_HUECO && dia <= topeDia; k++, dia = diaSiguiente(dia)) {
      const horas = new Set();
      for (const r of puede) {
        for (const f of franjasLibres({ ...reglasDe(neg, r, s, ocupado[r.id], ahora), dia })) horas.add(f.hhmm);
      }
      if (horas.size) huecos.push({ dia, semana: DIAS[diaDeLaSemana(zona, dia)], horas: muestra([...horas].sort(), HORAS_POR_DIA) });
    }
    return {
      id: s.id, clave: claveDe(s.id), nombre: s.nombre, minutos: s.minutos, precio: s.precio,
      quien: puede.map(r => r.nombre), huecos,
    };
  });
  // `todos` hace falta para reconocer que el modelo pidió uno SIN marcar —y
  // negarse con motivo— en vez de no entender qué pidió.
  return { neg, zona, servicios: lista, catalogo: { servicios: suyos, todos: servicios, recursos }, hoy: diaLocal(zona, ahora), ahora };
}

function precioTexto(p) {
  if (p == null || p === '') return null;
  const n = Number(p);
  return Number.isFinite(n) ? '$' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 }) : null;
}

/** El trozo del prompt. Sin backticks: vive dentro de un template literal. */
export function bloqueReservas(info, canal = 'whatsapp') {
  if (!info || !info.servicios.length) return '';
  const hoy = info.hoy;
  const lineas = info.servicios.map(s => {
    const cab = '[' + s.clave + '] ' + s.nombre + ' · ' + s.minutos + ' min' +
      (precioTexto(s.precio) ? ' · ' + precioTexto(s.precio) : '') +
      (s.quien.length ? ' · lo atiende: ' + s.quien.join(', ') : '');
    const huecos = s.huecos.length
      ? s.huecos.map(h => '  ' + h.dia + ' (' + h.semana + '): ' + h.horas.join(', ')).join('\n')
      : '  Sin huecos en los próximos días. Si lo piden, ofrece pasar la conversación a un asesor.';
    return cab + '\n' + huecos;
  }).join('\n');
  // El ejemplo lleva una clave, un día y una hora DE VERDAD. Con una plantilla
  // abstracta («clave de 8 letras») el modelo pequeño escribía el nombre del
  // servicio, y no se agendaba nada: lo destapó la prueba contra Claude real.
  const s0 = info.servicios.find(s => s.huecos.length) || info.servicios[0];
  const ej = { clave: s0.clave, nombre: s0.nombre, dia: s0.huecos[0]?.dia || hoy, hora: s0.huecos[0]?.horas[0] || '10:00' };
  const contacto = canal === 'whatsapp'
    ? 'El teléfono ya lo tienes: es este chat.'
    : 'Necesitas también un celular o un correo para confirmarle.';

  return `AGENDAR CITAS — PUEDES HACERLO TÚ:
Hoy es ${DIAS[diaDeLaSemana(info.zona, hoy)]} ${hoy}. Las horas son de la zona del negocio (${info.zona}).
Servicios que puedes agendar, con algunas horas libres de cada día:
${lineas}

Cómo se agenda:
- Ofrece como mucho tres horas por mensaje, de las de arriba. Son una muestra: si la persona pide otra hora de ese día, puedes proponerla igual.
- Para agendar necesitas el servicio, el día, la hora y el nombre de la persona. ${contacto}
- Antes de agendar, confírmalo con ella en una frase («¿Te agendo el corte el martes a las 10:00?»). Solo cuando diga que sí, escribe al final de tu mensaje, invisible para ella, un bloque como este:
[RESERVA: {"servicio": "${ej.clave}", "dia": "${ej.dia}", "hora": "${ej.hora}", "nombre": "Nombre Apellido"}]
- "servicio" es la clave entre corchetes de la lista (la de ${ej.nombre} es ${ej.clave}), no el nombre. El día y la hora, exactamente en ese formato.
- Si pidió a alguien concreto, añade "con": "su nombre".
- El bloque va SOLO en el mensaje que responde a su «sí». Nunca en el mismo mensaje en el que le preguntas si le parece bien: si preguntas, todavía no ha dicho que sí.
- En ese mensaje di que la estás agendando, sin darla por hecha. El sistema comprueba la hora y le manda debajo la confirmación con el enlace para cancelar. No inventes ese enlace ni digas que ya quedó.
- Si piden algo que no está en esta lista, no lo agendes: di que eso lo confirma un asesor e incluye [ESCALAR].

`;
}

/** El pedido del bloque [RESERVA], o null si no hay o no se entiende. */
export function extraerReserva(texto) {
  const m = String(texto || '').match(/\[RESERVA:\s*(\{.*?\})\]/s);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]);
    if (!o || typeof o !== 'object') return null;
    return {
      servicio: String(o.servicio || '').trim(),
      dia: String(o.dia || '').trim(),
      hora: String(o.hora || '').trim(),
      nombre: String(o.nombre || '').trim().slice(0, 120),
      con: String(o.con || '').trim().slice(0, 80),
    };
  } catch { return null; }
}

/**
 * ¿El propio mensaje del agente está PIDIENDO la confirmación?
 *
 * Con Claude de verdad pasó: «Te agendo mañana a las 11:00, ¿te parece bien?»
 * y el bloque en el mismo mensaje. La cita quedaba hecha antes de que la
 * persona dijera que sí. El prompt lo prohíbe; esto es el cerrojo por si el
 * modelo se lo salta: si la última frase pregunta por la cita, no se agenda.
 * Se mira solo la ÚLTIMA pregunta y solo las que piden visto bueno, para no
 * frenar un «Listo, te la agendo. ¿Algo más?».
 */
export function pideConfirmacion(textoVisible) {
  const t = String(textoVisible || '').trim();
  if (!t.endsWith('?')) return false;
  const ultima = t.slice(t.lastIndexOf('¿') >= 0 ? t.lastIndexOf('¿') : 0);
  return /(te|le|les) (parece|sirve|queda|va|viene|funciona)|est[aá] bien|confirm|de acuerdo|te (la|lo) (agendo|dejo|reservo|cancelo|cambio|paso|muevo)|(agendo|reservo|dejo|cancelo|cambio|muevo|cancelamos|cambiamos)\b|(la|lo) agendamos|procedo|seguimos|as[ií] est[aá]/i.test(ultima);
}

/**
 * ¿El agente ANUNCIA que está agendando, cambiando o cancelando?
 *
 * Con Claude de verdad pasó: «Listo, te estoy agendando… en un momento te llega
 * la confirmación» y ningún bloque. La persona se queda esperando algo que no
 * va a llegar. Si esto da verdadero y no hay bloque, el motor le pide al
 * modelo que lo escriba.
 */
export function prometeAccion(textoVisible) {
  return /(estoy|voy a|vamos a) (agend|cambi|cancel|reserv)|te (llega|llegar[aá]) la confirmaci|recib(es|ir[aá]s) la confirmaci|(queda|qued[oó]) (agendad|reservad|cambiad|cancelad)/i
    .test(String(textoVisible || ''));
}

/** ¿Trae alguno de los bloques de cita? */
export function traeBloqueDeCita(texto) {
  return /\[(RESERVA|CANCELAR_CITA|CAMBIAR_CITA):/.test(String(texto || ''));
}

/** Los bloques ocultos de una respuesta, para conservarlos si se cambia el texto. */
export function bloquesOcultos(texto) {
  return (String(texto || '').match(/\[(?:CAPTURA|CALIFICACION|RESERVA|CANCELAR_CITA|CAMBIAR_CITA):\s*\{.*?\}\]|\[ESCALAR\]/gs) || []).join('\n');
}

function horaCorta(iso, zona) {
  try {
    return new Intl.DateTimeFormat('es-CO', { timeZone: zona, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
      .format(new Date(iso));
  } catch { return iso; }
}

/** Otras horas del mismo servicio, sin la que acaba de fallar. */
function alternativas(info, servicio, fallida) {
  const s = info.servicios.find(x => x.id === servicio.id);
  const out = [];
  for (const h of (s ? s.huecos : [])) {
    for (const hh of h.horas) {
      const iso = instanteDe(info.zona, h.dia, hh).toISOString();
      if (iso !== fallida) out.push(iso);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

async function citaYaGuardada(neg, leadId, servicioId, inicioISO) {
  if (!leadId) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/activities?user_id=eq.${encodeURIComponent(neg.user_id)}&lead_id=eq.${encodeURIComponent(leadId)}` +
    `&service_id=eq.${encodeURIComponent(servicioId)}&due_at=eq.${encodeURIComponent(inicioISO)}&cancelled_at=is.null` +
    `&select=id,due_at,booking_token,resource_id&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  ).catch(() => null);
  return r && r.ok ? (await r.json())?.[0] || null : null;
}

/**
 * Ejecuta el bloque [RESERVA].
 *
 * Devuelve { ok: true, texto, cita } —`texto` es la confirmación que va debajo
 * del mensaje del agente— o { ok: false, texto, escalar? } —`texto` SUSTITUYE
 * al mensaje del agente, que ya prometía algo que no pasó—.
 *
 * Con `simular` (el probador) se comprueba todo igual y no se escribe nada.
 */
/**
 * El servicio que pidió el modelo: por su clave o, si escribió el nombre, por
 * el nombre. Se busca entre TODOS para distinguir «pidió uno sin marcar» de
 * «no se entiende qué pidió».
 */
export function servicioPedido(info, pedido) {
  const todos = info.catalogo.todos || info.catalogo.servicios;
  const clave = claveDe(pedido.servicio);
  const porClave = todos.find(s => claveDe(s.id) === clave);
  if (porClave) return porClave;
  const q = normal(pedido.servicio);
  if (!q) return null;
  const exactos = todos.filter(s => normal(s.nombre) === q);
  if (exactos.length === 1) return exactos[0];
  // «Asesoría» por «Asesoría inicial». Solo si no hay duda: con dos servicios
  // que empiezan igual, adivinar sería agendar lo que no se pidió.
  const parecidos = todos.filter(s => normal(s.nombre).startsWith(q) || q.startsWith(normal(s.nombre)));
  return parecidos.length === 1 ? parecidos[0] : null;
}

export async function ejecutarReserva({ info, pedido, contacto = {}, leadId = null, simular = false }) {
  const zona = info.zona;
  const servicio = servicioPedido(info, pedido);
  if (!servicio) {
    return { ok: false, motivo: 'servicio_desconocido', texto: '¿Me confirmas qué servicio quieres agendar? Así te lo dejo listo.' };
  }
  // Un servicio sin marcar NO se agenda aunque el modelo lo pida: el interruptor
  // es del negocio, no del prompt.
  if (!servicio || servicio.agente_reserva !== true) {
    return { ok: false, escalar: true, motivo: 'servicio',
      texto: 'Eso prefiero confirmártelo con un asesor para no darte una hora equivocada. Ya le paso tu conversación.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido.dia) || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(pedido.hora)) {
    return { ok: false, motivo: 'fecha', texto: '¿Me confirmas el día y la hora exactos que prefieres? Así te la agendo.' };
  }
  const nombre = pedido.nombre || contacto.nombre || '';
  if (!nombre) return { ok: false, motivo: 'nombre', texto: 'Para agendarte, ¿a nombre de quién la dejo?' };
  if (!contacto.telefono && !contacto.correo) {
    return { ok: false, motivo: 'contacto', texto: 'Para confirmarte la cita necesito un celular o un correo. ¿Me lo compartes?' };
  }

  const hora = pedido.hora.padStart(5, '0');
  const inicio = instanteDe(zona, pedido.dia, hora);
  // A quién pidió, si pidió a alguien y ese alguien presta el servicio. Si el
  // nombre no casa con nadie, se ignora: mejor cualquiera libre que ninguno.
  const pedidoRecurso = recursoPedido(servicio, info.catalogo.recursos, pedido.con);

  // Si el mismo mensaje llega dos veces —o el modelo repite el bloque en el
  // turno siguiente—, la cita ya está: se confirma otra vez, no se duplica con
  // otra persona del equipo a la misma hora.
  const previa = simular ? null : await citaYaGuardada(info.neg, leadId, servicio.id, inicio.toISOString());
  if (previa) {
    return { ok: true, repetida: true, cita: previa,
      texto: confirmacion(servicio, previa.due_at, zona, null, previa.booking_token) };
  }

  const r = await guardarCita(info.neg, {
    servicio, recursos: info.catalogo.recursos, inicio,
    pedido: pedidoRecurso ? pedidoRecurso.id : null,
    contacto: { nombre, telefono: contacto.telefono || '', correo: contacto.correo || '', nota: 'Agendada por el agente del chat' },
    leadId,
    fuente: { source: info.neg.lead_source || 'reserva', sourceLabel: 'Reserva por chat' },
    simular,
  });

  if (r.simulada) {
    return { ok: true, simulada: true,
      texto: '(Ensayo: no se guardó nada) ' + confirmacion(servicio, inicio.toISOString(), zona, r.recurso.nombre, null) };
  }
  if (r.error) {
    const otras = r.ocupada || r.lejos ? alternativas(info, servicio, inicio.toISOString()) : [];
    const lista = otras.map(iso => horaCorta(iso, zona)).join('\n');
    const texto = (r.lejos
        ? 'Esa fecha queda muy lejos para agendarla todavía.'
        : r.ocupada
          ? (pedidoRecurso ? 'Esa hora con ' + pedidoRecurso.nombre + ' no está libre.' : 'Uy, esa hora ya no está libre.')
          : 'No pude agendarla por un problema de nuestro lado.') +
      (otras.length ? ' Te puedo ofrecer:\n' + lista + '\n¿Cuál te sirve?' : ' ¿Te sirve otro día u otra hora?');
    return { ok: false, motivo: r.ocupada ? 'ocupada' : r.lejos ? 'lejos' : 'error', texto };
  }
  return { ok: true, cita: r.cita, recurso: r.recurso, cerrar: r.cerrar,
    texto: confirmacion(servicio, r.cita.due_at, zona, r.recurso.nombre, r.citaToken) };
}

function recursoPedido(servicio, recursos, con) {
  if (!con) return null;
  const candidatos = elegibles(servicio, recursos);
  return candidatos.find(r => normal(r.nombre) === normal(con)) ||
    candidatos.find(r => normal(r.nombre).split(' ')[0] === normal(con).split(' ')[0]) || null;
}

function confirmacion(servicio, iso, zona, con, token) {
  return 'Cita confirmada: ' + servicio.nombre + ', ' + fechaLarga(new Date(iso), zona) +
    (con ? ', con ' + con : '') + '.' +
    (token ? '\nSi necesitas cancelarla: https://app.acuarius.app/cita/' + token : '');
}

// ── Cancelar y cambiar una cita que ya existe ───────────────────────────────
//
// El agente solo ve —y solo puede tocar— las citas del contacto de ESTA
// conversación. No hay forma de nombrar otra: la clave se busca dentro de esa
// lista, que se arma en el servidor a partir del lead de la conversación, nunca
// de algo que escriba el modelo o la persona.
//
//   [CANCELAR_CITA: {"cita": "ab12cd34"}]
//   [CAMBIAR_CITA: {"cita": "ab12cd34", "dia": "2026-10-02", "hora": "15:00", "con": "Ana"}]
//
// Cancelar se puede siempre, igual que con el enlace que ya tiene la persona.
// Cambiar, solo en los servicios que el agente puede agendar: mover una cita es
// volver a agendarla, y lo que el negocio no quiere cerrar solo tampoco lo
// quiere mover solo.

const MAX_CITAS = 5;

/** Las próximas citas vivas del contacto, con lo que hace falta para nombrarlas. */
export async function citasDelContacto(userId, clientId, leadId, ahora = new Date()) {
  if (!leadId) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/activities?user_id=eq.${encodeURIComponent(userId)}&lead_id=eq.${encodeURIComponent(leadId)}` +
    `&resource_id=not.is.null&cancelled_at=is.null&due_at=gte.${encodeURIComponent(ahora.toISOString())}` +
    `&select=id,user_id,client_id,title,due_at,end_at,service_id,resource_id,booking_token,gcal_event_id` +
    `&order=due_at.asc&limit=${MAX_CITAS}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!r.ok) throw new Error('citas del contacto: HTTP ' + r.status);
  const filas = await r.json();
  if (!filas.length) return null;
  const neg = await negocioDe(userId, clientId);
  if (!neg) return null;
  const { servicios, recursos } = await cargarCatalogo(neg, { conAgente: true });
  return {
    neg, zona: neg.zona_horaria || 'America/Bogota', catalogo: { servicios, recursos },
    citas: filas.map(c => {
      const servicio = servicios.find(s => s.id === c.service_id) || null;
      return {
        ...c, clave: claveDe(c.id), servicio,
        // Un servicio borrado o apagado ya no está en el catálogo: su nombre
        // sale del título de la cita («Corte · Laura»).
        nombreServicio: servicio ? servicio.nombre : String(c.title || 'Cita').split(' · ')[0],
        con: (recursos.find(r => r.id === c.resource_id) || {}).nombre || null,
        movible: !!(servicio && servicio.agente_reserva === true),
      };
    }),
  };
}

/** El trozo del prompt con sus citas. Sin backticks: vive dentro de un template literal. */
export function bloqueCitas(suyas) {
  if (!suyas || !suyas.citas.length) return '';
  const lineas = suyas.citas.map(c =>
    '[' + c.clave + '] ' + c.nombreServicio + ' · ' + fechaLarga(new Date(c.due_at), suyas.zona) +
    (c.con ? ' · con ' + c.con : '') +
    (c.movible ? ' · se puede cambiar de hora' : ' · cambiarla de hora lo confirma un asesor')).join('\n');
  const ej = suyas.citas[0].clave;
  return `CITAS QUE YA TIENE ESTA PERSONA:
${lineas}

Si quiere cancelar o cambiar una:
- Confírmale cuál y qué quiere hacer en una frase. Solo cuando diga que sí, escribe al final de tu mensaje, invisible para ella:
  para cancelar: [CANCELAR_CITA: {"cita": "${ej}"}]
  para cambiarla: [CAMBIAR_CITA: {"cita": "${ej}", "dia": "AAAA-MM-DD", "hora": "HH:MM"}]
- "cita" es la clave entre corchetes de arriba. Para cambiarla, ofrécele horas de la lista de huecos de ese servicio; si pide a alguien concreto, añade "con".
- Si la cita dice que cambiarla lo confirma un asesor, no escribas el bloque de cambiar: dilo e incluye [ESCALAR]. Cancelar sí puedes.
- El bloque va solo en el mensaje que responde a su «sí», nunca en el que le preguntas. El sistema le manda debajo la confirmación: no la des por hecha.

`;
}

/** { tipo: 'cancelar'|'cambiar', cita, dia?, hora?, con? } o null. */
export function extraerCambio(texto) {
  const t = String(texto || '');
  const m = t.match(/\[(CANCELAR_CITA|CAMBIAR_CITA):\s*(\{.*?\})\]/s);
  if (!m) return null;
  try {
    const o = JSON.parse(m[2]);
    if (!o || typeof o !== 'object') return null;
    return {
      tipo: m[1] === 'CANCELAR_CITA' ? 'cancelar' : 'cambiar',
      cita: String(o.cita || '').trim().toLowerCase(),
      dia: String(o.dia || '').trim(),
      hora: String(o.hora || '').trim(),
      con: String(o.con || '').trim().slice(0, 80),
    };
  } catch { return null; }
}

/**
 * Ejecuta un cancelar o un cambiar. Misma forma de respuesta que
 * `ejecutarReserva`: { ok: true, texto } —la confirmación que va debajo— o
 * { ok: false, texto, escalar? } —el texto que SUSTITUYE al del agente—.
 *
 * `info` son los huecos del agente (null si no puede agendar nada): hacen
 * falta para cambiar de hora, no para cancelar.
 */
export async function ejecutarCambio({ suyas, info, pedido, simular = false }) {
  const cita = suyas && suyas.citas.find(c => c.clave === claveDe(pedido.cita));
  if (!cita) {
    return { ok: false, motivo: 'cita_desconocida',
      texto: 'No encuentro esa cita entre las tuyas. ¿Me dices qué día la tenías?' };
  }
  const zona = suyas.zona;
  const cuando = fechaLarga(new Date(cita.due_at), zona);

  if (pedido.tipo === 'cancelar') {
    if (simular) return { ok: true, simulada: true, texto: '(Ensayo: no se canceló nada) Cita cancelada: ' + cita.nombreServicio + ', ' + cuando + '.' };
    const r = await cancelarCita(cita);
    if (r.error) {
      return { ok: false, escalar: true, motivo: 'error',
        texto: 'No pude cancelarla por un problema de nuestro lado. Ya le aviso a un asesor para que lo haga.' };
    }
    return { ok: true, motivo: 'cancelada',
      texto: 'Cita cancelada: ' + cita.nombreServicio + ', ' + cuando + '. Ese turno queda libre para otra persona.' };
  }

  // Cambiar
  const serv = info && info.catalogo.servicios.find(s => s.id === cita.service_id);
  if (!cita.movible || !serv) {
    return { ok: false, escalar: true, motivo: 'no_movible',
      texto: 'El cambio de esa cita prefiero confirmártelo con un asesor. Ya le paso tu conversación.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido.dia) || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(pedido.hora)) {
    return { ok: false, motivo: 'fecha', texto: '¿A qué día y hora exactos quieres pasarla? Así te la cambio.' };
  }
  const inicio = instanteDe(zona, pedido.dia, pedido.hora.padStart(5, '0'));
  const pedidoRecurso = recursoPedido(serv, info.catalogo.recursos, pedido.con);

  if (inicio.toISOString() === new Date(cita.due_at).toISOString() && !pedidoRecurso) {
    return { ok: true, motivo: 'igual', texto: 'Tu cita sigue igual: ' + cita.nombreServicio + ', ' + cuando + '.' };
  }

  const r = simular
    // El ensayo mira el hueco igual y se para ahí.
    ? await comprobarHueco(info.neg, {
        servicio: serv, recursos: info.catalogo.recursos, inicio, pedido: pedidoRecurso ? pedidoRecurso.id : null, ignorar: cita.id })
    : await moverCita(info.neg, cita, {
        servicio: serv, recursos: info.catalogo.recursos, inicio, pedido: pedidoRecurso ? pedidoRecurso.id : null });

  if (r.error) {
    const otras = r.ocupada || r.lejos ? alternativas(info, serv, inicio.toISOString()) : [];
    const lista = otras.map(iso => horaCorta(iso, zona)).join('\n');
    // Lo primero que tiene que oír: su cita de antes NO se ha tocado.
    const texto = 'Tu cita del ' + cuando + ' sigue en pie. ' +
      (r.lejos ? 'Esa fecha queda muy lejos para pasarla allí todavía.'
        : r.ocupada ? (pedidoRecurso ? 'Esa hora con ' + pedidoRecurso.nombre + ' no está libre.' : 'Esa hora no está libre.')
        : 'No pude cambiarla por un problema de nuestro lado.') +
      (otras.length ? ' Te la puedo pasar a:\n' + lista + '\n¿Cuál te sirve?' : ' ¿Te sirve otro día u otra hora?');
    return { ok: false, motivo: r.ocupada ? 'ocupada' : r.lejos ? 'lejos' : 'error', texto };
  }
  const nuevo = fechaLarga(inicio, zona);
  const con = (r.recurso || r.libre || {}).nombre;
  if (simular) {
    return { ok: true, simulada: true, texto: '(Ensayo: no se cambió nada) Cita cambiada: ' + serv.nombre + ', ' + nuevo + (con ? ', con ' + con : '') + '.' };
  }
  return { ok: true, motivo: 'cambiada', cerrar: r.cerrar,
    texto: 'Cita cambiada: ' + serv.nombre + ', ahora ' + nuevo + (con ? ', con ' + con : '') + '.' +
      (cita.booking_token ? '\nTu enlace para cancelarla sigue siendo el mismo: https://app.acuarius.app/cita/' + cita.booking_token : '') };
}
