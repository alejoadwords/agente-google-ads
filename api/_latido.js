// api/_latido.js — que se sepa qué cron corrió y cuál no
//
// El 23-09-2026 el resumen diario de tareas no le llegó a los cinco asesores
// de Certain. Lo reportó uno de ellos. Al ir a mirar qué había pasado a las
// 12:00 UTC no había NADA que mirar: ningún cron deja constancia de haberse
// ejecutado, así que «no corrió», «corrió y no encontró nada» y «corrió y
// falló en silencio» son indistinguibles después del hecho. La causa solo se
// pudo acotar disparándolo a mano.
//
// Un cron que falla es un problema. Un cron que falla sin dejar rastro es el
// mismo problema, pero descubierto por el cliente y sin poder explicárselo.
//
// El latido se escribe SIEMPRE, corriera bien o mal, y guarda el resultado:
// así «hoy nadie tenía tareas» queda distinguido de «hoy no se ejecutó».
// `api/cron-errores.js` compara los latidos con lo que cada cron promete en
// `vercel.json` y avisa del que lleva demasiado callado.

const SB = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_KEY;

/**
 * @param {string} cron      nombre del cron, tal cual el fichero: 'cron-tasks'
 * @param {object} resultado lo que hizo, para poder leerlo después
 * @param {string} [fallo]   motivo si terminó mal; deja la marca del fallo
 */
