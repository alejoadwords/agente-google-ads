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
  'cron-errores': 60,
  'cron-recordatorios': 10,
  'cron-tasks': 24 * 60,         // 0 12 * * 1-5
  'cron-trials': 24 * 60,        // 0 13 * * *
};

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

/**
 * Los que llevan callados más de lo que se les perdona. Los que solo corren de
 * lunes a viernes se perdonan el sábado y el domingo.
 */
export function callados(latidos, ahora = new Date()) {
  const porNombre = {};
  (latidos || []).forEach(l => { porNombre[l.cron] = l; });
  const finDeSemana = ahora.getUTCDay() === 0 || ahora.getUTCDay() === 6;
  const soloEntreSemana = ['cron-tasks'];
  const fuera = [];
  for (const [cron, minutos] of Object.entries(CADA)) {
    if (finDeSemana && soloEntreSemana.includes(cron)) continue;
    const l = porNombre[cron];
    if (!l) { fuera.push({ cron, desde: null }); continue; }
    const callado = (ahora.getTime() - new Date(l.ultima_vez).getTime()) / 60000;
    if (callado > tolerancia(minutos)) fuera.push({ cron, desde: l.ultima_vez, minutos: Math.round(callado) });
  }
  return fuera;
}
