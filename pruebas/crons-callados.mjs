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

import { callados, atascados, latir, ATASCO_MIN, CADA, tolerancia, DESDE, DESDE_POR_CRON, desdeDe, SOLO_ENTRE_SEMANA, minutosHabiles } from '../api/_latido.js';

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

// ── El fin de semana no cuenta, pero tampoco tapa ───────────────────────────
//
// La primera regla era «el sábado y el domingo no se avisa de los que solo
// corren de lunes a viernes», y tenía dos agujeros opuestos:
//
//  · tapaba de más: el sábado no avisaba aunque el cron se hubiera saltado su
//    turno del VIERNES, que es un fallo de verdad;
//  · y no tapaba lo suficiente: el LUNES por la mañana el silencio medido
//    incluía el fin de semana entero. `cron-tasks` corre a las 12:00 de lunes
//    a viernes, así que el lunes a las 00:15 —cuando pasa el vigilante— habría
//    llevado 60 horas calladas contra 30 de tolerancia. Aviso seguro, y sin
//    que hubiera pasado nada. El lunes 28-09-2026 habría sido el primero.
//
// Ahora el silencio de esos crons se mide en minutos HÁBILES.
const unoDeCadaUno = (referencia, salvo, cuando) => Object.keys(CADA).map(cron => ({
  cron, ultima_vez: cron === salvo ? cuando : hace(1, referencia),
}));
const VIERNES_12 = '2026-09-25T12:00:00Z';
const JUEVES_13  = '2026-09-24T13:00:00Z';
const LUNES_TEMPRANO = new Date('2026-09-28T00:15:00Z');   // cuando pasa cron-errores
const LUNES_TARDE    = new Date('2026-09-28T19:00:00Z');   // ya debería haber corrido a las 12:00

ok(!callados(unoDeCadaUno(SABADO, 'cron-tasks', VIERNES_12), SABADO)
     .some(c => c.cron === 'cron-tasks'),
   'el sábado, con su turno del viernes hecho, no avisa');
ok(callados(unoDeCadaUno(SABADO, 'cron-tasks', JUEVES_13), SABADO)
     .some(c => c.cron === 'cron-tasks'),
   'pero si se saltó el viernes, el sábado SÍ avisa — el fin de semana no lo tapa');
ok(!callados(unoDeCadaUno(LUNES_TEMPRANO, 'cron-tasks', VIERNES_12), LUNES_TEMPRANO)
     .some(c => c.cron === 'cron-tasks'),
   'el lunes de madrugada no avisa: las 60 horas son fin de semana, no silencio');
ok(callados(unoDeCadaUno(LUNES_TARDE, 'cron-tasks', VIERNES_12), LUNES_TARDE)
     .some(c => c.cron === 'cron-tasks'),
   'y el lunes por la tarde, si no corrió a las 12:00, sí');
ok(callados(sinTareas, MIERCOLES).some(c => c.cron === 'cron-tasks'),
   'el mismo silencio entre semana sigue avisando');

// A los de todos los días el fin de semana SÍ les cuenta: ellos corren igual.
ok(callados(unoDeCadaUno(SABADO, 'cron-retention', JUEVES_13), SABADO)
     .some(c => c.cron === 'cron-retention'),
   'a un cron diario el fin de semana no se le perdona: corre sábado y domingo');

// Un cron que NUNCA ha latido: ni ignorarlo siempre ni denunciarlo siempre.
//
// Ignorarlo fue el punto ciego real: `cron-tasks` —el cron para el que se
// construyó todo esto— no latió en dos días y el vigilante calló, porque
// «nunca ha latido» era su caso descartado.
//
// Denunciarlo siempre habría sacado seis falsos positivos el día de estrenar.
// El término medio es perdonarle su intervalo contado desde que la vigilancia
// existe.
const RECIEN = new Date(new Date(DESDE).getTime() + 60 * 60000);        // una hora después
const MUCHO  = new Date(new Date(DESDE).getTime() + 120 * 60 * 60000); // cinco días después
// OJO: tiene que caer ENTRE SEMANA. A las sesenta horas caía en sábado y el
// vigilante perdonaba a cron-tasks con toda la razón, así que la prueba daba
// rojo por la fecha elegida y no por el código.
if (MUCHO.getUTCDay() === 0 || MUCHO.getUTCDay() === 6) throw new Error('MUCHO cayó en fin de semana');

