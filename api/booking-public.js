// api/booking-public.js — la cara pública de las reservas. SIN sesión.
//
// Lo que ve y hace quien quiere una cita:
//   GET  ?token=            el negocio, sus servicios y quién atiende
//   GET  ?token=&dias=14    qué días de la tira tienen hueco (el puntito)
//   GET  ?token=&dia=…      las horas libres de un día
//   POST ?token=            reservar
//   GET  ?cita=<token>      ver la reserva (para cancelar o cambiarla)
//   POST ?cita=<token>      cancelar o reprogramar
//
// UNA RESERVA ES UNA `activity`, la misma tabla de la agenda: por eso al
// guardarla aparece en la agenda del negocio y se sincroniza con Google
// Calendar sin nada más.
//
// La protección de verdad contra citar a dos personas a la misma hora NO es la
// comprobación de aquí, que siempre tiene una rendija entre mirar y escribir:
// es el índice único `activities_reserva_sin_choque` sobre (resource_id,
// due_at) donde la cita no está cancelada. La base rechaza la segunda y aquí se
// traduce a «esa hora se acaba de ocupar».
export const config = { runtime: 'edge' };

import { franjasLibres, sigueLibre, diasConCupo, diaLocal } from './_disponibilidad.js';
import { intakeLead } from './_lead-intake.js';
import { getGcalToken, gcalEventBody, gcalRequest } from './_gcal.js';
import { emailHtml, bloque, RESPONDER_A, esc } from './_email-layout.js';
import { registrarError } from './_registro-errores.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const DIAS_TIRA = 14;

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: prefer || 'return=representation',
  };
}
const jsonResp = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const esToken = (t) => /^[a-f0-9]{24,64}$/i.test(String(t || ''));

function nuevoToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

const sb = (path) => fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: sbHeaders() })
  .then(r => r.ok ? r.json() : Promise.reject(new Error('Supabase ' + r.status)));

// ── Datos del negocio ───────────────────────────────────────────────────────

