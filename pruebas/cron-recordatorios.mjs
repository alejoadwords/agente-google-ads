// El cron de recordatorios: node pruebas/cron-recordatorios.mjs
//
// Ejecuta el cron DE VERDAD contra la base, con citas sembradas a distintas
// distancias, e intercepta las salidas a Resend y a Meta para no escribirle a
// nadie. Es la única forma de comprobar lo que de verdad importa aquí:
//
//   · que avisa a quien toca y solo a quien toca,
//   · que NO avisa dos veces — el fallo más caro, porque el cliente lo nota,
//   · que si se pierde una ejecución el aviso sale tarde y no se pierde,
//   · que WhatsApp sale solo en el aviso más cercano.
//
// Siembra y borra su propia cuenta de prueba. No toca ninguna cuenta real.

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Identidad propia en cada pasada: con identificadores fijos, dos pasadas a la
// vez —dos sesiones trabajando, o la batería lanzada dos veces— se pisaban y
// salía «clave duplicada» o «queda algo de la prueba». Falla una vez de cada
// tantas, que es la peor clase de prueba: la que enseña a no creerse los rojos.
const SUFIJO = randomUUID().slice(0, 8);

// Esta prueba NO se puede aislar con identificadores propios, y conviene que
// quede escrito: dispara el cron de verdad, y el cron recorre TODAS las
// cuentas. Si otra pasada tiene citas montadas, también las avisa, y entonces
// «avisa exactamente a dos citas» ve cuatro. No es un fallo del cron: es que
// la prueba mide un total global.
//
// Así que se pide turno. Un `mkdir` es atómico: o lo creas tú o ya estaba.
// Si el turno lleva más de cinco minutos, se da por muerto —una pasada que
// reventó sin soltarlo— y se toma igual.
const TURNO = join(tmpdir(), 'acuarius-prueba-recordatorios.lock');
for (let espera = 0; ; espera++) {
  try { mkdirSync(TURNO); break; } catch {
    let edad = Infinity;
    try { edad = Date.now() - statSync(TURNO).mtimeMs; } catch { continue; }
    if (edad > 5 * 60000) { try { rmSync(TURNO, { recursive: true }); } catch {} continue; }
    if (espera === 0) console.log('  · otra pasada lo está corriendo; esperando turno');
    if (espera > 120) { console.error('  ✗ no se liberó el turno en dos minutos'); process.exit(1); }
    await new Promise(r => setTimeout(r, 1000));
  }
}
process.on('exit', () => { try { rmSync(TURNO, { recursive: true }); } catch {} });

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const CUENTA = `user_prueba_recordatorios_${SUFIJO}`;

function tokenDelLlavero() {
  const cru = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
  return Buffer.from(cru.replace(/^go-keyring-base64:/, ''), 'base64').toString('utf8').trim();
}
const TOK = tokenDelLlavero();

async function sql(consulta) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'User-Agent': 'SupabaseCLI/2.72.7' },
    body: JSON.stringify({ query: consulta }),
  });
  const t = await r.text();
  if (!r.ok) { console.error(t.slice(0, 400)); process.exit(1); }
  try { return JSON.parse(t); } catch { return []; }
}

async function serviceKey() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${TOK}`, 'User-Agent': 'SupabaseCLI/2.72.7' },
  });
  const j = await r.json();
  return j.find(x => x.name === 'service_role').api_key;
}

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

// ── Interceptar las salidas ────────────────────────────────────────────────
// Se deja pasar Supabase; Resend y Meta se apuntan y se responden con un ok.
const enviados = { correo: [], whatsapp: [] };
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.resend.com')) {
    enviados.correo.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'falso' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.startsWith('https://graph.facebook.com')) {
    enviados.whatsapp.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ messages: [{ id: 'falso' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return fetchReal(url, opts);
};

process.env.SUPABASE_URL = `https://${PROYECTO}.supabase.co`;
process.env.SUPABASE_SERVICE_KEY = await serviceKey();
process.env.RESEND_API_KEY = 'falsa-para-la-prueba';
process.env.CRON_SECRET = 'secreto-de-prueba';

const { default: cron } = await import('../api/cron-recordatorios.js');

function correr() {
  enviados.correo.length = 0; enviados.whatsapp.length = 0;
  let salida = null;
  const res = { status: () => ({ json: (d) => { salida = d; } }) };
  return cron({ headers: { authorization: 'Bearer secreto-de-prueba' } }, res).then(() => salida);
}

