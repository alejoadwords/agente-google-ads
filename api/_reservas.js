// api/_reservas.js — reservar una cita, desde donde sea.
//
// Vivía dentro de api/booking-public.js. Salió aquí cuando el agente de
// WhatsApp empezó a agendar: una reserva que entra por el chat tiene que pasar
// por EXACTAMENTE el mismo camino que la que entra por la página —la misma
// comprobación de hueco, el mismo índice contra el choque, el mismo evento en
// Google, el mismo correo—. Dos copias acaban diciendo cosas distintas, y la
// que se queda vieja es la que cita a dos personas a la misma hora.
//
// Solo se importa desde funciones EDGE (ver CLAUDE.md).

import { sigueLibre } from './_disponibilidad.js';
import { intakeLead } from './_lead-intake.js';
import { getGcalToken, gcalEventBody, gcalRequest, tokenDeRecurso, ocupadoDeCalendarios, gcalEnSuCalendario } from './_gcal.js';
import { emailHtml, bloque, RESPONDER_A, esc } from './_email-layout.js';
import { registrarError } from './_registro-errores.js';
import { enviarResend } from './_correo.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: prefer || 'return=representation',
  };
}

const sb = (path) => fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: sbHeaders() })
  .then(r => r.ok ? r.json() : Promise.reject(new Error('Supabase ' + r.status)));

export function nuevoToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * La configuración de reservas de una cuenta (o de uno de sus clientes).
 *
 * `booking_settings.client_id` guarda '' para «de la cuenta», no NULL: es NOT
 * NULL y forma parte de la clave. Con `is.null` aquí no saldría nunca nada.
 */
export async function negocioDe(userId, clientId) {
  const filas = await sb(`/booking_settings?user_id=eq.${encodeURIComponent(userId)}` +
    `&client_id=eq.${encodeURIComponent(clientId || '')}&select=*&limit=1`);
  return filas?.[0] || null;
}

export const filtroCliente = (c) => (c ? `client_id=eq.${encodeURIComponent(c)}` : 'client_id=is.null');

export async function cargarCatalogo(neg, { conAgente = false } = {}) {
  // `booking_settings.client_id` guarda '' para «de la cuenta»; servicios y
  // recursos guardan NULL. Traducir aquí y no más adelante: `eq.` no casa con
  // NULL y el catálogo saldría vacío sin un solo error.
  const cliente = neg.client_id || null;
  const [servicios, recursos] = await Promise.all([
    sb(`/booking_services?user_id=eq.${encodeURIComponent(neg.user_id)}&${filtroCliente(cliente)}` +
       `&activo=is.true&select=id,nombre,descripcion,minutos,precio,color,icono,orden${conAgente ? ',agente_reserva' : ''},booking_service_resources(resource_id)` +
       `&order=orden.asc,created_at.asc`),
    sb(`/booking_resources?user_id=eq.${encodeURIComponent(neg.user_id)}&${filtroCliente(cliente)}` +
       `&activo=is.true&select=id,nombre,horario,orden&order=orden.asc,created_at.asc`),
  ]);
  const vivos = new Set(recursos.map(r => r.id));
  return {
    servicios: servicios.map(s => {
      const { booking_service_resources, ...resto } = s;
      return { ...resto, recursos: (booking_service_resources || []).map(x => x.resource_id).filter(id => vivos.has(id)) };
    // Un servicio que no presta nadie no se puede reservar: enseñarlo es
    // ofrecer algo que acaba en una lista de horas vacía sin explicación.
    }).filter(s => s.recursos.length),
    recursos,
  };
}

