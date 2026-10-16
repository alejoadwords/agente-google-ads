// api/ruta.js — la ruta de arranque de una cuenta nueva (ver api/_ruta.js).
//
//   GET                 la ruta de quien pregunta: completa para el dueño y los
//                       administradores, la mini‑ruta para un asesor
//   POST {accion}       'ocultar' | 'mostrar'
//
// Cada GET vuelve a mirar la cuenta, anota la primera vez que se cumplió cada
// paso (para medir qué frena a la gente) y, si se cumplieron los esenciales
// durante la prueba, da una sola vez los 7 días de premio.
//
// En una sesión de soporte solo se LEE: ni se anotan pasos ni se dan premios,
// o quien revisa una cuenta cambiaría lo que mide.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta } from './_perfiles.js';
import { soporteDe } from './_soporte-sesion.js';
import { PASOS_EQUIPO, DIAS, opcionales, pasosPara, esencialesCumplidos, detectar, detectarEquipo,
         datosDeLaCuenta, datosDelAsesor, armarRuta, RUTA_DESDE, DIA } from './_ruta.js';

const PREMIO_DIAS = 7;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLERK = 'https://api.clerk.com/v1';

function sb(extra = {}) {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function estadoDe(id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ruta_cuenta?user_id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { headers: sb() });
  return r.ok ? ((await r.json())?.[0] || null) : null;
}
async function guardarEstado(id, cambios) {
  await fetch(`${SUPABASE_URL}/rest/v1/ruta_cuenta?on_conflict=user_id`, {
    method: 'POST',
    headers: sb({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ user_id: id, ...cambios, updated_at: new Date().toISOString() }),
  });
}

