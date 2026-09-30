// api/cuentas.js — las cuentas de los clientes vistas desde el equipo de Acuarius
//
//   GET  ?lista=1                 todas las cuentas, con plan, estado y origen (admin)
//   GET  ?accesos=1               quién entró a qué cuenta y cuándo (admin)
//   GET  ?enlace=1                mi enlace de registro (admin)
//   GET  ?registro=<slug>         datos PÚBLICOS de un enlace, para la página de alta
//   POST {accion:'entrar', cuenta, motivo}   abre sesión en la cuenta del cliente (admin)
//   POST {accion:'volver'}                   cierra esa sesión y devuelve la del admin
//   POST {accion:'enlace', slug, titulo, bienvenida, video_url}   guarda mi enlace (admin)
//   POST {accion:'enviar-enlace', nombre, email, nota}           lo manda por correo (admin)
//   POST {accion:'atribuir', slug}           la cuenta recién creada dice por qué enlace llegó
//
// POR QUÉ ESTA VEZ SÍ SE ENTRA A LA CUENTA
//
// El 07-08-2026 se revirtió un «modo soporte» que resolvía la cuenta del
// cliente endpoint por endpoint con un vale propio. Lo que lo tumbó fue la
// identidad: la sesión seguía siendo la del administrador, con SU nombre y SU
// plan, así que en la cuenta del cliente se veían funciones y cupos que no
// eran los suyos. Once endpoints enganchados a mano y seguía sangrando.
//
// Aquí no se engancha nada. Clerk emite un «actor token»: la sesión que se
// abre ES la del cliente —su `sub`, su plan, sus límites, su equipo— y lleva
// además el claim `act` con quién está detrás. Ningún endpoint necesita saber
// que existe esto; todos ven al cliente porque es el cliente. Lo único que
// cambia es el navegador, que pinta un banner y se abstiene de lo que haría el
// cliente al entrar por primera vez (arrancar su prueba, suscribir avisos…).
//
// Garantías, porque esto toca datos de terceros:
//   1. Solo ADMIN_EMAILS, comprobado contra Clerk en cada petición — el token
//      no trae el correo y no se le cree a nada que venga del navegador.
//   2. No se entra a la cuenta de otro administrador ni se encadenan entradas.
//   3. La sesión dura una hora como mucho (`session_max_duration`).
//   4. Cada entrada y cada salida quedan en `acceso_cuentas`, con el motivo.
//   5. Volver exige que la sesión actual lleve `act.sub` de un administrador:
//      ese claim lo firma Clerk, no se puede fabricar desde el navegador.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { emailHtml, bloque, esc, RESPONDER_A } from './_email-layout.js';
import { enviarResend } from './_correo.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLERK = 'https://api.clerk.com/v1';
const APP = 'https://app.acuarius.app';

// Una hora: suficiente para una revisión o una sesión de asesoría, y corta
// para que una pestaña olvidada no deje abierta la cuenta de un cliente.
const DURACION_SESION = 3600;

// Rutas que ya existen o que suenan a nuestras: nadie puede quedarse con ellas.
const RESERVADOS = new Set(['acuarius', 'admin', 'soporte', 'api', 'app', 'login', 'registro', 'www', 'ayuda', 'help', 'clientify']);

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
const clerkH = () => ({ Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' });

// Lectura que FALLA A LA VISTA: una lista vacía porque Supabase no respondió
// se leería como «no hay nadie», que es justo lo que no debe decir esta pantalla.
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbH() });
  if (!r.ok) throw new Error(`Supabase ${r.status} en ${path.split('?')[0]}`);
  return r.json();
}