async function limpiar() {
  await sql(`
    delete from public.activities where user_id = '${CUENTA}';
    delete from public.leads where user_id = '${CUENTA}';
    delete from public.booking_settings where user_id = '${CUENTA}';
    delete from public.channel_connections where user_id = '${CUENTA}';`);
}

// ── Siembra ────────────────────────────────────────────────────────────────
await limpiar();
await sql(`
insert into public.booking_settings (user_id, client_id, token, nombre_negocio, zona_horaria,
  horario, excepciones, recordatorios, activo, wa_template)
values ('${CUENTA}','', 'dddd1111eeee2222${SUFIJO}','Negocio de Prueba','America/Bogota',
  '{}'::jsonb, '{}'::jsonb, '[24, 2]'::jsonb, true,
  '{"name":"recordatorio_de_cita","language":"es"}'::jsonb);

insert into public.channel_connections (user_id, channel, external_id, access_token, is_active)
values ('${CUENTA}','whatsapp','111222333_${SUFIJO}','TOKEN-FALSO',true);

insert into public.leads (user_id, name, email, phone, stage, source)
values ('${CUENTA}','Cliente Prueba','cliente@ejemplo-prueba.test','+57 300 000 1111','nuevo','reserva');
`);

const lead = (await sql(`select id from public.leads where user_id='${CUENTA}' limit 1;`))[0].id;

const cita = (nombre, minutosDesdeAhora, extra = '') => `
insert into public.activities (user_id, client_id, lead_id, type, title, due_at, end_at,
  booking_token, booking_status ${extra ? ', recordatorios_enviados' : ''})
values ('${CUENTA}', null, '${lead}', 'meeting', '${nombre}',
  now() + interval '${minutosDesdeAhora} minutes', now() + interval '${minutosDesdeAhora + 30} minutes',
  md5('${nombre}_${SUFIJO}'), 'confirmada' ${extra ? ', ' + extra : ''});`;

await sql([
  cita('dentro de 90 min', 90),          // toca el aviso de 2 h
  cita('dentro de 20 h', 20 * 60),       // toca el de 24 h
  cita('dentro de 30 h', 30 * 60),       // todavía no toca nada
  cita('ya avisada', 90, `'[2]'::jsonb`), // su aviso de 2 h ya salió
].join('\n'));

// Una cancelada y una reunión normal de la agenda: ninguna debe recibir nada.
await sql(`
insert into public.activities (user_id, lead_id, type, title, due_at, booking_token, booking_status, cancelled_at)
values ('${CUENTA}','${lead}','meeting','cancelada', now() + interval '80 minutes', md5('cancelada_${SUFIJO}'), 'cancelada', now());
insert into public.activities (user_id, lead_id, type, title, due_at)
values ('${CUENTA}','${lead}','meeting','reunion a mano', now() + interval '85 minutes');`);

const titulosDe = (lista) => lista.map(m => String(m.subject || '')).join(' | ');

console.log('\nA quién avisa, y a quién no\n');
{
  const r = await correr();
  chk('el cron termina bien', r && r.ok === true, JSON.stringify(r));
  chk('avisa exactamente a dos citas', r.avisados === 2, 'avisados: ' + r.avisados);
  chk('salen dos correos', enviados.correo.length === 2, titulosDe(enviados.correo));

  const marcas = await sql(`select title, recordatorios_enviados::text as m from public.activities
    where user_id='${CUENTA}' order by title;`);
  const m = Object.fromEntries(marcas.map(x => [x.title, x.m]));
  chk('la de 90 min queda marcada con el aviso de 2 h', m['dentro de 90 min'] === '[2]', m['dentro de 90 min']);
  chk('la de 20 h queda marcada con el de 24 h', m['dentro de 20 h'] === '[24]', m['dentro de 20 h']);
  chk('la de 30 h sigue sin marcar', m['dentro de 30 h'] == null, String(m['dentro de 30 h']));
  chk('la ya avisada no se vuelve a marcar', m['ya avisada'] === '[2]', m['ya avisada']);

  // Una cita cancelada y una reunión puesta a mano en la agenda no son
  // reservas. Avisar de cualquiera de las dos sería escribirle a alguien por
  // algo que no existe.
  chk('a la cancelada no se le avisa', m['cancelada'] == null);
  chk('a una reunión normal de la agenda tampoco', m['reunion a mano'] == null);
}

