// api/_reglas-pauta.js — reglas automáticas con las métricas del CRM
//
// Bïrch, Madgicx u Optmyzr dejan escribir reglas sobre lo que reporta la red.
// Aquí la condición es lo que pasó en el CRM: el costo por lead que de verdad
// entró, el costo por venta ganada, o el gasto sin un solo lead. Es el punto 5
// del plan de pauta (03-10-2026).
//
// Lo que se puede hacer en la red es solo RESTAR: pausar o bajar un
// presupuesto (pauta.js, pausarEnRed / bajarPresupuestoEnRed). Nunca activar
// ni subir. Por defecto cada regla PROPONE y espera aprobación; ejecutar sola
// es una opción por regla.
//
// SOLO desde funciones edge (regla 2 de CLAUDE.md).

import { conexionesDe, traerCampanas, leadsDelPeriodo, unir, atribuirPorClic, pausarEnRed, bajarPresupuestoEnRed, conexionDePauta } from './pauta.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' en ' + ruta.split('?')[0]);
  return r.status === 204 ? null : r.json().catch(() => null);
}

const OBJETIVOS_SIN_LEADS = new Set(['OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'LINK_CLICKS', 'REACH', 'BRAND_AWARENESS', 'VIDEO_VIEWS', 'POST_ENGAGEMENT']);
// Una propuesta que nadie mira en 3 días ya no describe la cuenta de hoy.
export const DIAS_CADUCA = 3;

const activa = e => ['enabled', 'active'].includes(String(e || '').toLowerCase());
const plata = (n, m) => {
  try { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: m || 'COP', maximumFractionDigits: 0 }).format(n); }
  catch { return '$' + Math.round(n).toLocaleString('es-CO'); }
};
const NOMBRE_ACCION = { avisar: 'Avisar', pausar: 'Pausar', bajar_presupuesto: 'Bajar presupuesto' };
export function textoAccion(a) {
  return a.accion === 'bajar_presupuesto' ? 'Bajar el presupuesto un ' + a.porcentaje + ' %' : NOMBRE_ACCION[a.accion] || a.accion;
}

/**
 * ¿Qué campañas cumplen la condición de una regla? Pura, para probarla sola.
 * @param regla   fila de reglas_pauta
 * @param campanas [{ red, id, nombre, estado, objetivo, moneda, inv, leads, ganados, conexion_id }]
 * @returns [{ campana, motivo }]
 */
export function evaluarRegla(regla, campanas) {
  const out = [];
  for (const c of campanas) {
    if (!activa(c.estado)) continue;                        // lo pausado ya no gasta
    if (c.dudoso) continue;                                 // sin saber de qué campaña es cada lead, no se juzga
    if (regla.red !== 'todas' && c.red !== regla.red) continue;
    if (regla.campana_id && String(regla.campana_id) !== String(c.id)) continue;
    const buscaLeads = !(c.red === 'meta' && OBJETIVOS_SIN_LEADS.has(String(c.objetivo || '').toUpperCase()));
    const u = Number(regla.umbral);
    const enDias = ' en los últimos ' + regla.dias + ' días';
    let motivo = null;
    if (regla.metrica === 'cpl_real' && buscaLeads) {
      if (c.leads > 0 && c.inv / c.leads > u) {
        motivo = 'Costo por lead real de ' + plata(c.inv / c.leads, c.moneda) + enDias + ' (' + c.leads + (c.leads === 1 ? ' lead' : ' leads') + '). Tu límite: ' + plata(u, c.moneda) + '.';
      } else if (!c.leads && c.inv > u) {
        motivo = 'Gastó ' + plata(c.inv, c.moneda) + enDias + ' sin traer ningún lead al CRM. Tu límite por lead: ' + plata(u, c.moneda) + '.';
      }
    } else if (regla.metrica === 'costo_venta') {
      if (c.ganados > 0 && c.inv / c.ganados > u) {
        motivo = 'Costo por venta de ' + plata(c.inv / c.ganados, c.moneda) + enDias + ' (' + c.ganados + (c.ganados === 1 ? ' venta' : ' ventas') + '). Tu límite: ' + plata(u, c.moneda) + '.';
      } else if (!c.ganados && c.inv > u) {
        motivo = 'Gastó ' + plata(c.inv, c.moneda) + enDias + ' sin ninguna venta ganada. Tu límite por venta: ' + plata(u, c.moneda) + '.';
      }
    } else if (regla.metrica === 'gasto_sin_leads' && buscaLeads) {
      if (!c.leads && c.inv >= u) motivo = 'Gastó ' + plata(c.inv, c.moneda) + enDias + ' sin traer ningún lead al CRM. Tu límite: ' + plata(u, c.moneda) + '.';
    }
    // Leads que entraron sin dato de campaña podrían ser de esta: decirlo, para
    // que quien aprueba sepa que el «sin leads» puede no ser del todo cierto.
    if (motivo && c.huerfanos > 0) motivo += ' Ojo: ' + c.huerfanos + (c.huerfanos === 1 ? ' lead del periodo entró' : ' leads del periodo entraron') + ' sin dato de campaña.';
    if (motivo) out.push({ campana: c, motivo });
  }
  return out;
}

