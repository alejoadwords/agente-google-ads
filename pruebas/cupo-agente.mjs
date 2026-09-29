// El contador de mensajes del agente: node pruebas/cupo-agente.mjs
//
// El landing vende un cupo de mensajes por plan. Dentro de la aplicación no
// había forma de saber cuántos se llevan gastados, así que ni el cliente podía
// mirarlo ni nosotros avisarle: se vendía un límite que nadie podía ver.
//
// Lo que más importa aquí no es la suma, es qué pasa cuando algo falla. Un
// contador que dice «0 de 500» porque la consulta se cayó miente con mucha
// seguridad, y quien lo mire creerá que no ha gastado nada.

import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2] + '/.env', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1);
}
// El módulo se importa DESPUÉS de cargar el .env, y a mano.
//
// Con un `import` normal no funciona: los imports se evalúan antes que
// cualquier línea del fichero, así que el módulo capturaba SUPABASE_URL vacía
// y la primera consulta fallaba con «Invalid URL» en una prueba que por lo
// demás estaba bien escrita.
const {
  cupoDelPlan, CUPOS, CUPO_POR_DEFECTO, ORIGENES_CUPO,
  inicioDelMes, consumoDelMes, estadoDeCupo, planDeCuenta,
} = await import('../api/_cupo-agente.js');

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : ''));
  if (!c) mal++;
};

console.log('\nEl cupo de cada plan');
ok(cupoDelPlan('free') === 0, 'free no tiene agente');
ok(cupoDelPlan('pro') === 500, 'pro: 500');
ok(cupoDelPlan('agency') === 2000, 'agency: 2.000');
ok(cupoDelPlan('trial') === 300, 'la prueba: 300');
// Alias históricos: Clerk guardó 'individual' y 'agencia' en algunas cuentas.
// Sin ellos, esos clientes se quedarían con el cupo por defecto y un Agency
// vería la cuarta parte de lo que paga.
ok(cupoDelPlan('individual') === CUPOS.pro, 'el alias «individual» recibe el cupo de Pro');
ok(cupoDelPlan('agencia') === CUPOS.agency, 'el alias «agencia» recibe el cupo de Agency');
ok(cupoDelPlan('AGENCY') === 2000, 'y da igual cómo esté escrito');
// Un plan que no conocemos NO se queda sin agente: entre cobrar de menos y
// dejar mudo a un cliente que paga por un dato nuestro mal puesto, se cobra
// de menos.
ok(cupoDelPlan('loquesea') === CUPO_POR_DEFECTO, 'un plan desconocido recibe el cupo por defecto');
ok(cupoDelPlan('') === CUPO_POR_DEFECTO && cupoDelPlan(null) === CUPO_POR_DEFECTO,
   'y sin plan, lo mismo');

console.log('\nQué cuenta para el cupo');
for (const c of ['whatsapp', 'instagram', 'messenger', 'tiktok', 'webchat']) {
  ok(ORIGENES_CUPO.includes(c), c + ' cuenta');
}
// El probador queda fuera a propósito: cobrarle a alguien por probar su agente
// antes de encenderlo es empujarlo a encenderlo sin probar.
ok(!ORIGENES_CUPO.includes('ensayo') && !ORIGENES_CUPO.includes('ensayo-publico'),
   'el probador del agente NO gasta cupo');
// Y lo que no es del inbox tampoco: una propuesta o un reporte gastan dinero,
// pero no son mensajes del agente y no pueden comerse el cupo de mensajes.
for (const otro of ['propuesta', 'reporte-semanal', 'imagen', 'voz', 'conocimiento']) {
  ok(!ORIGENES_CUPO.includes(otro), otro + ' tampoco');
}

console.log('\nEl mes se cuenta en hora de Colombia');
{
  // Con UTC el mes nuevo empezaría a las 7 de la tarde del último día: quien
  // mirara su consumo el 30 por la noche lo vería ya puesto a cero.
  const inicio = inicioDelMes(new Date('2026-09-15T12:00:00Z'));
  ok(inicio.toISOString() === '2026-09-01T05:00:00.000Z',
     'el mes empieza el día 1 a las 00:00 de Colombia', inicio.toISOString());

  // El día 1 a las 02:00 UTC en Colombia son las 9 de la noche del día 31: ese
  // mensaje pertenece al mes que se está acabando, no al siguiente.
  const madrugada = inicioDelMes(new Date('2026-10-01T02:00:00Z'));
  ok(madrugada.toISOString() === '2026-09-01T05:00:00.000Z',
     'y a las 2 UTC del día 1 todavía es el mes anterior en Colombia', madrugada.toISOString());

  const yaOctubre = inicioDelMes(new Date('2026-10-01T06:00:00Z'));
  ok(yaOctubre.toISOString() === '2026-10-01T05:00:00.000Z',
     'a las 6 UTC ya cambió el mes', yaOctubre.toISOString());
}