/** Lo que ya tiene cogido cada recurso en ese rango. */
// `ignorar`: el id de una cita que NO cuenta como ocupada. Al cambiar una cita
// de hora, la propia cita no puede taparse a sí misma: moverla media hora
// más tarde solapa con donde estaba y saldría «ocupado» siempre.
export async function ocupadoDe(neg, ids, desdeISO, hastaISO, ignorar = null) {
  const porRecurso = {};
  ids.forEach(id => { porRecurso[id] = []; });
  if (!ids.length) return porRecurso;
  const cliente = neg.client_id || null;

  const [filas, bloqueos, google] = await Promise.all([
    sb(
      `/activities?user_id=eq.${encodeURIComponent(neg.user_id)}` +
      `&resource_id=in.(${ids.map(encodeURIComponent).join(',')})` +
      `&cancelled_at=is.null&due_at=gte.${encodeURIComponent(desdeISO)}&due_at=lt.${encodeURIComponent(hastaISO)}` +
      `&select=id,due_at,end_at,resource_id&limit=1000`
    ).catch(() => []),
    // Los bloqueos que alguien puso a mano.
    //
    // El filtro es por SOLAPE, no por cuándo empiezan: unas vacaciones de una
    // semana empiezan antes del rango que se está mirando y aun así lo tapan
    // entero. Con el filtro de las citas —`inicio` dentro del rango— esa
    // semana no habría bloqueado nada, que es peor que no tener bloqueos.
    sb(
      `/booking_blocks?user_id=eq.${encodeURIComponent(neg.user_id)}` +
      `&${filtroCliente(cliente)}` +
      `&inicio=lt.${encodeURIComponent(hastaISO)}&fin=gt.${encodeURIComponent(desdeISO)}` +
      `&select=inicio,fin,resource_id&limit=500`
    ).catch(() => []),
    // Lo que cada persona tiene en SU Google Calendar.
    ocupadoGoogle(neg, ids, desdeISO, hastaISO),
  ]);

  for (const f of filas || []) {
    if (ignorar && f.id === ignorar) continue;
    const ini = new Date(f.due_at).getTime();
    const fin = f.end_at ? new Date(f.end_at).getTime() : ini + 3600000;
    if (porRecurso[f.resource_id]) porRecurso[f.resource_id].push({ ini, fin });
  }
  for (const b of bloqueos || []) {
    const ini = new Date(b.inicio).getTime();
    const fin = new Date(b.fin).getTime();
    if (!Number.isFinite(ini) || !Number.isFinite(fin)) continue;
    // Sin recurso, el bloqueo es de TODO el negocio. Se aplica a cada uno al
    // calcular, y no creando una fila por recurso: así el que se dé de alta
    // mañana también respeta el cierre de la semana que viene.
    const destino = b.resource_id ? [b.resource_id] : ids;
    for (const id of destino) if (porRecurso[id]) porRecurso[id].push({ ini, fin });
  }
  for (const [id, tramos] of Object.entries(google || {})) {
    if (porRecurso[id]) porRecurso[id].push(...tramos);
  }
  return porRecurso;
}

/**
 * Lo ocupado en el Google Calendar de cada persona que lo tenga conectado.
 *
 * SI NO SE PUEDE LEER, ESA PERSONA SE DA POR OCUPADA en todo el rango. Es la
 * decisión que más pesa del módulo: con el calendario caído hay dos fallos
 * posibles —no ofrecer horas que estaban libres u ofrecer una que ya tenía una
 * cita apuntada en Google— y el segundo es el que un negocio de citas no
 * perdona. El primero, además, se ve: la pantalla de Reservas enseña en rojo
 * el calendario que dejó de responder, y el error queda en el registro.
 */
async function ocupadoGoogle(neg, ids, desdeISO, hastaISO) {
  const todo = () => ({ ini: new Date(desdeISO).getTime(), fin: new Date(hastaISO).getTime() });
  // Las citas que ya escribimos en Google no se cuentan dos veces, y sobre
  // todo no tapan a otra persona si cayeron en un calendario compartido. Las
  // nuevas llevan una marca; esto cubre las que se escribieron antes de ella.
  const nuestras = () => sb(
    `/activities?user_id=eq.${encodeURIComponent(neg.user_id)}&resource_id=not.is.null&gcal_event_id=not.is.null` +
    `&due_at=gte.${encodeURIComponent(new Date(new Date(desdeISO).getTime() - 86400000).toISOString())}` +
    `&due_at=lt.${encodeURIComponent(hastaISO)}&select=gcal_event_id&limit=2000`
  ).then(f => new Set((f || []).map(x => x.gcal_event_id))).catch(() => new Set());

  let lecturas;
  try {
    lecturas = await ocupadoDeCalendarios(ids, desdeISO, hastaISO, nuestras);
  } catch (e) {
    // Ni siquiera se supo quién tiene calendario: se tapa a todos.
    await registrarError({ origen: 'reservas', donde: 'calendarios', error: e, detalle: 'Negocio: ' + neg.user_id });
    return Object.fromEntries(ids.map(id => [id, [todo()]]));
  }
  const out = {};
  for (const [id, v] of Object.entries(lecturas)) {
    if (Array.isArray(v)) { out[id] = v; continue; }
    await registrarError({
      origen: 'reservas', donde: 'leer google calendar', error: new Error(v.fallo),
      detalle: 'Recurso ' + id + ' de ' + neg.user_id + ': se da por ocupado mientras no se pueda leer.',
    });
    out[id] = [todo()];
  }
  return out;
}

