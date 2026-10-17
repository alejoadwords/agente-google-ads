// api/_google-sa.js — token de la cuenta de servicio de Acuarius.
//
// Para leer datos de un cliente sin pedirle que inicie sesión con Google: el
// cliente agrega el correo de la cuenta de servicio como lector de su Search
// Console o de su GA4, y con este token leemos. La firma va con WebCrypto (el
// repo no tiene dependencias de ejecución). El token dura una hora; se guarda
// en memoria de la instancia por alcance. Solo se importa desde edge.

const cache = new Map();   // scopes → { token, vence }
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64uTexto = (t) => b64u(new TextEncoder().encode(t));

export const correoServicio = () => process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;

export async function tokenServicio(scopes) {
  const clave = [].concat(scopes).sort().join(' ');
  const hit = cache.get(clave);
  if (hit && hit.vence > Date.now() + 60000) return hit.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !raw) throw new Error('Falta la cuenta de servicio de Google en el servidor');
  const ahora = Math.floor(Date.now() / 1000);
  const entrada = b64uTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64uTexto(JSON.stringify({ iss: email, scope: clave, aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const pem = raw.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const llave = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)).buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, new TextEncoder().encode(entrada));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + entrada + '.' + b64u(firma) });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('Google no dio el token de la cuenta de servicio: ' + (d.error_description || d.error || r.status));
  cache.set(clave, { token: d.access_token, vence: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}
