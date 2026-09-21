// La fila espejo de `users`: node pruebas/usuario-espejo.mjs
//
// Cuatro tablas dependen de `public.users` por clave foránea —`user_profiles`,
// `chat_history`, `activity_logs` y `billing`— y esa fila NO la creaba el
// registro. Quien se daba de alta y guardaba cualquier preferencia recibía un
// 500 con un 23503: cinco cuentas entre el 10 y el 21 de septiembre de 2026.
//
// Se prueba contra la base de verdad, con un id inventado que se borra al final.

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const FALSO = 'user_prueba_espejo_0001';

const cru = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
const TOK = Buffer.from(cru.replace(/^go-keyring-base64:/, ''), 'base64').toString('utf8').trim();

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'User-Agent': 'SupabaseCLI/2.72.7' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) { console.error(t.slice(0, 300)); process.exit(1); }
  try { return JSON.parse(t); } catch { return []; }
}

let fallos = 0;
const chk = (n, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};
const lee = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const claves = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${TOK}`, 'User-Agent': 'SupabaseCLI/2.72.7' },
}).then(r => r.json());
process.env.SUPABASE_URL = `https://${PROYECTO}.supabase.co`;
process.env.SUPABASE_SERVICE_KEY = claves.find(k => k.name === 'service_role').api_key;

const { asegurarUsuario } = await import('../api/_usuario-espejo.js');

const limpiar = () => sql(`delete from public.user_profiles where user_id='${FALSO}';
                           delete from public.users where id='${FALSO}';`);
await limpiar();

console.log('\nCrear la fila cuando falta\n');
{
  const antes = await sql(`select count(*)::int as n from public.users where id='${FALSO}';`);
  chk('parte de cero', antes[0].n === 0);

  const ok = await asegurarUsuario(FALSO, 'espejo@ejemplo-prueba.test', 'Espejo Prueba');
  chk('dice que sí', ok === true);

  const fila = await sql(`select email, name from public.users where id='${FALSO}';`);
  chk('la fila existe con su correo', fila[0]?.email === 'espejo@ejemplo-prueba.test', JSON.stringify(fila));
  chk('y con su nombre', fila[0]?.name === 'Espejo Prueba');
}

console.log('\nY ahora el fallo de verdad: guardar un perfil\n');
{
  // Esto es lo que daba 500. Con la fila espejo puesta tiene que entrar.
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ user_id: FALSO, agent_key: 'prueba', profile_data: { hola: true } }),
  });
  chk('el perfil se guarda sin chocar con la clave foránea', r.ok, 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
}

console.log('\nSin la fila, el guardado SÍ falla (o esto no probaría nada)\n');
{
  await limpiar();
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ user_id: FALSO, agent_key: 'prueba', profile_data: { hola: true } }),
  });
  const cuerpo = await r.text();
  chk('da 23503, que es el error que veía el cliente',
      !r.ok && /23503|foreign key/i.test(cuerpo), 'HTTP ' + r.status);
}

console.log('\nNo repite trabajo ni inventa filas\n');
{
  await asegurarUsuario(FALSO, 'espejo@ejemplo-prueba.test', 'Espejo Prueba');
  await asegurarUsuario(FALSO, 'otro@ejemplo-prueba.test', 'Otro Nombre');
  const filas = await sql(`select email from public.users where id='${FALSO}';`);
  chk('llamarla dos veces no duplica', filas.length === 1, String(filas.length));
  // La segunda no debe pisar el correo: la fila ya existía y quien manda sobre
  // los datos es Clerk, no una llamada de paso.
  chk('ni pisa lo que ya había', filas[0].email === 'espejo@ejemplo-prueba.test', filas[0].email);

  chk('sin id no hace nada', (await asegurarUsuario(null, 'x@y.test')) === false);
  // Sin correo NO se crea: `users.email` es lo que identifica a la persona en
  // soporte y en los avisos. Una fila sin él es un fantasma.
  await sql(`delete from public.users where id='${FALSO}_b';`);
  chk('y sin correo tampoco', (await asegurarUsuario(FALSO + '_b', '')) === false ||
      (await sql(`select count(*)::int as n from public.users where id='${FALSO}_b';`))[0].n === 0);
}

console.log('\nDonde tiene que estar llamada\n');
{
  chk('profile.js la llama antes de guardar',
      /await asegurarUsuario\(userId\);[\s\S]{0,200}user_profiles\?on_conflict/.test(lee('api/profile.js')));
  chk('y también en el guardado genérico (chat_history)',
      (lee('api/profile.js').match(/await asegurarUsuario\(userId\)/g) || []).length === 2);
  chk('team.js la asegura en el primer «hola» de cada sesión',
      /searchParams\.get\('me'\)[\s\S]{0,400}asegurarFilaDeUsuario\(userId\)/.test(lee('api/team.js')));
  chk('y ese handler recibe el contexto que usa',
      /function handler\(req, contexto\)/.test(lee('api/team.js')));
  chk('hay UNA sola implementación, compartida',
      (lee('api/team.js').match(/rest\/v1\/users\?on_conflict=id/g) || []).length === 0);
}

console.log('\nLa tabla que no existe ya no se consulta\n');
{
  // `campaign_alerts` nunca se creó y el endpoint devolvía 500 en cada carga.
  // Se quitó la función entera en vez de crear la tabla.
  const vivos = [];
  for (const f of readdirSync(new URL('../api', import.meta.url))) {
    if (!f.endsWith('.js')) continue;
    lee('api/' + f).split('\n').forEach((l, i) => {
      if (/campaign_alerts/.test(l) && !/^\s*\/\//.test(l)) vivos.push(`${f}:${i + 1}`);
    });
  }
  chk('ningún endpoint la toca', vivos.length === 0, vivos.join(', '));
  // Se miran solo las líneas de CÓDIGO: el comentario que explica por qué se
  // quitó nombra los endpoints, y contarlo sería cazarse a uno mismo.
  const codigo = lee('public/app.js').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  for (const a of ['get-alerts', 'check-alerts', 'mark-alerts-read', 'dismiss-alert']) {
    chk(`la aplicación ya no pide ${a}`, !new RegExp('action=' + a).test(codigo));
  }
  chk('pero la campana sigue, con las notas de dirección',
      /function refrescarCampana/.test(codigo) && /crmAvisosPanel\(\)/.test(codigo));
}

await limpiar();
await sql(`delete from public.users where id='${FALSO}_b';`);
const queda = await sql(`select count(*)::int as n from public.users where id like 'user_prueba_espejo%';`);
console.log('\nLimpieza\n');
chk('no queda nada de la prueba', queda[0].n === 0, String(queda[0].n));

console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
