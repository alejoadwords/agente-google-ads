// pruebas/tokens-se-descifran.mjs
//
// Los tokens de terceros se guardan cifrados (`enc:v1:…`). Mandarle a Google
// el texto cifrado devuelve `invalid_grant` — EL MISMO error que da un permiso
// caducado. El 23-09-2026 eso hizo pensar que la autorización de YouTube había
// vencido y se pidió al usuario que volviera a autorizar sin necesidad.
//
// Esta prueba no comprueba el cifrado en sí: comprueba que ningún sitio que
// lea un token de `platform_connections` lo use sin pasarlo antes por
// `descifrar()` o por `abrirConexion()`.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

// Plataformas cuyos tokens SÍ se guardan cifrados: las que alguien pasa por
// `cifrar()` al escribir. Las de MercadoPago y el webhook de leads van en
// plano a propósito —se escriben y se leen igual— y por eso no entran aquí.
const CIFRADAS = /platform=eq\.(google_ads|google_calendar|youtube|meta|meta_ads|facebook|instagram|whatsapp|tiktok)/;

const ficheros = [
  ...readdirSync(join(RAIZ, 'api')).filter(f => f.endsWith('.js')).map(f => ['api', f]),
  ...readdirSync(join(RAIZ, 'academia-scripts')).filter(f => f.endsWith('.js')).map(f => ['academia-scripts', f]),
];

const sospechosos = [];
for (const [dir, f] of ficheros) {
  const src = readFileSync(join(RAIZ, dir, f), 'utf8');
  if (!/platform_connections/.test(src)) continue;
  if (!CIFRADAS.test(src)) continue;                      // no lee una plataforma cifrada
  // Buscar que la palabra «descifrar» aparezca NO basta: la primera versión de
  // esta prueba daba verde con el fallo puesto, porque seguía mencionada en un
  // comentario. Hay que mirar las dos formas concretas en las que se rompe:
  // meter el campo de la fila directo en la petición de token, o directo en la
  // cabecera Authorization.
  const crudo = [
    /refresh_token:\s*\w+\.refresh_token\b/,        // body del refresh de OAuth
    /access_token:\s*\w+\.access_token\b/,
    /Bearer \$\{\s*\w+\.access_token\s*\}/,        // cabecera
    /access_token=\$\{\s*\w+\.access_token\s*\}/,  // query de Graph
  ].some(re => re.test(src));
  if (!crudo) continue;
  // Que aparezca el patrón no basta para acusar: si la variable salió de
  // `abrirConexion()` ya viene descifrada, y eso es lo normal —así lo hacen
  // _gcal, admin, refresh-google-token y refresh-meta-token—.
  //
  // Los comentarios se quitan antes de mirar: la primera versión de esta
  // prueba daba verde con el fallo puesto porque la palabra «descifrar»
  // seguía escrita en un comentario justo encima.
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (!/abrirConexion\s*\(|descifrar\s*\(/.test(codigo)) sospechosos.push(`${dir}/${f}`);
}

ok(sospechosos.length === 0,
   sospechosos.length
     ? 'leen tokens cifrados SIN descifrar: ' + sospechosos.join(', ')
     : 'todo el que lee un token de una plataforma cifrada lo descifra');

// Y que el ayudante siga cubriendo los dos campos: si mañana alguien añade
// `page_token` a la fila y no lo mete aquí, vuelve el mismo fallo por otro lado.
const cifrado = readFileSync(join(RAIZ, 'api/_cifrado.js'), 'utf8');
ok(/for \(const campo of \['access_token', 'refresh_token'\]\)/.test(cifrado),
   'abrirConexion cubre access_token y refresh_token');
ok(/export async function abrirConexion/.test(cifrado) && /export async function cerrarConexion/.test(cifrado),
   'existen las dos mitades: abrir para leer y cerrar para guardar');

// `descifrar` tiene que dejar pasar el texto plano: es lo que permite migrar
// por partes sin romper una conexión vieja.
const { descifrar } = await import(join(RAIZ, 'api/_cifrado.js'));
ok(await descifrar('1//0abcdEFGH') === '1//0abcdEFGH',
   'un token en plano se devuelve tal cual (la migración puede ir por partes)');
ok(await descifrar(null) === null, 'y un nulo no revienta');

process.exit(mal ? 1 : 0);
