// api/_cupo-agente.js — cuántos mensajes del agente lleva una cuenta este mes.
//
// El landing ya vende un cupo de mensajes por plan, y dentro de la aplicación
// no había forma de saber cuántos se llevan gastados: ni el cliente podía
// mirarlo ni nosotros podíamos avisarle. Cobrar por algo que el cliente no
// puede ver es de las cosas que acaban en una discusión por la factura.
//
// La fuente es `ai_usage`, que ya registra cada llamada al modelo con la cuenta
// a la que se le imputa. Aquí no se escribe nada: solo se cuenta.
//
// OJO: este módulo solo lo pueden importar funciones con runtime 'edge'.
// Importarlo desde una función Node rompe SU build en silencio.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Qué cuenta para el cupo: las respuestas que el agente le da a un contacto de
// verdad, por cualquiera de los canales.
//
// El probador del agente (`ensayo`, `ensayo-publico`) queda FUERA a propósito.
// Cuesta dinero igual, pero cobrarle a un cliente por probar su propio agente
// antes de encenderlo es empujarlo a encenderlo sin probarlo, y un agente mal
// probado sale mucho más caro que los pocos mensajes del ensayo. Se registra
// igual, así que el gasto sigue siendo visible para nosotros.
export const ORIGENES_CUPO = ['whatsapp', 'instagram', 'messenger', 'tiktok', 'webchat'];

// Mensajes incluidos al mes. Los nombres repetidos son los alias históricos con
// los que Clerk guardó el plan en algunas cuentas: 'individual' fue el nombre
// viejo de Pro y 'agencia' el de Agency, y una cuenta con el alias tiene que
// recibir su cupo, no cero.
export const CUPOS = {
  free: 0,
  trial: 300,
  pro: 500,
  individual: 500,
  agency: 2000,
  agencia: 2000,
};

// Un plan desconocido NO se queda sin cupo: se le da el de Pro.
//
// La alternativa —cero— convierte cualquier error nuestro (un plan mal escrito
// en Clerk, un nombre nuevo que alguien añada) en un agente mudo para un
// cliente que paga. Entre cobrar de menos y dejar a un cliente sin servicio por
// un dato nuestro mal puesto, se cobra de menos.
export const CUPO_POR_DEFECTO = 500;

export function cupoDelPlan(plan) {
  const p = String(plan || '').toLowerCase().trim();
  if (!p) return CUPO_POR_DEFECTO;
  if (p === 'free') return 0;
  return CUPOS[p] !== undefined ? CUPOS[p] : CUPO_POR_DEFECTO;
}

// El mes se cuenta en hora de Colombia, no en UTC.
//
// Con UTC el mes nuevo empezaría a las 7 de la tarde del último día, y un
// cliente que mira su consumo el día 30 por la noche vería el contador ya
// puesto a cero. El mismo desfase de cinco horas que usan los crons.
const HORAS_COLOMBIA = -5;

export function inicioDelMes(ahora = new Date()) {
  const local = new Date(ahora.getTime() + HORAS_COLOMBIA * 3600000);
  // El día 1 a las 00:00 locales, devuelto en UTC, que es como se guardan las
  // fechas en la base.
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, -HORAS_COLOMBIA, 0, 0));
}

function sb() {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}

