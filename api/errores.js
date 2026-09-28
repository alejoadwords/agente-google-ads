export const config = { runtime: 'edge' };

// api/errores.js
// Recibe los errores que ocurren en el NAVEGADOR del usuario.
//
// Es la mitad que más falta hacía: un TypeError dentro de un onclick muere en
// silencio —el botón simplemente no hace nada— y jamás llega a los logs del
// servidor. Así fue como el botón «Editar» de la ficha estuvo roto sin que
// nadie lo supiera.
//
// Pide sesión: si no, es un buzón abierto para que cualquiera nos llene la
// tabla. Y limita lo que acepta por petición, por lo mismo.

import { registrarError } from './_registro-errores.js';
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Se comprueba la FIRMA, no solo que el token tenga forma de token. Sin esto,
// cualquiera podría llenar la tabla de errores inventados: no robaría nada,
// pero llenaría el aviso de basura y en dos días dejaríamos de leerlo — que es
// exactamente el fallo que este sistema viene a evitar.
let _jwks = null, _jwksExp = 0;
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); } catch { return new Response('{}', { status: 400, headers: CORS }); }

  // El token puede llegar en el CUERPO: `sendBeacon` no permite cabeceras, y
  // sin esa puerta se perderían los errores del último momento —justo los que
  // preceden a que alguien cierre la aplicación enfadado—.
  const sesion = await verificarSesion(req, { tokenAlterno: body?.t });
  const usuario = sesion.id;
  if (!usuario) {
    return new Response(JSON.stringify(await cuerpoSinSesion(sesion, 'errores')),
      { status: 401, headers: CORS });
  }

  // Como mucho cinco por petición: el navegador ya los agrupa, y esto evita que
  // un bucle infinito en el cliente nos mande mil.
  const lista = (Array.isArray(body?.errores) ? body.errores : [body]).slice(0, 5);
  for (const e of lista) {
    if (!e?.mensaje) continue;
    await registrarError({
      origen: 'navegador',
      donde: String(e.donde || 'desconocido').slice(0, 120),
      error: String(e.mensaje).slice(0, 500),
      detalle: [e.traza, e.url].filter(Boolean).join('\n').slice(0, 4000),
      usuario,
    });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
