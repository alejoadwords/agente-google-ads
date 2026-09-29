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

/** { userId, resourceId } si vale; { caducado: true } si ya no; null si es falso. */
export async function abrirEnlaceCalendario(t) {
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

  const [prefijo, userId, resourceId, caduca] = datos.split('|');
  if (prefijo !== PREFIJO || !userId || !resourceId) return null;
  // La caducidad, DESPUÉS de la firma: al revés, un enlace con la fecha
  // manipulada se rechazaría por viejo y no por falso.
  if (!(Number(caduca) > Date.now())) return { caducado: true };
  return { userId, resourceId };
}
