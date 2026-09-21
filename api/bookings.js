// api/bookings.js — la trastienda de las reservas.
//
// Aquí se configura lo que luego ve el público: qué se ofrece (servicios), quién
// lo presta (recursos) y cuándo se atiende (horario). La página pública no toca
// este endpoint: lee de `api/booking-public.js`, sin sesión.
//
// UNA RESERVA NO VIVE AQUÍ. Una reserva es una fila de `activities`, la misma
// tabla de la agenda: así aparece en la agenda, se sincroniza con Google
// Calendar y entra en el resumen diario sin escribir una línea para ello. Estas
// tablas solo guardan el catálogo y las reglas.
export const config = { runtime: 'edge' };

import { quienPregunta, alcanceDeCliente, clienteAjeno, normalizarPerfil, exigeModulo } from './_perfiles.js';
import { iconoValido, ICONO_POR_DEFECTO } from './_iconos-reserva.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const MAX_SERVICIOS = 40;
const MAX_RECURSOS = 40;

// Lunes a viernes de 9 a 13 y de 14 a 18. Es un punto de partida razonable para
// casi cualquier negocio de citas y, sobre todo, hace que la página pública
// funcione desde el primer minuto: un horario vacío significa cerrado siempre, y
// quien entrara vería una página que no deja reservar nada sin saber por qué.
const HORARIO_POR_DEFECTO = {
  1: [['09:00', '13:00'], ['14:00', '18:00']],
  2: [['09:00', '13:00'], ['14:00', '18:00']],
  3: [['09:00', '13:00'], ['14:00', '18:00']],
  4: [['09:00', '13:00'], ['14:00', '18:00']],
  5: [['09:00', '13:00'], ['14:00', '18:00']],
};
const RECORDATORIOS_POR_DEFECTO = [24, 2];   // horas antes

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: prefer || 'return=representation',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data)) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

/** 32 caracteres hex, el mismo formato que los tokens de formularios. */
function nuevoToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// ── Validación ──────────────────────────────────────────────────────────────
//
// Se valida AQUÍ y no solo en la pantalla porque un horario mal formado no
// revienta: `franjasLibres` se salta los tramos que no entiende y la página
// pública se queda sin horas, muda, sin que nadie sepa por qué. Es exactamente
// el fallo silencioso que hay que evitar.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function limpiarHorario(x) {
  if (!x || typeof x !== 'object') return null;
  const out = {};
  for (let d = 0; d <= 6; d++) {
    const tramos = x[d] ?? x[String(d)];
    if (!Array.isArray(tramos)) continue;
    const buenos = tramos
      .filter(t => Array.isArray(t) && HHMM.test(t[0]) && HHMM.test(t[1]) && t[1] > t[0])
      .map(t => [t[0], t[1]])
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 6);
    if (buenos.length) out[d] = buenos;
  }
  return Object.keys(out).length ? out : {};
}

export function limpiarExcepciones(x) {
  if (!x || typeof x !== 'object') return null;
  const out = {};
  for (const [dia, tramos] of Object.entries(x).slice(0, 200)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    // Una lista VACÍA es un festivo y tiene que sobrevivir: es lo que distingue
    // «ese día cerramos» de «ese día no tiene nada especial».
    if (!Array.isArray(tramos)) continue;
    out[dia] = tramos
      .filter(t => Array.isArray(t) && HHMM.test(t[0]) && HHMM.test(t[1]) && t[1] > t[0])
      .map(t => [t[0], t[1]]);
  }
  return out;
}

// ── La dirección pública ────────────────────────────────────────────────────
//
// `/reservar/barberia-aurora` en vez de 32 caracteres de hexadecimal. El token
// sigue existiendo y siguiendo funcionando: los enlaces ya repartidos no se
// pueden romper por un cambio de estética.
//
// Un slug adivinable NO es un problema: la página de reservas está hecha para
// repartirse. El token de cada CITA sí sigue siendo aleatorio, porque ese deja
// cancelar.
const RESERVADAS = new Set([
  'api', 'app', 'www', 'admin', 'acuarius', 'reservar', 'cita', 'citas', 'form',
  'formulario', 'login', 'logout', 'signup', 'p', 'l', 'privacy', 'terms',
  'academia', 'soporte', 'ayuda', 'null', 'undefined', 'nuevo', 'test',
]);

