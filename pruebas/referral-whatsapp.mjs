// De qué anuncio vino la conversación: node pruebas/referral-whatsapp.mjs
//
// Cuando alguien escribe tras pulsar un anuncio de clic-a-WhatsApp, Meta manda
// un bloque `referral` con el anuncio, su titular y el identificador del clic.
// Lo manda SOLO pegado al primer mensaje: si no se recoge ahí, no se
// reconstruye después de ninguna forma.
//
// Antes se tiraba entero. Un lead de Meta Lead Ads guardaba campaña, conjunto y
// anuncio; uno que entraba por clic-a-WhatsApp guardaba «whatsapp» y nada más,
// así que la mitad de la pauta de un cliente no aparecía en ningún reporte y el
// agente trataba igual a quien venía de un anuncio y a quien escribía en frío.
//
// Lo que hay que proteger:
//   1. Que se traduzca a LAS MISMAS claves que Lead Ads. Con claves distintas,
//      la misma campaña sale partida en dos y nadie entiende por qué.
//   2. Que una publicación orgánica con botón de WhatsApp NO se cuente como
//      pauta: inflaría los resultados de campañas que no existen.
//   3. Que el agente lo reciba, pero advertido: es lo que decía el anuncio, no
//      lo que la persona dijo.

import { readFileSync } from 'node:fs';
import { pautaDeReferral, camposDePauta } from '../api/_lead-intake.js';

const js = readFileSync(new URL('../api/_inbox-engine.js', import.meta.url), 'utf8');
const wh = readFileSync(new URL('../api/webhooks/meta.js', import.meta.url), 'utf8');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// Un referral tal como lo manda Meta.
const ANUNCIO = {
  source_url: 'https://fb.me/2abc',
  source_type: 'ad',
  source_id: '120248730043800252',
  headline: 'Apartamentos en arriendo en Villa Santos',
  body: 'Desde $1.200.000. Agenda tu visita hoy.',
  media_type: 'image',
  ctwa_clid: 'ARAbc123xyz',
};

// ── La traducción ──────────────────────────────────────────────────────────
console.log('\nDe referral a campos de pauta');
const p = pautaDeReferral(ANUNCIO);
ok(p['Anuncio'] === 'Apartamentos en arriendo en Villa Santos',
   'el titular del anuncio queda como «Anuncio»', p['Anuncio']);
ok(p['ID de anuncio'] === '120248730043800252',
   'y su id aparte: el titular se puede cambiar en Meta, el id no', p['ID de anuncio']);
ok(p['Clic de anuncio'] === 'ARAbc123xyz', 'el identificador del clic se guarda', p['Clic de anuncio']);
ok(p['Plataforma'] === 'Meta', 'y la plataforma', p['Plataforma']);

// Las claves tienen que ser las MISMAS que las de Lead Ads.
console.log('\nLas mismas claves que un lead de Meta Lead Ads');
const leadAds = camposDePauta({
  campaign_name: 'Arriendo Barranquilla', campaign_id: '120248730036960252',
  adset_name: 'Villa Santos', ad_name: 'Carrusel 3 fotos',
  publisher_platform: 'facebook', fbclid: 'IwAR123',
});
for (const k of Object.keys(p)) {
  const compartida = k in leadAds || k === 'ID de anuncio';
  ok(compartida, `«${k}» es una clave del mismo vocabulario`,
     'Lead Ads usa: ' + Object.keys(leadAds).join(', '));
}
ok(!('campaign_name' in p) && !('ad_name' in p),
   'y NO se cuelan las claves crudas de Meta: partirían el reporte en dos');

// ── Orgánico no es pauta ───────────────────────────────────────────────────
console.log('\nUna publicación no es un anuncio');
const post = pautaDeReferral({ ...ANUNCIO, source_type: 'post' });
ok(post['Plataforma'] === 'Meta orgánico',
   'un clic desde una publicación se marca como orgánico', post['Plataforma']);
ok(post['Plataforma'] !== 'Meta',
   'y no se cuenta como pauta: inflaría campañas que no existen');

// ── Lo que no trae, no se inventa ──────────────────────────────────────────
console.log('\nLo que el referral NO trae');
ok(!('Campaña' in p) && !('Conjunto' in p),
   'no se inventan campaña ni conjunto: el referral solo trae el anuncio');
ok(Object.keys(pautaDeReferral(null)).length === 0, 'sin referral no se guarda nada');
ok(Object.keys(pautaDeReferral({})).length === 0, 'con un referral vacío tampoco');
ok(Object.keys(pautaDeReferral({ source_type: 'ad' })).length === 0,
   'y con un referral sin datos útiles, tampoco se marca la plataforma');

// Un titular larguísimo no puede reventar la columna.
const largo = pautaDeReferral({ ...ANUNCIO, headline: 'x'.repeat(500) });
ok(largo['Anuncio'].length <= 120, 'un titular kilométrico se recorta', String(largo['Anuncio'].length));

// ── El camino completo, en el código ───────────────────────────────────────
console.log('\nEl dato llega de punta a punta');
ok(/referral: msg\.referral \|\| null/.test(wh),
   'el webhook lo saca del mensaje de WhatsApp');
ok(/processIncoming\(\{[^}]*referral[^}]*\}\)/s.test(js) || /media, referral \}/.test(js),
   'el motor lo recibe');
ok(/referral: referral \|\| null,/.test(js),
   'y lo guarda al crear la conversación, que es cuando el lead aún no existe');
ok(/if \(referral && !conv\.referral\)/.test(js),
   'si la conversación ya existía, solo se escribe cuando estaba vacío: la atribución se queda con el PRIMER origen');
ok(/const pauta = pautaDeReferral\(conv\.referral\);/.test(js),
   'el lead hereda la atribución al nacer');

// ── El agente se entera, pero advertido ────────────────────────────────────
console.log('\nY el agente lo sabe');
const src = js.slice(js.indexOf('function bloqueDeAnuncio'), js.indexOf('export function buildSystemPrompt'));
const bloqueDeAnuncio = new Function(src + '; return bloqueDeAnuncio;')();
const b = bloqueDeAnuncio(ANUNCIO);
ok(/Apartamentos en arriendo en Villa Santos/.test(b), 'se le pasa el titular del anuncio');
ok(/no lo que la persona te ha dicho/.test(b),
   'advertido de que es lo que decía el anuncio, no lo que dijo la persona');
ok(/No repitas el anuncio palabra por palabra/.test(b),
   'y de que no lo recite: quedaría como un robot leyendo su propia pauta');
ok(bloqueDeAnuncio(null) === '', 'sin anuncio no se le mete nada al prompt');
ok(bloqueDeAnuncio({ source_id: '1' }) === '',
   'y con un referral sin titular ni texto tampoco: no hay nada que contarle');
ok(/una publicación/.test(bloqueDeAnuncio({ ...ANUNCIO, source_type: 'post' })),
   'a una publicación la llama publicación, no anuncio');

// Y que de verdad se le pase en los dos sitios donde se arma el prompt.
ok((js.match(/conv\.referral \|\| null/g) || []).length >= 2,
   'se pasa tanto a la respuesta del agente como a la sugerencia del inbox');

console.log('');
process.exit(mal ? 1 : 0);
