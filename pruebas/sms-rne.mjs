// El RNE de la CRC por dentro: node pruebas/sms-rne.mjs
//
// Se ejecuta api/_rne.js contra una CRC y un Supabase de mentira, con la forma
// de respuesta del manual del web service (v3.1). Lo que hace en las campañas
// y automatizaciones lo prueba pruebas/sms-motores.mjs.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
delete process.env.RNE_TOKEN; delete process.env.SMS_ACTIVO; delete process.env.TOKENS_KEY;

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(d === null ? null : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const jwt = (p) => 'x.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.y';

let crc, base;
function mundo() {
  crc = { estado: 200, inscritos: [], pedidos: [], renovar: { estado: 200, token: null }, cae: false, basura: false };
  base = { rne_consultas: [], rne_token: [], cacheRota: false, guardarFalla: false };
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'tramitescrcom.gov.co') {
    if (crc.cae) throw new TypeError('fetch failed');
    if (u.pathname.endsWith('/generateApiToken')) {
      crc.pedidos.push({ renovar: true, auth: init.headers.Authorization });
      return crc.renovar.estado === 200 ? resp({ status: 'OK', message: '', data: crc.renovar.token }) : resp({ errorCode: 'AUTH-001' }, crc.renovar.estado);
    }
    const b = JSON.parse(init.body);
    crc.pedidos.push(b);
    if (crc.estado !== 200) return resp({ errorCode: 'X' }, crc.estado);
    if (crc.basura) return resp({ hola: 1 });
    return resp(crc.inscritos.filter(i => b.keys.includes(i.llave)));
  }
  const tabla = u.pathname.replace('/rest/v1/', '');
  const metodo = init.method || 'GET';
  if (tabla === 'rne_token') {
    if (metodo === 'GET') return resp(base.rne_token);
    if (base.guardarFalla) return resp({ message: 'caída' }, 503);
    base.rne_token = [JSON.parse(init.body)];
    return resp(null, 201);
  }
  if (tabla === 'rne_consultas') {
    if (metodo === 'GET') {
      if (base.cacheRota) return resp({ message: 'caída' }, 503);
      const tels = u.searchParams.get('telefono').slice(4, -1).split(',');
      const desde = u.searchParams.get('consultado_at').slice(4);
      return resp(base.rne_consultas.filter(f => tels.includes(f.telefono) && f.consultado_at >= desde));
    }
    for (const n of JSON.parse(init.body)) {
      const i = base.rne_consultas.findIndex(x => x.telefono === n.telefono);
      if (i >= 0) base.rne_consultas[i] = n; else base.rne_consultas.push(n);
    }
    return resp(null, 201);
  }
  return resp([]);
};

const rne = await import('../api/_rne.js');
const inscrito = (llave, op) => ({ llave, opcionesContacto: op, tipo: 'Móvil', fechaCreacion: '2026-05-01 10:00:00' });

console.log('\nLos números');
ok(rne.aDiezDigitos('+57 300 111 2233') === '3001112233' && rne.aDiezDigitos('573001112233') === '3001112233' && rne.aDiezDigitos('0057 3001112233') === '3001112233',
  'cualquier forma de un móvil queda en los 10 dígitos que pide la CRC');
ok(rne.aDiezDigitos('601 7654321') === null && rne.aDiezDigitos('') === null && rne.aDiezDigitos('30011122') === null, 'un fijo o un número incompleto no se consulta');

console.log('\nCuánto vale una respuesta');
const iso = (s) => new Date(s).toISOString();
ok(rne.inicioVigencia(new Date('2026-10-02T10:00:00-05:00')).toISOString() === iso('2026-10-02T03:00:00-05:00'), 'a media mañana, vale lo consultado desde las 3:00 de hoy');
ok(rne.inicioVigencia(new Date('2026-10-02T02:59:00-05:00')).toISOString() === iso('2026-10-01T03:00:00-05:00'), 'a las 2:59 todavía vale lo de ayer (la CRC está cargando)');
ok(rne.inicioVigencia(new Date('2026-10-02T03:00:00-05:00')).toISOString() === iso('2026-10-02T03:00:00-05:00'), 'a las 3:00 en punto empieza el día nuevo');
ok(rne.inicioVigencia(new Date('2026-10-02T22:00:00-05:00')).toISOString() === iso('2026-10-02T03:00:00-05:00'), 'de noche en Bogotá (ya otro día en UTC) sigue valiendo lo de hoy');

console.log('\nLa consulta');
{
  mundo(); process.env.RNE_TOKEN = jwt({ iat: 1, exp: 9999999999 });
  crc.inscritos = [inscrito('3001112233', { sms: false, aplicacion: true, llamada: true }), inscrito('3002223344', { aplicacion: false })];
  const r = await rne.consultarRne(['3001112233', '3002223344', '3003334455', '3003334455', '601 7654321']);
  ok(crc.pedidos.length === 1 && crc.pedidos[0].keys.length === 3, 'una sola petición, sin repetidos ni fijos', JSON.stringify(crc.pedidos));
  ok(r.get('3001112233').sms === false && r.get('3003334455').sms === true && !r.get('3003334455').inscrito, 'el inscrito sin SMS queda fuera; el que no aparece, no está inscrito');
  ok(r.get('3002223344').sms === false, 'inscrito sin decir nada del SMS: ante la duda, no se le envía', JSON.stringify(r.get('3002223344')));

  base.cacheRota = true; crc.pedidos = [];
  const r2 = await rne.consultarRne(['3001112233']);
  ok(crc.pedidos.length === 1 && r2.get('3001112233').sms === false, 'si la caché no se puede leer, se pregunta a la CRC: nunca se deja de filtrar');
  base.cacheRota = false;

  mundo(); crc.inscritos = [inscrito('3009999999', { sms: false })];
  const muchos = Array.from({ length: 10001 }, (_, i) => '3' + String(100000000 + i));
  muchos.push('3009999999');
  const r3 = await rne.consultarRne(muchos);
  ok(crc.pedidos.length === 2 && r3.size === 10002 && r3.get('3009999999').sms === false, 'una audiencia grande va en tandas de 10.000', crc.pedidos.map(p => p.keys.length).join('+'));
}

