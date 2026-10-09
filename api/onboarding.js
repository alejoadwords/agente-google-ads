// api/onboarding.js — el alta guiada de una cuenta nueva
//
//   GET                           dónde va el alta y si le toca hacerla
//   POST {paso, ...datos}         guarda un paso (empresa, moneda, telefono)
//   POST {accion:'completar', objetivo}   cierra el alta y deja la bienvenida
//
// La bienvenida no es un correo ni un modal que se cierra y se pierde: es el
// primer mensaje del chat de soporte, escrito por el equipo. El cliente
// contesta AHÍ y la conversación sigue en el mismo hilo donde luego pedirá
// ayuda. Además se abre un caso con su objetivo, su empresa y su teléfono:
// «¿qué quieres lograr?» no sirve de nada si nadie del equipo lo lee.
//
// Una sesión de soporte (un admin dentro de la cuenta) no escribe aquí: el
// alta es del cliente, y completarla por él le quitaría su bienvenida.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { soporteDe } from './_soporte-sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLERK = 'https://api.clerk.com/v1';

// Desde cuándo se exige el alta. Las cuentas anteriores ya están trabajando:
// mandarlas de golpe a un asistente de bienvenida sería un estorbo, no un regalo.
const DESDE = Date.parse('2026-09-30T00:00:00Z');

// «Tu prueba Pro de 14 días — qué incluye y cómo aprovecharla», de la Academia
// (versión de octubre de 2026, con la navegación y los cupos de hoy).
// Es el video que responde lo que se pregunta quien acaba de entrar.
const VIDEO_POR_DEFECTO = 'https://www.youtube.com/watch?v=j05ZT7bsFZk';

const FIRMA = 'Equipo de Soporte — Acuarius';

const BIENVENIDA_POR_DEFECTO = `Hola {nombre},

Bienvenido a Acuarius. Es un gusto acompañarte en estos primeros días.

Nos contaste que quieres: «{objetivo}».

Con eso te preparamos los 2 o 3 pasos exactos para empezar. Si prefieres verlo en vivo, agendamos 15 minutos juntos y lo dejamos funcionando en tu cuenta.

Respóndenos por aquí y coordinamos.

Mientras tanto, te dejamos un video corto para que aproveches tu prueba.`;

const MONEDAS = ['COP', 'USD', 'MXN', 'PEN', 'CLP', 'ARS', 'EUR', 'GTQ', 'CRC', 'DOP', 'BOB', 'PYG', 'UYU', 'BRL', 'PAB', 'HNL', 'NIO'];

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbH() });
  if (!r.ok) throw new Error(`Supabase ${r.status} en ${path.split('?')[0]}`);
  return r.json();
}