/** Las reglas con las que se calculan los huecos de un recurso concreto. */
export function reglasDe(neg, recurso, servicio, ocupado, ahora) {
  return {
    zona: neg.zona_horaria || 'America/Bogota',
    // Un recurso puede tener su propio horario (media jornada, solo martes).
    // `null` = sigue el del negocio; `{}` = no atiende nunca, que es distinto.
    horario: recurso && recurso.horario ? recurso.horario : (neg.horario || {}),
    excepciones: neg.excepciones || {},
    ocupado: ocupado || [],
    minutos: servicio.minutos,
    margen: neg.margen_min | 0,
    paso: (neg.paso_min | 0) || 15,
    ahora,
    antelacionMinHoras: neg.antelacion_min_horas | 0,
  };
}

/** Los recursos que pueden prestar ese servicio, filtrados por el que se pidió. */
export function elegibles(servicio, recursos, pedido) {
  const puede = recursos.filter(r => servicio.recursos.includes(r.id));
  if (!pedido) return puede;
  return puede.filter(r => r.id === pedido);
}


// ── Guardar la cita ─────────────────────────────────────────────────────────

/**
 * Comprueba el hueco OTRA VEZ y guarda la cita. Lo usan la página pública y el
 * agente del chat.
 *
 * `contacto` = { nombre, telefono, correo, nota }. Con `leadId` la cita se
 * cuelga de ese contacto; sin él se crea (o se reutiliza) con `fuente`.
 *
 * Devuelve { cita, recurso, citaToken, cerrar } o { error, status, ocupada }.
 * `cerrar` es la promesa de lo de después —Google y el correo—, que quien
 * llama decide si esperar: el cliente ya tiene su cita y no tiene por qué.
 */
/**
 * ¿Hay hueco para este servicio a esa hora? Devuelve { libre } —el recurso que
 * lo atendería— o { error, status, ocupada?, lejos? }.
 *
 * Lo comparten reservar y cambiar de hora: las dos cosas tienen que mirar lo
 * mismo, y en el mismo instante en que se va a escribir.
 */
export async function comprobarHueco(neg, { servicio, recursos, inicio, pedido, ignorar }) {
  const puede = elegibles(servicio, recursos, pedido || null);
  if (!puede.length) return { error: 'Nadie presta ese servicio ahora mismo', status: 410 };

  // El techo de la ventana. La página no lo ofrecía, pero tampoco lo impedía al
  // guardar: bastaba con mandar una fecha a un año vista. Con el agente, que
  // escribe la fecha él mismo, eso deja de ser teórico.
  const maxDias = (neg.antelacion_max_dias | 0) || 60;
  if (inicio.getTime() > Date.now() + maxDias * 86400000) {
    return { error: 'Solo se puede reservar con ' + maxDias + ' días de antelación como mucho.', status: 400, lejos: true };
  }

  const desdeISO = new Date(inicio.getTime() - 86400000).toISOString();
  const hastaISO = new Date(inicio.getTime() + 2 * 86400000).toISOString();
  const ocupado = await ocupadoDe(neg, puede.map(r => r.id), desdeISO, hastaISO, ignorar || null);

  // Se vuelve a comprobar AHORA, no cuando el cliente vio las horas. Entre una
  // cosa y otra pasan minutos y en ese rato otra persona puede haber cogido la
  // misma hora.
  const libre = puede.find(r => sigueLibre(inicio.toISOString(), reglasDe(neg, r, servicio, ocupado[r.id], new Date())));
  if (!libre) return { error: 'Esa hora se acaba de ocupar. Elige otra, por favor.', ocupada: true, status: 409 };
  return { libre };
}

