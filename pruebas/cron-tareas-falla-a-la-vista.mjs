// pruebas/cron-tareas-falla-a-la-vista.mjs
//
// El resumen diario de tareas confundía «la base no contestó» con «hoy nadie
// tiene nada»: cualquier fallo de la consulta se volvía una lista vacía, la
// función devolvía 200 «todo bien» y el correo no salía para nadie. Sin error,
// sin reintento y sin rastro.
//
// El 23-09-2026 los cinco asesores de Certain se quedaron sin su aviso y solo
// se supo porque uno lo reportó. La base ya ha dado 504 antes, así que no es
// hipotético.
//
// Se ejecuta el cron con la consulta fallando de tres maneras y se mira qué
// devuelve y si deja rastro.

process.env.CRON_SECRET = 'secreto';
process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'llave';
process.env.CLERK_SECRET_KEY = 'ck';
process.env.RESEND_API_KEY = 're';

let modo = 'ok', anotados = [], correos = 0;

globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (u.includes('/rpc/registrar_error')) { anotados.push(JSON.parse(opt.body).p_mensaje); return new Response('{}', { status: 200 }); }
  if (u.includes('/activities?')) {
    if (modo === 'caida') throw new Error('socket colgado');
    if (modo === '504') return new Response('gateway timeout', { status: 504 });
    if (modo === 'raro') return new Response(JSON.stringify({ message: 'algo' }), { status: 200 });
    if (modo === 'vacio') return new Response('[]', { status: 200 });
  }
  if (u.includes('resend.com')) { correos++; return new Response('{"id":"1"}', { status: 200 }); }
  return new Response('[]', { status: 200 });
};

const { default: handler } = await import('../api/cron-tasks.js');

async function correr(m) {
  modo = m; anotados = []; correos = 0;
  let estado = 0, cuerpo = null;
  const res = { status: (c) => { estado = c; return res; }, json: (x) => { cuerpo = x; return res; } };
  await handler({ headers: { authorization: 'Bearer secreto' } }, res);
  return { estado, cuerpo, anotados, correos };
}

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const caida = await correr('caida');
ok(caida.estado === 500, 'si la base ni contesta, devuelve 500 (antes: 200) — estado ' + caida.estado);
ok(caida.anotados.length > 0, 'y lo deja escrito en el registro de errores');

const e504 = await correr('504');
ok(e504.estado === 500, 'un 504 de Supabase también sale como fallo');
ok(/no contest/i.test(e504.anotados[0] || ''), 'con un mensaje que se entiende: ' + (e504.anotados[0] || '—'));

const raro = await correr('raro');
ok(raro.estado === 500, 'una respuesta que no es una lista tampoco pasa por vacía');

const vacio = await correr('vacio');
ok(vacio.estado === 200, 'y cuando de verdad no hay nada pendiente, sigue siendo 200');
ok(vacio.cuerpo?.sin_pendientes === true, 'diciéndolo, para distinguirlo de un fallo');
ok(vacio.anotados.length === 0, 'sin ensuciar el registro de errores');
ok(vacio.correos === 0, 'y sin mandar nada');

process.exit(mal ? 1 : 0);
