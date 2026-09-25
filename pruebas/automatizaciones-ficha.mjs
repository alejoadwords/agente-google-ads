// Qué le va a pasar a un lead: node pruebas/automatizaciones-ficha.mjs
//
// La caja de la ficha promete dos cosas y las dos se pueden equivocar en
// silencio:
//
// 1. «Mañana a las 9 le sale el correo de seguimiento». El `step_index` de un
//    trabajo indexa la lista COMPILADA de pasos, no `automations.steps`. En
//    cuanto la automatización tiene una rama, los dos índices se separan y la
//    caja nombraría un paso que no es. Nadie lo notaría: lo que dice suena
//    igual de razonable.
//
// 2. «Parado». Si el motor ya ejecutó el paso —va cada 10 minutos— cancelarlo
//    no para nada, y quien lo pulsó se queda creyendo que frenó un correo que
//    ya salió.
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
const CUENTA = `user_prueba_autos_ficha_${SUFIJO}`;

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

const AUTO = randomUUID();
const LEAD = randomUUID();
const JOB_RAMA = randomUUID();
const JOB_HUERFANO = randomUUID();

const limpiar = () => sql(`
  delete from public.automation_logs where user_id='${CUENTA}';
  delete from public.automation_jobs where user_id='${CUENTA}';
  delete from public.automations where user_id='${CUENTA}';
  delete from public.leads where user_id='${CUENTA}';`);
await limpiar();

// Una automatización CON RAMA. Compilada queda así:
//   0 _branch      1 add_tag(vip)   2 _goto   3 send_email(«El correo del NO»)
// En `steps` sin compilar, el índice 1 sería el send_email de después de la
// rama. Ahí está la trampa.
await sql(`
insert into public.leads (id, user_id, client_id, name, stage, source)
  values ('${LEAD}','${CUENTA}', null, 'Lead de prueba', 'nuevo', 'manual');

insert into public.automations (id, user_id, client_id, name, active, trigger, steps) values
 ('${AUTO}','${CUENTA}', null, 'Bienvenida con rama', true,
  '{"type":"lead_created"}'::jsonb,
  '[{"type":"branch","field":"value","op":"gt","value":"100",
     "yes":[{"type":"add_tag","tag":"vip"}],
     "no":[{"type":"send_email","subject":"El correo del NO","body":"hola"}]},
    {"type":"wait","hours":24}]'::jsonb);

insert into public.automation_jobs (id, automation_id, user_id, lead_id, step_index, run_at, status) values
 ('${JOB_RAMA}','${AUTO}','${CUENTA}','${LEAD}', 3, now() + interval '1 hour', 'pending'),
 ('${JOB_HUERFANO}', null, '${CUENTA}','${LEAD}', 0, now() + interval '2 hours', 'pending');

insert into public.automation_logs (automation_id, user_id, lead_id, step_index, action, result, detail) values
 ('${AUTO}','${CUENTA}','${LEAD}', 0, 'send_email', 'failed', 'Resend 422: dominio no verificado');`);

const { estadoDeAutomatizaciones, pararTrabajo } = await import('../api/automations.js');

console.log('\nEl paso que se anuncia es el que va a correr\n');
{
  const r = await estadoDeAutomatizaciones(CUENTA, LEAD);
  const p = r.pendientes.find(x => x.id === JOB_RAMA);
  chk('el trabajo aparece', !!p, JSON.stringify(r.pendientes));
  // Índice 3 en la lista compilada = el correo de la rama «no».
  chk('nombra el paso de la lista compilada, no el de steps',
      p && p.paso === 'Enviar correo: El correo del NO', p && p.paso);
  chk('y dice de qué automatización es', p && p.nombre === 'Bienvenida con rama', p && p.nombre);
  chk('con la hora a la que le toca', !!(p && p.run_at));
  chk('lo más próximo, primero',
      r.pendientes.length === 2 && r.pendientes[0].id === JOB_RAMA,
      r.pendientes.map(x => x.id.slice(-1)).join(','));
}

console.log('\nLo que ya pasó, sobre todo lo que falló\n');
{
  const r = await estadoDeAutomatizaciones(CUENTA, LEAD);
  const h = r.hechas[0];
  chk('sale el intento fallido', h && h.accion === 'Correo' && h.resultado === 'falló', JSON.stringify(h));
  chk('marcado como fallo, para poder pintarlo distinto', h && h.fallo === true);
  // Sin el detalle, «falló» no sirve de nada: la causa es lo que se contesta
  // al cliente que pregunta por qué no le llegó.
  chk('con la causa entera', h && /dominio no verificado/.test(h.detalle), h && h.detalle);
}

console.log('\nUn trabajo sin automatización no se esconde\n');
{
  const r = await estadoDeAutomatizaciones(CUENTA, LEAD);
  const h = r.pendientes.find(x => x.id === JOB_HUERFANO);
  chk('se sigue viendo', !!h);
  chk('y se dice que la automatización ya no está',
      h && h.nombre === '(automatización eliminada)', h && h.nombre);
  chk('sin inventarse un paso', h && h.paso === 'Continuar el flujo', h && h.paso);
}

console.log('\nParar de verdad para\n');
{
  const r = await pararTrabajo(CUENTA, JOB_RAMA);
  chk('responde ok', r.estado === 200 && r.cuerpo.ok === true, JSON.stringify(r.cuerpo));
  const fila = (await sql(`select status from public.automation_jobs where id='${JOB_RAMA}';`))[0];
  chk('el trabajo queda cancelado en la base', fila.status === 'cancelled', fila.status);
  const log = (await sql(
    `select result, detail from public.automation_logs where user_id='${CUENTA}' and result='cancelled';`))[0];
  chk('y queda anotado quién lo paró', log && /a mano desde la ficha/.test(log.detail), JSON.stringify(log));
  const otra = await estadoDeAutomatizaciones(CUENTA, LEAD);
  chk('ya no figura como pendiente', !otra.pendientes.some(x => x.id === JOB_RAMA));
}

console.log('\nY lo que ya corrió no se puede «parar»\n');
{
  // El motor va cada 10 minutos: entre que se pinta la caja y se pulsa el
  // botón, el paso puede haber salido ya.
  const r = await pararTrabajo(CUENTA, JOB_RAMA);
  chk('no dice que lo paró', r.estado === 409, String(r.estado));
  chk('dice que ya se ejecutó', /ya se ejecutó/.test(r.cuerpo.error || ''), r.cuerpo.error);

  const ajeno = await pararTrabajo('user_otra_cuenta', JOB_HUERFANO);
  chk('y no se para el trabajo de otra cuenta', ajeno.estado === 409, String(ajeno.estado));
  const sigue = (await sql(`select status from public.automation_jobs where id='${JOB_HUERFANO}';`))[0];
  chk('que sigue pendiente', sigue.status === 'pending', sigue.status);
}

await limpiar();
console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
