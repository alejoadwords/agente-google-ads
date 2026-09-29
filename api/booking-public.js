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

import { franjasLibres, diasConCupo, diaLocal } from './_disponibilidad.js';
// Lo que decide si hay hueco y cómo se guarda una cita vive en _reservas.js:
// el agente del chat reserva por el mismo camino.
import { cargarCatalogo, ocupadoDe, reglasDe, elegibles, guardarCita, cancelarCita } from './_reservas.js';

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
// La dirección pública: o el token de siempre, o un slug de 3 a 40 caracteres.
const esDireccion = (t) => esToken(t) || /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/i.test(String(t || ''));

const sb = (path) => fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: sbHeaders() })
  .then(r => r.ok ? r.json() : Promise.reject(new Error('Supabase ' + r.status)));

// ── Datos del negocio ───────────────────────────────────────────────────────

/**
 * El negocio, por su dirección amigable o por su token.
 *
 * Los dos siguen valiendo a propósito: cuando alguien se pone una dirección
 * bonita, los enlaces que ya repartió con el token no pueden dejar de
 * funcionar. Un cliente con la cita apuntada en el móvil no se entera de que
 * cambiamos de estética.
 */
async function cargarNegocio(id) {
  const v = String(id || '');
  // Un token es hexadecimal y largo; cualquier otra cosa se busca como slug.
  const campo = /^[a-f0-9]{24,64}$/i.test(v) ? 'token' : 'slug';
  const filas = await sb(`/booking_settings?${campo}=eq.${encodeURIComponent(v.toLowerCase())}&select=*&limit=1`);
  return filas?.[0] || null;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, contexto) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const citaTok = url.searchParams.get('cita');
  if (citaTok) return manejarCita(req, url, citaTok);

  const token = url.searchParams.get('token');
  if (!esDireccion(token)) return jsonResp({ error: 'Página de reservas no encontrada' }, 404);

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
    // El título manda sobre el nombre del negocio: hay quien quiere «Reservar
    // espacio» y no su razón social.
    nombre: neg.titulo || neg.nombre_negocio || 'Reservar una cita',
    // Las iniciales salen del NOMBRE DEL NEGOCIO, no del título. Si no, un
    // título como «Reservar espacio» daba un círculo con «RE», que no
    // identifica a nadie.
    marca: neg.nombre_negocio || neg.titulo || '',
    logo: neg.logo_url || null,
    pregunta: neg.pregunta || null,
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
  //
  // Se guarda como DÍA LOCAL del negocio, no como instante. Antes se comparaba
  // `new Date(d.dia) <= tope`, y `d.dia` es un día suelto («2026-11-23»): eso
  // lo interpreta como medianoche UTC, cinco horas antes de que empiece de
  // verdad en Colombia. El resultado era que, según la hora a la que alguien
  // abriera la página, se ofrecía un día MÁS del máximo configurado. Comparar
  // dos cadenas de día no depende de la hora ni de la zona de quien mira.
  const tope = new Date(ahora.getTime() + ((neg.antelacion_max_dias | 0) || 60) * 86400000);
  const topeDia = diaLocal(zona, tope);

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
      cupo: porRecurso.some(p => p[i] && p[i].cupo) && d.dia <= topeDia,
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

  const nota = body.nota ? String(body.nota).trim().slice(0, 400) : null;
  const r = await guardarCita(neg, {
    servicio, recursos, inicio,
    pedido: body.resource_id || null,
    contacto: { nombre, telefono, correo, nota },
  });
  if (r.error) return jsonResp({ error: r.error, ...(r.ocupada ? { ocupada: true } : {}) }, r.status || 500);
  const { cita, recurso: libre, citaToken, cerrar } = r;

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

  // El mismo cancelar que usa el agente del chat.
  const r = await cancelarCita(cita);
  if (r.error) return jsonResp({ error: r.error }, 500);
  return jsonResp({ ok: true, cita: { ...vista, estado: 'cancelada' } });
}
