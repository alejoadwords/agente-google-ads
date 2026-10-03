// El cupo diario de correo es por cuenta, también para automatizaciones:
// node pruebas/cupo-correo-cuenta.mjs
//
// 30-09-2026: los correos de las automatizaciones no decían de qué cuenta eran
// ni miraban el cupo. Una cuenta con automatizaciones grandes podía agotar el
// tope diario de toda la plataforma y comerse la reserva de las confirmaciones
// de cita de todos. Se ejecuta el motor real.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.RESEND_API_KEY = 're_x';
process.env.CLERK_SECRET_KEY = 'sk';
process.env.CRON_SECRET = 'c';
process.env.EMAIL_TOPE_DIARIO = '100';
process.env.EMAIL_RESERVA = '40';          // 60 para correo masivo → 30 por cuenta

// El horario de la Ley 2300 frena campañas y automatizaciones de noche y en
// domingo: el reloj avanza de verdad pero arranca un jueves hábil a las 10:00.
const RealDate = Date;
const DESFASE = RealDate.parse('2026-10-01T10:00:00-05:00') - RealDate.now();
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [RealDate.now() + DESFASE])); }
  static now() { return RealDate.now() + DESFASE; }
};
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

const cuota = { enviados: 0, porCuenta: {} };
let correos = 0, parches = [], consultasCuota = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url)), m = init.method || 'GET';
  if (u.includes('api.clerk.com')) return resp({ public_metadata: { plan: 'pro' }, email_addresses: [{ email_address: 'd@x.co' }] });
  if (u.includes('/email_cuota')) { consultasCuota++; return resp([{ enviados: cuota.enviados, por_cuenta: cuota.porCuenta }]); }
  if (u.includes('/rpc/contar_correos')) {
    const b = JSON.parse(init.body);
    cuota.enviados += b.p_cuantos;
    if (b.p_cuenta) cuota.porCuenta[b.p_cuenta] = (cuota.porCuenta[b.p_cuenta] || 0) + b.p_cuantos;
    return resp(cuota.enviados);
  }
  if (u.startsWith('https://api.resend.com')) { correos++; return resp({ id: 'r' + correos }); }
  if (u.includes('/automation_jobs') && m === 'PATCH') { parches.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
  return m === 'GET' ? resp([]) : new Response(null, { status: 201 });
};
const motor = await import('../api/cron-automations.js');

const auto = (user) => ({ id: 'a-' + user, user_id: user, client_id: null, active: true, trigger: { type: 'lead_created' },
  steps: [{ type: 'send_email', subject: 'Hola', body: 'Te escribo' }] });
const lead = (i) => ({ id: 'l' + i, name: 'L' + i, email: `l${i}@x.co`, tags: [] });

motor.reiniciarCupoCorreo();
// La cuenta grande manda 40 correos por automatización en una corrida.
for (let i = 0; i < 40; i++) await motor.ejecutarTrabajo({ id: 'j' + i, user_id: 'grande', lead_id: 'l' + i, step_index: 0 }, auto('grande'), lead(i));
ok(cuota.porCuenta.grande === 30 && correos === 30, 'la cuenta grande manda hasta su parte (30) y la apunta a su nombre', JSON.stringify(cuota.porCuenta) + ' correos=' + correos);
const esperan = parches.filter(p => p.run_at && p.step_index === 0 && new Date(p.run_at) > new Date());
ok(esperan.length === 10, 'los otros 10 NO se pierden: esperan a mañana', esperan.length);
const manana = new Date(esperan[0]?.run_at || 0);
ok(manana.getUTCHours() === 0 && manana.getUTCMinutes() === 5 && manana.getTime() - Date.now() < 25 * 3600e3, 'a las 00:05 UTC, cuando el cupo vuelve a empezar', esperan[0]?.run_at);
ok(consultasCuota === 1, 'y el cupo se consultó UNA vez en toda la corrida, no una por correo', consultasCuota);
ok(100 - cuota.enviados >= 40, 'la reserva de 40 para confirmaciones de cita sigue intacta', 'enviados=' + cuota.enviados);

// Otra cuenta, en la misma corrida, tiene su propia parte.
for (let i = 0; i < 5; i++) await motor.ejecutarTrabajo({ id: 'k' + i, user_id: 'chica', lead_id: 'm' + i, step_index: 0 }, auto('chica'), lead(100 + i));
ok(cuota.porCuenta.chica === 5, 'otra cuenta en la misma corrida no queda bloqueada por la grande', JSON.stringify(cuota.porCuenta));

// Una baja o un lead sin correo no gastan cupo.
motor.reiniciarCupoCorreo();
const antes = consultasCuota;
await motor.ejecutarTrabajo({ id: 'z1', user_id: 'otra', lead_id: 'x', step_index: 0 }, auto('otra'), { id: 'x', email: null, tags: [] });
await motor.ejecutarTrabajo({ id: 'z2', user_id: 'otra', lead_id: 'y', step_index: 0 }, auto('otra'), { id: 'y', email: 'y@x.co', tags: ['no-email'] });
ok(consultasCuota === antes, 'un lead sin correo o dado de baja no consume cupo');

console.log(mal ? `\n  ${mal} fallo(s)\n` : '\n  Todo en verde\n');
process.exit(mal ? 1 : 0);