export async function latir(cron, resultado, fallo) {
  if (!SB() || !KEY()) return;
  const fila = {
    cron,
    ultima_vez: new Date().toISOString(),
    ultimo_resultado: resultado ?? null,
  };
  // El fallo se guarda aparte del último resultado: si mañana va bien, quiero
  // seguir viendo cuándo fue la última vez que se rompió.
  if (fallo) { fila.ultimo_fallo = fila.ultima_vez; fila.motivo_fallo = String(fallo).slice(0, 300); }
  try {
    // `on_conflict` obligatorio: sin él el segundo latido de cada cron sería
    // un 409 y la tabla se quedaría congelada en la primera ejecución.
    await fetch(`${SB()}/rest/v1/cron_latidos?on_conflict=cron`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: KEY(),
        Authorization: `Bearer ${KEY()}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(fila),
    });
  } catch { /* un latido que no se puede escribir no puede tumbar el cron */ }
}

// Cada cuánto promete correr cada uno, en minutos, según `vercel.json`.
//
// SOLO los que ya llaman a `latir()`. Poner aquí uno que todavía no late sería
// un aviso permanente de un cron que está perfectamente vivo, y un aviso que
// suena siempre es un aviso que se deja de leer. Al enchufar otro cron, se
// añade aquí; hasta entonces no se vigila.
export const CADA = {
  'cron-automations': 10,
  'cron-campaigns': 10,
  'cron-conectores': 24 * 60,    // 0 14 * * 1-5
  'cron-errores': 60,
  'cron-integridad': 24 * 60,    // 0 11 * * *
  'cron-knowledge': 31 * 24 * 60,        // 0 12 1 * * — 31 días: el mes más largo
  'cron-catalogo': 30,           // 25,55 * * * *
  'cron-conversiones': 10,      // */10 — ventas a Meta y Google
  'cron-alertas-pauta': 24 * 60, // 0 13 * * * — alertas de la pauta de ayer
  'cron-audiencias': 24 * 60,    // 0 11 * * * — audiencias del CRM a Google y Meta
  'cron-reportes': 24 * 60,      // */15 12-14 * * * — reportes programados para clientes
  'cron-notas': 24 * 60,         // 0 13,20 * * 1-5
  'cron-recordatorios': 10,
  'cron-programados': 5,
  'cron-retention': 24 * 60,     // 0 6 * * *
  'cron-tasks': 24 * 60,         // 0 12 * * 1-5
  'cron-trials': 24 * 60,        // 0 13 * * *
  'cron-ventana': 60,
  'cron-seguimiento': 10,       // */10; fuera de horario también late (fueraDeHora)
  'cron-partners': 60,          // 17 * * * * — comisiones de Partners
};

// Los que solo corren de lunes a viernes. Su silencio se mide en minutos
// HÁBILES, no de reloj: ver `calladoEn`.
export const SOLO_ENTRE_SEMANA = ['cron-conectores', 'cron-notas', 'cron-tasks'];

/**
 * Cuánto silencio se le perdona a cada uno antes de avisar.
 *
 * No vale multiplicar el intervalo por un número y ya: al triple, un cron
 * diario tendría que callarse TRES DÍAS para saltar, que es justo el caso que
 * esto viene a cazar. Y para uno de diez minutos, tres minutos de margen
 * avisaría en cada despliegue.
 *
 * Así que dos criterios: a los frecuentes, el triple —un retraso pequeño es
 * normal—; a los de una vez al día o menos, su intervalo más seis horas, que
 * deja saltar el aviso el mismo día en que se perdió la ejecución.
 */
export const tolerancia = (minutos) => (minutos <= 60 ? minutos * 3 : minutos + 360);

// Desde cuándo existe la vigilancia. Antes de esta fecha no había latidos que
// buscar, así que un cron sin fila no significaba nada.
export const DESDE = '2026-09-23T16:00:00Z';

// Un cron no se empieza a vigilar cuando nació la vigilancia, sino cuando se
// le puso el latido.
//
// Los siete de abajo se enchufaron el 27-09, cuatro días después de estrenar
// esto. Con la fecha común, en cuanto entraron en `CADA` ya llevaban «cuatro
// días sin latir» —más de las 30 horas que se le perdonan a un cron diario— y
// el vigilante los habría denunciado a los pocos minutos de publicar, TODOS a
// la vez y sin que ninguno hubiera tenido todavía su primer turno con el
// código nuevo. Un aviso que sale el día de estrenar por estrenar es el que
// enseña a ignorar los avisos.
export const DESDE_POR_CRON = {
  'cron-partners': '2026-10-06T23:00:00Z',
  'cron-catalogo': '2026-09-28T22:00:00Z',
  'cron-conectores': '2026-09-27T17:00:00Z',
  'cron-integridad': '2026-09-27T17:00:00Z',
  'cron-knowledge': '2026-09-27T17:00:00Z',
  'cron-retention': '2026-09-27T17:00:00Z',
};

/** Desde cuándo se vigila a este cron en concreto. */
export const desdeDe = (cron) => DESDE_POR_CRON[cron] || DESDE;

/**
 * Minutos transcurridos entre dos instantes, contando SOLO de lunes a viernes.
 *
 * Saltarse el sábado y el domingo no bastaba, y el aviso habría empezado a
 * mentir el lunes 28-09-2026 por la mañana: `cron-tasks` corre a las 12:00 de
 * lunes a viernes, así que el lunes a las 00:15 —cuando el vigilante pasa—
 * llevaría 60 horas callado. Con 30 de tolerancia, aviso. Y no habría pasado
 * nada: es viernes más el fin de semana.
 *
 * Se recorre día a día porque el cálculo tiene que ser exacto en los bordes
 * —un tramo que empieza un viernes por la tarde y acaba un lunes por la
 * mañana— y aquí se comparan como mucho unas pocas semanas.
 */
export function minutosHabiles(desde, hasta) {
  let ini = new Date(desde).getTime();
  const fin = new Date(hasta).getTime();
  let total = 0;
  // La condición del bucle ya cubre los casos raros: hacia atrás, el mismo
  // instante y una fecha ilegible —NaN— no entran, y el resultado es cero.
  while (ini < fin) {
    const d = new Date(ini);
    const finDelDia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const tramo = Math.min(finDelDia, fin) - ini;
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6) total += tramo / 60000;
    ini = finDelDia;
  }
  return total;
}

/** Cuánto lleva callado un cron, con la regla que le toque. */
export function calladoEn(cron, desde, ahora) {
  return SOLO_ENTRE_SEMANA.includes(cron)
    ? minutosHabiles(desde, ahora)
    : (new Date(ahora).getTime() - new Date(desde).getTime()) / 60000;
}

/**
 * Los que llevan callados más de lo que se les perdona. A los de lunes a
 * viernes no se les cuenta el fin de semana.
 */
export function callados(latidos, ahora = new Date()) {
  const porNombre = {};
  (latidos || []).forEach(l => { porNombre[l.cron] = l; });
  const fuera = [];
  for (const [cron, minutos] of Object.entries(CADA)) {
    const l = porNombre[cron];
    // Un cron que NUNCA ha latido se denuncia, pero solo cuando ya ha tenido
    // tiempo de hacerlo.
    //
    // La primera versión lo denunciaba siempre, y el minuto de estrenar esto
    // —tabla vacía— el aviso habría salido con los seis dentro. La segunda se
    // pasó al otro extremo y lo ignoraba por completo… y resultó ser el punto
    // ciego exacto: `cron-tasks`, el cron para el que se construyó todo esto,
    // NO ha latido ni una vez en dos días. El vigilante no dijo nada porque
    // «nunca ha latido» era su caso descartado.
    //
    // El término medio: se le perdona lo mismo que a cualquiera —su intervalo
    // más el margen— contado desde que la vigilancia existe. Si en ese plazo
    // no ha aparecido, es que no está corriendo.
    if (!l) {
      const desdeQueSeVigila = calladoEn(cron, desdeDe(cron), ahora);
      if (desdeQueSeVigila > tolerancia(minutos)) fuera.push({ cron, desde: null, minutos: null });
      continue;
    }
    const callado = calladoEn(cron, l.ultima_vez, ahora);
    if (callado > tolerancia(minutos)) fuera.push({ cron, desde: l.ultima_vez, minutos: Math.round(callado) });
  }
  return fuera;
}