async function usuarioClerk(id) {
  return fetch(`${CLERK}/users/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY } })
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
}

// Anota la primera vez de cada paso cumplido. Lo que se deshace (un agente que
// se apaga) deja de verse hecho, pero su primera fecha se conserva: es lo que
// sirve para medir cuánto tarda la gente en llegar.
function anotar(hitos, hechos, ahora) {
  const nuevos = { ...(hitos || {}) };
  let hubo = false;
  for (const [id, ok] of Object.entries(hechos)) if (ok && !nuevos[id]) { nuevos[id] = ahora; hubo = true; }
  return { nuevos, hubo };
}


export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'ruta'), 401);
  let quien;
  try { quien = await quienPregunta(sesion.id); }
  catch (e) { return jsonResp({ error: e.message }, e.suspendida ? 403 : 503); }
  const deSoporte = !!(await soporteDe(sesion));
  const completa = !quien.esMiembro || quien.perfil === 'admin';
  // La ruta completa es de la CUENTA (la del dueño); la mini‑ruta, de cada asesor.
  const clave = completa ? quien.userId : quien.actorId;

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch {}
    if (deSoporte) return jsonResp({ ok: true, soporte: true });
    if (body.accion === 'ocultar') await guardarEstado(clave, { oculta_at: new Date().toISOString() });
    else if (body.accion === 'mostrar') await guardarEstado(clave, { oculta_at: null });
    else return jsonResp({ error: 'Acción no válida' }, 400);
    return jsonResp({ ok: true });
  }
  if (req.method !== 'GET') return jsonResp({ error: 'Método no permitido' }, 405);

  try {
    const ahora = Date.now(), ahoraIso = new Date(ahora).toISOString();
    const estado = await estadoDe(clave);

    if (!completa) {
      // Mini‑ruta: desde que entró al equipo.
      const fila = (await fetch(`${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(quien.userId)}&member_user_id=eq.${encodeURIComponent(quien.actorId)}&select=joined_at,created_at&limit=1`, { headers: sb() })
        .then(r => (r.ok ? r.json() : [])).catch(() => []))?.[0];
      const inicio = Date.parse(fila?.joined_at || fila?.created_at || ahoraIso);
      const hechos = detectarEquipo(await datosDelAsesor(quien.userId, quien.actorId));
      const { nuevos, hubo } = anotar(estado?.hitos, hechos, ahoraIso);
      if (hubo && !deSoporte) await guardarEstado(clave, { hitos: nuevos, ultimo_avance_at: ahoraIso });
      const r = armarRuta({ pasos: PASOS_EQUIPO, hechos, hitos: nuevos, inicio, ahora });
      const terminada = r.progreso.hechos >= r.progreso.total;
      return jsonResp({
        rol: 'asesor', ...r, dias: { 1: { titulo: 'Tus primeros pasos', meta: 'Empieza a atender desde Acuarius' } },
        visible: !estado?.oculta_at && (!terminada || ahora - inicio < 3 * DIA) && ahora - inicio < 30 * DIA,
        oculta: !!estado?.oculta_at,
      });
    }

    const [u, alta, datos] = await Promise.all([
      usuarioClerk(quien.userId),
      fetch(`${SUPABASE_URL}/rest/v1/onboarding_cuenta?user_id=eq.${encodeURIComponent(quien.userId)}&select=empresa,completado_at&limit=1`, { headers: sb() })
        .then(r => (r.ok ? r.json() : [])).then(r => r?.[0] || null).catch(() => null),
      datosDeLaCuenta(quien.userId),
    ]);
    const creada = u?.created_at ? Number(u.created_at) : ahora;
    const inicio = Date.parse(alta?.completado_at || '') || creada;
    const sector = alta?.empresa?.sector || '';
    const empleados = alta?.empresa?.empleados || '';
    const hechos = detectar(datos);
    const { nuevos, hubo } = anotar(estado?.hitos, hechos, ahoraIso);
    const PASOS = pasosPara(sector);
    const r = armarRuta({ pasos: PASOS, hechos, hitos: nuevos, opc: opcionales(sector, empleados), inicio, ahora });

    // ── El premio ──────────────────────────────────────────────────────────
    const meta = u?.public_metadata || {};
    const enPrueba = meta.plan === 'trial' && meta.trial_until && Date.parse(meta.trial_until) > ahora;
    const cumplidos = esencialesCumplidos(hechos, PASOS);
    let premio = { otorgado_at: estado?.premio_at || null, trial_until: meta.trial_until || null, en_prueba: !!enPrueba, dias: PREMIO_DIAS };
    const cambios = {};
    if (hubo) { cambios.hitos = nuevos; cambios.ultimo_avance_at = ahoraIso; }
    // Copia del avance para el panel de Cuentas de clientes, que no puede
    // recalcular 23 consultas por cuenta al listar.
    if (estado?.pct !== r.progreso.pct || estado?.dia !== r.dia_actual || estado?.siguiente !== r.siguiente) {
      Object.assign(cambios, { pct: r.progreso.pct, dia: r.dia_actual, siguiente: r.siguiente });
    }
    if (cumplidos && enPrueba && !estado?.premio_at && !deSoporte) {
      const hasta = new Date(Date.parse(meta.trial_until) + PREMIO_DIAS * DIA).toISOString();
      const ok = await fetch(`${CLERK}/users/${encodeURIComponent(quien.userId)}/metadata`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_metadata: { trial_until: hasta, ruta_premio: ahoraIso } }),
      }).then(x => x.ok).catch(() => false);
      if (ok) {
        cambios.premio_at = ahoraIso;
        premio = { ...premio, otorgado_at: ahoraIso, trial_until: hasta, recien: true };
      }
    }
    if (Object.keys(cambios).length && !deSoporte) await guardarEstado(clave, cambios);

    const terminada = r.progreso.hechos >= r.progreso.total;
    const ultimo = Object.values(nuevos).sort().pop();
    return jsonResp({
      rol: 'dueno', ...r, dias: DIAS, sector, empleados,
      // Para las plantillas de «Hazlo por mí» (el agente se presenta con esto).
      negocio: { nombre: alta?.empresa?.nombre || '', descripcion: alta?.empresa?.descripcion || '' },
      esenciales: {
        cumplidos,
        faltan: PASOS.filter(p => p.esencial && !hechos[p.id]).map(p => p.id)
          .concat(PASOS.some(p => p.entrada && hechos[p.id]) ? [] : ['entrada']),
      },
      premio,
      // Visible para las cuentas nuevas mientras le falte algo, y tres días más
      // para celebrar al terminar. Se puede ocultar y volver a mostrar.
      visible: creada >= RUTA_DESDE && !estado?.oculta_at && (!terminada || !ultimo || ahora - Date.parse(ultimo) < 3 * DIA),
      oculta: !!estado?.oculta_at,
      soporte: deSoporte,
    });
  } catch (e) {
    return jsonResp({ error: 'No se pudo leer tu ruta: ' + (e.message || 'error') }, 502);
  }
}
