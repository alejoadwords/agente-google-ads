// pruebas/crons-callados.mjs
//
// El 23-09-2026 el resumen diario de tareas no salió y no había NADA que
// mirar: ningún cron dejaba constancia de haber corrido, así que «no se
// ejecutó», «corrió y no encontró nada» y «corrió y falló en silencio» eran
// indistinguibles. La causa solo se pudo acotar disparándolo a mano.
//
// Ahora cada cron late y `callados()` decide de quién hay que avisar. Esta
// prueba vigila al vigilante: un aviso que salta cuando no debe se deja de
// leer, y entonces no sirve para nada el día que sí importa.

import { callados, CADA, tolerancia } from '../api/_latido.js';

let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };

const MIERCOLES = new Date('2026-09-23T15:00:00Z');
const SABADO = new Date('2026-09-26T15:00:00Z');
const hace = (min, desde = MIERCOLES) => new Date(desde.getTime() - min * 60000).toISOString();

// Todos al día, como debe estar un martes cualquiera.
const alDia = Object.keys(CADA).map(cron => ({ cron, ultima_vez: hace(1) }));
ok(callados(alDia, MIERCOLES).length === 0, 'con todos al día no avisa de nada');

// El caso real: cron-tasks se salta su ejecución de las 12:00. A las 18:00 UTC
// del día siguiente lleva 30 horas callado y tiene que saltar YA — el mismo día
// en que se perdió el aviso, no tres días después.
const sinTareas = alDia.map(l => l.cron === 'cron-tasks' ? { ...l, ultima_vez: hace(60 * 31) } : l);
const f1 = callados(sinTareas, MIERCOLES);
ok(f1.length === 1 && f1[0].cron === 'cron-tasks', 'detecta el cron diario que se saltó su turno');
ok(f1[0].minutos >= 1800, 'y dice cuánto lleva callado: ' + (f1[0]?.minutos) + ' min');

// El día siguiente antes de su hora todavía no: saltó ayer, hoy aún puede correr.
const aunNo = alDia.map(l => l.cron === 'cron-tasks' ? { ...l, ultima_vez: hace(60 * 28) } : l);
ok(!callados(aunNo, MIERCOLES).some(c => c.cron === 'cron-tasks'), 'a las 28 horas todavía no avisa');
ok(tolerancia(10) === 30 && tolerancia(1440) === 1800, 'la tolerancia: 30 min a los frecuentes, 30 h a los diarios');

// A los frecuentes se les perdona el triple: un retraso normal no despierta a nadie.
const conRetraso = alDia.map(l => l.cron === 'cron-campaigns' ? { ...l, ultima_vez: hace(25) } : l);
ok(callados(conRetraso, MIERCOLES).length === 0, 'un retraso de 25 min en un cron de 10 no avisa');
const muyTarde = alDia.map(l => l.cron === 'cron-campaigns' ? { ...l, ultima_vez: hace(45) } : l);
ok(callados(muyTarde, MIERCOLES).some(c => c.cron === 'cron-campaigns'), 'pero 45 min sí');

// Los que solo corren entre semana no pueden avisar el sábado.
const viernes = Object.keys(CADA).map(cron => ({
  cron, ultima_vez: cron === 'cron-tasks' ? hace(60 * 50, SABADO) : hace(1, SABADO),
}));
ok(!callados(viernes, SABADO).some(c => c.cron === 'cron-tasks'),
   'el sábado no se avisa de un cron que solo corre de lunes a viernes');
ok(callados(sinTareas, MIERCOLES).some(c => c.cron === 'cron-tasks'),
   'pero el mismo silencio entre semana sí avisa');

// Un cron que NUNCA ha latido no se denuncia: el día de estrenar esto la tabla
// está vacía y saltarían los seis de golpe. Lo que se vigila es que uno DEJE
// de correr.
const faltaUno = alDia.filter(l => l.cron !== 'cron-trials');
ok(!callados(faltaUno, MIERCOLES).some(c => c.cron === 'cron-trials'),
   'un cron que aún no ha latido nunca no genera aviso');
ok(callados([], MIERCOLES).length === 0, 'con la tabla vacía no avisa de nada — el primer día no suena');
ok(callados(null, MIERCOLES).length === 0, 'y con null no revienta');

// Pero en cuanto late una vez, ya queda vigilado.
const yaLatio = [{ cron: 'cron-trials', ultima_vez: hace(60 * 31) }];
ok(callados(yaLatio, MIERCOLES).some(c => c.cron === 'cron-trials'),
   'en cuanto late una vez, su silencio posterior sí avisa');

process.exit(mal ? 1 : 0);