const faltaUno = alDia.filter(l => l.cron !== 'cron-trials');
ok(!callados(faltaUno, RECIEN).some(c => c.cron === 'cron-trials'),
   'recién estrenado, un cron sin latido no genera aviso: no le ha dado tiempo');
// Con la tabla vacía el perdón NO es igual para todos, y debe ser así: a la
// hora de estrenar, un cron de diez minutos ya ha perdido seis oportunidades
// —eso es un problema— mientras que uno diario ni siquiera ha tenido la suya.
const vaciaRecien = callados([], RECIEN).map(c => c.cron);
ok(vaciaRecien.includes('cron-automations'),
   'un cron de 10 min sin latido tras una hora sí se denuncia: perdió seis turnos');
ok(!vaciaRecien.includes('cron-tasks') && !vaciaRecien.includes('cron-trials'),
   'y uno diario no: todavía no le ha tocado');
ok(Array.isArray(callados(null, RECIEN)), 'con null no revienta');

const sinTasks = Object.keys(CADA).filter(c => c !== 'cron-tasks')
  .map(cron => ({ cron, ultima_vez: hace(1, MUCHO) }));
const f3 = callados(sinTasks, MUCHO);
ok(f3.some(c => c.cron === 'cron-tasks'),
   'pero pasado su plazo SIN haber latido nunca, sí se denuncia — el punto ciego de cron-tasks');
ok(f3.find(c => c.cron === 'cron-tasks')?.desde === null,
   'y se distingue: no tiene «desde», porque nunca latió');

// Pero en cuanto late una vez, ya queda vigilado.
const yaLatio = [{ cron: 'cron-trials', ultima_vez: hace(60 * 31) }];
ok(callados(yaLatio, MIERCOLES).some(c => c.cron === 'cron-trials'),
   'en cuanto late una vez, su silencio posterior sí avisa');

