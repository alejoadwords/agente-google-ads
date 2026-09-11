// pruebas/campos-de-pauta.mjs
//
// De qué campaña, conjunto y anuncio viene cada lead. Se prueba contra los
// ficheros reales, no contra una copia: si alguien cambia el intake y rompe
// esto, la prueba se entera.
//
//   node pruebas/campos-de-pauta.mjs

import { readFileSync } from 'node:fs';
import { camposDePauta } from '../api/_lead-intake.js';

let ok = 0, fallos = [];
const chk = (nombre, cond) => { if (cond) ok++; else fallos.push(nombre); };
const raiz = new URL('..', import.meta.url).pathname;
const leer = (p) => readFileSync(raiz + p, 'utf8');

// ── 1. Extracción de los campos ──────────────────────────────────────────────
const meta = camposDePauta({
  campaign_name: 'Arké 55 · Clientes potenciales',
  adset_name: 'Bogotá 25-45',
  ad_name: 'Video fachada v2',
  platform: 'instagram',
});
chk('lee campaign_name', meta['Campaña'] === 'Arké 55 · Clientes potenciales');
chk('lee adset_name', meta['Conjunto'] === 'Bogotá 25-45');
chk('lee ad_name', meta['Anuncio'] === 'Video fachada v2');
chk('lee platform', meta['Plataforma'] === 'instagram');

const esp = camposDePauta({ 'campaña': 'Lanzamiento', conjunto: 'Frío', anuncio: 'Carrusel' });
chk('acepta los nombres en español', esp['Campaña'] === 'Lanzamiento' && esp['Conjunto'] === 'Frío' && esp['Anuncio'] === 'Carrusel');

const utm = camposDePauta({ utm_campaign: 'remarketing-sep' });
chk('acepta utm_campaign', utm['Campaña'] === 'remarketing-sep');

const mayus = camposDePauta({ Campaign_Name: 'MAYÚSCULAS', AD_NAME: 'anuncio' });
chk('no distingue mayúsculas', mayus['Campaña'] === 'MAYÚSCULAS' && mayus['Anuncio'] === 'anuncio');

chk('un payload sin pauta no devuelve nada', Object.keys(camposDePauta({ name: 'Ana', email: 'a@b.c' })).length === 0);
chk('aguanta null sin reventar', Object.keys(camposDePauta(null)).length === 0);
chk('aguanta un texto sin reventar', Object.keys(camposDePauta('hola')).length === 0);
chk('ignora las claves vacías', Object.keys(camposDePauta({ campaign_name: '   ', ad_name: '' })).length === 0);
chk('recorta a 120 caracteres', camposDePauta({ campaign_name: 'x'.repeat(400) })['Campaña'].length === 120);
chk('el orden de alias respeta el primero', camposDePauta({ campaign_name: 'A', campaign: 'B' })['Campaña'] === 'A');

// ── 2. El intake guarda y mergea ─────────────────────────────────────────────
const intake = leer('api/_lead-intake.js');
chk('intakeLead documenta custom_fields', /data: \{[^}]*custom_fields/.test(intake));
chk('lee data.custom_fields', /cfEntrada\s*=\s*data\.custom_fields/.test(intake));
chk('los escribe al crear', /custom_fields:\s*cfEntrada/.test(intake));
chk('no escribe la columna si viene vacía', /cfEntrada && Object\.keys\(cfEntrada\)\.length \?/.test(intake));
chk('al mergear respeta lo que ya había', /previos\[k\] === undefined/.test(intake));
chk('al mergear no pisa el valor anterior', /patch\.custom_fields = \{ \.\.\.previos, \.\.\.nuevos \}/.test(intake));
chk('anota si vuelve por otra pauta', /Volvió por otra pauta/.test(intake));
chk('camposDePauta se exporta', /export function camposDePauta/.test(intake));

// ── 3. El webhook por token lo pasa ──────────────────────────────────────────
const hook = leer('api/hook/[token].js');
chk('el hook importa camposDePauta', /import \{[^}]*camposDePauta[^}]*\} from '\.\.\/_lead-intake\.js'/.test(hook));
chk('el hook extrae la pauta del payload', /camposDePauta\(gBody\)/.test(hook));
chk('el hook la pasa al intake', /mapped\.custom_fields = \{ \.\.\.\(mapped\.custom_fields \|\| \{\}\), \.\.\.pauta \}/.test(hook));

// ── 4. El webhook de Meta la pide a Graph ────────────────────────────────────
const metaHook = leer('api/webhooks/meta.js');
chk('meta.js importa camposDePauta', /import \{[^}]*camposDePauta[^}]*\}/.test(metaHook));
chk('pide campaign_name a Graph', /campaign_name/.test(metaHook));
chk('pide adset_name a Graph', /adset_name/.test(metaHook));
chk('pide ad_name a Graph', /ad_name/.test(metaHook));
// La trampa que rompería todo en silencio: al pasar `fields`, Graph deja de
// mandar los de por defecto. Sin field_data explícito no llega ni el lead.
chk('NO se olvida de field_data al pasar fields', /fields=\$\{CAMPOS\}/.test(metaHook) && /CAMPOS\s*=\s*'field_data,/.test(metaHook));
chk('pasa custom_fields al intake', /custom_fields: Object\.keys\(pauta\)\.length \? pauta : undefined/.test(metaHook));
chk('usa el ad_id como respaldo', /value\.ad_id/.test(metaHook));

// ── 5. La lista puede enseñarlos como columnas ───────────────────────────────
const app = leer('public/app.js');
chk('la lista descubre los campos propios', /Object\.keys\(cf\)\.forEach/.test(app));
chk('el título de la columna sale de la clave', /label: k\.replace\(\/_\/g, ' '\)/.test(app));
chk('las claves elegidas no llevan guion bajo', !/Campa[nñ]a_|Conjunto_|Anuncio_/.test(intake));

// ── Resultado ────────────────────────────────────────────────────────────────
console.log(`\n  ${ok}/${ok + fallos.length} comprobaciones`);
if (fallos.length) {
  console.log('\n  Fallan:');
  fallos.forEach(f => console.log('   ✗ ' + f));
  process.exit(1);
}
console.log('  Todo en orden.\n');