async function guardar(userId, cambios) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/onboarding_cuenta?on_conflict=user_id`, {
    method: 'POST',
    headers: sbH({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({ user_id: userId, ...cambios, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('no se pudo guardar (' + r.status + ')');
  return (await r.json())[0];
}

function limpiar(t, max) { return String(t ?? '').trim().slice(0, max); }

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'onboarding'), 401);
  const yo = sesion.id;
  const soporte = !!(await soporteDe(sesion));

  let u;
  try {
    const r = await fetch(`${CLERK}/users/${yo}`, { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } });
    if (!r.ok) throw new Error('Clerk ' + r.status);
    u = await r.json();
  } catch (e) {
    return jsonResp({ error: 'No se pudo leer tu cuenta: ' + e.message }, 502);
  }
  const correo = (u.email_addresses || []).find(e => e.id === u.primary_email_address_id)?.email_address || '';

  if (req.method === 'GET') {
    try {
      const [filas, miembro] = await Promise.all([
        sbGet(`onboarding_cuenta?user_id=eq.${encodeURIComponent(yo)}&select=*&limit=1`),
        // Quien entra por una invitación trabaja en la cuenta de otro: su alta
        // es la del dueño, no la suya. Se mira por id y por correo porque la
        // invitación aún sin canjear solo tiene el correo.
        sbGet(`team_members?or=(member_user_id.eq.${encodeURIComponent(yo)},member_email.eq.${encodeURIComponent('"' + correo.toLowerCase() + '"')})&status=in.(active,invited)&select=id&limit=1`),
      ]);
      const fila = filas[0] || null;
      const debe = !soporte && !fila?.completado_at && !miembro.length && (u.created_at || 0) >= DESDE;
      return jsonResp({ onboarding: fila, debe, nombre: u.first_name || '', correo });
    } catch (e) {
      // Si no se puede saber, NO se manda a nadie al alta: bloquear la entrada
      // a la aplicación por un fallo nuestro sería mucho peor que saltársela.
      return jsonResp({ error: 'No se pudo leer el alta: ' + e.message, debe: false }, 502);
    }
  }

  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  if (soporte) return jsonResp({ error: 'El alta la completa el propio cliente' }, 403);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.accion === 'completar') {
      const objetivo = limpiar(body.objetivo, 1500);
      if (objetivo.length < 20) return jsonResp({ error: 'Cuéntanos un poco más: con una frase completa podemos ayudarte mejor' }, 400);

      const previa = (await sbGet(`onboarding_cuenta?user_id=eq.${encodeURIComponent(yo)}&select=*&limit=1`))[0] || {};
      // Completar dos veces (doble clic, recarga) no deja dos bienvenidas.
      if (previa.completado_at) return jsonResp({ ok: true, ya: true });

      // El texto de la bienvenida sale del enlace por el que llegó, si su dueño
      // lo personalizó. Si no, el de siempre.
      const slug = u.public_metadata?.enlace || previa.enlace_slug || null;
      let enlace = null;
      if (slug) {
        enlace = (await sbGet(`enlaces_registro?slug=eq.${encodeURIComponent(slug)}&select=bienvenida,video_url&limit=1`).catch(() => []))[0] || null;
      }
      const nombre = u.first_name || correo.split('@')[0] || '';
      const texto = (enlace?.bienvenida || BIENVENIDA_POR_DEFECTO)
        .replace(/\{nombre\}/g, nombre)
        .replace(/\{objetivo\}/g, objetivo.length > 280 ? objetivo.slice(0, 277) + '…' : objetivo)
        .replace(/\{empresa\}/g, previa.empresa?.nombre || 'tu empresa');
      const video = enlace?.video_url || VIDEO_POR_DEFECTO;
      const ahora = new Date().toISOString();

      await guardar(yo, { objetivo, paso: 'completo', completado_at: ahora, enlace_slug: slug });

      // 1) La bienvenida, como primer mensaje del hilo de soporte.
      const conv = (await sbGet(`support_conversations?user_id=eq.${encodeURIComponent(yo)}&select=id,mensajes&order=updated_at.desc&limit=1`))[0];
      const mensaje = { role: 'equipo', content: texto, at: ahora, firma: FIRMA, video, bienvenida: true };
      const rc = conv
        ? await fetch(`${SUPABASE_URL}/rest/v1/support_conversations?id=eq.${conv.id}`, {
            method: 'PATCH', headers: sbH({ Prefer: 'return=representation' }),
            body: JSON.stringify({ mensajes: [...(conv.mensajes || []), mensaje].slice(-60), updated_at: ahora }),
          })
        : await fetch(`${SUPABASE_URL}/rest/v1/support_conversations`, {
            method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
            body: JSON.stringify({ user_id: yo, email: correo, plan: u.public_metadata?.plan || null, mensajes: [mensaje], updated_at: ahora }),
          });
      const convId = rc.ok ? (await rc.json())?.[0]?.id || conv?.id || null : conv?.id || null;

      // 2) El caso para el equipo. Si no se crea, se dice: la bienvenida
      // promete que le leemos, y eso tiene que ser verdad.
      const empresa = previa.empresa || {};
      const detalle = [
        `Objetivo: ${objetivo}`,
        empresa.nombre ? `Empresa: ${empresa.nombre}${empresa.web ? ' (' + empresa.web + ')' : ''}` : null,
        empresa.sector ? `Sector: ${empresa.sector}${empresa.empleados ? ' · ' + empresa.empleados + ' empleados' : ''}` : null,
        previa.telefono ? `Teléfono: ${previa.telefono}` : null,
        previa.moneda ? `Moneda: ${previa.moneda}` : null,
        slug ? `Llegó por el enlace: ${slug}` : 'Llegó sin enlace de registro',
      ].filter(Boolean).join('\n');
      const rt = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
        method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          user_id: yo, author_user_id: yo, email: correo, plan: u.public_metadata?.plan || null,
          conversation_id: convId,
          asunto: `Cuenta nueva: ${empresa.nombre || nombre || correo}`.slice(0, 200),
          detalle,
          contexto: { origen: 'onboarding', empresa, telefono: previa.telefono || null, moneda: previa.moneda || null, enlace: slug },
        }),
      });
      return jsonResp({ ok: true, bienvenida: rc.ok, caso: rt.ok });
    }

    // Pasos sueltos. Cada uno guarda solo lo suyo, así que volver atrás y
    // cambiar un dato no borra los demás.
    const cambios = { paso: limpiar(body.paso, 30) || null };
    if (body.empresa) {
      const e = body.empresa;
      cambios.empresa = {
        nombre: limpiar(e.nombre, 120), web: limpiar(e.web, 200), descripcion: limpiar(e.descripcion, 600),
        sector: limpiar(e.sector, 80), empleados: limpiar(e.empleados, 20),
      };
    }
    if (body.moneda !== undefined) {
      const m = String(body.moneda || '').toUpperCase();
      if (!MONEDAS.includes(m)) return jsonResp({ error: 'Moneda no soportada' }, 400);
      cambios.moneda = m;
    }
    if (body.telefono !== undefined) {
      const t = String(body.telefono || '').replace(/[^\d+]/g, '');
      if (t.replace(/\D/g, '').length < 8) return jsonResp({ error: 'Ese teléfono parece incompleto' }, 400);
      cambios.telefono = t;
    }
    if (body.enlace_slug) cambios.enlace_slug = limpiar(body.enlace_slug, 40).toLowerCase();
    const fila = await guardar(yo, cambios);
    return jsonResp({ ok: true, onboarding: fila });
  } catch (e) {
    return jsonResp({ error: 'No se pudo guardar: ' + e.message }, 502);
  }
}