// ── Que no quede ningún cron sin vigilar ────────────────────────────────────
//
// Siete de los dieciséis no dejaban latido, así que el vigilante no podía
// decir nada de ellos: `cron-retention`, `cron-integridad` y `cron-conectores`
// corren a diario o cada día hábil y nadie sabía si corrían. Un instrumento
// que cubre la mitad da confianza falsa, que es peor que no tener ninguno.
//
// Esta comprobación es la que impide que vuelva a pasar: se lee `vercel.json`,
// no una lista escrita a mano, así que un cron nuevo entra en rojo hasta que
// late.
{
  const { readFileSync } = await import('node:fs');
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const enVercel = (vercel.crons || []).map(c => c.path.replace('/api/', ''));
  ok(enVercel.length > 0, 'vercel.json declara crons: ' + enVercel.length);

  const sinVigilar = enVercel.filter(c => !(c in CADA));
  ok(sinVigilar.length === 0, 'todos los crons de vercel.json están vigilados'
     + (sinVigilar.length ? ' → faltan: ' + sinVigilar.join(', ') : ''));

  const sobran = Object.keys(CADA).filter(c => !enVercel.includes(c));
  ok(sobran.length === 0, 'y no se vigila ninguno que ya no exista'
     + (sobran.length ? ' → sobran: ' + sobran.join(', ') : ''));

  // Vigilar sin latir es peor que no vigilar: sería un aviso permanente de un
  // cron perfectamente vivo, y un aviso que suena siempre se deja de leer.
  const mudos = Object.keys(CADA).filter(c => {
    try { return !/latir\(/.test(readFileSync(new URL('../api/' + c + '.js', import.meta.url), 'utf8')); }
    catch { return true; }
  });
  ok(mudos.length === 0, 'y todos llaman a latir()'
     + (mudos.length ? ' → mudos: ' + mudos.join(', ') : ''));

  // La entrada además de la salida: sin ella no se distingue «Vercel no lo
  // llamó» de «lo llamó y se murió a mitad».
  const sinEntrada = Object.keys(CADA).filter(c => {
    try { return !/\{ empezo:/.test(readFileSync(new URL('../api/' + c + '.js', import.meta.url), 'utf8')); }
    catch { return true; }
  });
  ok(sinEntrada.length === 0, 'y todos marcan la entrada'
     + (sinEntrada.length ? ' → sin marca: ' + sinEntrada.join(', ') : ''));

  // El horario declarado y el intervalo vigilado tienen que hablar de lo
  // mismo. Un cron de lunes a viernes vigilado con la regla de los de diario
  // avisaría cada lunes por la mañana.
  const soloLV = enVercel.filter(c => {
    const cr = (vercel.crons || []).find(x => x.path === '/api/' + c);
    return /1-5|MON-FRI/i.test(cr.schedule.split(' ').slice(4).join(' '));
  });
  const mal2 = soloLV.filter(c => !SOLO_ENTRE_SEMANA.includes(c));
  ok(mal2.length === 0, 'los de lunes a viernes están marcados como tales'
     + (mal2.length ? ' → faltan: ' + mal2.join(', ') : ''));
  const noLV = SOLO_ENTRE_SEMANA.filter(c => !soloLV.includes(c));
  ok(noLV.length === 0, 'y ninguno se libra del fin de semana sin merecerlo'
     + (noLV.length ? ' → sobran: ' + noLV.join(', ') : ''));
}

// ── Minutos hábiles ─────────────────────────────────────────────────────────
ok(minutosHabiles('2026-09-25T12:00:00Z', '2026-09-28T00:15:00Z') === 12 * 60 + 15,
   'de viernes 12:00 a lunes 00:15 hay 12 h 15 min hábiles, no 60 h');
ok(minutosHabiles('2026-09-26T00:00:00Z', '2026-09-28T00:00:00Z') === 0,
   'un fin de semana entero son cero minutos hábiles');
ok(minutosHabiles('2026-09-23T10:00:00Z', '2026-09-23T11:30:00Z') === 90,
   'dentro del mismo día laborable se cuenta normal');
ok(minutosHabiles('2026-09-28T10:00:00Z', '2026-09-23T10:00:00Z') === 0,
   'hacia atrás da cero, no un número negativo');
ok(minutosHabiles('2026-09-23T10:00:00Z', '2026-09-23T10:00:00Z') === 0,
   'el mismo instante son cero minutos');
ok(minutosHabiles('no es una fecha', '2026-09-23T10:00:00Z') === 0,
   'y una fecha ilegible da cero, no NaN');

// ── Un cron recién vigilado no se denuncia por estrenarlo ───────────────────
//
// Los siete que se enchufaron el 27-09 entraron en `CADA` cuatro días después
// de que naciera la vigilancia. Con la fecha común habrían llevado «cuatro
// días sin latir» desde el minuto uno y el vigilante los habría sacado a
// todos a la vez, antes de que ninguno tuviera su primer turno. Cada uno se
// cuenta desde que SE LE PUSO el latido.
{
  const recienes = Object.keys(DESDE_POR_CRON);
  ok(recienes.length > 0, 'hay crons con fecha propia de vigilancia: ' + recienes.length);
  ok(recienes.every(c => c in CADA), 'y todos están en CADA');
  ok(desdeDe('cron-tasks') === DESDE, 'los de siempre usan la fecha común');
  ok(desdeDe('cron-retention') === DESDE_POR_CRON['cron-retention'], 'y los nuevos, la suya');

  // Contra un instante ABSOLUTO, no contra la propia constante que se está
  // comprobando. Medirlo relativo a `DESDE_POR_CRON` era una tautología: al
  // mover la fecha se movía con ella la ventana de la prueba, y adelantarla
  // cuatro días —el fallo exacto que esto viene a cazar— pasaba en verde. Es
  // el mismo error que ya se cometió con la ventana de la agenda.
  //
  // 27-09 a las 17:10 UTC es el minuto de publicar esto. Con la fecha común
  // —23-09— los siete ya llevarían cuatro días de silencio, muy por encima de
  // las 30 horas de un cron diario, y saldrían todos.
  const AL_PUBLICAR = new Date('2026-09-27T17:10:00Z');
  const viejosAlDia = Object.keys(CADA).filter(c => !(c in DESDE_POR_CRON))
    .map(cron => ({ cron, ultima_vez: new Date(AL_PUBLICAR.getTime() - 60000).toISOString() }));
  const falsos = recienes.filter(c => callados(viejosAlDia, AL_PUBLICAR).some(x => x.cron === c));
  ok(falsos.length === 0, 'al publicar no avisa de ninguno de los recién enchufados'
     + (falsos.length ? ' → falsos: ' + falsos.join(', ') : ''));
  ok(recienes.every(c => new Date(desdeDe(c)) > new Date(DESDE)),
     'porque cada uno se cuenta desde que se le puso el latido, no desde el 23-09');

  // Pero pasado su plazo sí: si de verdad no corre, se sabe.
  const DOS_DIAS_DESPUES = new Date('2026-09-29T17:10:00Z');
  ok(callados(viejosAlDia, DOS_DIAS_DESPUES).some(c => c.cron === 'cron-retention'),
     'y a las 48 horas sin latir, cron-retention sí sale');
}

// ── Entró y no salió ────────────────────────────────────────────────────────
//
// La marca de entrada pisaba la misma `ultima_vez` que la salida: un cron que
// se moría a mitad en CADA vuelta seguía pareciendo vivo. Ahora la entrada va
// a `ultima_entrada` y `atascados()` avisa del que entró y no salió.
{
  const fila = (cron, entro, salio) => ({ cron, ultima_entrada: entro, ultima_vez: salio });
  ok(atascados([fila('cron-tasks', hace(ATASCO_MIN + 5), hace(24 * 60))], MIERCOLES).some(c => c.cron === 'cron-tasks'),
     'entró hace más de ' + ATASCO_MIN + ' min y no salió → atascado');
  ok(atascados([fila('cron-tasks', hace(2), hace(24 * 60))], MIERCOLES).length === 0,
     'si entró hace dos minutos, está corriendo: no se avisa');
  ok(atascados([fila('cron-tasks', hace(60), hace(59))], MIERCOLES).length === 0,
     'si salió después de entrar, terminó bien');
  ok(atascados([fila('cron-tasks', null, hace(10))], MIERCOLES).length === 0,
     'sin marca de entrada todavía (filas de antes del cambio) no se inventa nada');
  ok(atascados([fila('cron-que-ya-no-existe', hace(600), hace(900))], MIERCOLES).length === 0,
     'y solo se mira a los que se vigilan');

  // Lo que escribe latir(): la entrada NO puede tocar ultima_vez, o el
  // vigilante vuelve a quedar ciego.
  const enviados = [];
  const antes = { f: globalThis.fetch, u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_KEY };
  process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_KEY = 'k';
  globalThis.fetch = async (u, o) => { enviados.push(JSON.parse(o.body)); return { ok: true }; };
  await latir('cron-tasks', { empezo: new Date().toISOString() });
  await latir('cron-tasks', { enviados: 3 });
  await latir('cron-tasks', { error: true }, 'se cayó');
  globalThis.fetch = antes.f;
  if (antes.u === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = antes.u;
  if (antes.k === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = antes.k;
  const [ent, sal, fal] = enviados;
  ok(ent && ent.ultima_entrada && !('ultima_vez' in ent) && !('ultimo_resultado' in ent),
     'la entrada escribe ultima_entrada y no toca ultima_vez ni el resultado');
  ok(sal && sal.ultima_vez && !('ultima_entrada' in sal) && sal.ultimo_resultado.enviados === 3,
     'la salida escribe ultima_vez y el resultado');
  ok(fal && fal.ultimo_fallo && fal.motivo_fallo === 'se cayó', 'y un fallo deja su marca');
}

process.exit(mal ? 1 : 0);