export function limpiarSlug(x) {
  return String(x || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // fuera tildes y eñes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function revisarSlug(x) {
  const s = limpiarSlug(x);
  if (!s) return { error: 'La dirección necesita al menos una letra o un número.' };
  if (s.length < 3) return { error: 'Muy corta: mínimo 3 caracteres.' };
  // Un slug de solo hexadecimal y 24+ chars se confundiría con un token.
  if (/^[a-f0-9]{24,}$/.test(s)) return { error: 'Esa dirección se parece demasiado a un identificador. Ponle palabras.' };
  if (RESERVADAS.has(s)) return { error: 'Esa dirección está reservada. Prueba con otra.' };
  return { slug: s };
}

function zonaValida(z) {
  try { new Intl.DateTimeFormat('en', { timeZone: String(z) }); return true; } catch { return false; }
}

const entero = (v, min, max, porDefecto) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : porDefecto;
};

// ── Lecturas ────────────────────────────────────────────────────────────────

// Dos filtros, porque las dos tablas guardan «sin cliente» de forma distinta:
// `booking_settings.client_id` es NOT NULL con '' por defecto (forma parte de su
// clave primaria), mientras que servicios y recursos lo dejan en NULL, como el
// resto del CRM. Y en PostgREST `eq.` NO casa con NULL: usar el filtro
// equivocado no da error, simplemente devuelve una lista vacía — el catálogo
// entero desaparecido sin un solo mensaje.
const filtroConfig = (cliente) => `client_id=eq.${encodeURIComponent(cliente || '')}`;
const filtroCliente = (cliente) => (cliente ? `client_id=eq.${encodeURIComponent(cliente)}` : 'client_id=is.null');

/**
 * La configuración del negocio, creándola con valores sensatos la primera vez.
 *
 * Se siembra al leer y no al guardar porque el token de la página pública tiene
 * que existir antes de que nadie pulse «guardar»: si no, la pantalla enseñaría
 * un enlace vacío y quien lo copiara se llevaría una URL rota.
 */
async function traerConfig(userId, cliente) {
  const url = `${SUPABASE_URL}/rest/v1/booking_settings?user_id=eq.${encodeURIComponent(userId)}&${filtroConfig(cliente)}&select=*&limit=1`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error('config: HTTP ' + res.status);
  const fila = (await res.json())?.[0];
  if (fila) return fila;

  const semilla = {
    user_id: userId,
    client_id: cliente || '',
    token: nuevoToken(),
    zona_horaria: 'America/Bogota',
    horario: HORARIO_POR_DEFECTO,
    excepciones: {},
    recordatorios: RECORDATORIOS_POR_DEFECTO,
    activo: false,          // nace apagado: nadie publica una página sin mirarla
  };
  // `on_conflict` obligatorio: sin él, dos pestañas abiertas a la vez dan 409 y
  // la segunda se queda sin configuración.
  const ins = await fetch(
    `${SUPABASE_URL}/rest/v1/booking_settings?on_conflict=user_id,client_id`,
    { method: 'POST', headers: sbHeaders('return=representation,resolution=merge-duplicates'), body: JSON.stringify(semilla) }
  );
  if (ins.ok) {
    const filas = await ins.json();
    if (Array.isArray(filas) && filas[0]) return filas[0];
  }
  // Si el insert se perdió la carrera, la fila ya existe: se relee.
  const otra = await fetch(url, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
  if (otra?.[0]) return otra[0];
  throw new Error('No se pudo preparar la configuración de reservas');
}

async function traerServicios(userId, cliente) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/booking_services?user_id=eq.${encodeURIComponent(userId)}&${filtroCliente(cliente)}` +
    `&select=*,booking_service_resources(resource_id)&order=orden.asc,created_at.asc`,
    { headers: sbHeaders() }
  );
  if (!res.ok) throw new Error('servicios: HTTP ' + res.status);
  const filas = await res.json();
  return (Array.isArray(filas) ? filas : []).map(s => {
    const { booking_service_resources, ...resto } = s;
    return { ...resto, recursos: (booking_service_resources || []).map(r => r.resource_id) };
  });
}

async function traerRecursos(userId, cliente) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/booking_resources?user_id=eq.${encodeURIComponent(userId)}&${filtroCliente(cliente)}` +
    `&select=*&order=orden.asc,created_at.asc`,
    { headers: sbHeaders() }
  );
  if (!res.ok) throw new Error('recursos: HTTP ' + res.status);
  const filas = await res.json();
  return Array.isArray(filas) ? filas : [];
}