async function clerkUsuario(id) {
  const r = await fetch(`${CLERK}/users/${encodeURIComponent(id)}`, { headers: clerkH() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Clerk devolvió ' + r.status + ' al pedir el usuario');
  return r.json();
}

function correoPrincipal(u) {
  if (!u) return '';
  const p = (u.email_addresses || []).find(e => e.id === u.primary_email_address_id) || (u.email_addresses || [])[0];
  return (p?.email_address || '').toLowerCase();
}
function nombreDe(u) {
  return [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim();
}
function admins() {
  return String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// Qué ve el equipo en la columna «Estado». La prueba vencida se nombra aparte:
// en Clerk sigue diciendo 'trial' hasta que pasa el cron del día, y contarla
// como activa inflaría la cifra que más se mira.
function estadoDe(meta) {
  const plan = meta?.plan || 'free';
  if (meta?.status === 'suspended') return 'suspendida';
  if (plan === 'trial') {
    const hasta = meta.trial_until ? Date.parse(meta.trial_until) : 0;
    return hasta > Date.now() ? 'prueba' : 'prueba vencida';
  }
  if (plan === 'pro' || plan === 'agency' || plan === 'individual' || plan === 'agencia') return 'activa';
  return 'gratis';
}

function slugValido(s) {
  return /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(s) && !RESERVADOS.has(s);
}
function slugDesde(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);

  // ── Público: la página de alta pregunta por su enlace ──────────────────────
  // Sin sesión, porque quien abre el enlace todavía no tiene cuenta. Devuelve
  // solo lo que se pinta en la página: nunca el id ni el correo del dueño.
  const slugPublico = url.searchParams.get('registro');
  if (req.method === 'GET' && slugPublico !== null) {
    const slug = slugDesde(slugPublico);
    if (!slug) return jsonResp({ ok: false });
    try {
      const filas = await sbGet(`enlaces_registro?slug=eq.${encodeURIComponent(slug)}&select=slug,titulo&limit=1`);
      if (!filas.length) return jsonResp({ ok: false });
      return jsonResp({ ok: true, slug: filas[0].slug, titulo: filas[0].titulo || '' });
    } catch (e) {
      // La página de alta sigue funcionando sin personalizar: mejor registrar
      // a alguien sin su enlace que no dejarle registrarse.
      return jsonResp({ ok: false, error: 'No se pudo leer el enlace' }, 502);
    }
  }

  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'cuentas'), 401);
  const yo = sesion.id;
  const actor = sesion.datos?.act?.sub || null;   // quién está detrás, si es una entrada de soporte

  let body = {};
  if (req.method === 'POST') body = await req.json().catch(() => ({}));

  // ── Atribución: la cuenta nueva dice por qué enlace llegó ─────────────────
  // Lo pide el navegador del propio cliente al terminar el alta. No se le cree
  // sin más: solo se acepta en cuentas recién creadas y que aún no tengan
  // origen, para que nadie se «adjudique» cuentas viejas cambiando el slug.
  if (req.method === 'POST' && body.accion === 'atribuir') {
    if (actor) return jsonResp({ ok: false, motivo: 'sesión de soporte' });
    const slug = slugDesde(body.slug);
    if (!slug) return jsonResp({ error: 'Falta el enlace' }, 400);
    try {
      const u = await clerkUsuario(yo);
      if (!u) return jsonResp({ error: 'No existe la cuenta' }, 404);
      if (u.public_metadata?.enlace) return jsonResp({ ok: true, ya: true });
      if (Date.now() - (u.created_at || 0) > 3 * 86400000) return jsonResp({ ok: false, motivo: 'cuenta antigua' });
      const filas = await sbGet(`enlaces_registro?slug=eq.${encodeURIComponent(slug)}&select=user_id,registros&limit=1`);
      if (!filas.length) return jsonResp({ ok: false, motivo: 'enlace inexistente' });
      if (filas[0].user_id === yo) return jsonResp({ ok: false, motivo: 'enlace propio' });
      const r = await fetch(`${CLERK}/users/${yo}/metadata`, {
        method: 'PATCH', headers: clerkH(),
        body: JSON.stringify({ public_metadata: { enlace: slug, enlace_de: filas[0].user_id } }),
      });
      if (!r.ok) throw new Error('Clerk devolvió ' + r.status + ' al guardar el origen');
      await fetch(`${SUPABASE_URL}/rest/v1/enlaces_registro?slug=eq.${encodeURIComponent(slug)}`, {
        method: 'PATCH', headers: sbH(),
        body: JSON.stringify({ registros: (filas[0].registros || 0) + 1, updated_at: new Date().toISOString() }),
      });
      return jsonResp({ ok: true });
    } catch (e) {
      return jsonResp({ error: 'No se pudo registrar el origen: ' + e.message }, 502);
    }
  }

  // ── Volver a la cuenta propia ─────────────────────────────────────────────
  // Va ANTES de la puerta de administrador a propósito: en este momento la
  // sesión es la del cliente, así que «¿es admin quien pregunta?» diría que no.
  // Lo que se comprueba es `act.sub`, que firma Clerk.
  if (req.method === 'POST' && body.accion === 'volver') {
    if (!actor) return jsonResp({ error: 'Esta sesión no es una entrada de soporte' }, 400);
    try {
      const adminU = await clerkUsuario(actor);
      if (!adminU || !admins().includes(correoPrincipal(adminU))) {
        return jsonResp({ error: 'Quien abrió esta sesión ya no es del equipo' }, 403);
      }
      const r = await fetch(`${CLERK}/sign_in_tokens`, {
        method: 'POST', headers: clerkH(),
        body: JSON.stringify({ user_id: actor, expires_in_seconds: 300 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) throw new Error('Clerk devolvió ' + r.status + ' al pedir el regreso');
      // Cierra la entrada abierta. Si falla, el regreso sigue: quedarse
      // atrapado en la cuenta de un cliente por un registro es peor.
      await fetch(`${SUPABASE_URL}/rest/v1/acceso_cuentas?admin_id=eq.${encodeURIComponent(actor)}&cuenta_id=eq.${encodeURIComponent(yo)}&fin=is.null`, {
        method: 'PATCH', headers: sbH(), body: JSON.stringify({ fin: new Date().toISOString() }),
      }).catch(() => {});
      return jsonResp({ ticket: d.token });
    } catch (e) {
      return jsonResp({ error: 'No se pudo volver a tu cuenta: ' + e.message }, 502);
    }
  }

  // ── De aquí en adelante, solo el equipo de Acuarius ───────────────────────
  // Una sesión de soporte NO pasa, aunque detrás haya un admin: dentro de la
  // cuenta del cliente no se abren otras cuentas ni se toca su enlace.
  if (actor) return jsonResp({ error: 'Estás dentro de la cuenta de un cliente. Vuelve a la tuya primero.' }, 403);
  let yoU;
  try { yoU = await clerkUsuario(yo); }
  catch (e) { return jsonResp({ error: 'No se pudo comprobar quién eres: ' + e.message }, 502); }
  const miCorreo = correoPrincipal(yoU);
  if (!admins().includes(miCorreo)) return jsonResp({ error: 'Solo el equipo de Acuarius puede usar esto' }, 403);

  // ── Listado de cuentas ────────────────────────────────────────────────────
  if (req.method === 'GET' && url.searchParams.get('lista')) {
    try {
      // Clerk es la verdad del plan (la fila espejo de `users` no siempre lo
      // está). 500 por página; se pagina hasta el final, no hasta un tope,
      // porque una cuenta que no sale en la lista es una cuenta a la que no se
      // puede entrar y nadie sabría por qué.
      const usuarios = [];
      for (let offset = 0; offset < 20000; offset += 500) {
        const r = await fetch(`${CLERK}/users?limit=500&offset=${offset}&order_by=-created_at`, { headers: clerkH() });
        if (!r.ok) throw new Error('Clerk devolvió ' + r.status + ' al listar');
        const pag = await r.json();
        usuarios.push(...pag);
        if (pag.length < 500) break;
      }
      const [miembros, empresas, ultimos] = await Promise.all([
        sbGet('team_members?status=eq.active&select=member_user_id,owner_user_id'),
        sbGet('onboarding_cuenta?select=user_id,empresa,telefono,objetivo,completado_at'),
        sbGet('acceso_cuentas?select=cuenta_id,admin_email,inicio&order=inicio.desc&limit=500'),
      ]);
      const dueñoDe = new Map(miembros.filter(m => m.member_user_id).map(m => [m.member_user_id, m.owner_user_id]));
      const correoDe = new Map(usuarios.map(u => [u.id, correoPrincipal(u)]));
      const empresaDe = new Map(empresas.map(e => [e.user_id, e]));
      const ultimoAcceso = new Map();
      for (const a of ultimos) if (!ultimoAcceso.has(a.cuenta_id)) ultimoAcceso.set(a.cuenta_id, a);
      const equipo = admins();

      const cuentas = usuarios.map(u => {
        const m = u.public_metadata || {};
        const correo = correoPrincipal(u);
        const onb = empresaDe.get(u.id);
        const dueño = dueñoDe.get(u.id);
        return {
          id: u.id,
          nombre: nombreDe(u),
          correo,
          empresa: onb?.empresa?.nombre || '',
          plan: m.plan || 'free',
          estado: estadoDe(m),
          hasta: m.plan === 'trial' ? (m.trial_until || null) : (m.hasta || null),
          origen_plan: m.origen || null,
          enlace: m.enlace || null,
          creada: u.created_at,
          ultima_entrada: u.last_sign_in_at || null,
          ultima_actividad: u.last_active_at || null,
          // Un miembro de equipo tiene cuenta propia en Clerk, pero entrar a la
          // suya no enseña nada: sus datos son los del dueño. Se marca para
          // que el equipo entre a la cuenta que de verdad importa.
          miembro_de: dueño ? (correoDe.get(dueño) || dueño) : null,
          es_equipo: equipo.includes(correo),
          onboarding: onb ? (onb.completado_at ? 'completo' : 'a medias') : null,
          ultimo_acceso: ultimoAcceso.get(u.id) || null,
        };
      });
      return jsonResp({ cuentas });
    } catch (e) {
      return jsonResp({ error: 'No se pudo armar la lista: ' + e.message }, 502);
    }
  }

  // ── Registro de accesos ───────────────────────────────────────────────────
  if (req.method === 'GET' && url.searchParams.get('accesos')) {
    try {
      const cuenta = url.searchParams.get('cuenta');
      const filtro = cuenta ? `&cuenta_id=eq.${encodeURIComponent(cuenta)}` : '';
      const filas = await sbGet(`acceso_cuentas?select=admin_email,cuenta_id,cuenta_email,motivo,inicio,fin${filtro}&order=inicio.desc&limit=100`);
      return jsonResp({ accesos: filas });
    } catch (e) {
      return jsonResp({ error: 'No se pudo leer el registro: ' + e.message }, 502);
    }
  }

  // ── Entrar a una cuenta ───────────────────────────────────────────────────
  if (req.method === 'POST' && body.accion === 'entrar') {
    const cuenta = String(body.cuenta || '');
    const motivo = String(body.motivo || '').trim().slice(0, 300);
    if (!cuenta) return jsonResp({ error: 'Falta la cuenta' }, 400);
    if (cuenta === yo) return jsonResp({ error: 'Esa es tu propia cuenta' }, 400);
    // El motivo es obligatorio: si un cliente pregunta quién entró y para
    // qué, la respuesta tiene que estar escrita, no en la memoria de alguien.
    if (motivo.length < 3) return jsonResp({ error: 'Escribe para qué entras (asesoría, revisión, soporte…)' }, 400);
    try {
      const destino = await clerkUsuario(cuenta);
      if (!destino) return jsonResp({ error: 'Esa cuenta no existe' }, 404);
      const correoDestino = correoPrincipal(destino);
      if (admins().includes(correoDestino)) return jsonResp({ error: 'No se entra a la cuenta de otra persona del equipo' }, 403);

      const r = await fetch(`${CLERK}/actor_tokens`, {
        method: 'POST', headers: clerkH(),
        body: JSON.stringify({
          user_id: cuenta,
          actor: { sub: yo },
          expires_in_seconds: 300,                  // lo que tarda en canjearse
          session_max_duration_in_seconds: DURACION_SESION,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) {
        const det = d?.errors?.[0]?.long_message || d?.errors?.[0]?.message || ('estado ' + r.status);
        throw new Error('Clerk no emitió el acceso (' + det + ')');
      }
      // El registro va ANTES de devolver el acceso: una entrada que no quedó
      // anotada no se entrega. Es la única garantía que se puede enseñar.
      const log = await fetch(`${SUPABASE_URL}/rest/v1/acceso_cuentas`, {
        method: 'POST', headers: sbH({ Prefer: 'return=minimal' }),
        body: JSON.stringify({
          admin_id: yo, admin_email: miCorreo, cuenta_id: cuenta, cuenta_email: correoDestino,
          motivo, actor_token_id: d.id,
        }),
      });
      if (!log.ok) {
        await fetch(`${CLERK}/actor_tokens/${d.id}/revoke`, { method: 'POST', headers: clerkH() }).catch(() => {});
        throw new Error('no se pudo anotar la entrada, así que no se abre');
      }
      return jsonResp({ ticket: d.token, cuenta: { id: cuenta, correo: correoDestino, nombre: nombreDe(destino) }, minutos: DURACION_SESION / 60 });
    } catch (e) {
      return jsonResp({ error: 'No se pudo entrar: ' + e.message }, 502);
    }
  }

  // ── Mi enlace de registro ─────────────────────────────────────────────────
  if (req.method === 'GET' && url.searchParams.get('enlace')) {
    try {
      let filas = await sbGet(`enlaces_registro?user_id=eq.${encodeURIComponent(yo)}&select=*&limit=1`);
      if (!filas.length) {
        // Se crea al primer vistazo con un slug razonable; si está cogido se
        // le pone un número. El dueño lo cambia luego si no le gusta.
        const base = slugDesde(yoU.first_name || miCorreo.split('@')[0]) || 'equipo';
        for (let i = 0; i < 6 && !filas.length; i++) {
          const slug = i ? `${base}-${i + 1}` : base;
          if (!slugValido(slug)) continue;
          const r = await fetch(`${SUPABASE_URL}/rest/v1/enlaces_registro`, {
            method: 'POST', headers: sbH({ Prefer: 'return=representation' }),
            body: JSON.stringify({ user_id: yo, slug }),
          });
          if (r.ok) filas = await r.json();
        }
        if (!filas.length) throw new Error('no se pudo reservar un enlace');
      }
      return jsonResp({ enlace: { ...filas[0], url: `${APP}/registro/${filas[0].slug}` } });
    } catch (e) {
      return jsonResp({ error: 'No se pudo leer tu enlace: ' + e.message }, 502);
    }
  }

  if (req.method === 'POST' && body.accion === 'enlace') {
    const slug = slugDesde(body.slug);
    if (!slugValido(slug)) return jsonResp({ error: 'El enlace debe tener entre 3 y 40 letras, números o guiones, y no puede ser una palabra reservada' }, 400);
    const video = String(body.video_url || '').trim();
    if (video && !/^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\//.test(video)) {
      return jsonResp({ error: 'El video tiene que ser un enlace de YouTube o Vimeo' }, 400);
    }
    const fila = {
      user_id: yo,
      slug,
      titulo: String(body.titulo || '').trim().slice(0, 120) || null,
      bienvenida: String(body.bienvenida || '').trim().slice(0, 3000) || null,
      video_url: video || null,
      updated_at: new Date().toISOString(),
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/enlaces_registro?on_conflict=user_id`, {
      method: 'POST', headers: sbH({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(fila),
    });
    if (r.status === 409) return jsonResp({ error: 'Ese enlace ya lo usa otra persona' }, 409);
    if (!r.ok) return jsonResp({ error: 'No se pudo guardar: ' + (await r.text()).slice(0, 200) }, 502);
    const [g] = await r.json();
    return jsonResp({ enlace: { ...g, url: `${APP}/registro/${g.slug}` } });
  }

  if (req.method === 'POST' && body.accion === 'enviar-enlace') {
    const email = String(body.email || '').trim().toLowerCase();
    const nombre = String(body.nombre || '').trim().slice(0, 80);
    const nota = String(body.nota || '').trim().slice(0, 1200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResp({ error: 'Ese correo no es válido' }, 400);
    try {
      const filas = await sbGet(`enlaces_registro?user_id=eq.${encodeURIComponent(yo)}&select=slug&limit=1`);
      if (!filas.length) return jsonResp({ error: 'Primero guarda tu enlace' }, 400);
      const link = `${APP}/registro/${filas[0].slug}`;
      const quien = nombreDe(yoU) || 'El equipo de Acuarius';
      const r = await enviarResend('cuentas/enviar-enlace', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Acuarius <crm@app.acuarius.app>',
          reply_to: miCorreo || RESPONDER_A,
          to: email,
          subject: `${nombre ? nombre + ', te' : 'Te'} invito a probar Acuarius 14 días`,
          html: emailHtml({
            titulo: `${nombre ? esc(nombre) + ', tu' : 'Tu'} cuenta de Acuarius te espera`,
            intro: `${esc(quien)} te invita a probar Acuarius: el CRM con agentes de IA que atiende tus conversaciones y ordena tus ventas.`,
            cuerpo: (nota ? bloque(esc(nota).replace(/\n/g, '<br>')) : '')
              + '<p style="margin:14px 0 0">Tienes <strong>14 días con todo incluido</strong> y no te pedimos tarjeta. En cinco minutos dejas tu cuenta lista.</p>',
            cta: { texto: 'Crear mi cuenta', url: link },
            pie: `Si el botón no abre, copia este enlace: ${esc(link)}`,
            preheader: '14 días gratis, sin tarjeta de crédito',
          }),
        }),
      }, yo);
      if (!r.ok) return jsonResp({ error: 'El correo no salió (Resend ' + r.status + ')' }, 502);
      return jsonResp({ ok: true });
    } catch (e) {
      return jsonResp({ error: 'No se pudo enviar: ' + e.message }, 502);
    }
  }

  return jsonResp({ error: 'Acción desconocida' }, 400);
}
