// api/_sesion.js — verificar el token de Clerk diciendo POR QUÉ falla
//
// Los 65 endpoints llevan cada uno su copia de `getUserId`, y todas terminan
// igual: `catch { return null; }` → 401 «No autorizado». Al usuario le llega
// una frase que suena a «no tienes permiso» y a nosotros no nos llega nada.
//
// El 28-09-2026 «Plataformas de pauta» le salía «No autorizado» a la cuenta
// principal, con sesión abierta y el resto de la aplicación funcionando. Con
// ese 401 mudo no hay forma de saber cuál de estas cinco cosas pasó:
//
//   1. la petición llegó sin cabecera `Authorization`;
//   2. el token no tiene forma de JWT;
//   3. Clerk no nos dio las llaves, o no está la que firmó este token;
//   4. la firma no cuadra;
//   5. el token venció.
//
// Son cinco problemas con cinco arreglos distintos, y el quinto —el más
// probable y el único que el usuario puede resolver solo— merece un mensaje
// propio: «vuelve a entrar» en vez de «no autorizado».
//
// Esto NO cambia quién entra: lo que se aceptaba se sigue aceptando y lo que
// se rechazaba se sigue rechazando. Solo deja de ser mudo.

const JWKS = 'https://clerk.acuarius.app/.well-known/jwks.json';

const b64 = (s) => atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));

/**
 * @returns {{id: string|null, motivo: string|null, vencida: boolean}}
 *   `id` es el `sub` de Clerk cuando el token es bueno. Si no, `motivo` dice
 *   qué pasó —para el registro del servidor, nunca para el navegador— y
 *   `vencida` distingue el caso que el usuario arregla volviendo a entrar.
 */
export async function verificarSesion(req) {
  const mal = (motivo, vencida) => ({ id: null, motivo, vencida: !!vencida });

  const auth = req.headers.get('Authorization');
  // Sin cabecera NO es un fallo que investigar: es una petición sin sesión, y
  // de esas llegan solas. Se distingue para no llenar el registro de ruido.
  if (!auth) return mal('sin cabecera Authorization');
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return mal('la cabecera Authorization venía vacía');

  const partes = token.split('.');
  if (partes.length !== 3) return mal('el token no tiene tres partes, tiene ' + partes.length);
  const [hB64, pB64, sB64] = partes;

  let header;
  try { header = JSON.parse(b64(hB64)); }
  catch (e) { return mal('la cabecera del token no se pudo leer: ' + (e && e.message)); }

  // El payload ANTES de verificar la firma, solo para poder decir que venció.
  // Un token vencido tiene la firma perfectamente buena, así que si se
  // comprueba en el orden contrario el caso más común queda sin nombre.
  let payload = null;
  try { payload = JSON.parse(b64(pB64)); } catch (e) { /* lo dirá la firma */ }
  if (payload && payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    const hace = Math.round(Date.now() / 1000 - payload.exp);
    return mal('el token venció hace ' + hace + ' s', true);
  }

  let jwks;
  try {
    const r = await fetch(JWKS);
    if (!r.ok) return mal('Clerk devolvió ' + r.status + ' al pedirle las llaves');
    jwks = await r.json();
  } catch (e) {
    // Este es el que más rabia da: el token es bueno y aun así se rechaza,
    // porque no pudimos preguntar. Sin este mensaje parece un permiso.
    return mal('no se pudieron traer las llaves de Clerk: ' + (e && e.message));
  }

  const key = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!key) {
    return mal('ninguna llave de Clerk tiene el kid ' + header.kid
      + ' (hay ' + (jwks.keys || []).length + ')');
  }

  try {
    const ck = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(b64(sB64), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', ck, sig, new TextEncoder().encode(hB64 + '.' + pB64));
    if (!ok) return mal('la firma no cuadra con la llave ' + header.kid);
  } catch (e) {
    return mal('no se pudo comprobar la firma: ' + (e && e.message));
  }

  if (!payload) return mal('el contenido del token no se pudo leer');
  if (!payload.sub) return mal('el token no trae `sub`');
  return { id: payload.sub, motivo: null, vencida: false };
}

/**
 * La respuesta al navegador cuando no hay sesión, y la anotación al registro.
 *
 * Al usuario NO se le cuenta la criptografía: se le dice lo único que puede
 * hacer. El motivo real se guarda del lado del servidor, que es donde hace
 * falta tres horas después.
 */
export async function respuestaSinSesion({ motivo, vencida }, donde, cabeceras) {
  // La petición sin cabecera no se anota: es ruido, no un fallo.
  if (motivo && motivo !== 'sin cabecera Authorization') {
    try {
      const { registrarError } = await import('./_registro-errores.js');
      await registrarError({
        origen: 'api', donde: donde + '/sesion',
        error: new Error('se rechazó una sesión: ' + motivo),
      });
    } catch { /* que no se pueda anotar no puede tumbar la respuesta */ }
  }
  const cuerpo = vencida
    ? { error: 'Tu sesión venció. Vuelve a entrar para seguir.', sesion_vencida: true }
    : { error: 'No autorizado' };
  return new Response(JSON.stringify(cuerpo), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...(cabeceras || {}) },
  });
}
