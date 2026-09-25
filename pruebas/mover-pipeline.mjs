// Mover un lead de proceso de venta: node pruebas/mover-pipeline.mjs
//
// El peligro no es mover el lead, es la ETAPA. Cada proceso tiene las suyas, y
// un lead cuya etapa no existe en el proceso destino DESAPARECE del tablero —
// la aplicación ya tiene un aviso para esos leads huérfanos
// (`crmAvisoEtapasAjenas`), y esta función no puede fabricarlos.
//
// El otro peligro es callado: un proceso pertenece a un cliente. Mover el lead
// a uno de OTRO cliente lo cambiaría de cartera sin decirlo.
//
// Se prueba contra la base de verdad con una cuenta inventada, que se borra.

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';

// Cada pasada usa SU cuenta y SUS identificadores. Con unos fijos, dos pasadas
// a la vez —dos sesiones trabajando en el repo, o la batería lanzada dos
// veces— se pisaban: una limpiaba lo que la otra acababa de insertar, y salía
// «clave duplicada» o «queda algo de la prueba». Falla una vez de cada tantas,
// que es la peor clase de prueba: la que enseña a no creerse los rojos.
const PREFIJO = 'user_prueba_mover';
const CUENTA = `${PREFIJO}_${randomUUID().slice(0, 8)}`;

const PRINCIPAL = randomUUID();
const ARRIENDO  = randomUUID();
const AJENO     = randomUUID();
const COMPARTE  = randomUUID();   // etapa «contactado», existe en los dos
const HUERFANA  = randomUUID();   // etapa «nuevo», NO existe en Arriendo

const cru = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
const TOK = Buffer.from(cru.replace(/^go-keyring-base64:/, ''), 'base64').toString('utf8').trim();

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'User-Agent': 'SupabaseCLI/2.72.7' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) { console.error(t.slice(0, 400)); process.exit(1); }
  try { return JSON.parse(t); } catch { return []; }
}

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const claves = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${TOK}`, 'User-Agent': 'SupabaseCLI/2.72.7' },
}).then(r => r.json());
process.env.SUPABASE_URL = `https://${PROYECTO}.supabase.co`;
process.env.SUPABASE_SERVICE_KEY = claves.find(k => k.name === 'service_role').api_key;

const limpiar = () => sql(`
  delete from public.lead_activities where user_id='${CUENTA}';
  delete from public.leads where user_id='${CUENTA}';
  delete from public.pipeline_stages where user_id='${CUENTA}';
  delete from public.pipelines where user_id='${CUENTA}';`);
await limpiar();

// Restos de pasadas que se interrumpieron: se barren las cuentas del mismo
// prefijo con más de una hora. El corte por edad es lo que deja convivir dos
// pasadas simultáneas sin que una se lleve por delante a la otra.
await sql(`
  delete from public.lead_activities where user_id like '${PREFIJO}%' and created_at < now() - interval '1 hour';
  delete from public.leads           where user_id like '${PREFIJO}%' and created_at < now() - interval '1 hour';
  delete from public.pipeline_stages where user_id like '${PREFIJO}%' and created_at < now() - interval '1 hour';
  delete from public.pipelines       where user_id like '${PREFIJO}%' and created_at < now() - interval '1 hour';`);

// Dos procesos del MISMO cliente con etapas distintas, y uno de OTRO cliente.
await sql(`
insert into public.pipelines (id, user_id, client_id, name, is_default, position) values
  ('${PRINCIPAL}','${CUENTA}', null, 'Principal', true, 0),
  ('${ARRIENDO}','${CUENTA}', null, 'Arriendo', false, 1),
  ('${AJENO}','${CUENTA}', 'cli_otro', 'De otro cliente', false, 2);

insert into public.pipeline_stages (user_id, pipeline_id, key, label, position) values
  ('${CUENTA}','${PRINCIPAL}','nuevo','Nuevo',0),
  ('${CUENTA}','${PRINCIPAL}','contactado','Contactado',1),
  ('${CUENTA}','${PRINCIPAL}','ganado','Ganado',2),
  ('${CUENTA}','${ARRIENDO}','visita','Visita al inmueble',0),
  ('${CUENTA}','${ARRIENDO}','contactado','Contactado',1),
  ('${CUENTA}','${ARRIENDO}','ganado','Ganado',2),
  ('${CUENTA}','${AJENO}','nuevo','Nuevo',0);

insert into public.leads (id, user_id, client_id, name, stage, stage_position, pipeline_id, source) values
  ('${COMPARTE}','${CUENTA}', null, 'Comparte etapa', 'contactado', 5, '${PRINCIPAL}','manual'),
  ('${HUERFANA}','${CUENTA}', null, 'Etapa huerfana', 'nuevo', 5, '${PRINCIPAL}','manual');`);