export async function guardarCita(neg, { servicio, recursos, inicio, pedido, contacto, leadId, fuente, simular }) {
  const zona = neg.zona_horaria || 'America/Bogota';
  const hueco = await comprobarHueco(neg, { servicio, recursos, inicio, pedido });
  if (hueco.error) return hueco;
  const libre = hueco.libre;
  // El ensayo del agente pregunta lo mismo y se para aquí: sin contacto, sin
  // cita, sin Google y sin correo.
  if (simular) return { simulada: true, recurso: libre };

  const fin = new Date(inicio.getTime() + servicio.minutos * 60000);
  const cliente = neg.client_id || null;
  const citaToken = nuevoToken();
  const cuando = fechaLarga(inicio, zona);
  const { nombre, telefono, correo, nota } = contacto;

  // ── El contacto ──────────────────────────────────────────────────────────
  // Quien reserva es un lead: entra al tablero con su origen y su etiqueta, y
  // si ya existía se le suma la cita a su ficha en vez de duplicarlo.
  let lead = leadId ? { id: leadId } : null;
  if (!lead) {
    try {
      const r = await intakeLead(neg.user_id, cliente, {
        name: nombre, email: correo || null, phone: telefono || null,
        note: '\n' + servicio.nombre + ' · ' + cuando + '\nCon: ' + libre.nombre +
              (nota ? '\nNota: ' + nota : ''),
        source: (fuente && fuente.source) || neg.lead_source || 'reserva',
        sourceLabel: (fuente && fuente.sourceLabel) || 'Reserva en línea',
        pipelineId: neg.pipeline_id || null,
        // Nada de tarea «Primer contacto»: esta persona no espera una llamada,
        // ya tiene hora. El pendiente solo ensuciaría la lista de alguien.
        sinPrimerContacto: true,
      });
      lead = r.lead;
    } catch (e) {
      // Sin contacto se sigue: la cita es lo que el cliente vino a hacer y
      // perderla porque falló el CRM sería el peor intercambio posible. Queda en
      // el registro de errores para que alguien lo mire.
      await registrarError({ origen: 'reservas', donde: 'intakeLead', error: e, detalle: 'Negocio: ' + neg.user_id });
    }
  }

  // ── La cita ──────────────────────────────────────────────────────────────
  const fila = {
    user_id: neg.user_id,
    client_id: cliente,
    lead_id: lead?.id || null,
    type: 'meeting',
    title: servicio.nombre + ' · ' + nombre,
    description: [
      servicio.nombre + ' (' + servicio.minutos + ' min)',
      'Con: ' + libre.nombre,
      telefono ? 'Teléfono: ' + telefono : null,
      correo ? 'Correo: ' + correo : null,
      nota ? 'Nota: ' + nota : null,
    ].filter(Boolean).join('\n'),
    due_at: inicio.toISOString(),
    end_at: fin.toISOString(),
    service_id: servicio.id,
    resource_id: libre.id,
    booking_token: citaToken,
    booking_status: 'confirmada',
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify(fila),
  });
  if (!res.ok) {
    const txt = await res.text();
    // 23505 = el índice único. Alguien se adelantó entre la comprobación y el
    // insert; es la carrera que la comprobación sola no puede cerrar.
    if (res.status === 409 || /23505|duplicate key/i.test(txt)) {
      return { error: 'Esa hora se acaba de ocupar. Elige otra, por favor.', ocupada: true, status: 409 };
    }
    await registrarError({ origen: 'reservas', donde: 'crear cita', error: new Error(txt.slice(0, 300)), detalle: 'Negocio: ' + neg.user_id });
    return { error: 'No se pudo guardar la reserva. Inténtalo otra vez.', status: 500 };
  }
  const cita = (await res.json())[0];

  const cerrar = (async () => {
    await sincronizarGcal(neg, cita, correo);
    await avisarPorCorreo(neg, cita, servicio, libre, { nombre, correo, telefono }, citaToken, zona);
  })().catch(e => registrarError({
    origen: 'reservas', donde: 'avisos', error: e,
    detalle: 'La cita ' + cita.id + ' se guardó bien; falló lo de después.',
  }));

  return { cita, recurso: libre, citaToken, cerrar, lead };
}

