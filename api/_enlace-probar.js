// api/_enlace-probar.js
// El enlace con el que un cliente prueba su agente sin tener cuenta.
//
// La firma va aparte del endpoint porque la usan los dos lados: el que crea el
// enlace (con sesión, desde el editor del agente) y el que lo abre (sin sesión
// ninguna, desde el navegador del cliente).
//
// El token lleva los datos a la vista y una firma. No se guarda en ninguna
// tabla: lo que no existe no hay que limpiarlo después, y un enlace caducado
// deja de valer solo.

const LINK_SECRET = process.env.LINK_SECRET || process.env.CRON_SECRET || '';

// Cuánto vive un enlace. Un mes es de sobra para que un cliente lo revise y
// suficientemente poco para que no quede una puerta abierta para siempre.
export const DIAS_ENLACE = 30;

async function firmar(datos) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(LINK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(datos));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function crearToken(userId, agentId, dias = DIAS_ENLACE) {
  if (!LINK_SECRET) return null;
  const caduca = Date.now() + dias * 86400000;
  const datos = [userId, agentId, caduca].join('|');
  return encodeURIComponent(datos) + '.' + (await firmar(datos));
}

export async function abrirToken(t) {
  if (!LINK_SECRET) return null;
  const i = String(t || '').lastIndexOf('.');
  if (i < 0) return null;
  const datos = decodeURIComponent(String(t).slice(0, i));
  const firma = String(t).slice(i + 1);

  // Comparación en tiempo constante: una comparación normal filtra, byte a
  // byte, cuánto acertó quien lo está intentando.
  const esperada = await firmar(datos);
  if (firma.length !== esperada.length) return null;
  let dif = 0;
  for (let k = 0; k < firma.length; k++) dif |= firma.charCodeAt(k) ^ esperada.charCodeAt(k);
  if (dif !== 0) return null;

  const [userId, agentId, caduca] = datos.split('|');
  if (!userId || !agentId) return null;
  // La caducidad se comprueba DESPUÉS de la firma: al revés, un token con fecha
  // manipulada se rechazaría por caducado en vez de por falso, y quien lo
  // probara aprendería que la fecha se puede tocar.
  if (!(Number(caduca) > Date.now())) return { caducado: true };
  return { userId, agentId };
}
