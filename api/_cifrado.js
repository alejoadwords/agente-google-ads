// api/_cifrado.js — cifrado de los tokens de terceros
//
// Los tokens de Google, Meta, TikTok, LinkedIn y WhatsApp son las llaves de
// las cuentas publicitarias y los canales de nuestros clientes. Vivían en
// texto plano en la base: el disco está cifrado, pero cualquiera con una copia
// de seguridad o con acceso de lectura a esa tabla veía las llaves.
//
// AES-256-GCM con WebCrypto, que existe igual en edge y en Node, así que este
// módulo se puede importar desde los dos (`cron-campaigns.js`, que es Node, ya
// importa `_campaign-email.js`; lo que rompe no es importar, es usar dentro
// una API que solo exista en un runtime).
//
// LA REGLA QUE HACE ESTO SEGURO DE MIGRAR: `descifrar` deja pasar tal cual lo
// que no esté cifrado. Así, mientras quede un sitio de escritura sin convertir,
// ese token se guarda como hoy y se sigue leyendo bien — degrada a lo de
// siempre en vez de romper la integración. Sin esa regla, migrar 46 sitios de
// escritura de una vez sería jugársela a que no se escape ninguno.

const MARCA = 'enc:v1:';

let _clave = null;
async function clave() {
  if (_clave) return _clave;
  const b64 = process.env.TOKENS_KEY;
  if (!b64) return null;                 // sin llave, todo sigue como antes
  const bruto = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (bruto.length !== 32) throw new Error('TOKENS_KEY debe ser de 32 bytes en base64');
  _clave = await crypto.subtle.importKey('raw', bruto, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return _clave;
}

export function estaCifrado(v) {
  return typeof v === 'string' && v.startsWith(MARCA);
}

/**
 * Cifra un token. Si no hay llave configurada devuelve el texto tal cual: es
 * preferible guardar como hoy a tumbar una conexión OAuth que el usuario
 * acaba de autorizar y tendría que repetir.
 */
export async function cifrar(texto) {
  if (texto === null || texto === undefined || texto === '') return texto;
  if (estaCifrado(texto)) return texto;                 // ya venía cifrado
  const k = await clave();
  if (!k) return texto;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = new TextEncoder().encode(String(texto));
  const cif = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, datos));
  // El vector de inicialización viaja delante del criptograma: es público por
  // diseño y tiene que ser distinto en cada cifrado.
  const todo = new Uint8Array(iv.length + cif.length);
  todo.set(iv, 0); todo.set(cif, iv.length);
  let s = '';
  for (const b of todo) s += String.fromCharCode(b);
  return MARCA + btoa(s);
}

/**
 * Descifra un token. Lo que no lleve la marca se devuelve tal cual — así
 * conviven los tokens viejos sin migrar con los nuevos.
 */
export async function descifrar(valor) {
  if (!estaCifrado(valor)) return valor;
  const k = await clave();
  // Un token cifrado sin llave para abrirlo NO se devuelve como está: quien lo
  // reciba se lo mandaría a Google como si fuera un token y el fallo aparecería
  // tres capas más abajo, disfrazado de «permiso caducado».
  if (!k) throw new Error('Hay tokens cifrados pero falta TOKENS_KEY');

  const todo = Uint8Array.from(atob(valor.slice(MARCA.length)), c => c.charCodeAt(0));
  const iv = todo.slice(0, 12);
  const cif = todo.slice(12);
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, cif);
  return new TextDecoder().decode(claro);
}

/** Descifra de una vez los campos de token de una fila de conexión. */
export async function abrirConexion(fila) {
  if (!fila) return fila;
  const out = { ...fila };
  for (const campo of ['access_token', 'refresh_token']) {
    if (out[campo]) out[campo] = await descifrar(out[campo]);
  }
  return out;
}

/** Y la vuelta: deja lista para guardar una fila con sus tokens cifrados. */
export async function cerrarConexion(fila) {
  if (!fila) return fila;
  const out = { ...fila };
  for (const campo of ['access_token', 'refresh_token']) {
    if (out[campo]) out[campo] = await cifrar(out[campo]);
  }
  return out;
}