async function cargarNegocio(token) {
  const filas = await sb(`/booking_settings?token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
  return filas?.[0] || null;
}

const filtroCliente = (c) => (c ? `client_id=eq.${encodeURIComponent(c)}` : 'client_id=is.null');

async function cargarCatalogo(neg) {
  // `booking_settings.client_id` guarda '' para «de la cuenta»; servicios y
  // recursos guardan NULL. Traducir aquí y no más adelante: `eq.` no casa con
  // NULL y el catálogo saldría vacío sin un solo error.
  const cliente = neg.client_id || null;
  const [servicios, recursos] = await Promise.all([
    sb(`/booking_services?user_id=eq.${encodeURIComponent(neg.user_id)}&${filtroCliente(cliente)}` +
       `&activo=is.true&select=id,nombre,descripcion,minutos,precio,color,orden,booking_service_resources(resource_id)` +
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
async function ocupadoDe(neg, ids, desdeISO, hastaISO) {
  const porRecurso = {};
  ids.forEach(id => { porRecurso[id] = []; });
  if (!ids.length) return porRecurso;
  const filas = await sb(
    `/activities?user_id=eq.${encodeURIComponent(neg.user_id)}` +
    `&resource_id=in.(${ids.map(encodeURIComponent).join(',')})` +
    `&cancelled_at=is.null&due_at=gte.${encodeURIComponent(desdeISO)}&due_at=lt.${encodeURIComponent(hastaISO)}` +
    `&select=due_at,end_at,resource_id&limit=1000`
  ).catch(() => []);
  for (const f of filas || []) {
    const ini = new Date(f.due_at).getTime();
    const fin = f.end_at ? new Date(f.end_at).getTime() : ini + 3600000;
    if (porRecurso[f.resource_id]) porRecurso[f.resource_id].push({ ini, fin });
  }
  return porRecurso;
}

/** Las reglas con las que se calculan los huecos de un recurso concreto. */
function reglasDe(neg, recurso, servicio, ocupado, ahora) {
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
function elegibles(servicio, recursos, pedido) {
  const puede = recursos.filter(r => servicio.recursos.includes(r.id));
  if (!pedido) return puede;
  return puede.filter(r => r.id === pedido);
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, contexto) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const citaTok = url.searchParams.get('cita');
  if (citaTok) return manejarCita(req, url, citaTok);

  const token = url.searchParams.get('token');
  if (!esToken(token)) return jsonResp({ error: 'Página de reservas no encontrada' }, 404);

  const neg = await cargarNegocio(token).catch(() => null);
  if (!neg) return jsonResp({ error: 'Página de reservas no encontrada' }, 404);
  // Apagada no es «no existe»: quien tenga el enlace merece saber que el
  // negocio dejó de tomar citas por aquí, no un 404 que parece un error suyo.
  if (!neg.activo) return jsonResp({ error: 'Este negocio no está tomando reservas en línea ahora mismo.', apagada: true }, 410);

  if (req.method === 'GET') return manejarGet(url, neg);
  if (req.method === 'POST') return reservar(req, url, neg, contexto);
  return jsonResp({ error: 'Método no permitido' }, 405);
}

async function manejarGet(url, neg) {
  const { servicios, recursos } = await cargarCatalogo(neg);
  const zona = neg.zona_horaria || 'America/Bogota';
  const ahora = new Date();

  const negocio = {
    nombre: neg.nombre_negocio || 'Reservar una cita',
    direccion: neg.direccion || null,
    detalle_direccion: neg.detalle_direccion || null,
    acento: neg.acento || '#1E2BCC',
    zona,
    mensaje_confirmacion: neg.mensaje_confirmacion || null,
    // La página solo promete el recordatorio si el negocio lo tiene puesto.
    // Anunciarlo siempre sería mentirle al cliente del negocio, que es quien
    // menos culpa tiene de cómo esté configurado esto.
    recordatorio: (Array.isArray(neg.recordatorios) ? neg.recordatorios : [24, 2]).length > 0,
  };

  const servId = url.searchParams.get('service_id');
  const recId = url.searchParams.get('resource_id') || null;
  const dia = url.searchParams.get('dia');
  const quiereDias = url.searchParams.get('dias') !== null;

  // Sin servicio no hay nada que calcular: es la primera pantalla.
  if (!servId) return jsonResp({ negocio, servicios, recursos });

  const servicio = servicios.find(s => s.id === servId);
  if (!servicio) return jsonResp({ error: 'Ese servicio ya no está disponible' }, 404);
  const puede = elegibles(servicio, recursos, recId);
  if (!puede.length) return jsonResp({ error: 'Nadie presta ese servicio ahora mismo' }, 404);

  // El techo de la ventana: ni un día más de lo que el negocio permite.
  const tope = new Date(ahora.getTime() + ((neg.antelacion_max_dias | 0) || 60) * 86400000);

  if (quiereDias) {
    const desde = url.searchParams.get('desde') || diaLocal(zona, ahora);
    const hasta = new Date(ahora.getTime() + (DIAS_TIRA + 2) * 86400000).toISOString();
    const ocupado = await ocupadoDe(neg, puede.map(r => r.id), ahora.toISOString(), hasta);

    // Un día tiene cupo si le queda hueco a CUALQUIERA de los que pueden
    // atenderlo, no a todos.
    const porRecurso = puede.map(r =>
      diasConCupo({ ...reglasDe(neg, r, servicio, ocupado[r.id], ahora), desde, dias: DIAS_TIRA }));
    const dias = (porRecurso[0] || []).map((d, i) => ({
      dia: d.dia,
      cerrado: porRecurso.every(p => p[i] && p[i].cerrado),
      cupo: porRecurso.some(p => p[i] && p[i].cupo) && new Date(d.dia) <= tope,
    }));
    return jsonResp({ negocio, dias });
  }

  if (dia) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return jsonResp({ error: 'Fecha inválida' }, 400);
    const desdeISO = new Date(new Date(dia + 'T00:00:00Z').getTime() - 86400000).toISOString();
    const hastaISO = new Date(new Date(dia + 'T00:00:00Z').getTime() + 2 * 86400000).toISOString();
    const ocupado = await ocupadoDe(neg, puede.map(r => r.id), desdeISO, hastaISO);

    // Se junta lo de todos los que pueden atender y se queda UNA entrada por
    // hora: al cliente le da igual con quién, y ver la misma hora tres veces
    // porque hay tres barberos libres es ruido.
    const porHora = new Map();
    for (const r of puede) {
      for (const f of franjasLibres({ ...reglasDe(neg, r, servicio, ocupado[r.id], new Date()), dia })) {
        if (new Date(f.inicio) > tope) continue;
        if (!porHora.has(f.inicio)) porHora.set(f.inicio, { ...f, recursos: [] });
        porHora.get(f.inicio).recursos.push(r.id);
      }
    }
    const horas = [...porHora.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
    return jsonResp({ negocio, horas });
  }

  return jsonResp({ negocio, servicios, recursos });
}

// ── Reservar ────────────────────────────────────────────────────────────────

async function reservar(req, url, neg, contexto) {
  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: 'Datos inválidos' }, 400); }

  // Honeypot: los bots llenan el campo oculto. Se responde ok sin crear nada,
  // igual que en los formularios: decirles que fallaron es enseñarles a
  // reintentar.
  if (body._hp) return jsonResp({ ok: true, cita: null });

  const nombre = String(body.nombre || '').trim().slice(0, 120);
  const telefono = String(body.telefono || '').trim().slice(0, 40);
  const correo = String(body.correo || '').trim().slice(0, 160);
  if (!nombre) return jsonResp({ error: 'Falta tu nombre' }, 400);
  if (!telefono && !correo) return jsonResp({ error: 'Déjanos un teléfono o un correo para confirmarte' }, 400);

  const { servicios, recursos } = await cargarCatalogo(neg);
  const servicio = servicios.find(s => s.id === body.service_id);
  if (!servicio) return jsonResp({ error: 'Ese servicio ya no está disponible' }, 410);

  const inicio = new Date(String(body.inicio || ''));
  if (isNaN(inicio.getTime())) return jsonResp({ error: 'Esa hora no es válida' }, 400);

  const zona = neg.zona_horaria || 'America/Bogota';
  const puede = elegibles(servicio, recursos, body.resource_id || null);
  if (!puede.length) return jsonResp({ error: 'Nadie presta ese servicio ahora mismo' }, 410);

  const desdeISO = new Date(inicio.getTime() - 86400000).toISOString();
  const hastaISO = new Date(inicio.getTime() + 2 * 86400000).toISOString();
  const ocupado = await ocupadoDe(neg, puede.map(r => r.id), desdeISO, hastaISO);

  // Se vuelve a comprobar AHORA, no cuando el cliente vio las horas. Entre una
  // cosa y otra pasan minutos y en ese rato otra persona puede haber cogido la
  // misma hora.
  const libre = puede.find(r => sigueLibre(inicio.toISOString(), reglasDe(neg, r, servicio, ocupado[r.id], new Date())));
  if (!libre) {
    return jsonResp({ error: 'Esa hora se acaba de ocupar. Elige otra, por favor.', ocupada: true }, 409);
  }

  const fin = new Date(inicio.getTime() + servicio.minutos * 60000);
  const cliente = neg.client_id || null;
  const citaToken = nuevoToken();
  const cuando = fechaLarga(inicio, zona);

  // ── El contacto ──────────────────────────────────────────────────────────
  // Quien reserva es un lead: entra al tablero con su origen y su etiqueta, y
  // si ya existía se le suma la cita a su ficha en vez de duplicarlo.
  let lead = null;
  try {
    const r = await intakeLead(neg.user_id, cliente, {
      name: nombre, email: correo || null, phone: telefono || null,
      note: '\n' + servicio.nombre + ' · ' + cuando + '\nCon: ' + libre.nombre +
            (body.nota ? '\nNota: ' + String(body.nota).trim().slice(0, 400) : ''),
      source: neg.lead_source || 'reserva',
      sourceLabel: 'Reserva en línea',
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
    await registrarError({ origen: 'booking-public', donde: 'intakeLead', error: e, detalle: 'Negocio: ' + neg.user_id });
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
      body.nota ? 'Nota: ' + String(body.nota).trim().slice(0, 400) : null,
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
      return jsonResp({ error: 'Esa hora se acaba de ocupar. Elige otra, por favor.', ocupada: true }, 409);
    }
    await registrarError({ origen: 'booking-public', donde: 'crear cita', error: new Error(txt.slice(0, 300)), detalle: 'Negocio: ' + neg.user_id });
    return jsonResp({ error: 'No se pudo guardar la reserva. Inténtalo otra vez.' }, 500);
  }
  const cita = (await res.json())[0];

  const cerrar = (async () => {
    await sincronizarGcal(neg, cita, correo);
    await avisarPorCorreo(neg, cita, servicio, libre, { nombre, correo, telefono }, citaToken, zona);
  })().catch(e => registrarError({
    origen: 'booking-public', donde: 'avisos', error: e,
    detalle: 'La cita ' + cita.id + ' se guardó bien; falló lo de después.',
  }));

  // Los avisos no hacen esperar al cliente: ya tiene su cita.
  if (contexto && typeof contexto.waitUntil === 'function') contexto.waitUntil(cerrar);
  else await cerrar;

  return jsonResp({
    ok: true,
    cita: {
      token: citaToken,
      inicio: cita.due_at, fin: cita.end_at,
      servicio: servicio.nombre, minutos: servicio.minutos,
      con: libre.nombre,
      nombre,
    },
  });
}

async function sincronizarGcal(neg, cita, correoCliente) {
  const conn = await getGcalToken(neg.user_id).catch(() => null);
  if (!conn?.token) return;
  try {
    const ev = await gcalRequest(conn.token, 'POST', '',
      gcalEventBody(cita, correoCliente || null, !!correoCliente, neg.zona_horaria), !!correoCliente);
    await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${cita.id}`, {
      method: 'PATCH', headers: sbHeaders('return=minimal'),
      body: JSON.stringify({ gcal_event_id: ev.id }),
    });
  } catch (e) {
    // Que no haya evento en Google NO invalida la cita: está en la agenda de
    // Acuarius. Se anota y se sigue.
    await registrarError({ origen: 'booking-public', donde: 'google calendar', error: e, detalle: 'Cita ' + cita.id });
  }
}

