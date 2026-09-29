// api/gcal-enlace.js — el enlace firmado para conectar el Google Calendar de la
// cuenta (el de la Agenda) y, con ?para=meta, Meta Ads.
//
// Antes el navegador iba directo a /api/gcal-auth?userId=…, y ese userId se
// guardaba tal cual: cualquiera que conociera el id de otra cuenta podía
// conectarle su propio Google y recibir sus reuniones y reservas. Ahora el
// usuario lo decide la SESIÓN, aquí, y viaja firmado hasta el callback.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, normalizarPerfil } from './_perfiles.js';
import { crearEnlaceCuenta } from './_enlace-calendario.js';

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'gcal-enlace'), 401);

  let quien;
  try { quien = await quienPregunta(sesion.id); }
  catch (e) {
    if (e?.suspendida) return json({ error: e.message, suspendida: true }, 403);
    return json({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  // El calendario es el de la CUENTA: ahí se escriben las reuniones y las
  // reservas de todo el equipo. Colgarle el Google de alguien es decisión de
  // quien la administra. Antes un miembro podía «conectarlo» y quedaba
  // guardado a su nombre, donde la Agenda no lo buscaba nunca.
  const admin = quien.esDueno || normalizarPerfil(quien.perfil) === 'admin';
  if (!admin) {
    const esMeta = new URL(req.url).searchParams.get('para') === 'meta';
    return json({ error: esMeta
      ? 'Solo el administrador de la cuenta conecta Meta Ads.'
      : 'Solo el administrador de la cuenta conecta el Google Calendar de la Agenda.' }, 403);
  }

  // ?para=meta: el mismo enlace firmado para conectar Meta Ads. Mismo criterio
  // —lo decide la sesión, a nombre de la cuenta, solo un administrador—.
  const para = new URL(req.url).searchParams.get('para') === 'meta' ? 'meta' : 'calendario';
  const t = await crearEnlaceCuenta(quien.userId, para);
  if (!t) return json({ error: 'Falta la clave para firmar enlaces en el servidor.' }, 500);
  return json({ url: (para === 'meta' ? '/api/meta-auth?c=' : '/api/gcal-auth?c=') + t });
}