function rango(dias, ahora = new Date()) {
  // Hasta AYER, en hora de Colombia: hoy está a medias y castigaría a todas.
  const f = (d) => new Date(d.getTime() - 5 * 3600000).toISOString().slice(0, 10);
  return { desde: f(new Date(ahora - dias * 86400000)), hasta: f(new Date(ahora - 86400000)) };
}

/** Las campañas de la cuenta en una ventana, con sus leads, ventas y conexión. */
async function campanasDeVentana(userId, conexiones, dias) {
  const { desde, hasta } = rango(dias);
  const [res, leads] = await Promise.all([
    traerCampanas(conexiones, desde, hasta),
    leadsDelPeriodo(userId, null, desde, hasta, null),
  ]);
  // Los leads de Google que solo traen el gclid no casan con su campaña hasta
  // preguntarle a Google. Sin esto, una campaña que sí trae leads parecería
  // «gastó sin leads» y la regla propondría pausarla.
  const porClic = await atribuirPorClic(conexiones, leads);
  const googleDudoso = !!(porClic && (porClic.error || porClic.pendientes > 0));
  const deConexion = new Map();
  for (const r of res) for (const f of r.filas) deConexion.set(f.red + ':' + f.id, r.conexion);
  const { filas, huerfanos } = unir(res.flatMap(r => r.filas), leads);
  return filas.map(f => {
    const con = deConexion.get(f.red + ':' + f.id);
    return { red: f.red, id: f.id, nombre: f.nombre, estado: f.estado, objetivo: f.objetivo, moneda: f.moneda,
      inv: f.inversion || 0, leads: f.crm?.leads || 0, ganados: f.crm?.ganados || 0,
      dudoso: f.red === 'google' && googleDudoso, huerfanos: huerfanos.length,
      conexion_id: con?.id || null, client_id: con?.client_id || null };
  });
}

/**
 * Toma una propuesta para ejecutarla. Atómico: solo una petición pasa de
 * «propuesta» a «en curso», así un doble clic o dos pestañas no bajan el
 * presupuesto dos veces. Devuelve la fila, o null si ya la decidió alguien.
 */
export async function reclamar(userId, id, nuevoEstado = 'en_curso', decididaPor = null) {
  const cambio = { estado: nuevoEstado };
  if (nuevoEstado !== 'en_curso') { cambio.decidida_por = decididaPor; cambio.decidida_at = new Date().toISOString(); }
  const filas = await sb(`/acciones_pauta?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&estado=eq.propuesta`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=representation' }), body: JSON.stringify(cambio),
  });
  return (filas && filas[0]) || null;
}

/** Qué tocaría hoy una regla, sin guardar nada: para verla antes de activarla. */
export async function vistaPrevia(userId, regla) {
  const conexiones = (await conexionesDe(userId, null, true)).filter(c => c.account_id);
  if (!conexiones.length) return [];
  const campanas = (await campanasDeVentana(userId, conexiones, regla.dias))
    .filter(c => !regla.client_id || c.client_id === regla.client_id);
  return evaluarRegla(regla, campanas).map(h => ({ red: h.campana.red, campana_id: h.campana.id, campana: h.campana.nombre, motivo: h.motivo }));
}

