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

// La cabecera, venga del runtime que venga.
//
// En edge `req.headers` es un `Headers` y se lee con `.get()`; en Node es un
// objeto plano con las claves en minúscula. Cada endpoint llevaba la forma de
// SU runtime escrita dentro, y por eso las doce funciones Node no podían usar
// este módulo. Se mira qué hay delante en vez de exigir una de las dos.
function cabecera(req, nombre) {
  const h = req && req.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(nombre);
  return h[nombre.toLowerCase()] || h[nombre] || null;
}

// Las llaves de Clerk, guardadas un rato.
//
// Antes cada endpoint se las pedía a Clerk en CADA petición, y al abrir una
// pantalla salen diez a la vez: diez viajes de ida y vuelta para nada, y diez
// oportunidades de que uno falle. Y cuando falla, el token es bueno y aun así
// se rechaza — uno de los cinco motivos que esto viene a distinguir.
//
// El peligro de cachear llaves es quedarse con las viejas cuando Clerk las
// rota: entonces se rechazarían tokens buenos hasta que caduque la caché. Por
// eso el corte no es solo el reloj — si el `kid` del token no está entre las
// guardadas, se vuelve a preguntar antes de rechazar a nadie.
let _llaves = null, _llavesHasta = 0;
async function llavesDeClerk(kid) {
  const frescas = _llaves && Date.now() < _llavesHasta;
  const tiene = frescas && (_llaves.keys || []).some(k => k.kid === kid);
  if (frescas && tiene) return _llaves;
  // Solo se llega aquí si no hay llaves guardadas, si caducaron, o si el `kid`
  // del token no está entre ellas. En ese último caso NO se vuelve a lo
  // guardado aunque esté fresco: diría «ninguna llave tiene ese kid», que
  // suena a token falso, cuando la verdad es que no pudimos preguntar. El
  // motivo exacto es justo lo que esto viene a dar.
  const r = await fetch(JWKS);
  if (!r.ok) {
    const e = new Error('Clerk devolvió ' + r.status + ' al pedirle las llaves');
    e.codigo = r.status;
    throw e;
  }
  _llaves = await r.json();
  _llavesHasta = Date.now() + 600000;   // diez minutos
  return _llaves;
}

/**
 * @returns {{id: string|null, motivo: string|null, vencida: boolean}}
 *   `id` es el `sub` de Clerk cuando el token es bueno. Si no, `motivo` dice
 *   qué pasó —para el registro del servidor, nunca para el navegador— y
 *   `vencida` distingue el caso que el usuario arregla volviendo a entrar.
 */
export async function verificarSesion(req, opciones) {
  const mal = (motivo, vencida) => ({ id: null, motivo, vencida: !!vencida });

  const auth = cabecera(req, 'Authorization');
  // `tokenAlterno` es para `api/errores.js`: `sendBeacon` no permite poner
  // cabeceras, así que al cerrar la pestaña el token viaja en el cuerpo. Sin
  // esa puerta se perderían los errores del último momento, que son justo los
  // que preceden a que alguien cierre la aplicación enfadado.
  const alterno = opciones && opciones.tokenAlterno;
  // Sin cabecera NO es un fallo que investigar: es una petición sin sesión, y
  // de esas llegan solas. Se distingue para no llenar el registro de ruido.
  if (!auth && !alterno) return mal('sin cabecera Authorization');
  const token = (auth ? auth.replace(/^Bearer\s+/i, '').trim() : '') || String(alterno || '').trim();
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
    jwks = await llavesDeClerk(header.kid);
  } catch (e) {
    // Este es el que más rabia da: el token es bueno y aun así se rechaza,
    // porque no pudimos preguntar. Sin este mensaje parece un permiso.
    return mal(e && e.codigo
      ? e.message
      : 'no se pudieron traer las llaves de Clerk: ' + (e && e.message));
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
 * El CUERPO de la respuesta cuando no hay sesión, y la anotación al registro.
 *
 * Devuelve el cuerpo en vez de la respuesta entera a propósito: cada endpoint
 * tiene su propio `jsonResp`, y varios de ellos añaden ahí sus cabeceras CORS
 * —los formularios públicos, el webhook de leads—. Si esto construyera la
 * `Response`, esos endpoints perderían sus cabeceras justo en el 401 y el
 * navegador vería un error de CORS en lugar del motivo. Se cambia el cuerpo y
 * no el sobre.
 *
 * Al usuario NO se le cuenta la criptografía: se le dice lo único que puede
 * hacer. El motivo real se guarda del lado del servidor, que es donde hace
 * falta tres horas después.
 */
export async function cuerpoSinSesion({ motivo, vencida }, donde) {
  // La petición sin cabecera no se anota: es ruido, no un fallo. Llegan solas
  // —un robot, una pestaña vieja— y anotarlas todas taparía las que importan.
  if (motivo && motivo !== 'sin cabecera Authorization') {
    try {
      const { registrarError } = await import('./_registro-errores.js');
      await registrarError({
        origen: 'api', donde: donde + '/sesion',
        error: new Error('se rechazó una sesión: ' + motivo),
      });
    } catch { /* que no se pueda anotar no puede tumbar la respuesta */ }
  }
  return vencida
    ? { error: 'Tu sesión venció. Vuelve a entrar para seguir.', sesion_vencida: true }
    : { error: 'No autorizado' };
}

/** Para el endpoint que no tiene un `jsonResp` propio. */
export async function respuestaSinSesion(sesion, donde, cabeceras) {
  return new Response(JSON.stringify(await cuerpoSinSesion(sesion, donde)), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...(cabeceras || {}) },
  });
}