// ── Cancelar y cambiar de hora ──────────────────────────────────────────────

/**
 * Cancela una cita. Lo usan el enlace /cita/:token y el agente del chat.
 *
 * Solo toca la fila si sigue viva (`cancelled_at=is.null`): dos cancelaciones
 * a la vez no pisan la fecha de la primera. Cancelar deja el hueco libre otra
 * vez, porque el índice único solo cuenta las citas no canceladas.
 *
 * Devuelve { ok } o { error }. Que falle Google no la invalida: la cita ya está
 * cancelada en Acuarius y lo que queda es un evento huérfano, que se anota.
 */
export async function cancelarCita(cita) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(cita.id)}&cancelled_at=is.null`, {
    method: 'PATCH', headers: sbHeaders('return=minimal'),
    body: JSON.stringify({ cancelled_at: new Date().toISOString(), booking_status: 'cancelada' }),
  });
  if (!res.ok) return { error: 'No se pudo cancelar. Inténtalo otra vez.' };
  if (cita.gcal_event_id) {
    try {
      await gcalEnSuCalendario(cita.user_id, cita.resource_id, 'DELETE', '/' + cita.gcal_event_id, null, true);
    } catch (e) {
      await registrarError({ origen: 'reservas', donde: 'cancelar en google', error: e, detalle: 'Cita ' + cita.id });
    }
  }
  return { ok: true };
}

/**
 * Cambia una cita de día u hora (y, si se pide, de persona).
 *
 * Se MUEVE la misma fila en vez de cancelar y crear otra: así el enlace para
 * cancelar que la persona ya tiene sigue valiendo, y la cita no se queda un
 * instante sin existir ni se duplica si algo falla a medias. Su hueco se mira
 * sin contarla a ella misma, y el índice único cierra la carrera igual que al
 * reservar.
 *
 * Devuelve { cita, recurso } o { error, status, ocupada?, lejos? }.
 */
export async function moverCita(neg, cita, { servicio, recursos, inicio, pedido }) {
  const hueco = await comprobarHueco(neg, { servicio, recursos, inicio, pedido, ignorar: cita.id });
  if (hueco.error) return hueco;
  const libre = hueco.libre;
  const fin = new Date(inicio.getTime() + servicio.minutos * 60000);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(cita.id)}&cancelled_at=is.null`, {
    method: 'PATCH', headers: sbHeaders(),
    body: JSON.stringify({
      due_at: inicio.toISOString(),
      end_at: fin.toISOString(),
      resource_id: libre.id,
      // Los recordatorios que ya salieron eran de la hora vieja. Sin vaciar esto,
      // mover una cita de mañana a la semana que viene dejaba sin el aviso de 24 h.
      recordatorios_enviados: [],
      gcal_event_id: null,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 409 || /23505|duplicate key/i.test(txt)) {
      return { error: 'Esa hora se acaba de ocupar. Elige otra, por favor.', ocupada: true, status: 409 };
    }
    await registrarError({ origen: 'reservas', donde: 'mover cita', error: new Error(txt.slice(0, 300)), detalle: 'Cita ' + cita.id });
    return { error: 'No se pudo cambiar la cita. Inténtalo otra vez.', status: 500 };
  }
  const movida = (await res.json())?.[0];
  // Si la fila ya estaba cancelada, el PATCH no toca nada y vuelve vacío.
  if (!movida) return { error: 'Esa cita ya no está activa.', status: 410 };

  // En Google: el evento viejo fuera (puede estar en el calendario de otra
  // persona si cambió quién atiende) y uno nuevo donde toca.
  const cerrar = (async () => {
    if (cita.gcal_event_id) {
      await gcalEnSuCalendario(cita.user_id, cita.resource_id, 'DELETE', '/' + cita.gcal_event_id, null, true).catch(() => {});
    }
    await sincronizarGcal(neg, movida, null);
  })().catch(e => registrarError({ origen: 'reservas', donde: 'mover cita en google', error: e, detalle: 'Cita ' + cita.id }));

  return { cita: movida, recurso: libre, cerrar };
}

