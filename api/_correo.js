// api/_correo.js — la única puerta por la que salen los correos
//
// Había 24 sitios llamando a Resend a mano. Casi todos miraban si la respuesta
// venía bien... y no hacían nada con el resultado más que un `console.error`
// que no lee nadie. El 21-09-2026, con la cuota diaria agotada por una cuenta
// fraudulenta, Resend estuvo rechazando TODO durante horas: los avisos de lead
// asignado, las notas de dirección, las invitaciones de equipo y las alertas
// de tareas se perdieron sin dejar rastro en ninguna parte.
//
// Lo que se envía por tandas —campañas, recordatorios— se reintenta solo y no
// se pierde. Lo que se manda una sola vez, no. Esos son los que hay que ver.
//
// Esta función devuelve **la misma `Response` que `fetch`**, a propósito: así
// todo el código que ya existía —`r.ok`, `r.json()`, `r.status`— sigue
// funcionando igual y lo único que cambia es que el fallo queda registrado.

import { registrarError } from './_registro-errores.js';

const RESEND = 'https://api.resend.com/emails';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── La cuota del día ────────────────────────────────────────────────────────
//
// El 21-09-2026 una cuenta creada tres horas antes mandó 200 correos y dejó a
// TODA la plataforma sin correo el resto del día: el tope del proveedor es
// diario y es de la cuenta entera, no de cada cliente. Las confirmaciones de
// reserva, los avisos de lead asignado y el resumen de tareas de todos los
// demás se cayeron por una campaña ajena.
//
// El cupo por plan que ya existía es MENSUAL y por cliente: no protege de esto.
// Por eso se cuenta aquí, en la única puerta por la que salen los correos.
//
// El tope va en una variable de entorno porque cambia el día que se sube el
// plan de Resend, y un número escondido en el código no se sube nunca.
// Se leen en CADA llamada, no al cargar el módulo: así cambiar la variable en
// Vercel surte efecto sin volver a desplegar, y una prueba puede mover el tope
// sin reimportar medio mundo.
export const topeDia = () => Number(process.env.EMAIL_TOPE_DIARIO || 100);
// Lo que NUNCA se le presta a una campaña. Una confirmación de cita que no sale
// le rompe el día a una persona que ya se movió de su casa; un correo de
// campaña que sale mañana no se lo rompe a nadie.
export const reservaTransaccional = () => Number(process.env.EMAIL_RESERVA || 40);

/** Cuántos van hoy, en total y por cuenta. No lanza: sin esto no se bloquea. */
export async function cuotaDeHoy() {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/email_cuota?dia=eq.${hoy}&select=enviados,por_cuenta&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!r.ok) return null;
    const f = (await r.json())?.[0];
    return { enviados: f?.enviados || 0, porCuenta: f?.por_cuenta || {} };
  } catch { return null; }
}

/**
 * Cuántos correos de CAMPAÑA caben todavía hoy, para esta cuenta.
 *
 * Devuelve null si no se pudo consultar. Quien llama decide: aquí NO se decide
 * bloquear a ciegas, porque quedarse sin mandar nada por una consulta caída es
 * peor que pasarse un poco del tope.
 */
export async function huecoParaCampana(userId) {
  const c = await cuotaDeHoy();
  if (!c) return null;
  const paraCampanas = Math.max(0, topeDia() - reservaTransaccional());
  // Ninguna cuenta se lleva más de la mitad de lo que queda para campañas: con
  // dos clientes grandes el primero ya no deja al segundo sin nada.
  const porCuenta = Math.max(1, Math.floor(paraCampanas / 2));
  const usadosCuenta = Number(c.porCuenta?.[userId] || 0);
  return Math.max(0, Math.min(paraCampanas - c.enviados, porCuenta - usadosCuenta));
}

/** Apunta lo que SÍ salió. Nunca estorba al envío: se lanza y se olvida. */
function apuntar(cuantos, usuario) {
  if (!cuantos || !SUPABASE_URL) return;
  fetch(`${SUPABASE_URL}/rest/v1/rpc/contar_correos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ p_cuantos: cuantos, p_cuenta: usuario || null }),
  }).catch(() => {});
}

// El registro de errores separa por origen y la pantalla agrupa por ahí. Un
// cron y un endpoint fallan por motivos distintos y se miran en momentos
// distintos, así que se deduce del nombre en vez de pedirlo en cada llamada.
function origenDe(donde) {
  return String(donde || '').startsWith('cron-') ? 'cron' : 'api';
}

// A quién iba. Es lo primero que se pregunta uno al ver el fallo: no es lo
// mismo que se caiga un aviso interno que la invitación de un cliente nuevo.
function paraQuien(init) {
  try {
    const cuerpo = JSON.parse(init?.body || '{}');
    const lista = [].concat(cuerpo.to || []);
    const asunto = cuerpo.subject ? ` · «${String(cuerpo.subject).slice(0, 80)}»` : '';
    return (lista.length > 3 ? `${lista.length} destinatarios` : lista.join(', ')) + asunto;
  } catch { return ''; }
}

async function mandar(ruta, donde, init, usuario, cuantos) {
  let r;
  try {
    r = await fetch(ruta, init);
  } catch (e) {
    // Ni siquiera se llegó a Resend. Esto sí que no lo veía nadie.
    await registrarError({
      origen: origenDe(donde), donde: 'correo/' + donde, usuario,
      error: 'no se pudo contactar con Resend: ' + (e?.message || e),
      detalle: paraQuien(init),
    });
    throw e;
  }
  if (!r.ok) {
    let motivo = '';
    // `clone()` porque leer el cuerpo lo consume, y quien llamó puede querer
    // leerlo después. Sin esto le llegaría una respuesta vacía.
    try { motivo = (await r.clone().text()).slice(0, 300); } catch {}
    await registrarError({
      origen: origenDe(donde), donde: 'correo/' + donde, usuario,
      error: `Resend ${r.status}: ${motivo}`,
      detalle: paraQuien(init),
    });
  }
  // Solo se cuenta lo que Resend aceptó: un 429 no gasta cuota, y contarlo
  // haría que el tope se cerrara solo por haberlo intentado.
  if (r.ok) apuntar(cuantos == null ? 1 : cuantos, usuario);
  return r;
}

/** Un correo. Devuelve la misma Response que `fetch`. */
export async function enviarResend(donde, init, usuario) {
  return mandar(RESEND, donde, init, usuario, 1);
}

/** Hasta 100 de golpe por el endpoint de lotes. Misma Response. */
export async function enviarResendLote(donde, init, usuario) {
  let cuantos = 1;
  try { cuantos = JSON.parse(init?.body || '[]').length || 1; } catch {}
  return mandar(RESEND + '/batch', donde, init, usuario, cuantos);
}