/** ¿Esta fila es de esta cuenta y de este cliente? Se comprueba antes de tocarla. */
async function mia(tabla, id, userId, cliente) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${tabla}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&${filtroCliente(cliente)}&select=id&limit=1`,
    { headers: sbHeaders() }
  );
  if (!res.ok) return false;
  return !!(await res.json())?.[0];
}

/** Reescribe a qué recursos se asocia un servicio. */
async function guardarRecursosDe(serviceId, ids, userId, cliente) {
  await fetch(`${SUPABASE_URL}/rest/v1/booking_service_resources?service_id=eq.${encodeURIComponent(serviceId)}`,
    { method: 'DELETE', headers: sbHeaders('return=minimal') });
  const limpios = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))].slice(0, MAX_RECURSOS);
  if (!limpios.length) return [];
  // Solo se aceptan recursos de la MISMA cuenta y cliente: sin esta comprobación
  // bastaría con mandar un id ajeno para colgar un servicio del profesional de
  // otra cuenta y leer su agenda a través de las horas libres.
  const validos = [];
  for (const rid of limpios) if (await mia('booking_resources', rid, userId, cliente)) validos.push(rid);
  if (!validos.length) return [];
  await fetch(`${SUPABASE_URL}/rest/v1/booking_service_resources?on_conflict=service_id,resource_id`, {
    method: 'POST',
    headers: sbHeaders('return=minimal,resolution=ignore-duplicates'),
    body: JSON.stringify(validos.map(rid => ({ service_id: serviceId, resource_id: rid }))),
  });
  return validos;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const actor = await getUserId(req);
  if (!actor) return jsonResp({ error: 'No autorizado' }, 401);

  let quien;
  try { quien = await quienPregunta(actor); }
  catch { return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }

  const corte = exigeModulo(quien, 'crm');
  if (corte) return corte;

  const url = new URL(req.url);
  const pedido = url.searchParams.get('client_id') || null;
  if (clienteAjeno(quien, pedido)) {
    return jsonResp({ error: 'No tienes acceso a ese cliente.' }, 403);
  }
  const userId = quien.userId;
  const cliente = alcanceDeCliente(quien, pedido);

  // Ver la configuración es de todo el equipo —un comercial necesita saber el
  // horario—, pero cambiarla no: quien toca precios, horarios o el enlace
  // público le cambia la cara del negocio a toda la cuenta. Mismo criterio que
  // los catálogos de fuentes y motivos.
  const esAdmin = quien.esDueno || normalizarPerfil(quien.perfil) === 'admin';
  if (!esAdmin && req.method !== 'GET') {
    return jsonResp({ error: 'Solo el administrador de la cuenta puede configurar las reservas.' }, 403);
  }

  try {
    // ── GET — todo lo que la pantalla necesita, de una vez ──────────────────
    if (req.method === 'GET') {
      const [config, servicios, recursos] = await Promise.all([
        traerConfig(userId, cliente),
        traerServicios(userId, cliente),
        traerRecursos(userId, cliente),
      ]);
      return jsonResp({ config, servicios, recursos, puede_configurar: esAdmin });
    }

    let body = {};
    if (req.method !== 'DELETE') {
      try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    }
    const que = String(url.searchParams.get('que') || body.que || '').toLowerCase();

    // ── PUT de la configuración ─────────────────────────────────────────────
    if (req.method === 'PUT' && que === 'config') {
      await traerConfig(userId, cliente);          // asegura que la fila existe
      const cambios = { updated_at: new Date().toISOString() };

      if ('nombre_negocio' in body) cambios.nombre_negocio = String(body.nombre_negocio || '').trim().slice(0, 120) || null;
      if ('direccion' in body) cambios.direccion = String(body.direccion || '').trim().slice(0, 200) || null;
      if ('detalle_direccion' in body) cambios.detalle_direccion = String(body.detalle_direccion || '').trim().slice(0, 200) || null;
      if ('mensaje_confirmacion' in body) cambios.mensaje_confirmacion = String(body.mensaje_confirmacion || '').trim().slice(0, 500) || null;
      // El título manda sobre el nombre del negocio en la página pública: un
      // estudio puede querer «Reservar espacio» y no su razón social.
      if ('titulo' in body) cambios.titulo = String(body.titulo || '').trim().slice(0, 80) || null;
      if ('pregunta' in body) cambios.pregunta = String(body.pregunta || '').trim().slice(0, 80) || null;
      if ('logo_url' in body) {
        const u = String(body.logo_url || '').trim();
        // Solo del almacenamiento propio: una URL cualquiera dejaría poner la
        // imagen de otro sitio en una página que lleva nuestra marca.
        if (u && !u.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`)) {
          return jsonResp({ error: 'Esa imagen no viene de aquí. Súbela desde el botón.' }, 400);
        }
        cambios.logo_url = u || null;
      }
      if ('slug' in body) {
        const pedido = String(body.slug || '').trim();
        if (!pedido) cambios.slug = null;
        else {
          const r = revisarSlug(pedido);
          if (r.error) return jsonResp({ error: r.error }, 400);
          // Único en toda la plataforma: es una URL. El índice de la base lo
          // garantiza; esto solo sirve para dar un mensaje entendible en vez
          // de un 409 en crudo.
          const ocupada = await fetch(
            `${SUPABASE_URL}/rest/v1/booking_settings?slug=eq.${encodeURIComponent(r.slug)}&select=user_id,client_id&limit=1`,
            { headers: sbHeaders() }
          ).then(x => (x.ok ? x.json() : [])).catch(() => []);
          const suya = ocupada?.[0] &&
            ocupada[0].user_id === userId && (ocupada[0].client_id || '') === (cliente || '');
          if (ocupada?.[0] && !suya) {
            return jsonResp({ error: 'Esa dirección ya la está usando otro negocio. Prueba con otra.' }, 409);
          }
          cambios.slug = r.slug;
        }
      }
      if ('acento' in body) {
        const c = String(body.acento || '').trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(c)) return jsonResp({ error: 'El color debe ir en formato #RRGGBB' }, 400);
        cambios.acento = c.toUpperCase();
      }
      if ('zona_horaria' in body) {
        if (!zonaValida(body.zona_horaria)) return jsonResp({ error: 'Esa zona horaria no existe' }, 400);
        cambios.zona_horaria = String(body.zona_horaria);
      }
      if ('horario' in body) {
        const h = limpiarHorario(body.horario);
        if (h === null) return jsonResp({ error: 'El horario no tiene el formato esperado' }, 400);
        cambios.horario = h;
      }
      if ('excepciones' in body) {
        const e = limpiarExcepciones(body.excepciones);
        if (e === null) return jsonResp({ error: 'Los días especiales no tienen el formato esperado' }, 400);
        cambios.excepciones = e;
      }
      if ('margen_min' in body) cambios.margen_min = entero(body.margen_min, 0, 240, 0);
      if ('antelacion_min_horas' in body) cambios.antelacion_min_horas = entero(body.antelacion_min_horas, 0, 720, 2);
      if ('antelacion_max_dias' in body) cambios.antelacion_max_dias = entero(body.antelacion_max_dias, 1, 365, 60);
      if ('paso_min' in body) cambios.paso_min = entero(body.paso_min, 5, 120, 15);
      if ('activo' in body) cambios.activo = !!body.activo;
      if ('pipeline_id' in body) cambios.pipeline_id = body.pipeline_id || null;
      if ('lead_source' in body) cambios.lead_source = String(body.lead_source || '').trim().slice(0, 60) || null;
      // El token solo se regenera si lo piden a propósito: cambiarlo tira abajo
      // todos los enlaces publicados del negocio.
      if (body.regenerar_token === true) cambios.token = nuevoToken();

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/booking_settings?user_id=eq.${encodeURIComponent(userId)}&${filtroConfig(cliente)}`,
        { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(cambios) }
      );
      if (!res.ok) return jsonResp({ error: await res.text() }, 500);
      const filas = await res.json();
      return jsonResp({ config: filas[0] });
    }

    // ── Servicios ───────────────────────────────────────────────────────────
    if (que === 'servicio') {
      if (req.method === 'POST' || req.method === 'PUT') {
        const nombre = String(body.nombre || '').trim().slice(0, 80);
        if (req.method === 'POST' && !nombre) return jsonResp({ error: 'El servicio necesita un nombre' }, 400);

        const campos = {};
        if (nombre) campos.nombre = nombre;
        if ('descripcion' in body) campos.descripcion = String(body.descripcion || '').trim().slice(0, 300) || null;
        if ('minutos' in body) campos.minutos = entero(body.minutos, 5, 8 * 60, 30);
        if ('precio' in body) {
          const p = body.precio === '' || body.precio == null ? null : Number(body.precio);
          if (p !== null && (!Number.isFinite(p) || p < 0)) return jsonResp({ error: 'El precio no es un número' }, 400);
          campos.precio = p;
        }
        if ('color' in body && /^#[0-9a-fA-F]{6}$/.test(String(body.color))) campos.color = String(body.color).toUpperCase();
        // Una clave inventada se cae al icono por defecto en vez de dejar el
        // servicio sin dibujo.
        if ('icono' in body) campos.icono = iconoValido(body.icono) ? String(body.icono) : ICONO_POR_DEFECTO;
        if ('activo' in body) campos.activo = !!body.activo;
        if ('orden' in body) campos.orden = entero(body.orden, 0, 999, 0);

        if (req.method === 'POST') {
          const ya = await traerServicios(userId, cliente);
          if (ya.length >= MAX_SERVICIOS) return jsonResp({ error: `Máximo ${MAX_SERVICIOS} servicios` }, 400);
          campos.user_id = userId;
          campos.client_id = cliente || null;
          if (campos.orden == null) campos.orden = ya.length;
          const res = await fetch(`${SUPABASE_URL}/rest/v1/booking_services`, {
            method: 'POST', headers: sbHeaders(), body: JSON.stringify(campos),
          });
          if (!res.ok) return jsonResp({ error: await res.text() }, 500);
          const fila = (await res.json())[0];
          const recursos = await guardarRecursosDe(fila.id, body.recursos, userId, cliente);
          return jsonResp({ servicio: { ...fila, recursos } });
        }

        if (!body.id) return jsonResp({ error: 'Falta id' }, 400);
        if (!await mia('booking_services', body.id, userId, cliente)) return jsonResp({ error: 'Servicio no encontrado' }, 404);
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/booking_services?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${encodeURIComponent(userId)}`,
          { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(campos) }
        );
        if (!res.ok) return jsonResp({ error: await res.text() }, 500);
        const fila = (await res.json())[0];
        const recursos = 'recursos' in body
          ? await guardarRecursosDe(body.id, body.recursos, userId, cliente)
          : undefined;
        return jsonResp({ servicio: recursos ? { ...fila, recursos } : fila });
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) return jsonResp({ error: 'Falta id' }, 400);
        if (!await mia('booking_services', id, userId, cliente)) return jsonResp({ error: 'Servicio no encontrado' }, 404);
        // Las citas ya reservadas NO se tocan: viven en `activities` con su
        // propio título y su hora. Borrar el servicio quita la opción de la
        // página pública, no la cita de nadie.
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/booking_services?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
          { method: 'DELETE', headers: sbHeaders('return=minimal') }
        );
        if (!res.ok) return jsonResp({ error: await res.text() }, 500);
        return jsonResp({ ok: true });
      }
    }

    // ── Recursos (quién presta el servicio) ─────────────────────────────────
    if (que === 'recurso') {
      if (req.method === 'POST' || req.method === 'PUT') {
        const nombre = String(body.nombre || '').trim().slice(0, 80);
        if (req.method === 'POST' && !nombre) return jsonResp({ error: 'Necesita un nombre' }, 400);

        const campos = {};
        if (nombre) campos.nombre = nombre;
        if ('activo' in body) campos.activo = !!body.activo;
        if ('orden' in body) campos.orden = entero(body.orden, 0, 999, 0);
        if ('horario' in body) {
          // null = sigue el horario del negocio. {} = no atiende nunca, que es
          // distinto y hay que poder decirlo.
          if (body.horario === null) campos.horario = null;
          else {
            const h = limpiarHorario(body.horario);
            if (h === null) return jsonResp({ error: 'El horario no tiene el formato esperado' }, 400);
            campos.horario = h;
          }
        }
        if ('member_user_id' in body) {
          const mid = String(body.member_user_id || '').trim();
          if (!mid) campos.member_user_id = null;
          else {
            // Solo alguien del equipo de ESTA cuenta. Si no, se podría enganchar
            // la agenda de un usuario cualquiera y leer sus huecos ocupados.
            const ok = mid === userId || await fetch(
              `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(userId)}` +
              `&member_user_id=eq.${encodeURIComponent(mid)}&status=eq.active&select=member_user_id&limit=1`,
              { headers: sbHeaders() }
            ).then(r => r.ok ? r.json() : []).then(f => !!f?.[0]).catch(() => false);
            if (!ok) return jsonResp({ error: 'Esa persona no está en tu equipo.' }, 400);
            campos.member_user_id = mid;
          }
        }

        if (req.method === 'POST') {
          const ya = await traerRecursos(userId, cliente);
          if (ya.length >= MAX_RECURSOS) return jsonResp({ error: `Máximo ${MAX_RECURSOS}` }, 400);
          campos.user_id = userId;
          campos.client_id = cliente || null;
          if (campos.orden == null) campos.orden = ya.length;
          const res = await fetch(`${SUPABASE_URL}/rest/v1/booking_resources`, {
            method: 'POST', headers: sbHeaders(), body: JSON.stringify(campos),
          });
          if (!res.ok) return jsonResp({ error: await res.text() }, 500);
          return jsonResp({ recurso: (await res.json())[0] });
        }

        if (!body.id) return jsonResp({ error: 'Falta id' }, 400);
        if (!await mia('booking_resources', body.id, userId, cliente)) return jsonResp({ error: 'No encontrado' }, 404);
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/booking_resources?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${encodeURIComponent(userId)}`,
          { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(campos) }
        );
        if (!res.ok) return jsonResp({ error: await res.text() }, 500);
        return jsonResp({ recurso: (await res.json())[0] });
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) return jsonResp({ error: 'Falta id' }, 400);
        if (!await mia('booking_resources', id, userId, cliente)) return jsonResp({ error: 'No encontrado' }, 404);
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/booking_resources?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
          { method: 'DELETE', headers: sbHeaders('return=minimal') }
        );
        if (!res.ok) return jsonResp({ error: await res.text() }, 500);
        return jsonResp({ ok: true });
      }
    }

    return jsonResp({ error: 'Método no permitido' }, 405);
  } catch (e) {
    return jsonResp({ error: String(e?.message || e) }, 500);
  }
}