export async function sincronizarGcal(neg, cita, correoCliente) {
  // En el calendario de quien atiende, si lo conectó. Si no —o si su conexión
  // falla—, en el de la cuenta, como siempre: la cita tiene que verse en
  // algún Google.
  let conn = null;
  if (cita.resource_id) {
    conn = await tokenDeRecurso(cita.resource_id).catch(async (e) => {
      await registrarError({ origen: 'reservas', donde: 'google calendar del recurso', error: e,
        detalle: 'Cita ' + cita.id + ': se escribe en el calendario de la cuenta.' });
      return null;
    });
  }
  if (!conn?.token) conn = await getGcalToken(neg.user_id).catch(() => null);
  if (!conn?.token) return;
  try {
    const cuerpo = gcalEventBody(cita, correoCliente || null, !!correoCliente, neg.zona_horaria);
    // La marca con la que, al leer lo ocupado, se reconoce que este evento es
    // una cita nuestra y no algo que la persona apuntó a mano.
    cuerpo.extendedProperties = { private: { acuarius_cita: String(cita.id) } };
    const ev = await gcalRequest(conn.token, 'POST', '', cuerpo, !!correoCliente);
    await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${cita.id}`, {
      method: 'PATCH', headers: sbHeaders('return=minimal'),
      body: JSON.stringify({ gcal_event_id: ev.id }),
    });
  } catch (e) {
    // Que no haya evento en Google NO invalida la cita: está en la agenda de
    // Acuarius. Se anota y se sigue.
    await registrarError({ origen: 'reservas', donde: 'google calendar', error: e, detalle: 'Cita ' + cita.id });
  }
}

// ── El correo de confirmación ───────────────────────────────────────────────
//
// Sale de app.acuarius.app porque es el único dominio verificado en Resend, con
// el nombre del negocio delante para que quien lo reciba sepa de quién es. El
// remitente propio del cliente es otra conversación —hace falta verificar SU
// dominio— y va apuntado.

export function fechaLarga(d, zona) {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: zona, weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d);
  } catch { return d.toISOString(); }
}

export async function avisarPorCorreo(neg, cita, servicio, recurso, quien, citaToken, zona) {
  if (!quien.correo || !process.env.RESEND_API_KEY) return;
  const negocio = neg.nombre_negocio || 'Tu cita';
  const cuando = fechaLarga(new Date(cita.due_at), zona);
  const enlace = 'https://app.acuarius.app/cita/' + citaToken;

  const html = emailHtml({
    titulo: 'Tu cita está confirmada',
    intro: negocio,
    preheader: cuando,
    cuerpo:
      bloque(
        '<b style="font-size:16px">' + esc(cuando) + '</b><br>' +
        esc(servicio.nombre) + ' · ' + servicio.minutos + ' min<br>' +
        'Te atiende ' + esc(recurso.nombre) +
        (neg.direccion ? '<br><br>' + esc(neg.direccion) +
          (neg.detalle_direccion ? '<br><span style="color:#5B6072">' + esc(neg.detalle_direccion) + '</span>' : '') : '')
      ) +
      (neg.mensaje_confirmacion ? '<p style="font-size:14px;line-height:1.6">' + esc(neg.mensaje_confirmacion) + '</p>' : '') +
      '<p style="font-size:14px;line-height:1.6;color:#5B6072">Si no puedes venir, cámbiala o cancélala desde el botón de abajo para dejarle el turno a alguien más.</p>',
    cta: { texto: 'Ver, cambiar o cancelar mi cita', url: enlace },
    pie: negocio,
  });

  const r = await enviarResend('booking-public', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: negocio.replace(/[<>"]/g, '').slice(0, 60) + ' <reservas@app.acuarius.app>',
      reply_to: RESPONDER_A,
      to: [quien.correo],
      subject: 'Tu cita: ' + cuando,
      html,
    }),
  });
  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (await r.text()).slice(0, 200));
}