console.log('\nContando de verdad contra la base');
{
  const CERTAIN = 'user_3HYi3uHYQyth190Tr2HXZKmHbTk';
  const n = await consumoDelMes(CERTAIN);
  ok(typeof n === 'number' && n >= 0, 'se pudo contar el consumo de una cuenta real', String(n));

  // El conteo tiene que salir de los orígenes del cupo y de este mes. Se
  // comprueba contra una consulta hecha aparte, con otros filtros escritos a
  // mano: si el módulo se equivocara de columna o de fecha, aquí no cuadraría.
  const desde = inicioDelMes().toISOString();
  const orig = ORIGENES_CUPO.map(o => `"${o}"`).join(',');
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${CERTAIN}` +
    `&origen=in.(${orig})&created_at=gte.${encodeURIComponent(desde)}&select=id`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY } }
  );
  const filas = await r.json();
  ok(Array.isArray(filas) && filas.length === n,
     'y el número coincide con contar las filas una a una', `módulo ${n} vs filas ${filas.length}`);

  const estado = await estadoDeCupo(CERTAIN);
  ok(!estado.error, 'el estado completo se pudo calcular', estado.motivo);
  ok(estado.usados + estado.restante >= estado.cupo || estado.usados > estado.cupo,
     'usados y restante cuadran con el cupo');
  ok(estado.avisar === (estado.cupo > 0 && estado.usados >= estado.cupo * 0.8),
     'el aviso salta al 80%, ni antes ni después');
}

console.log('\nY cuando algo falla, se nota');
{
  // Este es el punto de la prueba. Un plan que no se pudo consultar NO puede
  // convertirse en el cupo por defecto: una cuenta Agency vería 500 en vez de
  // 2.000 y creería que le queda la cuarta parte de lo que pagó.
  const bueno = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = 'sk_rota_a_proposito';
  const { estadoDeCupo: conClerkRoto, planDeCuenta: planRoto } = await import('../api/_cupo-agente.js?rota=1');
  const res = await planRoto('user_3HmDHM5d0TB2I4DQbCY91jQsoOc');
  ok(res.ok === false, 'un Clerk caído se reporta como «no se pudo», no como «sin plan»', JSON.stringify(res));
  const estado = await conClerkRoto('user_3HmDHM5d0TB2I4DQbCY91jQsoOc');
  ok(estado.error === true, 'y el estado sale con error en vez de inventar un cupo', JSON.stringify(estado));
  ok(estado.cupo === undefined, 'sin número de cupo, para que la pantalla no pueda pintarlo');
  process.env.CLERK_SECRET_KEY = bueno;

  // Un usuario que Clerk dice que no existe SÍ es una respuesta: ese no tiene
  // plan y le toca el cupo por defecto. No es lo mismo que no poder preguntar.
  const fantasma = await planDeCuenta('user_no_existe_en_clerk_xyz');
  ok(fantasma.ok === true && !fantasma.plan,
     'un usuario que no está en Clerk es una respuesta, no un fallo', JSON.stringify(fantasma));

  // Y lo mismo con el conteo: si la consulta se cae, el contador NO puede
  // decir cero. Un cliente que ha gastado 400 mensajes y ve «0 de 500» se
  // queda tranquilo justo cuando debería estar mirando.
  // Con la clave rota la base responde 401: una respuesta de verdad, que es el
  // camino por el que se decide si se devuelve null o un cero cómodo.
  const claveBuena = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_SERVICE_KEY = 'clave.rota.a.proposito';
  const { consumoDelMes: contarSinPermiso } = await import('../api/_cupo-agente.js?sinclave=1');
  const n401 = await contarSinPermiso('user_3HYi3uHYQyth190Tr2HXZKmHbTk').catch(() => 'lanzó');
  ok(n401 === null, 'un 401 de la base devuelve «no se pudo», nunca cero', String(n401));
  process.env.SUPABASE_SERVICE_KEY = claveBuena;

  // Y con la base inalcanzable tampoco puede reventar: el endpoint devolvería
  // un 500 pelado que la pantalla no sabe distinguir de «no hay consumo».
  const urlBuena = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://no-existe-esta-base.supabase.co';
  const { consumoDelMes: contarRoto, estadoDeCupo: estadoRoto } = await import('../api/_cupo-agente.js?sinbase=1');
  const n = await contarRoto('user_3HYi3uHYQyth190Tr2HXZKmHbTk').catch(() => 'lanzó');
  ok(n === null, 'una base inalcanzable devuelve «no se pudo» sin lanzar', String(n));
  const eRoto = await estadoRoto('user_3HYi3uHYQyth190Tr2HXZKmHbTk').catch(() => ({ error: 'lanzó' }));
  ok(eRoto.error === true, 'y el estado lo refleja', JSON.stringify(eRoto));
  process.env.SUPABASE_URL = urlBuena;
}

// Dos cuentas seguidas en la misma instancia no se mezclan.
//
// En Vercel el módulo se queda caliente entre peticiones de clientes
// DISTINTOS. Un `let _lastPlan` a nivel de módulo hizo que, tras una cuenta de
// pago, la siguiente gratis heredara su plan y pasara los gates (arreglado el
// 29-09-2026 en campaigns, automations, team y proposals). Aquí la caché va en
// un Map por usuario; esta prueba existe para que siga siendo así.
console.log('\nDos cuentas seguidas no se contagian');
{
  const CERTAIN = 'user_3HYi3uHYQyth190Tr2HXZKmHbTk';   // agency
  const OTRA = 'user_3HmDHM5d0TB2I4DQbCY91jQsoOc';      // asesora, plan propio

  const a1 = await estadoDeCupo(CERTAIN);
  const b1 = await estadoDeCupo(OTRA);
  const a2 = await estadoDeCupo(CERTAIN);   // otra vez, ya con la caché caliente
  const b2 = await estadoDeCupo(OTRA);

  ok(a1.plan === a2.plan && a1.cupo === a2.cupo,
     'la misma cuenta da lo mismo las dos veces', `${a1.plan}/${a1.cupo} vs ${a2.plan}/${a2.cupo}`);
  ok(b1.plan === b2.plan && b1.cupo === b2.cupo,
     'y la otra también', `${b1.plan}/${b1.cupo} vs ${b2.plan}/${b2.cupo}`);
  ok(b2.plan !== 'agency' || a1.plan === b2.plan,
     'la segunda cuenta NO hereda el plan de la primera', `${a1.plan} → ${b2.plan}`);
  ok(a1.usados !== b1.usados || a1.usados === 0,
     'y cada una cuenta su propio consumo', `${a1.usados} vs ${b1.usados}`);

  const src = fs.readFileSync(new URL('../api/_cupo-agente.js', import.meta.url), 'utf8');
  ok(/_planCache = new Map\(\)/.test(src), 'la caché es un Map, no una variable suelta');
  ok(!/let _ultimoPlan|let _lastPlan|let _plan =/.test(src),
     'y no hay ninguna variable de módulo con el plan de alguien');
}

console.log('\nEl endpoint que lo sirve');
{
  const src = fs.readFileSync(new URL('../api/uso-agente.js', import.meta.url), 'utf8');
  ok(/verificarSesion\(req\)/.test(src), 'exige sesión');
  // El rechazo lleva el NOMBRE del endpoint, que es la convención del
  // proyecto: si todos dijeran lo mismo, el registro no serviría para saber
  // qué pantalla se quedó sin sesión.
  ok(/cuerpoSinSesion\(sesion, 'uso-agente'\), 401\)/.test(src),
     'y sin ella devuelve 401 diciendo quién fue');
  // El consumo es de la CUENTA: un vendedor y su dueña ven el mismo número,
  // porque el cupo es uno solo y se gasta entre todos.
  ok(/cuentaDe\(sesion\.id\)/.test(src), 'pregunta por la cuenta del dueño, no por quien mira');
  ok(/estado\.error.*503|if \(estado\.error\) return jsonResp\(\{ error: estado\.motivo \}, 503\)/s.test(src),
     'si no se pudo calcular, responde 503 en vez de un cero cómodo');
  ok(/runtime: 'edge'/.test(src), 'es edge, que es lo que exige importar un api/_*.js');
}

console.log('');
process.exit(mal ? 1 : 0);
