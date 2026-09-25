// El candado de la encuesta NPS: node pruebas/nps-candado.mjs
//
// `pedir_resena` tenía `yaSePidio()` y `send_nps` no: una automatización que se
// disparara dos veces sobre el mismo lead mandaba dos correos con minutos de
// diferencia y creaba DOS filas en `nps_responses`. El cliente recibía la misma
// encuesta dos veces, y el reporte contaba dos envíos —y dos respuestas si
// contestaba las dos—, así que la tasa de respuesta y el NPS salían falseados.
//
// No es «una sola vez por lead» como la reseña: encuestar cada cierto tiempo es
// para lo que sirve esto. Lo que se impide es la ráfaga.
//
// Se ejecuta contra la base de verdad con una cuenta inventada, que se borra.

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Identidad propia en cada pasada: con identificadores fijos, dos pasadas a la
// vez —dos sesiones trabajando, o la batería lanzada dos veces— se pisaban y
// salía «clave duplicada» o «queda algo de la prueba». Falla una vez de cada
// tantas, que es la peor clase de prueba: la que enseña a no creerse los rojos.
const SUFIJO = randomUUID().slice(0, 8);

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const CUENTA = `user_prueba_nps_candado_${SUFIJO}`;

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
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra && !ok ? ' → ' + extra : ''}`);
  if (!ok) fallos++;
};

const claves = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${TOK}`, 'User-Agent': 'SupabaseCLI/2.72.7' },
}).then(r => r.json());
process.env.SUPABASE_URL = `https://${PROYECTO}.supabase.co`;
process.env.SUPABASE_SERVICE_KEY = claves.find(k => k.name === 'service_role').api_key;

const LIMPIO   = randomUUID();
const RECIENTE = randomUUID();
const ANTIGUO  = randomUUID();
const SIN_CONTESTAR = randomUUID();

const limpiar = () => sql(`
  delete from public.nps_responses where user_id='${CUENTA}';
  delete from public.leads where user_id='${CUENTA}';`);
await limpiar();

await sql(`
insert into public.leads (id, user_id, client_id, name, email, stage, source) values
 ('${LIMPIO}','${CUENTA}', null, 'Nunca encuestado', 'a@ejemplo-acuarius.test','ganado','manual'),
 ('${RECIENTE}','${CUENTA}', null, 'Encuestado ayer', 'b@ejemplo-acuarius.test','ganado','manual'),
 ('${ANTIGUO}','${CUENTA}', null, 'Encuestado hace meses', 'c@ejemplo-acuarius.test','ganado','manual'),
 ('${SIN_CONTESTAR}','${CUENTA}', null, 'Enviada ayer, sin contestar', 'd@ejemplo-acuarius.test','ganado','manual');

insert into public.nps_responses (user_id, lead_id, token, score, sent_at, responded_at) values
 ('${CUENTA}','${RECIENTE}','tk_ayer_${SUFIJO}', 9, now() - interval '1 day', now() - interval '1 day'),
 -- Fuera de la ventana: encuestar otra vez al cabo del tiempo es legítimo.
 ('${CUENTA}','${ANTIGUO}','tk_viejo_${SUFIJO}', 7, now() - interval '200 days', now() - interval '200 days'),
 -- Enviada y sin contestar: reenviarla crearía una segunda fila pendiente y
 -- hundiría la tasa de respuesta.
 ('${CUENTA}','${SIN_CONTESTAR}','tk_pend_${SUFIJO}', null, now() - interval '1 day', null);`);

const { yaSeEncuesto } = await import('../api/cron-automations.js');

console.log('\nA quién se le puede mandar\n');
{
  chk('a uno que nunca la recibió, sí', (await yaSeEncuesto(LIMPIO)) === false);
  chk('a uno encuestado ayer, NO', (await yaSeEncuesto(RECIENTE)) === true);
  // Lo que se impide es la ráfaga, no medir la satisfacción cada cierto tiempo.
  chk('a uno de hace 200 días, sí', (await yaSeEncuesto(ANTIGUO)) === false);
  chk('y a uno con una enviada sin contestar, NO', (await yaSeEncuesto(SIN_CONTESTAR)) === true);
}

console.log('\nEl candado mira la fecha de ENVÍO, no la de respuesta\n');
{
  // Una fila enviada hace 200 días y contestada ayer no puede bloquear: lo que
  // no queremos repetir es el correo.
  await sql(`update public.nps_responses set responded_at = now()
             where lead_id='${ANTIGUO}';`);
  chk('contestar hoy algo enviado hace meses no bloquea',
      (await yaSeEncuesto(ANTIGUO)) === false);
}

console.log('\nUn lead de otra cuenta no se cruza\n');
{
  chk('un id que no existe no bloquea',
      (await yaSeEncuesto('88888888-0000-0000-0000-00000000ffff')) === false);
}

await limpiar();
console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
