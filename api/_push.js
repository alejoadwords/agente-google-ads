// api/_push.js
// Envío de avisos push por el estándar Web Push, sin librerías ni proveedor
// externo: el navegador de cada usuario expone su propio servicio (Google para
// Chrome, Mozilla para Firefox, Apple para Safari) y ninguno cobra.
//
// Son dos criptografías distintas y es fácil confundirlas:
//
//   1. VAPID (RFC 8292) — nos identifica ANTE EL SERVICIO push. Un JWT ES256
//      firmado con nuestra clave privada. Sin esto rechazan el envío.
//   2. aes128gcm (RFC 8291) — cifra el CONTENIDO para que solo el navegador
//      del destinatario pueda leerlo. Ni Google ni Apple ven el texto.
//
// Todo con WebCrypto, que ya está en el runtime edge. Cualquier función que
// importe este fichero DEBE ser edge.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:ceo@acuarius.app';

// ── Utilidades base64url ────────────────────────────────────────────────────
export function b64uToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (String(s).length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

// ── 1. VAPID: el JWT que nos identifica ─────────────────────────────────────
async function jwtVapid(audiencia) {
  const cabecera = bytesToB64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = bytesToB64u(new TextEncoder().encode(JSON.stringify({
    aud: audiencia,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,   // 12h: el tope que aceptan
    sub: VAPID_SUBJECT,
  })));
  const sinFirma = cabecera + '.' + cuerpo;

  // La privada se guarda como el campo `d` de un JWK; se reconstruye el par
  // usando la pública, que ya tenemos en crudo.
  const pub = b64uToBytes(VAPID_PUBLIC);
  const clave = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: VAPID_PRIVATE,
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  // WebCrypto devuelve la firma en crudo (r||s), que es justo lo que pide JWS.
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, new TextEncoder().encode(sinFirma));
  return sinFirma + '.' + bytesToB64u(firma);
}

// ── 2. aes128gcm: cifrar el contenido para ese navegador ────────────────────
async function hkdf(sal, ikm, info, largo) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, base, largo * 8));
}

async function cifrar(texto, p256dhB64, authB64) {
  const clienteP = b64uToBytes(p256dhB64);   // clave pública del navegador
  const authSecret = b64uToBytes(authB64);

  // Par efímero nuestro: uno nuevo por envío, como manda el RFC.
  const efimero = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const nuestraPub = new Uint8Array(await crypto.subtle.exportKey('raw', efimero.publicKey));

  const clienteKey = await crypto.subtle.importKey('raw', clienteP, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clienteKey }, efimero.privateKey, 256));

  // PRK: el orden de las claves en el `info` es cliente-primero. Invertirlo
  // produce un cifrado válido que el navegador NO puede descifrar, y el
  // servicio push lo acepta igual: el aviso llega y no se ve nunca.
  const info1 = concat(
    new TextEncoder().encode('WebPush: info\0'),
    clienteP,
    nuestraPub,
  );
  const ikm = await hkdf(authSecret, compartido, info1, 32);

  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const datos = concat(new TextEncoder().encode(texto), new Uint8Array([0x02]));   // 0x02 = último registro
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, datos));

  // Cabecera del cuerpo: sal(16) + tamaño de registro(4) + largo clave(1) + clave(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(sal, rs, new Uint8Array([nuestraPub.length]), nuestraPub, cifrado);
}

// ── Envío ───────────────────────────────────────────────────────────────────
function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}

export async function enviarPushA(userId, aviso) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { enviados: 0, motivo: 'VAPID sin configurar' };
  const subs = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subs?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    { headers: sbHeaders() }
  ).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  if (!subs.length) return { enviados: 0, motivo: 'sin dispositivos' };

  const cuerpo = JSON.stringify({
    titulo: String(aviso.titulo || 'Acuarius').slice(0, 80),
    texto: String(aviso.texto || '').slice(0, 200),
    url: aviso.url || '/',
    etiqueta: aviso.etiqueta || 'acuarius',
  });

  let enviados = 0, caducados = 0;
  for (const s of subs) {
    try {
      const destino = new URL(s.endpoint);
      const jwt = await jwtVapid(destino.origin);
      const payload = await cifrar(cuerpo, s.p256dh, s.auth);
      const r = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'normal',
        },
        body: payload,
      });
      if (r.status === 404 || r.status === 410) {
        // El navegador se desuscribió (app desinstalada, permiso revocado).
        // Guardarla es acumular basura y fallos en cada envío futuro.
        await fetch(`${SUPABASE_URL}/rest/v1/push_subs?id=eq.${s.id}`, { method: 'DELETE', headers: sbHeaders() });
        caducados++;
      } else if (r.ok) {
        enviados++;
        await fetch(`${SUPABASE_URL}/rest/v1/push_subs?id=eq.${s.id}`, {
          method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' },
          body: JSON.stringify({ last_ok_at: new Date().toISOString() }),
        });
      } else {
        console.error('[push] rechazado', r.status, (await r.text()).slice(0, 160));
      }
    } catch (e) {
      console.error('[push] error enviando:', e.message);
    }
  }
  return { enviados, caducados, total: subs.length };
}