const { moverDePipeline } = await import('../api/leads.js');

const sb = (p) => fetch(`${process.env.SUPABASE_URL}/rest/v1${p}`, {
  headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
}).then(r => r.json());


console.log('\nPrevisualizar no toca nada\n');
{
  const r = await moverDePipeline(CUENTA, HUERFANA, ARRIENDO, { previsualizar: true });
  const p = r.cuerpo.previsualizacion;
  chk('avisa de que la etapa va a cambiar', p && p.cambia_etapa === true, JSON.stringify(r.cuerpo));
  chk('y dice a cuál: «Visita al inmueble»', p.etapa_nueva_label === 'Visita al inmueble', p.etapa_nueva_label);
  const l = (await sb(`/leads?id=eq.${HUERFANA}&select=pipeline_id,stage`))[0];
  chk('el lead sigue donde estaba', l.pipeline_id === PRINCIPAL && l.stage === 'nuevo', JSON.stringify(l));
}

console.log('\nMover de verdad\n');
{
  const r = await moverDePipeline(CUENTA, COMPARTE, ARRIENDO);
  chk('responde ok', r.estado === 200 && r.cuerpo.ok === true, JSON.stringify(r.cuerpo));
  chk('dice que la etapa NO cambió', r.cuerpo.cambia_etapa === false);
  const l = (await sb(`/leads?id=eq.${COMPARTE}&select=pipeline_id,stage,stage_position`))[0];
  chk('está en el proceso nuevo', l.pipeline_id === ARRIENDO, l.pipeline_id);
  chk('y conserva «contactado», que existe allí', l.stage === 'contactado', l.stage);
  chk('entra al principio de la columna', Number(l.stage_position) > 1e12, String(l.stage_position));
}

console.log('\nLa etapa huérfana NO deja el lead invisible\n');
{
  const r = await moverDePipeline(CUENTA, HUERFANA, ARRIENDO);
  chk('avisa de que cambió la etapa', r.cuerpo.cambia_etapa === true);
  const l = (await sb(`/leads?id=eq.${HUERFANA}&select=pipeline_id,stage`))[0];
  chk('cae en la primera del destino', l.stage === 'visita', l.stage);

  // La comprobación que de verdad importa: su etapa EXISTE en su proceso. Si no,
  // el lead no sale en ningún tablero y solo lo encuentra quien sepa buscarlo.
  const etapas = await sb(`/pipeline_stages?pipeline_id=eq.${l.pipeline_id}&select=key`);
  chk('su etapa existe en su proceso: sale en el tablero',
      etapas.some(e => e.key === l.stage), l.stage + ' vs ' + etapas.map(e => e.key).join(','));
}

console.log('\nQueda rastro\n');
{
  const act = await sb(`/lead_activities?lead_id=eq.${HUERFANA}&select=content,metadata&order=created_at.desc&limit=1`);
  chk('se anota el movimiento', /Movido al proceso «Arriendo»/.test(act[0]?.content || ''), act[0]?.content);
  chk('y que la etapa cambió, con el motivo',
      /no existe ahí, así que entró en «Visita al inmueble»/.test(act[0]?.content || ''), act[0]?.content);
  chk('con los dos procesos en los metadatos',
      act[0]?.metadata?.desde === PRINCIPAL && act[0]?.metadata?.hasta === ARRIENDO,
      JSON.stringify(act[0]?.metadata));
}

console.log('\nLo que NO deja hacer\n');
{
  const ajeno = await moverDePipeline(CUENTA, COMPARTE, AJENO);
  chk('no mueve a un proceso de otro cliente', ajeno.estado === 400 && /otro cliente/.test(ajeno.cuerpo.error), JSON.stringify(ajeno.cuerpo));
  const sigue = (await sb(`/leads?id=eq.${COMPARTE}&select=pipeline_id,client_id`))[0];
  chk('y el lead no se movió ni cambió de cliente',
      sigue.pipeline_id === ARRIENDO && sigue.client_id === null, JSON.stringify(sigue));

  const mismo = await moverDePipeline(CUENTA, COMPARTE, ARRIENDO);
  chk('mover al mismo proceso se rechaza, no se hace dos veces',
      mismo.cuerpo.sin_cambios === true, JSON.stringify(mismo.cuerpo));

  const otraCuenta = await moverDePipeline('user_que_no_es', COMPARTE, ARRIENDO);
  chk('otra cuenta no puede tocar este lead', otraCuenta.estado === 404, JSON.stringify(otraCuenta.cuerpo));

  const inventado = await moverDePipeline(CUENTA, COMPARTE, '99999999-9999-9999-9999-999999999999');
  chk('un proceso inventado se rechaza', inventado.estado === 404, JSON.stringify(inventado.cuerpo));
}

