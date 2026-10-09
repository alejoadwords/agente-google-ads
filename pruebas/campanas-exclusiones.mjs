// «No enviar a» llega al envío real: node pruebas/campanas-exclusiones.mjs
//
// Hasta el 09-10-2026 la tarjeta «No enviar a» del asistente solo existía en
// pantalla: el contador descontaba a los excluidos, pero cmpWSave() guardaba la
// audiencia SIN exclude_tags ni exclude_list_ids, y el encolado lee la
// audiencia guardada. El número que se veía no era el que salía.
//
// La cadena entera, sin atajos:
//   1. cmpBuilderOpen y cmpWSave tal cual están en public/app.js (red de mentira)
//   2. ese cuerpo se guarda como borrador en la base de verdad
//   3. la audiencia se relee de la fila y se resuelve con resolveAudience(),
//      la MISMA función con la que api/campaigns.js encola
//   4. y el contador del asistente (contarAudiencia) tiene que dar lo mismo.
//
// NO se encola nada: una fila en campaign_recipients la recoge cron-campaigns
// en menos de diez minutos y el correo sale de verdad. Cuenta inventada, con
// correos en .test, y se borra todo al final.

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SUFIJO = randomUUID().slice(0, 8);
const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const CUENTA = `user_prueba_excl_${SUFIJO}`;

const cru = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
const TOK = Buffer.from(cru.replace(/^go-keyring-base64:/, ''), 'base64').toString('utf8').trim();

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'User-Agent': 'SupabaseCLI/2.72.7' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) { console.error(t.slice(0, 500)); process.exit(1); }
  try { return JSON.parse(t); } catch { return []; }
}

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra !== undefined && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const claves = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${TOK}`, 'User-Agent': 'SupabaseCLI/2.72.7' },
}).then(r => r.json());
process.env.SUPABASE_URL = `https://${PROYECTO}.supabase.co`;
process.env.SUPABASE_SERVICE_KEY = claves.find(k => k.name === 'service_role').api_key;

// ── El mundo ─────────────────────────────────────────────────────────────────
// Todos con la etiqueta «vip», que es la audiencia. Cada uno cae fuera por
// UN motivo distinto, salvo L1, que es el único al que le debe llegar.
const L = Object.fromEntries(['ok', 'cliente', 'lista', 'moroso', 'baja', 'sinCorreo', 'rebote'].map(k => [k, randomUUID()]));
const correo = k => `excl.${k}.${SUFIJO}@ejemplo-acuarius.test`;
const LS = randomUUID();   // estática de exclusión: L.lista
const LD = randomUUID();   // dinámica de exclusión: etiqueta «moroso»
const LI = randomUUID();   // estática de INCLUSIÓN, para el modo «Lista guardada»
const CAMP = randomUUID();

const limpiar = () => sql(`
  delete from public.email_events where to_email like 'excl.%.${SUFIJO}@ejemplo-acuarius.test';
  delete from public.campaign_recipients where campaign_id='${CAMP}';
  delete from public.campaigns where user_id='${CUENTA}';
  delete from public.lead_lists where user_id='${CUENTA}';
  delete from public.leads where user_id='${CUENTA}';`);
await limpiar();
// Lo que dejó una pasada que se cayó a mitad (no llegó al limpiar() del
// final). Solo lo de más de una hora, para no pisar otra pasada en curso.
await sql(`
  delete from public.campaign_recipients where campaign_id in (select id from public.campaigns where user_id like 'user\\_prueba\\_excl\\_%' and created_at < now() - interval '1 hour');
  delete from public.campaigns where user_id like 'user\\_prueba\\_excl\\_%' and created_at < now() - interval '1 hour';
  delete from public.lead_lists where user_id like 'user\\_prueba\\_excl\\_%' and created_at < now() - interval '1 hour';
  delete from public.leads where user_id like 'user\\_prueba\\_excl\\_%' and created_at < now() - interval '1 hour';
  delete from public.email_events where to_email like 'excl.%@ejemplo-acuarius.test' and created_at < now() - interval '1 hour';`);

