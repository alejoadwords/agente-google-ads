// Qué envíos le tocaron a un contacto: node pruebas/campanas-ficha.mjs
//
// Aquí lo que se puede equivocar no es el código, son dos empalmes de datos:
//
// 1. `campaign_recipients` NO tiene user_id. Pedir las filas por lead_id y ya
//    devolvería las de cualquier cuenta. El alcance solo existe si se
//    comprueba que la campaña sea de esta cuenta.
//
// 2. Las aperturas, los clics y los rebotes los guarda el webhook de Resend
//    SIN lead_id y SIN campaign_id: solo sabe el resend_id. Pedirlos por
//    lead_id devuelve cero, y la caja diría «nadie abrió nada» con toda la
//    naturalidad del mundo.
//
// Y un rebote duro saca la dirección de todas las campañas siguientes en
// silencio: si eso no se dice, el comercial espera una respuesta a un correo
// que ya ni sale.
//
// Se ejecuta contra la base de verdad con cuentas inventadas, que se borran.

import { execSync } from 'node:child_process';

const PROYECTO = 'qgznzzhkuwxcknmcnrzn';
const CUENTA = 'user_prueba_camp_ficha';
const OTRA = 'user_prueba_camp_otra';

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

const LEAD = '66666666-0000-0000-0000-000000000001';
const C_MIA = '66666666-0000-0000-0000-000000000010';
const C_WA = '66666666-0000-0000-0000-000000000011';
const C_BAJA = '66666666-0000-0000-0000-000000000012';
const C_AJENA = '66666666-0000-0000-0000-000000000013';
const CORREO = 'quemado.prueba@ejemplo-acuarius.test';

const limpiar = () => sql(`
  delete from public.email_events where to_email='${CORREO}' or resend_id like 'rs_prueba%';
  delete from public.campaign_recipients where lead_id='${LEAD}';
  delete from public.campaigns where user_id in ('${CUENTA}','${OTRA}');
  delete from public.leads where user_id in ('${CUENTA}','${OTRA}');`);
await limpiar();

await sql(`
insert into public.leads (id, user_id, client_id, name, email, stage, source)
  values ('${LEAD}','${CUENTA}', null, 'Lead de prueba', '${CORREO}', 'nuevo', 'manual');

insert into public.campaigns (id, user_id, client_id, name, channel, subject, body, status) values
 ('${C_MIA}','${CUENTA}', null, 'Promo de septiembre', 'email', 'Tenemos algo para ti', 'hola', 'sent'),
 ('${C_WA}','${CUENTA}', null, 'Recordatorio por WhatsApp', 'whatsapp', null, 'hola', 'sent'),
 ('${C_BAJA}','${CUENTA}', null, 'Boletín de octubre', 'email', 'Novedades', 'hola', 'sent'),
 ('${C_AJENA}','${OTRA}', null, 'Campaña de OTRA cuenta', 'email', 'No deberías ver esto', 'hola', 'sent');

-- El mismo lead en las cuatro. La de otra cuenta es la trampa: la fila existe
-- y se busca por lead_id, sin user_id que la filtre.
insert into public.campaign_recipients (campaign_id, lead_id, status, detail, resend_id, processed_at) values
 ('${C_MIA}','${LEAD}','sent', null, 'rs_prueba_abierto', now() - interval '2 days'),
 ('${C_WA}','${LEAD}','sent', null, null, now() - interval '5 days'),
 ('${C_BAJA}','${LEAD}','skipped','dado de baja', null, now() - interval '1 day'),
 ('${C_AJENA}','${LEAD}','sent', null, 'rs_prueba_ajeno', now() - interval '3 days');

-- Como los guarda el webhook: solo resend_id y event. Sin lead_id, sin
-- campaign_id. Clic Y apertura del mismo correo: debe ganar el clic.
insert into public.email_events (resend_id, event) values
 ('rs_prueba_abierto','delivered'), ('rs_prueba_abierto','opened'), ('rs_prueba_abierto','clicked');

-- Y la dirección, quemada por un rebote duro.
insert into public.email_events (resend_id, event, to_email) values
 ('rs_prueba_rebote','bounced','${CORREO}');`);

const { historialDelLead, correoQuemado } = await import('../api/campaigns.js');

console.log('\nSalen sus envíos, y solo los suyos\n');
{
  const r = await historialDelLead(CUENTA, LEAD, null);
  chk('salen los tres de esta cuenta', r.envios.length === 3, String(r.envios.length));
  // La trampa: campaign_recipients no tiene user_id.
  chk('y NO el de la otra cuenta',
      !r.envios.some(e => /OTRA cuenta/.test(e.nombre)), JSON.stringify(r.envios.map(e => e.nombre)));
  chk('lo más reciente primero',
      r.envios[0].nombre === 'Boletín de octubre', r.envios.map(e => e.nombre).join(' | '));
  chk('cada canal con su nombre',
      r.envios.some(e => e.canal === 'WhatsApp') && r.envios.some(e => e.canal === 'Correo'));
}

console.log('\nQué hizo con el correo\n');
{
  const r = await historialDelLead(CUENTA, LEAD, null);
  const promo = r.envios.find(e => e.nombre === 'Promo de septiembre');
  // El empalme por resend_id. Por lead_id esto daría vacío.
  chk('se sabe que reaccionó', !!promo.reaccion, JSON.stringify(promo));
  chk('y gana lo más avanzado: hizo clic, no «abierto»',
      promo.reaccion === 'Hizo clic', promo.reaccion);
  const wa = r.envios.find(e => e.canal === 'WhatsApp');
  chk('un WhatsApp no inventa apertura', wa.reaccion === '', wa.reaccion);
}

console.log('\nPor qué NO le llegó\n');
{
  const r = await historialDelLead(CUENTA, LEAD, null);
  const baja = r.envios.find(e => e.nombre === 'Boletín de octubre');
  chk('se dice que no se le envió', baja.estado === 'No se le envió', baja.estado);
  // «No se le envió» a secas no deja hacer nada; el motivo sí.
  chk('con el motivo, que es lo accionable', baja.motivo === 'dado de baja', baja.motivo);
  chk('marcado como malo, para pintarlo distinto', baja.malo === true);
}

console.log('\nLa dirección quemada se dice\n');
{
  const r = await historialDelLead(CUENTA, LEAD, null);
  chk('la ficha lo sabe', r.quemado === 'rebote', String(r.quemado));
  chk('una dirección limpia no lo está',
      (await correoQuemado('nadie-ha-escrito-aqui@ejemplo-acuarius.test')) === null);
  chk('y sin dirección no se inventa nada', (await correoQuemado('')) === null);
}

console.log('\nUn miembro acotado a un cliente no se sale de él\n');
{
  // Sus campañas son del cliente `null`; este miembro está atado a 'cli_x'.
  const r = await historialDelLead(CUENTA, LEAD, { cliente: 'cli_x' });
  chk('no ve el lead de otro cliente', r.envios.length === 0, String(r.envios.length));
}

console.log('\nUn lead de otra cuenta no devuelve nada\n');
{
  const r = await historialDelLead(OTRA, LEAD, null);
  chk('ni envíos ni dirección', r.envios.length === 0 && r.quemado === null, JSON.stringify(r));
}

await limpiar();
console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nTodo en orden\n');
process.exit(fallos ? 1 : 0);
