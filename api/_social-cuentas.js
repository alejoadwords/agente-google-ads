// api/_social-cuentas.js — las cuentas de Instagram y Facebook para publicar
//
// Antes esto no existía: el token de la página de Facebook se guardaba en el
// `localStorage` del navegador y se le mandaba al servidor en cada publicación.
// Tres problemas de golpe:
//
//   1. Un token de página de larga duración viviendo en el navegador. Cualquier
//      script que se colara en la página podía leerlo y publicar en nombre del
//      cliente.
//   2. La conexión se perdía al limpiar la caché o al cambiar de equipo, y el
//      resto del equipo no la veía.
//   3. `social-publish` aceptaba CUALQUIER token que le mandaran, sin sesión:
//      era un proxy abierto a la API de Facebook con nuestra IP.
//
// Ahora el token vive cifrado en `social_connections` y nunca sale de aquí: el
// navegador elige una cuenta por su id de página y el servidor busca el token.

import { cifrar, descifrar } from './_cifrado.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SECRETO = process.env.LINK_SECRET || process.env.CRON_SECRET || '';

// El ticket dura poco: es solo el tiempo de ir a Facebook y volver.
const VIDA_TICKET = 15 * 60 * 1000;

function cabeceras(prefer) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

// ── El ticket de OAuth ───────────────────────────────────────────────────────
// Una redirección a Facebook no puede llevar la cabecera `Authorization`, así
// que el `userId` viajaba en la URL y volvía en el `state`. Cualquiera podía
// cambiarlo y colgarle una cuenta de Facebook a otra persona. Ahora el
// navegador pide primero un ticket con su sesión ya verificada, y ese ticket
// —firmado por nosotros y con caducidad— es lo único que viaja.

async function firmar(datos) {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRETO),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(datos));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function firmarTicket(userId, clientId) {
  if (!SECRETO) throw new Error('Falta LINK_SECRET para firmar la conexión');
  const datos = [userId, clientId || '', Date.now()].join('|');
  return encodeURIComponent(datos) + '.' + (await firmar(datos));
}

export async function abrirTicket(t) {
  if (!SECRETO) return null;
  const i = String(t || '').lastIndexOf('.');
  if (i < 0) return null;
  const datos = decodeURIComponent(String(t).slice(0, i));
  const firma = String(t).slice(i + 1);
  const esperada = await firmar(datos);
  // Comparación en tiempo constante: una normal filtra, byte a byte, cuánto
  // acertó quien lo intenta.
  if (firma.length !== esperada.length) return null;
  let dif = 0;
  for (let j = 0; j < firma.length; j++) dif |= firma.charCodeAt(j) ^ esperada.charCodeAt(j);
  if (dif !== 0) return null;
  const [userId, clientId, cuando] = datos.split('|');
  if (!userId || !cuando || Date.now() - Number(cuando) > VIDA_TICKET) return null;
  return { userId, clientId: clientId || '' };
}

// ── Quién es el dueño de la conexión ─────────────────────────────────────────
// Un miembro del equipo publica con las cuentas de SU cuenta, no con unas
// propias: si cada uno conectara las suyas, nadie publicaría por el cliente.
export async function cuentaDe(userId) {
  try {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}` +
      `&status=eq.active&select=owner_user_id&limit=1`,
      { headers: cabeceras() }
    ).then(r => (r.ok ? r.json() : []));
    return filas?.[0]?.owner_user_id || userId;
  } catch { return userId; }
}

// ── Guardar y leer ───────────────────────────────────────────────────────────

export async function guardarCuentas(userId, clientId, network, cuentas) {
  const cli = String(clientId ?? '');
  const filas = [];
  for (const c of cuentas || []) {
    if (!c.pageId || !c.pageToken) continue;
    filas.push({
      user_id: userId,
      client_id: cli,
      network,
      page_id: String(c.pageId),
      page_name: c.pageName || null,
      page_token: await cifrar(String(c.pageToken)),
      ig_user_id: c.igUserId || null,
      ig_username: c.igUsername || null,
      updated_at: new Date().toISOString(),
    });
  }
  if (!filas.length) return 0;

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/social_connections?on_conflict=user_id,client_id,network,page_id`,
    { method: 'POST', headers: cabeceras('resolution=merge-duplicates,return=minimal'), body: JSON.stringify(filas) }
  );
  if (!r.ok) throw new Error('No se pudo guardar la conexión: ' + (await r.text()).slice(0, 160));
  return filas.length;
}