await sql(`
insert into public.leads (id, user_id, client_id, name, email, stage, source, tags) values
 ('${L.ok}','${CUENTA}',null,'Le llega','${correo('ok')}','nuevo','manual','{vip}'),
 ('${L.cliente}','${CUENTA}',null,'Excluido por etiqueta','${correo('cliente')}','nuevo','manual','{vip,cliente}'),
 ('${L.lista}','${CUENTA}',null,'Excluido por lista estática','${correo('lista')}','nuevo','manual','{vip}'),
 ('${L.moroso}','${CUENTA}',null,'Excluido por lista dinámica','${correo('moroso')}','nuevo','manual','{vip,moroso}'),
 ('${L.baja}','${CUENTA}',null,'Dado de baja','${correo('baja')}','nuevo','manual','{vip,no-email}'),
 ('${L.sinCorreo}','${CUENTA}',null,'Sin correo',null,'nuevo','manual','{vip}'),
 ('${L.rebote}','${CUENTA}',null,'Rebotó','${correo('rebote')}','nuevo','manual','{vip}');
insert into public.lead_lists (id, user_id, client_id, name, kind, lead_ids, filters) values
 ('${LS}','${CUENTA}',null,'No molestar','static','{${L.lista}}','{}'),
 ('${LD}','${CUENTA}',null,'Morosos','dynamic','{}','{"tags":["moroso"]}'),
 ('${LI}','${CUENTA}',null,'Seleccionados','static','{${L.ok},${L.cliente},${L.lista},${L.moroso}}','{}');
insert into public.email_events (resend_id, event, to_email) values ('rs_prueba_excl_${SUFIJO}','bounced','${correo('rebote')}');`);

const { resolveAudience, contarAudiencia } = await import('../api/campaigns.js');

// ── El asistente, tal cual está en public/app.js ─────────────────────────────
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const trozo = (firma) => {
  const ini = app.search(new RegExp('^' + firma.replace(/[()]/g, '\\$&'), 'm'));
  if (ini < 0) throw new Error('No está en public/app.js: ' + firma);
  return app.slice(ini, app.indexOf('\n}\n', ini) + 3);
};

// Lo que el asistente le mandaría al servidor al guardar.
async function guardarDesdeAsistente(w) {
  let cuerpo;
  const mundo = {
    _cmpW: w, agencyActiveClientId: null,
    fetchAuth: async (url, init) => { cuerpo = JSON.parse(init.body); return new Response(JSON.stringify({ campaign: { id: CAMP } })); },
  };
  const fn = new Function(...Object.keys(mundo), trozo('async function cmpWSave()') + '\nreturn cmpWSave;')(...Object.values(mundo));
  await fn();
  return cuerpo;
}

// Lo que el asistente carga al abrir una campaña guardada para editarla.
function abrirEnAsistente(c) {
  const nada = () => {};
  const elemento = { remove: nada, appendChild: nada, set innerHTML(_) {}, get innerHTML() { return ''; } };
  const mundo = {
    cmpList: [c], _cmpChannel: 'email', _cmpAudTags: [], _smsEstado: {},
    document: { getElementById: () => null, createElement: () => ({ ...elemento }), body: elemento },
    ddConvertirSelects: nada, MutationObserver: class { observe() {} }, cmpWRender: nada, smsCargarEstado: nada,
  };
  const cuerpo = 'let _cmpW = null;\n' + trozo('function cmpBuilderOpen(id, canal)') + '\ncmpBuilderOpen(arguments[0]);\nreturn _cmpW;';
  return new Function(...Object.keys(mundo), cuerpo.replace('arguments[0]', JSON.stringify(c.id)))(...Object.values(mundo));
}

const asistente = {
  id: null, channel: 'email', name: 'Prueba exclusiones', subject: 'Hola', body: 'Hola {{nombre}}',
  mode: 'filters', tags: ['vip'], stage: '', source: '', list_id: '', lead_ids: [],
  exclude_list_ids: [LS, LD], exclude_tags: ['cliente'], utm: true,
};

console.log('\n1. El asistente guarda las exclusiones\n');
const payload = await guardarDesdeAsistente(asistente);
chk('exclude_tags va en la audiencia', JSON.stringify(payload.audience.exclude_tags) === '["cliente"]', JSON.stringify(payload.audience));
chk('exclude_list_ids va en la audiencia', JSON.stringify(payload.audience.exclude_list_ids) === JSON.stringify([LS, LD]), JSON.stringify(payload.audience));
chk('y la audiencia en sí sigue igual', JSON.stringify(payload.audience.tags) === '["vip"]');

// Como lo guarda el POST de api/campaigns.js: audience tal cual llega.
await sql(`insert into public.campaigns (id, user_id, client_id, name, channel, subject, body, audience, status)
  values ('${CAMP}','${CUENTA}',null,'Prueba exclusiones','email','Hola','Hola','${JSON.stringify(payload.audience).replace(/'/g, "''")}','draft');`);
