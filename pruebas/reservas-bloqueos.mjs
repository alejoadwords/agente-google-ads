// Bloquear un rato: node pruebas/reservas-bloqueos.mjs
//
// El módulo ya sabía cerrar un día entero (una excepción del horario), pero no
// bloquear un rato suelto —«mañana de 2 a 4»— ni bloquear a UNA persona
// dejando al resto atendiendo. Eso son ahora filas de `booking_blocks` que
// entran en el cálculo como si fueran citas.
//
// Lo delicado no es el bloqueo: es cómo se BUSCAN. Se prueba ejecutando
// `ocupadoDe` de verdad contra una base de mentira, porque el fallo que
// importa —unas vacaciones que no tapan nada— no se ve leyendo la consulta.

import { readFileSync } from 'node:fs';
import { franjasLibres } from '../api/_disponibilidad.js';

let mal = 0;
const ok = (c, m, extra) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra ? ' → ' + extra : ''));
  if (!c) mal++;
};

// ── `ocupadoDe`, ejecutada contra una base de mentira ───────────────────────
const fuente = readFileSync(new URL('../api/booking-public.js', import.meta.url), 'utf8');
const firma = 'async function ocupadoDe(neg, ids, desdeISO, hastaISO) {';
const i = fuente.indexOf(firma);
if (i < 0) throw new Error('No encontré ocupadoDe en booking-public.js: revisa esta prueba');
let prof = 0, j = i + firma.length - 1;
for (; j < fuente.length; j++) {
  if (fuente[j] === '{') prof++;
  else if (fuente[j] === '}' && --prof === 0) break;
}
const src = fuente.slice(i, j + 1);

/** Corre `ocupadoDe` con lo que responda la base falsa, y apunta qué preguntó. */
async function ocupado({ citas = [], bloqueos = [], ids, desde, hasta, cliente = null }) {
  const preguntas = [];
  const entorno = {
    sb: async (ruta) => {
      preguntas.push(ruta);
      return ruta.startsWith('/booking_blocks') ? bloqueos : citas;
    },
    filtroCliente: (c) => (c ? `client_id=eq.${encodeURIComponent(c)}` : 'client_id=is.null'),
  };
  const nombres = Object.keys(entorno);
  const f = new Function(...nombres, src + '\n; return ocupadoDe;');
  const res = await f(...nombres.map((n) => entorno[n]))(
    { user_id: 'u1', client_id: cliente }, ids, desde, hasta);
  return { res, preguntas };
}

const D = (s) => new Date(s).toISOString();
const IDS = ['r1', 'r2'];
const DESDE = D('2026-10-05T00:00:00Z');
const HASTA = D('2026-10-12T00:00:00Z');

console.log('\nUn bloqueo ocupa igual que una cita\n');
{
  const { res } = await ocupado({
    ids: IDS, desde: DESDE, hasta: HASTA,
    bloqueos: [{ inicio: D('2026-10-06T19:00:00Z'), fin: D('2026-10-06T21:00:00Z'), resource_id: 'r1' }],
  });
  ok(res.r1.length === 1, 'el recurso bloqueado lo tiene ocupado', JSON.stringify(res.r1));
  ok(res.r2.length === 0, 'y el otro sigue libre: se bloqueó a UNA persona', JSON.stringify(res.r2));
  ok(res.r1[0].ini === new Date('2026-10-06T19:00:00Z').getTime()
     && res.r1[0].fin === new Date('2026-10-06T21:00:00Z').getTime(),
     'con sus horas exactas');
}
{
  // Sin recurso, el bloqueo es del negocio entero.
  const { res } = await ocupado({
    ids: IDS, desde: DESDE, hasta: HASTA,
    bloqueos: [{ inicio: D('2026-10-06T19:00:00Z'), fin: D('2026-10-06T21:00:00Z'), resource_id: null }],
  });
  ok(res.r1.length === 1 && res.r2.length === 1,
     'un bloqueo sin recurso tapa a TODOS los del negocio',
     JSON.stringify({ r1: res.r1.length, r2: res.r2.length }));
}
{
  // Citas y bloqueos conviven.
  const { res } = await ocupado({
    ids: IDS, desde: DESDE, hasta: HASTA,
    citas: [{ due_at: D('2026-10-07T14:00:00Z'), end_at: D('2026-10-07T15:00:00Z'), resource_id: 'r1' }],
    bloqueos: [{ inicio: D('2026-10-06T19:00:00Z'), fin: D('2026-10-06T21:00:00Z'), resource_id: 'r1' }],
  });
  ok(res.r1.length === 2, 'lo reservado y lo bloqueado se suman', JSON.stringify(res.r1.length));
}

