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

async function mandar(ruta, donde, init, usuario) {
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
  return r;
}

/** Un correo. Devuelve la misma Response que `fetch`. */
export async function enviarResend(donde, init, usuario) {
  return mandar(RESEND, donde, init, usuario);
}

/** Hasta 100 de golpe por el endpoint de lotes. Misma Response. */
export async function enviarResendLote(donde, init, usuario) {
  return mandar(RESEND + '/batch', donde, init, usuario);
}
