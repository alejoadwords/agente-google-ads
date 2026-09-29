// El agente enseña fotos: node pruebas/fotos-inmueble.mjs
//
// Podía describir un apartamento y no enseñarlo: ante «¿me manda fotos?» tenía
// que pasar la conversación a un asesor para algo que ya está publicado en la
// web del cliente. En una inmobiliaria la foto es medio proceso de venta.
//
// Lo que hay que proteger:
//   1. Que NUNCA se cuele la foto de otro inmueble. Mandarle a alguien la
//      cocina de un apartamento que no es la que va a visitar es peor que no
//      mandar nada, y no se desmiente: ya la vio.
//   2. Que no las mande de golpe. Son datos del teléfono de una persona.
//   3. Que no prometa fotos de un inmueble que no las tiene.

import { readFileSync } from 'node:fs';
import { fotosDelHtml } from '../api/_catalogo.js';

const cat = readFileSync(new URL('../api/_catalogo.js', import.meta.url), 'utf8');
const eng = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
const wh = readFileSync(new URL('../api/webhooks/meta.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

// Una ficha como las de Certain: la foto lleva el código en el nombre.
const HTML = `
  <img src="https://certainpezzano.com/wp-content/uploads/2026/04/121514301_1_1776116684_1.jpg">
  <img src="https://certainpezzano.com/wp-content/uploads/2026/04/121514301_1_1776116684_1-768x576.jpg">
  <img src="https://certainpezzano.com/wp-content/uploads/2026/04/121514301_1_1776116685_3.jpg">
  <img src="https://certainpezzano.com/wp-content/uploads/2026/04/121514301_1_1776116686_4.jpg">
  <img src="https://certainpezzano.com/wp-content/uploads/2026/04/121514301_1_1776116687_5.jpg">
  <img src="https://certainpezzano.com/wp-content/uploads/2026/04/121514301_1_1776116688_6.jpg">
  <img src="https://certainpezzano.com/wp-content/uploads/2026/04/999999999_1_otro_inmueble.jpg">
  <img src="https://certainpezzano.com/wp-content/uploads/2020/01/logo-certain.png">
`;

console.log('\nDe qué inmueble es cada foto');
const f = fotosDelHtml(HTML, '121514301');
ok(f.length === 4, 'se guardan como mucho cuatro', String(f.length));
ok(f.every(u => u.includes('121514301')),
   'todas del inmueble pedido: la de otro NO se cuela', f.find(u => !u.includes('121514301')));
ok(!f.some(u => u.includes('logo')), 'y el logo del sitio tampoco');
ok(!f.some(u => /-\d+x\d+\./.test(u)),
   'de cada foto se guarda la original, no la miniatura: en WhatsApp se ve en grande');

console.log('\nCuando no hay de qué fiarse, no se inventa');
ok(fotosDelHtml(HTML, '').length === 0, 'sin código no se devuelve nada');
ok(fotosDelHtml(HTML, null).length === 0, 'con null tampoco');
ok(fotosDelHtml(HTML, '000000').length === 0, 'y de un código que no está en la ficha, ninguna');
ok(fotosDelHtml('', '121514301').length === 0, 'una ficha vacía no revienta');

console.log('\nSe sacan de la misma lectura que el precio');
ok(/const fotos = fotosDelHtml\(html, codigo\)/.test(cat),
   'del mismo HTML que ya se descarga: no cuesta ni una petición más');
ok(/fotos: igual\.fotos/.test(cat),
   'y una ficha reutilizada conserva las suyas, o se perderían en cada vuelta');
// Una fila de antes de que existieran las fotos tiene precio, así que se
// reutilizaba… y se quedaba sin fotos para siempre.
ok(/if \(!g\.fotos\) return null;/.test(cat),
   'y una fila sin fotos se relee aunque no haya cambiado');
ok(/fotos: pr\.fotos\?\.length \? pr\.fotos : null/.test(cat), 'se guardan');

console.log('\nEl agente sabe cuáles puede enseñar');
ok(/f\.fotos\?\.length \? 'con fotos' : null/.test(eng),
   'las opciones con fotos van marcadas en la lista que ve');
ok(/No las mandes de golpe/.test(eng), 'y se le pide que las ofrezca antes de mandarlas');
ok(/espera a que diga que sí/.test(eng), 'esperando el sí');
ok(/no las ofrezcas ni prometas mandarlas/.test(eng),
   'y que no prometa las de un inmueble que no las tiene');
ok(/Videos no tienes de ninguna/.test(eng), 'los videos se dicen que no: ninguna ficha trae');

console.log('\nY el código se comprueba contra el catálogo');
const fn = eng.slice(eng.indexOf('export async function fotosPedidas'), eng.indexOf('// Las pistas con las que se filtra'));
ok(/codigo=eq\.\$\{encodeURIComponent\(m\[1\]\)\}/.test(fn),
   'el código del bloque se busca en el catálogo del cliente');
ok(/user_id=eq\.\$\{encodeURIComponent\(userId\)\}/.test(fn),
   'acotado a su cuenta: nunca las fotos de otro cliente');
ok(/\.slice\(0, 4\)/.test(fn), 'y como mucho cuatro, aunque la fila traiga más');
ok(/catch \{ return \[\]; \}/.test(fn), 'si algo falla, no se manda ninguna');

console.log('\nEl bloque no lo ve el contacto');
ok(/CAMBIAR_CITA\|FOTOS\):/.test(eng), 'se limpia del texto visible');
ok(/CAMBIAR_CITA\|FOTOS\)\\b/.test(eng), 'y también si la respuesta se cortó a mitad');

console.log('\nY se envían como imágenes de verdad');
ok(/await send\(connection, contactId, '', \{ tipo: 'image', url \}\)/.test(eng),
   'una por una, detrás del mensaje');
ok(/catch \(e\) \{ console\.error\('foto no enviada'/.test(eng),
   'y si una falla se sigue con las demás: media galería es mejor que ninguna');
ok(/type: 'image', image: \{ link: adjunto\.url/.test(wh),
   'el webhook las manda como imagen por WhatsApp');
ok(/send: \(connection, contactId, text, adjunto\)/.test(wh), 'con el adjunto puesto');

console.log('');
process.exit(mal ? 1 : 0);