console.log('\nLas vacaciones de una semana tapan la semana entera\n');
{
  // EL fallo que se busca: si los bloqueos se filtraran por «empieza dentro
  // del rango» —como se filtran las citas, que son cortas— unas vacaciones
  // que empezaron el lunes anterior no taparían nada del rango que se mira.
  const { preguntas } = await ocupado({ ids: IDS, desde: DESDE, hasta: HASTA });
  const q = preguntas.find((p) => p.startsWith('/booking_blocks')) || '';
  ok(!!q, 'se pregunta por los bloqueos', JSON.stringify(preguntas));
  ok(/inicio=lt\./.test(q) && /fin=gt\./.test(q),
     'el filtro es por SOLAPE: empieza antes de que acabe el rango y acaba después de que empiece', q);
  ok(!/inicio=gte\./.test(q),
     'y NO por «empieza dentro del rango», que es lo que dejaría pasar unas vacaciones largas', q);
}
{
  // Y comprobado con datos: un bloqueo que empieza ANTES del rango.
  const { res } = await ocupado({
    ids: IDS, desde: DESDE, hasta: HASTA,
    bloqueos: [{ inicio: D('2026-10-01T00:00:00Z'), fin: D('2026-10-20T00:00:00Z'), resource_id: null }],
  });
  ok(res.r1.length === 1 && res.r2.length === 1,
     'unas vacaciones que empezaron la semana pasada siguen tapando');
}

console.log('\nY el alcance por cliente no se pierde\n');
{
  const { preguntas } = await ocupado({ ids: IDS, desde: DESDE, hasta: HASTA, cliente: 'c9' });
  const q = preguntas.find((p) => p.startsWith('/booking_blocks')) || '';
  ok(/client_id=eq\.c9/.test(q), 'los bloqueos de un cliente son suyos', q);
  const { preguntas: p2 } = await ocupado({ ids: IDS, desde: DESDE, hasta: HASTA, cliente: null });
  const q2 = p2.find((p) => p.startsWith('/booking_blocks')) || '';
  ok(/client_id=is\.null/.test(q2), 'y los de la cuenta, de la cuenta', q2);
}

// ── Lo que ve quien reserva ────────────────────────────────────────────────
console.log('\nLas horas bloqueadas desaparecen de la página pública\n');
{
  const base = {
    dia: '2026-10-06', zona: 'America/Bogota',
    horario: { '2': [['09:00', '17:00']] },      // martes
    minutos: 60, paso: 60, ahora: new Date('2026-10-01T12:00:00Z'),
  };
  const sinBloqueo = franjasLibres({ ...base, ocupado: [] });
  ok(sinBloqueo.length === 8, 'sin bloquear nada hay ocho horas', String(sinBloqueo.length));

  // Bloqueo de 14:00 a 16:00 hora de Bogotá = 19:00–21:00 UTC.
  const conBloqueo = franjasLibres({
    ...base,
    ocupado: [{ ini: new Date('2026-10-06T19:00:00Z').getTime(), fin: new Date('2026-10-06T21:00:00Z').getTime() }],
  });
  ok(conBloqueo.length === 6, 'bloqueando de 2 a 4 quedan seis', String(conBloqueo.length));
  ok(!conBloqueo.some(f => f.hhmm === '14:00' || f.hhmm === '15:00'),
     'y las dos bloqueadas no se ofrecen', conBloqueo.map(f => f.hhmm).join(' '));
  ok(conBloqueo.some(f => f.hhmm === '13:00') && conBloqueo.some(f => f.hhmm === '16:00'),
     'las de al lado sí: se bloquea el rato, no el día');
}

