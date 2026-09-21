// api/_disponibilidad.js — a qué horas queda hueco.
//
// El corazón del módulo de reservas, y la única parte con lógica de verdad.
// Vive aparte y sin tocar la base a propósito: así se puede probar entera con
// datos inventados, que es lo que hace falta cuando un fallo aquí significa dos
// clientes citados a la misma hora.
//
// Solo se importa desde funciones EDGE (ver CLAUDE.md).

// ── Zona horaria ─────────────────────────────────────────────────────────────
// package.json no tiene dependencias a propósito, así que no hay librería de
// zonas horarias. `Intl` la trae el motor y además sabe de horario de verano:
// una barbería en Santiago cambia de hora dos veces al año y con un desfase
// fijo se citaría a la gente una hora antes medio año.
const _fmt = new Map();
function partes(zona, instante) {
  let f = _fmt.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _fmt.set(zona, f);
  }
  const o = {};
  for (const p of f.formatToParts(instante)) if (p.type !== 'literal') o[p.type] = p.value;
  // A medianoche, `hour` sale como '24' en algunos motores.
  if (o.hour === '24') o.hour = '00';
  return o;
}

/** Cuántos minutos separa esa zona del UTC en ese instante concreto. */
export function desfaseMin(zona, instante) {
  const p = partes(zona, instante);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

/** El día local ('2026-09-22') de un instante. */
export function diaLocal(zona, instante) {
  const p = partes(zona, instante);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * El instante UTC de una hora local. Se resuelve en dos pasos porque el desfase
 * depende del propio instante: se estima con el desfase de ese día y se corrige
 * con el desfase real del resultado. Sin la corrección, las dos horas al año en
 * que cambia el horario quedan desplazadas.
 */
export function instanteDe(zona, dia, hhmm) {
  const [a, m, d] = dia.split('-').map(Number);
  const [h, mi] = String(hhmm).split(':').map(Number);
  const ingenuo = Date.UTC(a, m - 1, d, h, mi, 0);
  const off1 = desfaseMin(zona, new Date(ingenuo));
  const t1 = ingenuo - off1 * 60000;
  const off2 = desfaseMin(zona, new Date(t1));
  return new Date(off1 === off2 ? t1 : ingenuo - off2 * 60000);
}

const aMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/**
 * Los tramos de atención de un día, ya resueltos.
 *
 * Manda la EXCEPCIÓN sobre el horario semanal, y una excepción con lista vacía
 * significa cerrado — un festivo. Distinguir «no hay excepción» de «excepción
 * vacía» es justo lo que permite cerrar un día suelto sin tocar el horario.
 */
export function tramosDelDia(dia, horario, excepciones, diaSemana) {
  if (excepciones && Object.prototype.hasOwnProperty.call(excepciones, dia)) {
    return Array.isArray(excepciones[dia]) ? excepciones[dia] : [];
  }
  const h = (horario || {})[String(diaSemana)];
  return Array.isArray(h) ? h : [];
}

/**
 * Las horas a las que se puede empezar una cita ese día.
 *
 * @param dia        '2026-09-22' en la zona del negocio
 * @param zona       'America/Bogota'
 * @param horario    { '1': [['09:00','13:00'],['14:00','18:00']], … } 0=domingo
 * @param excepciones { '2026-12-25': [] }  cerrado · o tramos propios
 * @param ocupado    [{ ini: ms, fin: ms }] lo que ya tiene ese recurso
 * @param minutos    lo que dura el servicio
 * @param margen     minutos de respiro DESPUÉS de cada cita
 * @param paso       cada cuántos minutos se ofrece un inicio (15, 30…)
 * @param ahora      Date — para no ofrecer horas pasadas
 * @param antelacionMinHoras  con cuánta antelación mínima se puede reservar
 * @returns [{ inicio: ISO, fin: ISO, hhmm: '09:30' }]
 */
export function franjasLibres(o) {
  const {
    dia, zona = 'America/Bogota', horario, excepciones, ocupado = [],
    minutos = 30, margen = 0, paso = 15, ahora = new Date(), antelacionMinHoras = 0,
  } = o || {};
  if (!dia || !Number.isFinite(minutos) || minutos <= 0) return [];

  // El día de la semana se saca del propio día local, no de `new Date(dia)`:
  // interpretar '2026-09-22' como UTC puede caer en la víspera según la zona.
  // Se mira a mediodía para no caer en la víspera ni en el día siguiente por
  // culpa del desfase, que es lo que pasa si se mira a las 00:00.
  const mediodia = instanteDe(zona, dia, '12:00');
  const nombre = new Intl.DateTimeFormat('en-US', { timeZone: zona, weekday: 'short' })
    .format(mediodia).toLowerCase().slice(0, 3);
  const diaSemana = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(nombre);

  const tramos = tramosDelDia(dia, horario, excepciones, diaSemana);
  if (!tramos.length) return [];

  const noAntesDe = ahora.getTime() + antelacionMinHoras * 3600000;
  // Cada cita ocupa su duración MÁS el margen: si no, la siguiente empieza en
  // el mismo minuto en que termina la anterior y nadie llega a tiempo.
  const ocupadas = (ocupado || [])
    .map(x => ({ ini: Number(x.ini), fin: Number(x.fin) + margen * 60000 }))
    .filter(x => Number.isFinite(x.ini) && Number.isFinite(x.fin) && x.fin > x.ini);

  const out = [];
  const vistos = new Set();
  for (const tramo of tramos) {
    if (!Array.isArray(tramo) || tramo.length < 2) continue;
    const abre = aMin(tramo[0]);
    const cierra = aMin(tramo[1]);
    if (!(cierra > abre)) continue;

    // Se avanza de `paso` en `paso` y la cita tiene que CABER ENTERA dentro del
    // tramo. Ofrecer un corte de 45 min a las 17:30 cuando se cierra a las 18
    // es prometer algo que no se puede cumplir.
    for (let m = abre; m + minutos <= cierra; m += paso) {
      const hhmm = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      const ini = instanteDe(zona, dia, hhmm);
      const t0 = ini.getTime();
      const t1 = t0 + minutos * 60000;
      if (t0 < noAntesDe) continue;
      // Se solapa si empieza antes de que acabe la otra y acaba después de que
      // la otra empiece. El margen ya está sumado al final de cada ocupada.
      if (ocupadas.some(x => t0 < x.fin && t1 > x.ini)) continue;
      if (vistos.has(t0)) continue;
      vistos.add(t0);
      out.push({ inicio: ini.toISOString(), fin: new Date(t1).toISOString(), hhmm });
    }
  }
  out.sort((a, b) => a.inicio.localeCompare(b.inicio));
  return out;
}

/**
 * ¿Sigue libre esta hora exacta? Se pregunta otra vez justo antes de guardar.
 *
 * Entre que alguien ve las horas y pulsa «reservar» pasan minutos, y en ese
 * rato otra persona puede haber cogido la misma. Sin esta segunda comprobación
 * el módulo cita a dos personas a la vez, que es el único fallo que un negocio
 * de citas no perdona.
 */
export function sigueLibre(inicioISO, o) {
  const t = new Date(inicioISO);
  if (isNaN(t.getTime())) return false;
  const zona = o.zona || 'America/Bogota';
  const libres = franjasLibres({ ...o, dia: diaLocal(zona, t) });
  return libres.some(f => f.inicio === t.toISOString());
}
