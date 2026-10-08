// api/_cupo-seo.js — cupo mensual del Proyecto SEO: posiciones (Serper) y GEO (4 IAs).
//
// Hasta el 08-10-2026 «Consultar IAs ahora» hacía hasta 40 llamadas de pago por
// clic (10 preguntas × 4 motores) sin tope y sin dejar rastro, y «Actualizar
// posiciones» igual contra Serper. Antes de promocionar el módulo había que
// cerrarlo como el resto de puertas de gasto: el cupo vive en `ai_usage`, que es
// la misma tabla que dice cuánto cuesta cada cuenta. Un solo contador.
//
// Las unidades son las que cuestan dinero:
//   geo        → una llamada a UNA IA. Un reporte de 10 preguntas con 4 motores son 40.
//   posiciones → una keyword consultada en Google (2 créditos de Serper).
//
// Las llamadas que fallan se registran con su propio origen (`…-fallida`) y
// costo cero: quedan a la vista para nosotros pero no le gastan cupo a un
// cliente por una caída del proveedor.

import { inicioDelMes } from './_cupo-agente.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const ORIGEN_SEO = { geo: 'geo', posiciones: 'seo-posiciones' };

// Techo mensual por plan. Como el de imágenes, es un freno de emergencia y no
// un límite comercial: cubre varios reportes completos al mes por proyecto.
// Costo aproximado al tope: Pro ≈ 1,8 USD/mes, Agency ≈ 10 USD/mes.
// 'admin' es el bypass del equipo: recibe lo de Agency.
// Los alias 'individual' y 'agencia' son nombres históricos de Clerk.
export const CUPOS_SEO = {
  geo:        { free: 0, trial: 80,  pro: 200, individual: 200, agency: 1000, agencia: 1000, admin: 1000 },
  posiciones: { free: 0, trial: 150, pro: 500, individual: 500, agency: 3000, agencia: 3000, admin: 3000 },
};

// Un plan leído pero desconocido recibe el de Pro, no cero: un dato nuestro mal
// escrito en Clerk no puede dejar sin servicio a quien paga.
export function cupoSeo(tipo, plan) {
  const tabla = CUPOS_SEO[tipo];
  const p = String(plan || '').toLowerCase().trim();
  return tabla[p] !== undefined ? tabla[p] : tabla.pro;
}

const sb = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` });

// A qué cuenta se imputa: la del dueño, no la del miembro que pulsó el botón.
export async function cuentaDe(actorId) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(actorId)}` +
      `&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
    const tw = r.ok ? (await r.json())?.[0] : null;
    return tw?.owner_user_id || actorId;
  } catch { return actorId; }
}

// Cuántas unidades lleva la cuenta este mes (hora de Colombia).
// null = no se pudo contar. Quien llame NO debe tratarlo como cero.
export async function usadosSeo(cuenta, tipo) {
  if (!cuenta) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${encodeURIComponent(cuenta)}` +
      `&origen=eq.${encodeURIComponent(ORIGEN_SEO[tipo])}` +
      `&created_at=gte.${encodeURIComponent(inicioDelMes().toISOString())}&select=id&limit=0`,
      { headers: { ...sb(), Prefer: 'count=exact' } });
    if (!r.ok) return null;
    const total = parseInt((r.headers.get('content-range') || '').split('/')[1], 10);
    return Number.isFinite(total) ? total : null;
  } catch { return null; }
}

// Lo que pinta la pantalla. `error: true` cuando no se pudo contar: la
// pantalla debe decir «no se pudo consultar», nunca «te quedan 200».
export async function estadoSeo(cuenta, tipo, plan) {
  const cupo = cupoSeo(tipo, plan);
  const usados = await usadosSeo(cuenta, tipo);
  if (usados === null) return { error: true, cupo };
  return { cupo, usados, restante: Math.max(0, cupo - usados) };
}

/**
 * Apunta llamadas en ai_usage. Una fila por llamada.
 * filas: [{ ok, detalle, costo, tokensIn, tokensOut }]
 * Nunca lanza: perder un registro es mejor que perder el resultado que el
 * cliente ya pagó con su cupo. Devuelve false si no se pudo guardar.
 */
export async function apuntarSeo({ cuenta, actorId, tipo, filas }) {
  if (!cuenta || !filas?.length) return true;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
      method: 'POST',
      headers: { ...sb(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(filas.map(f => ({
        user_id: cuenta,
        actor_id: actorId && actorId !== cuenta ? actorId : null,
        origen: f.ok ? ORIGEN_SEO[tipo] : ORIGEN_SEO[tipo] + '-fallida',
        agente: f.detalle || null,
        modelo: f.detalle || null,
        tokens_in: f.tokensIn || 0, tokens_out: f.tokensOut || 0, cache_write: 0, cache_read: 0,
        costo: f.ok ? Number((f.costo || 0).toFixed(6)) : 0,
      }))),
    });
    if (!r.ok) console.error('apuntarSeo: HTTP', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) {
    console.error('apuntarSeo:', e?.message);
    return false;
  }
}
