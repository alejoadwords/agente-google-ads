// Qué contestó el contacto en la encuesta: node pruebas/nps-ficha.mjs
//
// Dos cosas que aquí se equivocan calladas:
//
// 1. Una fila de `nps_responses` existe desde que la encuesta se ENVÍA. Un
//    `score` nulo no es un cero: es «todavía no ha contestado». Tratarlo como
//    número pondría a un cliente que no ha dicho nada como detractor, con su
//    etiqueta roja en la ficha.
//
// 2. Las preguntas propias se leen de la copia que guardó la respuesta, no de
//    la configuración de hoy. Si no, reescribir una pregunta pondría el texto
//    nuevo encima de una respuesta vieja y el histórico mentiría.
//
// Se ejecuta contra la base de verdad con cuentas inventadas, que se borran.

import { execSync } from 'node:child_process';

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const CUENTA = 'user_prueba_nps_ficha';
const OTRA = 'user_prueba_nps_otra';

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

const DETRACTOR = '77777777-0000-0000-0000-000000000001';
const CALLADO   = '77777777-0000-0000-0000-000000000002';
const NADA      = '77777777-0000-0000-0000-000000000003';
const PROMOTOR  = '77777777-0000-0000-0000-000000000004';

const limpiar = () => sql(`
  delete from public.nps_responses where user_id in ('${CUENTA}','${OTRA}');
  delete from public.leads where user_id in ('${CUENTA}','${OTRA}');`);
await limpiar();

await sql(`
insert into public.leads (id, user_id, client_id, name, stage, source) values
 ('${DETRACTOR}','${CUENTA}', null, 'Contestó mal', 'ganado','manual'),
 ('${CALLADO}','${CUENTA}', null, 'No ha contestado', 'ganado','manual'),
 ('${NADA}','${CUENTA}', null, 'Nunca recibió encuesta', 'nuevo','manual'),
 ('${PROMOTOR}','${CUENTA}','cli_a','De otro cliente', 'ganado','manual');

insert into public.nps_responses (user_id, client_id, lead_id, token, score, comment, sent_at, responded_at, answers, preguntas) values
 -- Contestó 4 y escribió. Y tiene una pregunta propia contestada.
 ('${CUENTA}', null, '${DETRACTOR}','tk1', 4, 'Tardaron mucho en responderme.',
   now() - interval '3 days', now() - interval '2 days',
   '{"p1":"El tiempo de respuesta","p2":3}'::jsonb,
   '[{"id":"p1","texto":"¿Qué podríamos mejorar?","tipo":"texto"},
     {"id":"p2","texto":"¿Cómo calificas la atención?","tipo":"escala5"}]'::jsonb),
 -- Enviada hace dos días y NUNCA contestada: score nulo, no un cero.
 ('${CUENTA}', null, '${CALLADO}','tk2', null, null, now() - interval '2 days', null, null, null),
 -- Un promotor de otro cliente.
 ('${CUENTA}','cli_a','${PROMOTOR}','tk3', 10, '¡Excelentes!',
   now() - interval '5 days', now() - interval '5 days', null, null);`);

const { encuestaDelLead } = await import('../api/nps.js');

console.log('\nLo que contestó\n');
{
  const r = await encuestaDelLead(CUENTA, DETRACTOR, null);
  chk('sale la nota', r.encuesta && r.encuesta.nota === 4, JSON.stringify(r.encuesta));
  chk('con su categoría, la misma que la etiqueta del lead',
      r.encuesta.categoria === 'Detractor' && r.encuesta.clave === 'detractor',
      r.encuesta.categoria + '/' + r.encuesta.clave);
  // El comentario es el motivo: sin él, un 4 no dice qué arreglar.
  chk('y lo que escribió', /Tardaron mucho/.test(r.encuesta.comentario), r.encuesta.comentario);
  chk('nada pendiente', r.pendiente === false);
}

console.log('\nLas preguntas propias, con el texto que se le enseñó\n');
{
  const r = await encuestaDelLead(CUENTA, DETRACTOR, null);
  const e = r.encuesta.extras;
  chk('salen las dos', e.length === 2, JSON.stringify(e));
  // El texto viene de la copia que guardó la respuesta. Leerlo de la
  // configuración de hoy pondría una pregunta reescrita encima de la vieja.
  chk('con la pregunta tal como se la hicieron',
      e[0].texto === '¿Qué podríamos mejorar?', e[0].texto);
  chk('y la respuesta', e[0].valor === 'El tiempo de respuesta', e[0].valor);
  chk('una escala numérica también, como texto', e[1].valor === '3', e[1].valor);
}

console.log('\nEnviada y sin contestar NO es un cero\n');
{
  const r = await encuestaDelLead(CUENTA, CALLADO, null);
  // Tratar el nulo como número lo pondría de detractor, con etiqueta roja,
  // sin que haya dicho nada.
  chk('no se inventa una nota', r.encuesta === null, JSON.stringify(r.encuesta));
  chk('pero se dice que está pendiente', r.pendiente === true);
  chk('y desde cuándo', !!r.enviada);
}

console.log('\nSin encuesta, nada\n');
{
  const r = await encuestaDelLead(CUENTA, NADA, null);
  chk('ni encuesta ni pendiente', r.encuesta === null && r.pendiente === false, JSON.stringify(r));
}

console.log('\nEl alcance por cliente sale del contacto\n');
{
  const suyo = await encuestaDelLead(CUENTA, PROMOTOR, 'cli_a');
  chk('el miembro de cli_a ve el suyo', suyo.encuesta && suyo.encuesta.nota === 10, JSON.stringify(suyo.encuesta));
  chk('y es promotor', suyo.encuesta.clave === 'promotor', suyo.encuesta.clave);

  const ajeno = await encuestaDelLead(CUENTA, DETRACTOR, 'cli_a');
  chk('pero no el de un contacto de otro cliente', ajeno.encuesta === null, JSON.stringify(ajeno.encuesta));

  const otraCuenta = await encuestaDelLead(OTRA, DETRACTOR, null);
  chk('y otra cuenta no ve nada', otraCuenta.encuesta === null, JSON.stringify(otraCuenta.encuesta));
}

await limpiar();
console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