console.log('\nCuando la CRC falla');
for (const [estado, que, patron] of [[401, 'token vencido', /venció/], [403, 'sin el rol', /rol de Proveedor/], [509, 'actualizándose', /actualizando/], [500, 'error suyo', /error 500/]]) {
  mundo(); crc.estado = estado;
  let e = null;
  try { await rne.consultarRne(['3001112233']); } catch (x) { e = x; }
  ok(e?.rneNoDisponible && patron.test(e.message), `${estado} (${que}) se avisa con el motivo y nada sale`, e?.message);
}
{
  mundo(); crc.cae = true;
  let e = null;
  try { await rne.consultarRne(['3001112233']); } catch (x) { e = x; }
  ok(e?.rneNoDisponible && /no respondió/.test(e.message), 'sin conexión con la CRC, tampoco', e?.message);
  mundo(); crc.basura = true; e = null;
  try { await rne.consultarRne(['3001112233']); } catch (x) { e = x; }
  ok(e?.rneNoDisponible && !base.rne_consultas.length, 'una respuesta que no es la lista esperada no se toma por «nadie inscrito»', e?.message);
}

console.log('\nEl token');
{
  mundo(); delete process.env.RNE_TOKEN;
  ok(await rne.tokenRne() === null && (await rne.estadoRne()).modo === 'simulado', 'sin token en ningún sitio, modo simulado');
  const viejo = jwt({ iat: 100, exp: 2000000000 }), nuevo = jwt({ iat: 200, exp: 2100000000 });
  process.env.RNE_TOKEN = viejo; base.rne_token = [{ token: nuevo }];
  ok(await rne.tokenRne() === nuevo, 'si el cron ya lo renovó, gana el guardado (el de Vercel quedó anulado)');
  process.env.RNE_TOKEN = nuevo; base.rne_token = [{ token: viejo }];
  ok(await rne.tokenRne() === nuevo, 'si alguien generó otro en la web y lo pegó en Vercel, gana ese');
  const est = await rne.estadoRne();
  ok(est.modo === 'crc' && est.vence === new Date(2100000000 * 1000).toISOString(), 'la pantalla sabe cuándo vence', JSON.stringify(est));
}

console.log('\nLa renovación');
{
  const AHORA = new Date('2026-10-02T08:00:00-05:00');
  const seg = (d) => Math.floor(AHORA.getTime() / 1000) + d * 86400;
  mundo(); process.env.RNE_TOKEN = jwt({ iat: 1, exp: seg(90) });
  let r = await rne.renovarTokenRne({ ahora: AHORA });
  ok(!r.renovado && !crc.pedidos.length, 'con 90 días por delante no se toca', JSON.stringify(r));

  mundo(); process.env.RNE_TOKEN = jwt({ iat: 1, exp: seg(20) });
  const otro = jwt({ iat: 2, exp: seg(200) });
  crc.renovar.token = otro;
  r = await rne.renovarTokenRne({ ahora: AHORA });
  ok(r.renovado && crc.pedidos[0]?.auth === 'Bearer ' + process.env.RNE_TOKEN, 'a 20 días de vencer se renueva con el vigente', JSON.stringify(r));
  ok(base.rne_token[0]?.token === otro && base.rne_token[0].id === 1 && !!base.rne_token[0].expira_at, 'el nuevo queda guardado con su vencimiento', JSON.stringify(base.rne_token));
  ok(await rne.tokenRne() === otro, 'y desde ahí es el que se usa');

  mundo(); process.env.RNE_TOKEN = jwt({ iat: 1, exp: seg(5) }); crc.renovar.estado = 401;
  let e = null;
  try { await rne.renovarTokenRne({ ahora: AHORA }); } catch (x) { e = x; }
  ok(/No se pudo renovar/.test(e?.message) && /5 días/.test(e.message), 'si la CRC no lo renueva, lanza diciendo cuánto le queda (llega al aviso de errores)', e?.message);

  mundo(); process.env.RNE_TOKEN = jwt({ iat: 1, exp: seg(5) }); crc.renovar.token = otro; base.guardarFalla = true; e = null;
  try { await rne.renovarTokenRne({ ahora: AHORA }); } catch (x) { e = x; }
  ok(/NO se pudo guardar/.test(e?.message), 'si renovó pero no se pudo guardar, lo dice con todas las letras', e?.message);

  mundo(); delete process.env.RNE_TOKEN;
  r = await rne.renovarTokenRne({ ahora: AHORA });
  ok(!r.renovado && !crc.pedidos.length, 'sin token no hay nada que renovar');
}

console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