/** Ejecuta una acción guardada. Escribe el resultado en su fila. */
export async function ejecutarAccion(a, decididaPor) {
  let r;
  try {
    const fila = await conexionDePauta(a.user_id, a.conexion_id);
    if (!fila) r = { error: 'La conexión de esta cuenta publicitaria ya no existe.' };
    else if (a.accion === 'pausar') r = await pausarEnRed(fila, a.campana_id);
    else if (a.accion === 'bajar_presupuesto') r = await bajarPresupuestoEnRed(fila, a.campana_id, a.porcentaje);
    else r = { error: 'Acción desconocida' };
  } catch (e) { r = { error: String(e?.message || e).slice(0, 200) }; }
  const cambio = {
    estado: r.ok ? 'ejecutada' : 'fallida',
    resultado: r.ok
      ? (a.accion === 'pausar' ? 'Campaña pausada.' : 'Presupuesto diario de ' + r.antes.toLocaleString('es-CO') + ' a ' + r.despues.toLocaleString('es-CO') + '.')
      : r.error,
    decidida_por: decididaPor, decidida_at: new Date().toISOString(),
  };
  await sb(`/acciones_pauta?id=eq.${encodeURIComponent(a.id)}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(cambio) });
  return { ...a, ...cambio };
}

/**
 * Evalúa todas las reglas activas de una cuenta. Crea propuestas (o ejecuta
 * las automáticas) y devuelve lo nuevo, para el correo de la mañana.
 */
export async function evaluarCuenta(userId) {
  const reglas = await sb(`/reglas_pauta?user_id=eq.${encodeURIComponent(userId)}&activa=eq.true&select=*`) || [];
  if (!reglas.length) return [];
  // Las propuestas que nadie atendió caducan: describen una cuenta que ya cambió.
  const corte = new Date(Date.now() - DIAS_CADUCA * 86400000).toISOString();
  await sb(`/acciones_pauta?user_id=eq.${encodeURIComponent(userId)}&estado=eq.propuesta&created_at=lt.${encodeURIComponent(corte)}`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify({ estado: 'caducada' }),
  });
  // Una que quedó «en curso» más de una hora es una ejecución que se cortó a
  // medias: no se sabe si llegó a la red, y se dice así en vez de dejarla colgada.
  const hora = new Date(Date.now() - 3600000).toISOString();
  await sb(`/acciones_pauta?user_id=eq.${encodeURIComponent(userId)}&estado=eq.en_curso&created_at=lt.${encodeURIComponent(hora)}`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ estado: 'fallida', resultado: 'Se cortó a mitad del cambio: revisa la campaña en el administrador de anuncios.' }),
  });
  const conexiones = (await conexionesDe(userId, null, true)).filter(c => c.account_id);
  if (!conexiones.length) return [];
  const porDias = new Map();
  const nuevas = [];
  for (const regla of reglas) {
    if (!porDias.has(regla.dias)) porDias.set(regla.dias, await campanasDeVentana(userId, conexiones, regla.dias));
    // Una regla de un cliente solo mira las cuentas de ese cliente.
    const campanas = porDias.get(regla.dias).filter(c => !regla.client_id || c.client_id === regla.client_id);
    const hits = evaluarRegla(regla, campanas);
    if (!hits.length) continue;
    // No repetir: ni otra propuesta abierta para lo mismo, ni volver a actuar
    // dentro de la misma ventana de días.
    const desde = new Date(Date.now() - regla.dias * 86400000).toISOString();
    const previas = await sb(`/acciones_pauta?regla_id=eq.${regla.id}&or=(estado.eq.propuesta,created_at.gte.${encodeURIComponent(desde)})&select=campana_id,estado`) || [];
    const ya = new Set(previas.filter(p => p.estado !== 'fallida').map(p => String(p.campana_id)));
    for (const h of hits) {
      if (ya.has(String(h.campana.id)) || !h.campana.conexion_id) continue;
      const fila = {
        // El cliente sale de la regla o, si es de toda la cuenta, de la cuenta
        // publicitaria: así un miembro acotado a ese cliente la ve y la decide.
        user_id: userId, client_id: regla.client_id || h.campana.client_id || null, regla_id: regla.id, regla: regla.nombre,
        red: h.campana.red, conexion_id: h.campana.conexion_id, campana_id: String(h.campana.id), campana: h.campana.nombre,
        accion: regla.accion, porcentaje: regla.accion === 'bajar_presupuesto' ? regla.porcentaje : null, motivo: h.motivo,
        // Una automática nace «en curso»: nadie puede aprobarla a la vez.
        estado: regla.accion === 'avisar' ? 'avisada' : (regla.modo === 'auto' ? 'en_curso' : 'propuesta'),
      };
      const [creada] = await sb('/acciones_pauta', { method: 'POST', headers: sbH({ Prefer: 'return=representation' }), body: JSON.stringify(fila) }) || [];
      if (!creada) continue;
      nuevas.push(regla.modo === 'auto' && regla.accion !== 'avisar'
        ? await ejecutarAccion(creada, 'regla automática')
        : creada);
    }
  }
  return nuevas;
}