console.log('\nEl botón lo ve quien puede usarlo\n');
{
  const app = await import('node:fs').then(m => m.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'));
  const bloque = app.slice(app.indexOf('// ── El proceso de venta del lead ─'), app.indexOf('async function crmChangeStage('));

  // EL FALLO: `window._miPerfil` SOLO se rellena cuando la persona es miembro
  // del equipo de alguien — se pone dentro de `if (window._workspace)`. Al
  // DUEÑO se le queda sin definir, así que preguntarle solo a él escondía el
  // botón justo a quien más permisos tiene. Se vio abriendo una ficha.
  //
  // Las demás propiedades del perfil (`solo_sus_leads`, `solo_lo_suyo`,
  // `modulos`) RESTRINGEN, así que «sin definir» es lo correcto para el dueño.
  // La peligrosa es la que CONCEDE, como `gestiona_equipo`.
  chk('el permiso contempla al dueño, no solo a los miembros',
      /!crmSoyMiembro \|\|[\s\S]{0,120}gestiona_equipo/.test(bloque));
  chk('y `_miPerfil` no decide solo', !/const puede = !!\(window\._miPerfil/.test(bloque));

  // Y que el que concede siga siendo el único de esa forma en toda la app.
  const concesivos = [...app.matchAll(/window\._miPerfil && window\._miPerfil\.(gestiona_equipo|toca_el_plan)/g)]
    .map(m => app.slice(0, m.index).split('\n').length);
  const sinDueno = concesivos.filter(n => {
    const ctx = app.split('\n').slice(n - 6, n + 2).join('\n');
    return !/crmSoyMiembro|_workspace/.test(ctx);
  });
  chk('ningún permiso se concede mirando solo a `_miPerfil`',
      sinDueno.length === 0, 'líneas: ' + sinDueno.join(', '));

  chk('solo se ofrecen procesos del MISMO cliente',
      /\(p\.client_id \|\| null\) === \(lead\.client_id \|\| null\)/.test(bloque));
  chk('y nunca el proceso en el que ya está',
      /p\.id !== lead\.pipeline_id/.test(bloque));
  chk('sin candidatos no se enseña el botón', /puede && candidatos\.length/.test(bloque));
}

console.log('\nLo que el endpoint NO puede dejar pasar\n');
{
  const src = await import('node:fs').then(m => m.readFileSync(new URL('../api/leads.js', import.meta.url), 'utf8'));

  chk('solo un administrador mueve de proceso',
      /if \(esMiembro && rolMiembro !== 'admin'\)[\s\S]{0,200}Solo un administrador puede mover/.test(src));
  chk('`pipeline_id` NO está entre los campos de un guardado normal',
      !/const allowed = \[[^\]]*'pipeline_id'/.test(src));
  chk('el proceso destino se busca acotado a la cuenta',
      /pipelines\?id=eq[\s\S]{0,120}user_id=eq\.\$\{encodeURIComponent\(userId\)\}/.test(src));
  chk('y del MISMO cliente: si no, se rechaza',
      /destino\.client_id \|\| null\) !== \(lead\.client_id \|\| null\)[\s\S]{0,200}otro cliente/.test(src));
  chk('un proceso sin etapas se rechaza en vez de dejar el lead en la nada',
      /todavía no tiene etapas/.test(src));
  chk('si la etapa no existe allí, cae en la PRIMERA',
      /const nueva = misma \|\| etapas\[0\];/.test(src));
  chk('y las etapas se piden ORDENADAS, o «la primera» es la que quiera la base',
      /pipeline_stages\?pipeline_id=eq[\s\S]{0,160}order=position\.asc/.test(src));
  chk('el handler pasa la previsualización a la lógica',
      /previsualizar: !!fields\.previsualizar/.test(src));
  chk('el lead entra al principio de su nueva columna',
      /stage_position: Date\.now\(\)/.test(src));
  chk('y queda registrado en el historial',
      /lead_activities[\s\S]{0,400}mover_pipeline: true/.test(src));
  chk('el registro dice que la etapa cambió, cuando cambia',
      /no existe ahí, así que entró en/.test(src));
}

await limpiar();
const queda = await sql(`select
  (select count(*) from public.leads where user_id='${CUENTA}') as leads,
  (select count(*) from public.pipelines where user_id='${CUENTA}') as pipelines;`);
console.log('\nLimpieza\n');
chk('no queda nada de la prueba',
    Number(queda[0].leads) === 0 && Number(queda[0].pipelines) === 0, JSON.stringify(queda[0]));

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
