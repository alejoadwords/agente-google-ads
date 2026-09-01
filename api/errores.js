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
async function quien(req, cuerpo) {
  try {
    // sendBeacon no permite cabeceras, así que al cerrar la pestaña el token
    // viaja en el cuerpo. Sin esto, los errores del último momento —justo los
    // que preceden a que alguien cierre la app enfadado— se perdían.
    const t = (req.headers.get('Authorization') || '').replace('Bearer ', '') || String(cuerpo?.t || '');
    const partes = t.split('.');
    if (partes.length !== 3) return null;
    const [hB64, pB64, sB64] = partes;
    const bin = x => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const txt = x => new TextDecoder().decode(bin(x));
    const cabecera = JSON.parse(txt(hB64));
    if (!_jwks || _jwksExp < Date.now()) {
      _jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
      _jwksExp = Date.now() + 600000;
    }
    const clave = _jwks.keys?.find(k => k.kid === cabecera.kid);
    if (!clave) return null;
    const ck = await crypto.subtle.importKey('jwk', clave, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, bin(sB64), new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const j = JSON.parse(txt(pB64));
    if (j.exp && j.exp < Math.floor(Date.now() / 1000)) return null;
    return j.sub || null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); } catch { return new Response('{}', { status: 400, headers: CORS }); }

  const usuario = await quien(req, body);
  if (!usuario) return new Response(JSON.stringify({ error: 'No autorizado.' }), { status: 401, headers: CORS });

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
