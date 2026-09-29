// api/_enlace-calendario.js
// El enlace con el que una persona conecta SU Google Calendar a las reservas.
//
// Lo crea el administrador desde Reservas → Quién atiende, y lo puede abrir él
// mismo o mandárselo a Ana para que lo abra desde su móvil: Ana no necesita
// cuenta en Acuarius, solo su Google. Por eso el enlace va firmado y no se fía
// de nada que venga en la URL: lo que dice de qué cuenta y de qué recurso es,
// lo dice la firma.
//
// Mismo esquema que api/_enlace-probar.js, con un prefijo propio en los datos
// firmados: un enlace de probar un agente no sirve aquí ni al revés.

const LINK_SECRET = process.env.LINK_SECRET || process.env.CRON_SECRET || '';
const PREFIJO = 'cal';

// Una semana: lo justo para que Ana lo abra cuando pueda. Si caduca, el
// administrador saca otro con un clic; un enlace que conecta calendarios no
// debería quedar vivo en un chat para siempre.
export const DIAS_ENLACE_CALENDARIO = 7;

async function firmar(datos) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(LINK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(datos));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function crearEnlaceCalendario(userId, resourceId, dias = DIAS_ENLACE_CALENDARIO) {
  if (!LINK_SECRET || !userId || !resourceId) return null;
  const caduca = Date.now() + dias * 86400000;
  const datos = [PREFIJO, userId, resourceId, caduca].join('|');
  return encodeURIComponent(datos) + '.' + (await firmar(datos));
}

/** Los campos firmados, o null si la firma no cuadra. */
async function abrir(t) {
  if (!LINK_SECRET) return null;
  const i = String(t || '').lastIndexOf('.');
  if (i < 0) return null;
  let datos;
  try { datos = decodeURIComponent(String(t).slice(0, i)); } catch { return null; }
  const firma = String(t).slice(i + 1);

  const esperada = await firmar(datos);
  if (firma.length !== esperada.length) return null;
  let dif = 0;
  for (let k = 0; k < firma.length; k++) dif |= firma.charCodeAt(k) ^ esperada.charCodeAt(k);
  if (dif !== 0) return null;
  return datos.split('|');
}

/** { userId, resourceId } si vale; { caducado: true } si ya no; null si es falso. */
export async function abrirEnlaceCalendario(t) {
  const partes = await abrir(t);
  if (!partes) return null;
  const [prefijo, userId, resourceId, caduca] = partes;
  if (prefijo !== PREFIJO || !userId || !resourceId) return null;
  // La caducidad, DESPUÉS de la firma: al revés, un enlace con la fecha
  // manipulada se rechazaría por viejo y no por falso.
  if (!(Number(caduca) > Date.now())) return { caducado: true };
  return { userId, resourceId };
}

// ── La conexión de la CUENTA (Agenda) y la de YouTube ───────────────────────
//
// Antes el OAuth de la cuenta se fiaba del `userId` que venía en la URL: quien
// conociera el id de otra cuenta podía colgarle SU Google, y desde ese momento
// las reuniones de la Agenda y las reservas —con nombre, teléfono y correo del
// cliente— se escribían en el calendario del atacante. Ahora el usuario sale
// de la firma, y la firma solo la da un endpoint con sesión (api/gcal-enlace.js)
// o, para YouTube, quien tiene la clave del servidor (tools/enlace-youtube.mjs).
//
// Media hora: el enlace se usa en el acto, redirigiendo a Google. No tiene por
// qué sobrevivir en el historial del navegador.
export const MINUTOS_ENLACE_CUENTA = 30;
// `meta` es la conexión de Meta Ads: mismo agujero, mismo arreglo, y peor —ese
// token GESTIONA ANUNCIOS—.
// `google` (Google Ads) y `linkedin`: mismo agujero —el userId en la URL— y el de
// Google peor, porque su callback devolvía también el refresh_token en la URL.
const PREFIJO_CUENTA = { calendario: 'cuenta-cal', youtube: 'cuenta-yt', meta: 'cuenta-meta', google: 'cuenta-gads', linkedin: 'cuenta-li' };

export async function crearEnlaceCuenta(userId, para, minutos = MINUTOS_ENLACE_CUENTA) {
  const prefijo = PREFIJO_CUENTA[para];
  if (!LINK_SECRET || !userId || !prefijo) return null;
  const datos = [prefijo, userId, Date.now() + minutos * 60000].join('|');
  return encodeURIComponent(datos) + '.' + (await firmar(datos));
}

/**
 * { userId } si vale PARA ESO; { caducado: true } si ya no; null si es falso.
 * Un enlace de YouTube no conecta un calendario ni al revés: cada uno guarda
 * sus tokens en una plataforma distinta.
 */
export async function abrirEnlaceCuenta(t, para) {
  const partes = await abrir(t);
  if (!partes) return null;
  const [prefijo, userId, caduca] = partes;
  if (!PREFIJO_CUENTA[para] || prefijo !== PREFIJO_CUENTA[para] || !userId || partes.length !== 3) return null;
  if (!(Number(caduca) > Date.now())) return { caducado: true };
  return { userId };
}

// ── WhatsApp ────────────────────────────────────────────────────────────────
// Igual que la cuenta, pero la firma lleva también a QUÉ agente y a QUÉ cliente
// va el número: antes los tres viajaban sueltos en la URL, y con cambiarlos se
// colgaba un WhatsApp ajeno en tu cuenta —o el tuyo en la de otro—.
const PREFIJO_WA = 'cuenta-wa';
const limpio = (x) => String(x || '').replace(/\|/g, '');

export async function crearEnlaceWhatsapp(userId, agentId, clientId, minutos = MINUTOS_ENLACE_CUENTA) {
  if (!LINK_SECRET || !userId) return null;
  const datos = [PREFIJO_WA, limpio(userId), Date.now() + minutos * 60000, limpio(agentId), limpio(clientId)].join('|');
  return encodeURIComponent(datos) + '.' + (await firmar(datos));
}

/** { userId, agentId, clientId } si vale; { caducado: true } si ya no; null si es falso. */
export async function abrirEnlaceWhatsapp(t) {
  const partes = await abrir(t);
  if (!partes || partes.length !== 5) return null;
  const [prefijo, userId, caduca, agentId, clientId] = partes;
  if (prefijo !== PREFIJO_WA || !userId) return null;
  if (!(Number(caduca) > Date.now())) return { caducado: true };
  return { userId, agentId: agentId || '', clientId: clientId || '' };
}
