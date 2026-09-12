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

// ── 5. El lead entra en el ámbito donde el cliente trabaja ───────────────────
//
// Toda cuenta acaba con dos ámbitos: el `client_id` nulo del registro, con un
// tablero «Principal» vacío, y el `pro_main` donde viven los leads de verdad.
// Los dos webhooks entraban con null fijo, así que dejaban el lead en un
// tablero que nadie mira. Y no se arregla borrando el tablero vacío: sin
// ningún tablero en ese ámbito el lead entraría SIN tablero, que es peor.
chk('ambitoDeTrabajo se exporta', /export async function ambitoDeTrabajo/.test(intake));
chk('resuelve pro_main cuando existe', /client_id=eq\.pro_main/.test(intake));
chk('una agencia con varios clientes no se adivina', /return \(Array\.isArray\(filas\) && filas\.length\) \? 'pro_main' : null/.test(intake));
chk('el hook ya no pasa null fijo', !/intakeLead\(conn\.user_id, null,/.test(hook));
chk('el hook usa el ámbito de la conexión', /conn\.client_id \|\| await ambitoDeTrabajo\(conn\.user_id\)/.test(hook));
chk('el hook pide client_id al buscar la conexión', /select=user_id,client_id/.test(hook));
chk('meta.js ya no pasa null fijo', !/intakeLead\(connection\.user_id, null,/.test(metaHook));
chk('meta.js usa el ámbito de la conexión', /connection\.client_id \|\| await ambitoDeTrabajo/.test(metaHook));
chk('meta.js respeta el tablero del canal', /pipelineId: connection\.pipeline_id/.test(metaHook));

// ── 6. Una cuenta sin equipo también recibe su pendiente ─────────────────────
//
// asignarLead salía con `return null` antes de crear la tarea de primer
// contacto, asi que una cuenta de una sola persona recibia los leads de su
// pauta sin ningun pendiente — con la casilla marcada y el plazo puesto.
chk('si no hay comercial, igual se crea la tarea', /if \(!com\) \{[\s\S]{0,200}crearTareaPrimerContacto\(userId, created, null\)/.test(intake));
chk('se recoge lo que devuelve asignarLead', /const com = await asignarLead\(/.test(intake));
const followup = leer('api/_followup.js');
chk('la tarea no necesita responsable', /const quien = comercial\?\.nombre \? /.test(followup));
chk('la tarea cuelga de la cuenta, no de una persona', !/assigned_to/.test(followup.slice(followup.indexOf('crearTareaPrimerContacto'), followup.indexOf('crearTareaVentana'))));
chk('el ajuste sigue mandando sobre si se crea', /if \(!regla\.primer_contacto\) return null;/.test(followup));

// ── 7. En una cuenta de una persona, los leads son del dueño ─────────────────
//
// comercialesActivos solo lee team_members, asi que sin equipo no habia
// candidato y el lead quedaba «Sin asignar» — con el filtro «Míos» vacio y la
// ficha diciendo que no era de nadie, en una cuenta de un solo usuario.
const assign = leer('api/_assign.js');
const appJs = leer('public/app.js');
chk('existe el dueño como comercial', /async function duenoComoComercial/.test(assign));
chk('sin equipo, el lead va al dueño', /if \(!equipo\.length\) return await duenoComoComercial\(userId\);/.test(assign));
chk('el equipo se lee ANTES que la regla', assign.indexOf('const equipo = await comercialesActivos(userId);') < assign.indexOf("if (regla.modo === 'off') return null;"));
chk('al dueño no se le manda el correo de asignación', /if \(!com\.esDueno\) await avisarComercial/.test(assign));
chk('el dueño va marcado para poder distinguirlo', /esDueno: true/.test(assign));
chk('sigue habiendo reparto real cuando hay equipo', /regla\.modo === 'fijo'/.test(assign) && /equipo\[\(idx \+ 1\) % equipo\.length\]/.test(assign));
chk('Ajustes ya no pide invitar a nadie para asignar',
    !/el reparto necesita al menos un comercial/.test(appJs) && /todos los leads nuevos se te asignan a ti/.test(appJs));

chk('la copia de la raíz está sincronizada', leer('app.js').includes('todos los leads nuevos se te asignan a ti'));

// ── 8. El lead de pauta alimenta el Pulso ────────────────────────────────────
//
// El Pulso del inicio se calcula en el navegador a partir de /api/leads, asi
// que lo que hay que garantizar aqui son sus dependencias: que el lead entre
// en el ambito que el Pulso mira, que la fecha tenga respaldo y que un lead
// con tarea no se cuente como abandonado.
chk('el Pulso filtra por el ámbito del cliente activo',
    /const leads = activo \? todos\.filter\(l => l\.client_id === activo\) : todos;/.test(appJs));
chk('«sin actividad» respalda updated_at con created_at',
    /new Date\(l\.updated_at \|\| l\.created_at\)/.test(appJs));
chk('un lead con tarea no cuenta como abandonado',
    /!tieneSeguimientoProgramado\(l\)/.test(appJs));
chk('carga las tareas antes de decidir, aunque no se haya abierto el CRM',
    /await crmTareasCargar\(\);/.test(appJs));
chk('«lead nuevo hoy» se mide por created_at',
    /const fresh = leads\.filter\(l => \(now - new Date\(l\.created_at\)\.getTime\(\)\) < DAY\);/.test(appJs));

// ── 9. La lista puede enseñarlos como columnas ───────────────────────────────
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