// Cuántos mensajes lleva la cuenta este mes.
//
// Se pide `count=exact` con `limit=0`: el total viene en la cabecera y no se
// baja ni una fila. Con un cliente activo son miles al mes, y traerlas para
// contarlas sería pagar ancho de banda por un número.
export async function consumoDelMes(userId, desde = null) {
  if (!userId) return 0;
  const inicio = (desde || inicioDelMes()).toISOString();
  const orig = ORIGENES_CUPO.map(o => `"${o}"`).join(',');
  const url = `${SUPABASE_URL}/rest/v1/ai_usage`
    + `?user_id=eq.${encodeURIComponent(userId)}`
    + `&origen=in.(${orig})`
    + `&created_at=gte.${encodeURIComponent(inicio)}`
    + `&select=id&limit=0`;
  // Dos formas de no poder contar, y las dos devuelven null: que la base
  // conteste que no (una clave caducada, un permiso) y que no conteste (red).
  // Si esto lanzara, el endpoint respondería un 500 pelado y la pantalla no
  // sabría distinguirlo de «no hay consumo».
  try {
    const r = await fetch(url, { headers: { ...sb(), Prefer: 'count=exact' } });
    if (!r.ok) return null;
    const rango = r.headers.get('content-range') || '';
    const total = parseInt(rango.split('/')[1], 10);
    return Number.isFinite(total) ? total : null;
  } catch { return null; }
}

// El plan vive en Clerk: desde el token v2 ya no viaja en el JWT, así que hay
// que preguntárselo. Se cachea un minuto porque el contador se pinta en cada
// carga de pantalla y el plan no cambia entre dos.
//
// Devuelve `{ ok, plan }` y no el plan a secas, porque hay que distinguir dos
// cosas que se parecen y no lo son:
//
//   { ok: true,  plan: 'loquesea' }  el plan se leyó y no lo conocemos → cupo por defecto
//   { ok: false }                    NO se pudo preguntar → no se inventa un cupo
//
// Sin esa distinción, un fallo de Clerk le enseñaba a una cuenta Agency un cupo
// de 500 en vez de 2.000, sin un solo aviso. El cliente habría visto que le
// queda la cuarta parte de lo que pagó y nadie habría sabido por qué.
const _planCache = new Map();
export async function planDeCuenta(userId) {
  if (!userId || !process.env.CLERK_SECRET_KEY) return { ok: false };
  const hit = _planCache.get(userId);
  if (hit && hit.exp > Date.now()) return { ok: true, plan: hit.plan };
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + encodeURIComponent(userId), {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    // Un 404 sí es una respuesta: ese usuario no está en Clerk. Lo que no se
    // puede tratar como respuesta es un 5xx o una caída de red.
    if (r.status === 404) { _planCache.set(userId, { plan: null, exp: Date.now() + 60000 }); return { ok: true, plan: null }; }
    if (!r.ok) return { ok: false };
    const u = await r.json();
    const plan = (u.public_metadata?.plan || '').toLowerCase() || null;
    _planCache.set(userId, { plan, exp: Date.now() + 60000 });
    return { ok: true, plan };
  } catch { return { ok: false }; }
}

/**
 * El estado completo, que es lo que pinta la pantalla y lo que mirará el corte.
 *
 * `error: true` cuando no se pudo contar o no se pudo saber el plan. Se
 * distingue a propósito de «lleva cero»: una pantalla que dice «0 de 500» por
 * una consulta caída está mintiendo con mucha seguridad, y quien la mire creerá
 * que no ha gastado nada.
 */
export async function estadoDeCupo(userId) {
  const [res, usados] = await Promise.all([planDeCuenta(userId), consumoDelMes(userId)]);
  if (usados === null) return { error: true, motivo: 'no se pudo contar el consumo' };
  if (!res.ok) return { error: true, motivo: 'no se pudo consultar el plan de la cuenta' };
  const plan = res.plan;
  const cupo = cupoDelPlan(plan);
  const restante = Math.max(0, cupo - usados);
  return {
    plan: plan || 'desconocido',
    cupo,
    usados,
    restante,
    // Sin cupo (free) el porcentaje no significa nada; se devuelve 100 para que
    // la barra salga llena y no a medias.
    porcentaje: cupo > 0 ? Math.min(100, Math.round((usados / cupo) * 100)) : 100,
    agotado: cupo > 0 ? usados >= cupo : true,
    avisar: cupo > 0 && usados >= cupo * 0.8,
    desde: inicioDelMes().toISOString(),
  };
}