const fila = (await sql(`select * from public.campaigns where id='${CAMP}'`))[0];
console.log('\n2. La fila guardada\n');
console.log('     audience = ' + JSON.stringify(fila.audience));
chk('la base conserva las exclusiones', (fila.audience.exclude_tags || []).includes('cliente') && (fila.audience.exclude_list_ids || []).length === 2);

console.log('\n3. Al editar, el asistente las vuelve a cargar\n');
const reabierta = abrirEnAsistente(fila);
chk('exclude_tags cargado', JSON.stringify(reabierta.exclude_tags) === '["cliente"]', JSON.stringify(reabierta.exclude_tags));
chk('exclude_list_ids cargado', JSON.stringify(reabierta.exclude_list_ids) === JSON.stringify([LS, LD]), JSON.stringify(reabierta.exclude_list_ids));
const otraVez = await guardarDesdeAsistente({ ...asistente, ...reabierta, id: CAMP });
// jsonb reordena las claves: se compara el contenido, no el texto.
const igual = (x, y) => JSON.stringify(x, Object.keys(x).sort()) === JSON.stringify(y, Object.keys(y).sort());
chk('y guardar de nuevo no las borra', igual(otraVez.audience, fila.audience), JSON.stringify(otraVez.audience));

console.log('\n4. Los destinatarios, con la función del encolado\n');
const nombre = Object.fromEntries(Object.entries(L).map(([k, v]) => [v, k]));
const { leads } = await resolveAudience(CUENTA, null, fila.audience, 'email');
console.log('     le llega a: ' + leads.map(l => nombre[l.id]).join(', '));
chk('solo le llega a quien debe', leads.length === 1 && leads[0].id === L.ok, leads.map(l => nombre[l.id]).join(','));
const conteo = await contarAudiencia(CUENTA, null, fila.audience, 'email');
console.log('     contador: ' + conteo.count + ' · ' + JSON.stringify(conteo.breakdown));
chk('el contador dice lo mismo que sale', conteo.count === leads.length, conteo.count);
chk('3 en «No enviar a», 1 baja, 1 sin correo, 1 rebote',
  conteo.breakdown.excluidos === 3 && conteo.breakdown.unsubscribed === 1 && conteo.breakdown.missing === 1 && conteo.breakdown.rebotados === 1,
  JSON.stringify(conteo.breakdown));

console.log('\n5. Modo «Lista guardada»: el contador antes perdía las exclusiones\n');
const enLista = (await guardarDesdeAsistente({ ...asistente, mode: 'list', list_id: LI, exclude_list_ids: [LS], exclude_tags: ['cliente', 'moroso'] })).audience;
const rl = await resolveAudience(CUENTA, null, enLista, 'email');
const cl = await contarAudiencia(CUENTA, null, enLista, 'email');
chk('sale solo L1', rl.leads.length === 1 && rl.leads[0].id === L.ok, rl.leads.map(l => nombre[l.id]).join(','));
chk('y el contador coincide (antes daba 4)', cl.count === rl.leads.length, cl.count);

console.log('\n6. Fallar a la vista\n');
const borrada = { tags: ['vip'], exclude_list_ids: [randomUUID()], exclude_tags: [] };
let error = null;
try { await resolveAudience(CUENTA, null, borrada, 'email'); } catch (e) { error = e; }
chk('una lista de exclusión borrada frena el encolado (no excluye «a nadie»)', /ya no existe/.test(error?.message || ''), error?.message);
error = null;
try { await contarAudiencia(CUENTA, null, borrada, 'email'); } catch (e) { error = e; }
chk('y el contador lo dice', /ya no existe/.test(error?.message || ''), error?.message);
const vieja = await resolveAudience(CUENTA, null, { tags: ['vip'], stage: null, source: null }, 'email');
chk('una campaña sin exclusiones (formato viejo) sigue igual', vieja.leads.length === 4, vieja.leads.length);

console.log('\n7. Nada salió\n');
const cola = await sql(`select count(*)::int n from public.campaign_recipients where campaign_id='${CAMP}'`);
chk('ni un destinatario encolado', cola[0].n === 0, cola[0].n);

await limpiar();
const quedan = await sql(`select (select count(*) from public.leads where user_id='${CUENTA}') + (select count(*) from public.campaigns where user_id='${CUENTA}') + (select count(*) from public.lead_lists where user_id='${CUENTA}') as n`);
chk('limpieza: no queda nada de la prueba', Number(quedan[0].n) === 0, quedan[0].n);

console.log(fallos ? `\n${fallos} fallos\n` : '\nTodo en verde\n');
process.exit(fallos ? 1 : 0);
