// Trazabilidad de pauta: node pruebas/trazabilidad.mjs
//
// El hecho es UNO: alguien hace clic en un anuncio de Google, llega a la web
// del cliente, rellena un formulario y aparece en Acuarius. Google lo cuenta
// como conversión y nosotros como lead, y hasta ahora no sabíamos que eran la
// misma persona: la pantalla de pauta decía «0 de 182».
//
// El dato SÍ se capturaba. Se escribía en la nota del lead, como texto libre, y
// el reporte no lee notas: cuenta por custom_fields['Campaña'] y por
// ['ID de campaña']. Se capturaba y se tiraba donde nadie podía usarlo.

import { readFileSync } from 'node:fs';
import { camposDePauta } from '../api/_lead-intake.js';

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

console.log('\nLo que llega de un anuncio de Google\n');
{
  // Etiquetado automático: Google solo pone gclid, ninguna utm.
  const solo = camposDePauta({ gclid: 'Cj0KCQjw_abc123' });
  chk('el gclid se guarda', solo['Clic de anuncio'] === 'Cj0KCQjw_abc123');
  chk('y con él solo ya se sabe que vino de Google', solo['Plataforma'] === 'Google');

  // Sufijo de URL final: lo recomendable, trae el id de campaña.
  const conId = camposDePauta({ gclid: 'x', campaignid: '22458899', utm_source: 'google', utm_campaign: 'Search - general 2026' });
  chk('el ID de campaña llega al campo que lee el reporte', conId['ID de campaña'] === '22458899');
  chk('y el nombre también', conId['Campaña'] === 'Search - general 2026');
  chk('la plataforma declarada gana sobre la deducida', conId['Plataforma'] === 'google');

  chk('wbraid y gbraid también son Google',
      camposDePauta({ wbraid: 'a' })['Plataforma'] === 'Google' &&
      camposDePauta({ gbraid: 'b' })['Plataforma'] === 'Google');
  chk('fbclid es Meta', camposDePauta({ fbclid: 'z' })['Plataforma'] === 'Meta');
  chk('ttclid es TikTok', camposDePauta({ ttclid: 'z' })['Plataforma'] === 'TikTok');
  chk('sin nada de esto no se inventa una plataforma',
      camposDePauta({ nombre: 'Ana' })['Plataforma'] === undefined);
  chk('y no se escriben claves vacías', Object.keys(camposDePauta({ gclid: '  ' })).length === 0);
}

console.log('\nEl conector guarda el origen entre páginas\n');
{
  const f = readFileSync(new URL('../public/f.js', import.meta.url), 'utf8');
  chk('captura el gclid y sus primos', /'gclid', 'wbraid', 'gbraid'/.test(f));
  chk('y las utm', /'utm_source', 'utm_medium', 'utm_campaign'/.test(f));
  chk('y el campaignid del sufijo de URL final', /'campaignid'/.test(f));
  chk('lo lee al CARGAR, no al enviar (si no, ya se perdió)',
      /\/\/ Se llama al cargar[\s\S]{0,200}?try \{ origen\(\); \} catch/.test(f));
  chk('lo guarda en sessionStorage', /sessionStorage\.setItem\(LLAVE/.test(f));
  chk('gana el PRIMERO: un segundo anuncio no roba el crédito',
      /if \(guardado && guardado\._url\) return guardado;/.test(f));
  chk('si el navegador no deja guardar, no se rompe nada',
      /try \{ sessionStorage\.setItem[\s\S]{0,80}?catch \(e\) \{\}/.test(f));
  chk('viaja con el envío', /data\._origen = o/.test(f));
}

console.log('\nY el servidor lo pone donde el reporte lo ve\n');
{
  const fp = readFileSync(new URL('../api/form-public.js', import.meta.url), 'utf8');
  const pauta = readFileSync(new URL('../api/pauta.js', import.meta.url), 'utf8');

  chk('form-public usa camposDePauta', /import \{ intakeLead, pick, camposDePauta \}/.test(fp));
  chk('lee el origen que mandó el conector', /body\._origen === 'object'/.test(fp));
  chk('y también los parámetros de la propia URL del envío',
      /u\.searchParams\.entries\(\)/.test(fp));
  chk('todo eso acaba en campos propios, no en la nota',
      /const camposPropios = \(referencia \|\| Object\.keys\(pauta\)\.length\)/.test(fp));

  // El nexo: los nombres tienen que coincidir EXACTAMENTE con lo que cuenta
  // el reporte. Si alguien renombra uno de los dos lados, vuelve el «0 de 182».
  chk('el reporte cuenta por «ID de campaña»', /cf\['ID de campaña'\]/.test(pauta));
  chk('y por «Campaña»', /normNombre\(cf\['Campaña'\]\)/.test(pauta));
  const escritos = Object.keys(camposDePauta({ campaignid: '1', utm_campaign: 'x' }));
  chk('y son exactamente los que escribimos',
      escritos.includes('ID de campaña') && escritos.includes('Campaña'), escritos.join(', '));
}

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