console.log('\nWhatsApp solo en el aviso más cercano\n');
{
  chk('sale un solo WhatsApp', enviados.whatsapp.length === 1, String(enviados.whatsapp.length));
  const w = enviados.whatsapp[0];
  chk('es de tipo plantilla', w && w.type === 'template');
  chk('usa la plantilla configurada', w && w.template.name === 'recordatorio_de_cita');
  chk('manda los tres huecos, en orden', w && w.template.components[0].parameters.length === 3,
      JSON.stringify(w && w.template.components));
  chk('el primero es el nombre de la persona',
      w && w.template.components[0].parameters[0].text === 'Cliente Prueba');
  chk('el segundo, el del negocio',
      w && w.template.components[0].parameters[1].text === 'Negocio de Prueba');
  chk('y el tercero, cuándo es la cita',
      w && /\d{1,2}:\d{2}/.test(w.template.components[0].parameters[2].text),
      w && w.template.components[0].parameters[2].text);
  // El aviso de 24 h NO lleva WhatsApp: dos mensajes por una misma cita es
  // como se consigue que bloqueen el número del negocio.
  chk('el aviso de 24 h fue solo por correo',
      enviados.whatsapp.length === 1 && enviados.correo.length === 2);
}

console.log('\nNadie recibe el mismo aviso dos veces\n');
{
  const r = await correr();
  chk('la segunda pasada no avisa a nadie', r.avisados === 0, 'avisados: ' + r.avisados);
  chk('y no manda ni un correo', enviados.correo.length === 0, String(enviados.correo.length));
  chk('ni un WhatsApp', enviados.whatsapp.length === 0, String(enviados.whatsapp.length));
}

console.log('\nUna ejecución perdida no pierde el aviso\n');
{
  // Se deshace la marca de la cita de 20 h y se la acerca a 90 minutos: es lo
  // que pasa si el cron no corrió en todo ese rato. Debe salir el aviso de 2 h,
  // no el de 24 que ya quedó atrás.
  await sql(`update public.activities
    set due_at = now() + interval '90 minutes', end_at = now() + interval '120 minutes',
        recordatorios_enviados = null
    where user_id='${CUENTA}' and title='dentro de 20 h';`);
  const r = await correr();
  chk('la recupera en la siguiente pasada', r.avisados === 1, 'avisados: ' + r.avisados);
  const m = (await sql(`select recordatorios_enviados::text as m from public.activities
    where user_id='${CUENTA}' and title='dentro de 20 h';`))[0].m;
  chk('y manda el aviso CERCANO, no el que ya pasó', m === '[2]', m);
}

console.log('\nSin recordatorios configurados no se manda nada\n');
{
  await sql(`update public.activities set recordatorios_enviados = null where user_id='${CUENTA}';
             update public.booking_settings set recordatorios = '[]'::jsonb where user_id='${CUENTA}';`);
  const r = await correr();
  chk('con la lista vacía, cero avisos', r.avisados === 0, 'avisados: ' + r.avisados);

  // Y con la página apagada tampoco: apagarla es dejar de operar por ahí.
  await sql(`update public.booking_settings set recordatorios='[24,2]'::jsonb, activo=false where user_id='${CUENTA}';`);
  const r2 = await correr();
  chk('con la página apagada, cero avisos', r2.avisados === 0, 'avisados: ' + r2.avisados);
}

console.log('\nNo se puede disparar desde fuera\n');
{
  let salida = null;
  const res = { status: (c) => ({ json: (d) => { salida = { c, d }; } }) };
  await cron({ headers: {} }, res);
  chk('sin el secreto, 401', salida && salida.c === 401, JSON.stringify(salida));
}

await limpiar();
const queda = await sql(`select
  (select count(*) from public.activities where user_id='${CUENTA}') as a,
  (select count(*) from public.leads where user_id='${CUENTA}') as l,
  (select count(*) from public.booking_settings where user_id='${CUENTA}') as s,
  (select count(*) from public.channel_connections where user_id='${CUENTA}') as c;`);
console.log('\nLimpieza\n');
chk('no queda ni un dato de prueba en la base',
    Object.values(queda[0]).every(v => Number(v) === 0), JSON.stringify(queda[0]));

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