// Lo que ve el navegador. NO lleva el token, a propósito: ese es el cambio.
export async function listarCuentas(userId, clientId, network) {
  const cli = String(clientId ?? '');
  const filtro = network ? `&network=eq.${encodeURIComponent(network)}` : '';
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/social_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&client_id=eq.${encodeURIComponent(cli)}${filtro}` +
    `&select=network,page_id,page_name,ig_user_id,ig_username&order=created_at`,
    { headers: cabeceras() }
  ).then(r => (r.ok ? r.json() : []));
  const salida = { instagram: [], facebook: [] };
  for (const f of filas || []) {
    if (!salida[f.network]) salida[f.network] = [];
    salida[f.network].push({
      pageId: f.page_id, pageName: f.page_name,
      igUserId: f.ig_user_id, igUsername: f.ig_username,
    });
  }
  return salida;
}

// El token, ya abierto, solo para quien va a publicar. Se busca por la cuenta
// y el ámbito de quien pide: pedir el de otro no devuelve nada.
export async function tokenDeCuenta(userId, clientId, network, pageId) {
  const cli = String(clientId ?? '');
  const filtro = pageId ? `&page_id=eq.${encodeURIComponent(pageId)}` : '';
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/social_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&client_id=eq.${encodeURIComponent(cli)}&network=eq.${encodeURIComponent(network)}${filtro}` +
    `&select=page_id,page_token,ig_user_id&order=created_at&limit=1`,
    { headers: cabeceras() }
  ).then(r => (r.ok ? r.json() : []));
  const f = filas?.[0];
  if (!f) return null;
  return {
    pageId: f.page_id,
    pageToken: await descifrar(f.page_token),
    igUserId: f.ig_user_id || null,
  };
}

// ── Graph API ────────────────────────────────────────────────────────────────
// Una sola versión para conectar y publicar. Antes cada archivo traía la suya y
// social-publish se quedó sin la constante (se borró en f7abeae): toda
// publicación reventaba con «GRAPH is not defined» y nadie lo vio porque Meta
// todavía no dejaba conectar a ningún cliente.
export const GRAPH = 'https://graph.facebook.com/v23.0';

// Los permisos que hacen falta para publicar. Si la persona desmarca alguno en
// el diálogo de Facebook, la conexión se guarda igual pero se le dice cuál
// falta: publicar después y recibir un «(#200)» no le explicaría nada.
export const PERMISOS_PUBLICAR = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
  'instagram_basic', 'instagram_content_publish',
];

// El error de Graph, en algo que la persona pueda entender y resolver. Se
// conserva el mensaje original al final: soporte lo necesita para buscarlo.
export function errorDeMeta(e, contexto) {
  const err = e?.error || e || {};
  const code = Number(err.code), sub = Number(err.error_subcode);
  const original = String(err.error_user_msg || err.message || '').slice(0, 220);
  let texto, reconectar = false;
  if (code === 190 || code === 102) {
    texto = 'La conexión con Meta venció o se revocó. Vuelve a conectar la cuenta desde «Conectar redes».';
    reconectar = true;
  } else if (code === 10 || (code >= 200 && code <= 299)) {
    texto = 'Meta no dio permiso para publicar en esta cuenta. Vuelve a conectarla y acepta todos los permisos que pide.';
    reconectar = true;
  } else if ([4, 17, 32, 613].includes(code)) {
    texto = 'Meta frenó las publicaciones por demasiadas solicitudes seguidas. Espera unos minutos y reintenta.';
  } else if (sub === 2207042 || code === 9) {
    texto = 'Instagram llegó al límite de publicaciones por API de las últimas 24 horas. Reintenta mañana.';
  } else if ([2207003, 2207020, 2207052].includes(sub)) {
    texto = 'Instagram no pudo descargar el archivo. Reintenta; si sigue, vuelve a subir la imagen o el video.';
  } else if ([2207004, 2207005, 2207009, 2207013].includes(sub)) {
    texto = 'Instagram no acepta esta imagen: tiene que ser JPG, de hasta 8 MB y con proporción entre 4:5 y 1,91:1.';
  } else if ([2207026, 2207023, 2207082].includes(sub)) {
    texto = 'Instagram no acepta este video: tiene que ser MP4 o MOV, de 3 segundos a 15 minutos, idealmente vertical 9:16.';
  } else if (sub === 2207050) {
    texto = 'La cuenta de Instagram está restringida o inactiva. Entra a Instagram y revisa su estado.';
  } else {
    texto = 'Meta no aceptó la publicación' + (contexto ? ' (' + contexto + ')' : '') + '.';
  }
  return { error: texto + (original ? ' Detalle de Meta: ' + original : ''), reconectar, codigo: code || null, subcodigo: sub || null };
}

export async function borrarCuentas(userId, clientId, network) {
  const cli = String(clientId ?? '');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/social_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&client_id=eq.${encodeURIComponent(cli)}&network=eq.${encodeURIComponent(network)}`,
    { method: 'DELETE', headers: cabeceras('return=minimal') }
  );
  return r.ok;
}
