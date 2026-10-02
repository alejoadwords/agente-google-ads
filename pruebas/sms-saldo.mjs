// SMS: reglas y saldo — node pruebas/sms-saldo.mjs <carpeta con .env>
//
// Dos partes:
//   1. (Las reglas puras están en pruebas/sms-reglas.mjs.)
//   2. El saldo contra Supabase REAL (sms_reservar / sms_devolver): una compra
//      no se acredita dos veces, dos envíos simultáneos no gastan el mismo
//      crédito, y un rechazo del proveedor devuelve lo cobrado.
//
// Identidad propia: `user_prueba_sms_<hora>`, borrada al terminar.
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2] + '/.env', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1); }
delete process.env.LABSMOBILE_USUARIO; delete process.env.LABSMOBILE_TOKEN; // modo simulado salvo donde se diga

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };
const m = await import('../api/_sms.js');

const bog = (s) => new Date(s + '-05:00');
// El remitente se pasa directo, como hace el motor de campañas: guardarlo en
// user_profiles exigiría que el usuario de prueba existiera en public.users.
const enviar = (o) => m.enviarSms({ remitente: 'Prueba', ...o });

console.log('\nSaldo contra Supabase');
const U = 'user_prueba_sms_' + Date.now();
process.env.SMS_BETA = U;
ok((await enviar({ userId: 'otra_cuenta', lead: { phone: '3001234567', tags: [] }, texto: 'Hola', ahora: bog('2026-10-01T10:00') })).estado === 'omitido', 'una cuenta fuera de la beta no envía');
const H = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY };
const SB = process.env.SUPABASE_URL;
const lead = { phone: '300 123 4567', tags: [] };
const jueves = bog('2026-10-01T10:00');
const fetchReal = globalThis.fetch;
try {
  ok(await m.saldoSms(U) === 0, 'una cuenta nueva no tiene saldo');
  let r = await enviar({ userId: U, lead, texto: 'Hola', ahora: jueves });
  ok(r.estado === 'sin_saldo', 'sin saldo no sale nada', r.estado);

  ok((await m.acreditarSms(U, 3, 'prueba-' + U)).nuevo === true, 'se acreditan 3 créditos');
  ok((await m.acreditarSms(U, 3, 'prueba-' + U)).nuevo === false, 'el mismo aviso de compra repetido no suma otra vez');
  ok(await m.saldoSms(U) === 3, 'saldo 3', await m.saldoSms(U));

  r = await enviar({ userId: U, lead: { ...lead, tags: ['no-sms'] }, texto: 'Hola', ahora: jueves });
  ok(r.estado === 'omitido' && await m.saldoSms(U) === 3, 'a quien se dio de baja no se le envía ni se le cobra');
  r = await enviar({ userId: U, lead, texto: 'Hola', ahora: bog('2026-10-04T10:00') });
  ok(r.estado === 'fuera_de_horario' && r.siguiente === bog('2026-10-05T07:00').toISOString() && await m.saldoSms(U) === 3, 'un domingo espera al lunes 7:00 sin cobrar');
  r = await enviar({ userId: U, lead, texto: 'x'.repeat(153 * 6 + 1), ahora: jueves });
  ok(r.estado === 'omitido' && /máximo/.test(r.detalle), 'un texto de más de 6 SMS se frena antes de cobrar');

  r = await enviar({ userId: U, lead, texto: 'Hola, ¿cómo estás?', ahora: jueves });
  ok(r.estado === 'simulado' && r.creditos === 1, 'sin proveedor sale como simulado y cobra 1', JSON.stringify(r));

  const largo = 'y'.repeat(200); // 2 créditos; quedan 2: solo uno de los dos puede salir
  const [a, b] = await Promise.all([enviar({ userId: U, lead, texto: largo, ahora: jueves }), enviar({ userId: U, lead, texto: largo, ahora: jueves })]);
  ok([a.estado, b.estado].sort().join() === 'simulado,sin_saldo', 'dos envíos a la vez no gastan el mismo crédito', `${a.estado} ${b.estado}`);
  ok(await m.saldoSms(U) === 0, 'y el saldo queda en cero, nunca negativo', await m.saldoSms(U));

  // Rechazo del proveedor: se devuelve lo cobrado.
  await m.acreditarSms(U, 1, 'prueba2-' + U);
  process.env.LABSMOBILE_USUARIO = 'u'; process.env.LABSMOBILE_TOKEN = 't';
  let llamada = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('labsmobile')) { llamada = { url: String(url), init }; return new Response(JSON.stringify({ code: 35, message: 'The account has no enough credit' }), { status: 200 }); }
    return fetchReal(url, init);
  };
  r = await enviar({ userId: U, lead, texto: 'Oferta: 20% hoy', ahora: jueves });
  globalThis.fetch = fetchReal;
  ok(r.estado === 'fallido' && /LabsMobile 35/.test(r.detalle), 'un rechazo del proveedor queda como fallido con su motivo', JSON.stringify(r));
  ok(await m.saldoSms(U) === 1, 'y el crédito vuelve a la cuenta', await m.saldoSms(U));
  const cuerpo = JSON.parse(llamada.init.body);
  ok(llamada.url === 'https://api.labsmobile.com/json/send' && llamada.init.headers.Authorization === 'Basic ' + btoa('u:t'), 'a LabsMobile se le llama con autenticación básica');
  ok(cuerpo.recipient[0].msisdn === '573001234567' && cuerpo.subid.length === 20 && /\/api\/sms-ack\?k=[0-9a-f]{24}$/.test(cuerpo.ackurl), 'con el móvil internacional, un subid de 20 y el enlace de entrega firmado');
  const envios = await fetchReal(`${SB}/rest/v1/sms_envios?user_id=eq.${U}&select=estado,creditos&order=created_at.asc`, { headers: H }).then(x => x.json());
  ok(envios.map(e => e.estado).join() === 'simulado,simulado,fallido', 'cada envío queda registrado con su estado', envios.map(e => e.estado).join());
} finally {
  delete process.env.LABSMOBILE_USUARIO; delete process.env.LABSMOBILE_TOKEN;
  globalThis.fetch = fetchReal;
  await fetchReal(`${SB}/rest/v1/sms_envios?user_id=eq.${U}`, { method: 'DELETE', headers: H });
  await fetchReal(`${SB}/rest/v1/sms_movimientos?user_id=eq.${U}`, { method: 'DELETE', headers: H });
  await fetchReal(`${SB}/rest/v1/sms_bajas?user_id=eq.${U}`, { method: 'DELETE', headers: H });
}

console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