// ── El correo de confirmación ───────────────────────────────────────────────
//
// Sale de app.acuarius.app porque es el único dominio verificado en Resend, con
// el nombre del negocio delante para que quien lo reciba sepa de quién es. El
// remitente propio del cliente es otra conversación —hace falta verificar SU
// dominio— y va apuntado.

function fechaLarga(d, zona) {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: zona, weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d);
  } catch { return d.toISOString(); }
}

async function avisarPorCorreo(neg, cita, servicio, recurso, quien, citaToken, zona) {
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
      '<p style="font-size:14px;line-height:1.6;color:#5B6072">Si no puedes venir, cancela desde el botón de abajo para dejarle el turno a alguien más.</p>',
    cta: { texto: 'Ver o cancelar mi cita', url: enlace },
    pie: negocio,
  });

  const r = await fetch('https://api.resend.com/emails', {
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

// ── Ver, cancelar y reprogramar ─────────────────────────────────────────────

async function manejarCita(req, url, citaTok) {
  if (!esToken(citaTok)) return jsonResp({ error: 'Cita no encontrada' }, 404);
  const filas = await sb(
    `/activities?booking_token=eq.${encodeURIComponent(citaTok)}` +
    `&select=id,user_id,client_id,title,due_at,end_at,cancelled_at,booking_status,service_id,resource_id,gcal_event_id&limit=1`
  ).catch(() => []);
  const cita = filas?.[0];
  if (!cita) return jsonResp({ error: 'Cita no encontrada' }, 404);

  const negs = await sb(`/booking_settings?user_id=eq.${encodeURIComponent(cita.user_id)}&select=*&limit=1`).catch(() => []);
  const neg = negs?.[0] || {};
  const zona = neg.zona_horaria || 'America/Bogota';

  const vista = {
    inicio: cita.due_at, fin: cita.end_at,
    titulo: cita.title,
    estado: cita.cancelled_at ? 'cancelada' : (cita.booking_status || 'confirmada'),
    negocio: neg.nombre_negocio || null,
    direccion: neg.direccion || null,
    detalle_direccion: neg.detalle_direccion || null,
    acento: neg.acento || '#1E2BCC',
    zona,
    // Se dice si todavía se puede cancelar y por qué no, en vez de enseñar un
    // botón que devuelve un error.
    pasada: new Date(cita.due_at) < new Date(),
  };

  if (req.method === 'GET') return jsonResp({ cita: vista });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  let body = {};
  try { body = await req.json(); } catch {}
  if (String(body.accion) !== 'cancelar') return jsonResp({ error: 'Acción no reconocida' }, 400);
  if (cita.cancelled_at) return jsonResp({ ok: true, cita: { ...vista, estado: 'cancelada' } });
  if (vista.pasada) return jsonResp({ error: 'Esa cita ya pasó.' }, 400);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${cita.id}`, {
    method: 'PATCH', headers: sbHeaders('return=minimal'),
    // Cancelar deja el hueco libre otra vez: el índice único solo cuenta las
    // citas con `cancelled_at` nulo.
    body: JSON.stringify({ cancelled_at: new Date().toISOString(), booking_status: 'cancelada' }),
  });
  if (!res.ok) return jsonResp({ error: 'No se pudo cancelar. Inténtalo otra vez.' }, 500);

  if (cita.gcal_event_id) {
    const conn = await getGcalToken(cita.user_id).catch(() => null);
    if (conn?.token) {
      try { await gcalRequest(conn.token, 'DELETE', '/' + cita.gcal_event_id, null, true); } catch {}
    }
  }
  return jsonResp({ ok: true, cita: { ...vista, estado: 'cancelada' } });
}