// ── El servidor no se cree lo que le manden ────────────────────────────────
console.log('\nEl servidor comprueba antes de guardar\n');
{
  const api = readFileSync(new URL('../api/bookings.js', import.meta.url), 'utf8');
  const bloque = api.slice(api.indexOf("if (que === 'bloqueo')"), api.indexOf("return jsonResp({ error: 'Método no permitido' }"));
  ok(/El final tiene que ir después del principio/.test(bloque),
     'un bloqueo al revés se rechaza: taparía desde el infinito');
  ok(/isNaN\(ini\.getTime\(\)\) \|\| isNaN\(fin\.getTime\(\)\)/.test(bloque),
     'y una fecha que no se entiende también');
  // Sin esto, mandando un id por la petición se le tapa la agenda a otro negocio.
  ok(/await mia\('booking_resources', recurso, userId, cliente\)/.test(bloque),
     'el recurso que se bloquea tiene que ser de esta cuenta');
  ok(/await mia\('booking_blocks', id, userId, cliente\)/.test(bloque),
     'y el que se borra, también');
  ok(/client_id: cliente/.test(bloque), 'el bloqueo nace dentro de su cliente');
}
{
  const api = readFileSync(new URL('../api/bookings.js', import.meta.url), 'utf8');
  // Configurar reservas es cosa del administrador, como lo demás del módulo.
  ok(/Solo el administrador de la cuenta puede configurar las reservas/.test(api)
     && api.indexOf('Solo el administrador') < api.indexOf("if (que === 'bloqueo')"),
     'y todo esto pasa por la puerta de administrador, que está antes');
}

// ── Que no se cuelen en la agenda ni en el correo diario ───────────────────
console.log('\nUn bloqueo NO es una tarea de nadie\n');
{
  // La razón de que sean tabla propia. `cron-tasks` manda un correo diario con
  // lo pendiente y filtra solo por `done=false`: un bloqueo metido en
  // `activities` le habría escrito a cada asesor contándole sus bloqueos.
  const cron = readFileSync(new URL('../api/cron-tasks.js', import.meta.url), 'utf8');
  const agenda = readFileSync(new URL('../api/agenda.js', import.meta.url), 'utf8');
  ok(!/booking_blocks/.test(cron), 'el resumen diario no los ve');
  ok(!/booking_blocks/.test(agenda), 'ni la agenda del CRM');
  const pub = readFileSync(new URL('../api/booking-public.js', import.meta.url), 'utf8');
  ok(/booking_blocks/.test(pub), 'y quien sí los mira es el cálculo de huecos');
}

// ── La pantalla ────────────────────────────────────────────────────────────
console.log('\nLa pantalla lo ofrece y no miente\n');
{
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const i = app.indexOf("'<h3 class=\"rsv-h3\">Ratos bloqueados</h3>'");
  ok(i > 0, 'la sección existe');
  const seccion = app.slice(i - 400, i + 2400);

  ok(/rsv-bl-dia/.test(seccion) && /rsv-bl-desde/.test(seccion) && /rsv-bl-hasta/.test(seccion),
     'se pide día, desde y hasta');
  ok(/Todo el negocio/.test(seccion), 'y se puede bloquear a todo el negocio');
  ok(/rsvDatos\.recursos \|\| \[\]/.test(seccion), 'o a una persona de la lista real, no inventada');

  // Cada clase y cada token, comprobados: un token inventado no falla, solo se
  // ve mal. Es la regla de la casa.
  const clases = new Set();
  for (const m of seccion.matchAll(/class="([a-z0-9 \-]+)"/g)) m[1].split(' ').forEach(c => clases.add(c));
  const faltan = [...clases].filter(c => c && !c.startsWith('btn-') && c !== 'auto-input' && !html.includes('.' + c));
  ok(faltan.length === 0, 'todas las clases existen en el CSS', faltan.join(', '));

  const fn = app.slice(app.indexOf('async function rsvAgregarBloqueo'), app.indexOf('async function rsvBorrarBloqueo'));
  ok(/hasta <= desde/.test(fn), 'un rango al revés se para en el navegador, antes de molestar al servidor');
  ok(/if \(!dia\)/.test(fn), 'y sin día también');
  ok(/toISOString\(\)/.test(fn), 'las horas viajan en ISO, no como texto suelto');

  // La hora se pinta en la zona del NEGOCIO, no en la de quien mira: un dueño
  // de viaje vería sus bloqueos corridos y creería que se guardaron mal.
  const leg = app.slice(app.indexOf('function rsvRangoLegible'), app.indexOf('function rsvQuienBloqueado'));
  ok(/timeZone: zona/.test(leg), 'el rango se lee en la zona del negocio');
  ok(/zona_horaria/.test(leg), 'que sale de su configuración');
  ok(/d1 === d2/.test(leg), 'y si cruza la medianoche se enseñan los dos días');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);
