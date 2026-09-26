// La firma del webhook de Meta: node pruebas/webhook-meta-firma.mjs
//
// `api/webhooks/meta.js` recibe los mensajes de WhatsApp, Messenger e
// Instagram y los mete en el inbox del cliente: crea conversaciones, crea
// leads y hace contestar al agente. Solo comprobaba el verify token, y ese
// token únicamente viaja en el handshake GET de alta — en cada POST posterior
// no va. O sea que cualquiera que conociera la URL podía inventar mensajes en
// la cuenta de un cliente.
//
// Meta firma cada POST con HMAC-SHA256 del cuerpo usando el secreto de la app.
// Aquí se comprueba que esa firma se exige de verdad, con firmas buenas y
// malas calculadas al vuelo.
//
// Se prueba la función real extraída del fichero, no una copia.

import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const js = readFileSync(new URL('../api/webhooks/meta.js', import.meta.url), 'utf8');
const src = js.slice(js.indexOf('async function firmaValida'), js.indexOf('\nfunction sb()'));

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

const SECRETO = 'secreto-de-prueba-abc123';
const entorno = { crypto: webcrypto, process: { env: { META_APP_SECRET: SECRETO } }, TextEncoder };
const firmaValida = new Function(...Object.keys(entorno), src + '\n; return firmaValida;')(...Object.values(entorno));

// La firma que mandaría Meta.
async function firmar(cuerpo, secreto = SECRETO) {
  const k = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await webcrypto.subtle.sign('HMAC', k, new TextEncoder().encode(cuerpo));
  return 'sha256=' + [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const CUERPO = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1' }] });

// ── Lo que sí pasa ─────────────────────────────────────────────────────────
console.log('\nUn mensaje de Meta de verdad');
ok(await firmaValida(CUERPO, await firmar(CUERPO)), 'con la firma correcta, entra');
const sinPrefijo = (await firmar(CUERPO)).replace('sha256=', '');
ok(await firmaValida(CUERPO, sinPrefijo), 'y también si viene sin el prefijo «sha256=»');
ok(await firmaValida(CUERPO, (await firmar(CUERPO)).toUpperCase().replace('SHA256=', 'sha256=')),
   'las mayúsculas del hexadecimal no lo tumban');

// ── Lo que NO puede pasar ──────────────────────────────────────────────────
console.log('\nLo que hay que dejar fuera');
ok(!(await firmaValida(CUERPO, null)), 'sin cabecera de firma, no entra');
ok(!(await firmaValida(CUERPO, '')), 'con la cabecera vacía, tampoco');
ok(!(await firmaValida(CUERPO, 'sha256=' + '0'.repeat(64))), 'con una firma inventada, no entra');
ok(!(await firmaValida(CUERPO, await firmar(CUERPO, 'otro-secreto'))),
   'firmado con OTRO secreto, no entra — es el caso de quien conoce la URL pero no el secreto');

// El cuerpo cambiado es el ataque de verdad: firma buena, contenido otro.
const OTRO = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '666' }] });
ok(!(await firmaValida(OTRO, await firmar(CUERPO))),
   'una firma válida de OTRO cuerpo no sirve: si no, se reenvía una buena con el contenido cambiado');

// Un espacio de más rompe la firma. Por eso el cuerpo se lee en crudo.
ok(!(await firmaValida(CUERPO + ' ', await firmar(CUERPO))),
   'hasta un espacio de más la invalida: de ahí que el cuerpo se lea en crudo, sin re-serializar');

console.log('\nBasura en la cabecera');
for (const basura of ['sha256=xyz', 'sha1=' + '0'.repeat(40), 'sha256=' + '0'.repeat(63), '{}', 'sha256=']) {
  ok(!(await firmaValida(CUERPO, basura)), `«${basura.slice(0, 22)}» no cuela`);
}

// ── Sin secreto configurado: cerrado, no abierto ───────────────────────────
console.log('\nSi falta el secreto de la app');
const sinSecreto = new Function(...Object.keys(entorno), src + '\n; return firmaValida;')(
  webcrypto, { env: {} }, TextEncoder);
ok(!(await sinSecreto(CUERPO, await firmar(CUERPO))),
   'falla CERRADO: sin secreto no se acepta a nadie, en vez de dejar pasar todo');

// ── Que el fichero la use de verdad ────────────────────────────────────────
console.log('\nY que el handler la exija');
ok(/if \(!\(await firmaValida\(crudo, req\.headers\.get\('x-hub-signature-256'\)\)\)\)/.test(js),
   'el POST comprueba la firma antes de procesar nada');
ok(js.indexOf("searchParams.get('simulate')") < js.indexOf('await firmaValida'),
   'el simulador va ANTES: tiene su propia puerta y no viene firmado');
ok(js.indexOf('await firmaValida') < js.indexOf('const procesar'),
   'y la comprobación va antes de crear conversaciones o leads');
ok(/crudo = await req\.text\(\);\s*\n\s*body = JSON\.parse\(crudo\);/.test(js),
   'el cuerpo se lee en crudo y se parsea después, no al revés');
// Se mira la PRIMERA respuesta que se devuelve tras comprobar la firma, no una
// ventana de N caracteres: al añadir el registro del rechazo, el 403 se salió
// de la ventana y la prueba acusó en falso a un código correcto.
const trasFirma = js.slice(js.indexOf('await firmaValida'));
const primeraRespuesta = trasFirma.slice(0, trasFirma.indexOf('return new Response') + 120);
ok(/status: 403/.test(primeraRespuesta),
   'a una firma inválida se le responde 403, no un 200 de «recibido»', primeraRespuesta.slice(-90));
ok(/registrarError/.test(trasFirma.slice(0, trasFirma.indexOf('return new Response'))),
   'y el rechazo queda registrado: si el secreto dejara de valer, el inbox se callaría sin un error a la vista');

console.log('');
process.exit(mal ? 1 : 0);
