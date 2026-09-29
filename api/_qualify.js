// api/_qualify.js
// Calificación de leads en la conversación, antes de molestar a un comercial.
//
// La idea: el agente ya está hablando con la persona, así que aprovecha esa
// conversación para averiguar lo que el negocio necesita saber (presupuesto,
// zona, cuándo compra…). Cuando tiene las respuestas, el código —no el modelo—
// decide si el lead pasa al comercial o se queda con el bot.
//
// Es por agente, no por canal: el mismo agente atiende WhatsApp, Messenger,
// Instagram, TikTok o lo que venga, y califica igual en todos.
//
// La config vive en user_profiles con un agent_key reservado, como el resto de
// la configuración sin esquema versionado.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const QUALIFY_KEY = '__qualify_rules__';

// Un criterio: qué preguntar y qué respuesta lo da por bueno.
// { clave: 'presupuesto', pregunta: '¿Qué presupuesto maneja?', condicion: 'más de 200 millones' }
export const DEFAULT_REGLA = {
  activo: false,
  criterios: [],
  minimo: 0,          // cuántos criterios debe cumplir; 0 = todos
  al_calificar: { escalar: true, etapa: 'calificado', etiqueta: 'calificado' },
  al_descartar: { etiqueta: 'no-calificado' },
  // Enrutado: el agente averigua QUÉ busca la persona y esta tabla lo traduce a
  // un proceso de venta y, si se quiere, a un comercial. El modelo solo reporta
  // la clave; la traducción vive aquí, donde se puede auditar y cambiar sin
  // tocar un prompt.
  enrutado: { activo: false, pregunta: '', rutas: [] },
};

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

function limpiarTexto(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

export function normalizarRegla(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const criterios = (Array.isArray(r.criterios) ? r.criterios : [])
    .map(c => ({
      clave: limpiarTexto(c?.clave, 30).toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'criterio',
      pregunta: limpiarTexto(c?.pregunta, 200),
      condicion: limpiarTexto(c?.condicion, 200),
    }))
    .filter(c => c.pregunta)
    .slice(0, 8); // más de 8 preguntas deja de ser una conversación
  const al = r.al_calificar && typeof r.al_calificar === 'object' ? r.al_calificar : {};
  const ad = r.al_descartar && typeof r.al_descartar === 'object' ? r.al_descartar : {};
  return {
    activo: !!r.activo && criterios.length > 0,
    criterios,
    minimo: Math.min(Math.max(parseInt(r.minimo || 0) || 0, 0), criterios.length),
    al_calificar: {
      escalar: al.escalar !== false,
      etapa: limpiarTexto(al.etapa, 40) || 'calificado',
      etiqueta: limpiarTexto(al.etiqueta, 30).toLowerCase() || 'calificado',
    },
    al_descartar: {
      etiqueta: limpiarTexto(ad.etiqueta, 30).toLowerCase() || 'no-calificado',
    },
    enrutado: normalizarEnrutado(r.enrutado),
  };
}

function normalizarEnrutado(raw) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const rutas = (Array.isArray(e.rutas) ? e.rutas : [])
    .map(r => ({
      clave: limpiarTexto(r?.clave, 30).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      etiqueta: limpiarTexto(r?.etiqueta, 40),
      pipeline_id: limpiarTexto(r?.pipeline_id, 60) || null,
      asignar_a: limpiarTexto(r?.asignar_a, 60) || null,
      asignar_nombre: limpiarTexto(r?.asignar_nombre, 60) || null,
    }))
    .filter(r => r.clave && r.pipeline_id)
    .slice(0, 10);
  return {
    activo: !!e.activo && rutas.length > 0,
    pregunta: limpiarTexto(e.pregunta, 200),
    rutas,
  };
}

// Las reglas se guardan todas juntas: { [agentId]: regla }
async function leerBlob(userId) {
  try {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${QUALIFY_KEY}&select=profile_data&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    return rows?.[0]?.profile_data || {};
  } catch { return {}; }
}

export async function getRegla(userId, agentId) {
  const blob = await leerBlob(userId);
  return normalizarRegla(blob[agentId]);
}

export async function saveRegla(userId, agentId, regla) {
  const blob = await leerBlob(userId);
  // on_conflict obligatorio: sin él el segundo guardado choca con el índice
  // único (user_id, agent_key).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
    method: 'POST',
    headers: { ...sb(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      agent_key: QUALIFY_KEY,
      profile_data: { ...blob, [agentId]: normalizarRegla(regla) },
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

// ── Lo que se le añade al prompt del agente ─────────────────────────────────
// No le pedimos al modelo que decida si el lead sirve: le pedimos que averigüe
// y reporte. Quién pasa al comercial se decide abajo, en código, que es
// auditable y no cambia de opinión entre mensajes.
export function bloqueDePrompt(regla) {
  if (!regla?.activo) return '';
  const lista = regla.criterios
    .map((c, i) => `${i + 1}. ${c.clave} — averigua: ${c.pregunta}${c.condicion ? `\n   Se considera que cumple si: ${c.condicion}` : ''}`)
    .join('\n');
  const json = regla.criterios
    .map(c => `"${c.clave}": {"valor": "lo que te dijo", "cumple": true|false}`)
    .join(', ');

  const enr = regla.enrutado?.activo ? regla.enrutado : null;
  const bloqueRuta = enr
    ? `

TAMBIÉN NECESITAS SABER QUÉ BUSCA LA PERSONA:
${enr.pregunta || 'Averigua cuál de estas opciones encaja con lo que quiere.'}
Opciones (usa EXACTAMENTE una de estas claves): ${enr.rutas.map(r => r.clave).join(', ')}
Si todavía no está claro, no la inventes: omite el campo y sigue conversando.`
    : '';
  const campoRuta = enr ? ', "_ruta": "una de las claves de arriba"' : '';

  return `

LO QUE NECESITAS AVERIGUAR EN ESTA CONVERSACIÓN:
${lista}${bloqueRuta}

Cómo hacerlo:
- Una pregunta a la vez, cuando venga a cuento. Nunca sueltes el cuestionario entero de golpe
- Primero responde lo que te preguntaron; la pregunta tuya va después, encadenada
- Si la persona no quiere responder algo, no insistas más de una vez: márcalo como no cumplido y sigue
- Si ya te dieron el dato antes en la conversación, no lo vuelvas a preguntar

En CADA mensaje tuyo, incluye al final este bloque (invisible para el usuario):
[CALIFICACION: {${json}${campoRuta}}]

Reglas del bloque, importantes:
- Repite SIEMPRE todos los puntos que ya tengas respondidos, no solo el último. El bloque es la foto completa de lo que sabes hasta ahora
- Omite únicamente los puntos que todavía no te hayan respondido
- Si la persona ya te dio el dato en cualquier mensaje anterior, cuenta como respondido aunque no lo hayas preguntado tú
- Marca "cumple" según la condición de cada punto, sin adornar: si la respuesta no llega a lo pedido, es false`;
}

export function extraerCalificacion(text) {
  const match = String(text || '').match(/\[CALIFICACION:\s*(\{.*?\})\]/s);
  if (!match) return {};
  try {
    const raw = JSON.parse(match[1]);
    const out = {};
    for (const k of Object.keys(raw || {})) {
      const v = raw[k];
      // El enrutado viaja como cadena suelta; los criterios como {valor,cumple}.
      // Quedarse solo con los objetos tiraba la ruta sin que nadie se enterara.
      if (k === '_ruta') {
        const cadena = v && typeof v === 'object' ? v.valor : v;
        const limpia = limpiarTexto(cadena, 30).toLowerCase();
        if (limpia) out._ruta = limpia;
        continue;
      }
      if (v && typeof v === 'object') {
        const valor = limpiarTexto(v.valor, 200);
        // Un criterio sin respuesta NO es un criterio respondido.
        //
        // El modelo reporta a veces `{"presupuesto": {"valor": "sin
        // información", "cumple": false}}` para algo que acaba de preguntar y
        // que nadie le ha contestado todavía. Eso contaba como respondido, y
        // con todos los criterios «respondidos» el veredicto salía: un lead
        // llegaba al comercial marcado como calificado y sin presupuesto, o
        // descartado sin haber dicho una palabra. Lo que falta se omite, que es
        // justo lo que el prompt le pide, y entonces el veredicto se queda en
        // 'pendiente' y el agente sigue preguntando.
        if (esNoRespuesta(valor)) continue;
        out[k] = { valor, cumple: !!v.cumple };
      }
    }
    return out;
  } catch { return {}; }
}

// Las formas que toma «todavía no me lo han dicho».
//
// Se compara sin tildes: el modelo escribe «sin información» y «sin
// informacion» indistintamente, y una lista que solo reconociera una de las dos
// dejaría pasar la mitad.
//
// La cola de hasta 12 caracteres es para «sin información aún» o «no lo dijo
// todavía». Y nada de esto puede tragarse una respuesta de verdad: «no» a secas
// es una respuesta, y «no tiene parqueadero» también.
const NO_RESPUESTA = new RegExp(
  '^(' +
  'sin (informacion|datos?|especificar|definir|responder|aclarar)' +
  '|no (lo )?(se|sabe|dijo|indico|indica|respondio|responde|especifico|especifica|' +
      'proporciono|proporciona|menciono|menciona|confirmo|confirma|aclaro|aclara|contesto)' +
  // Los participios: «No especificado» disparó un veredicto sin presupuesto en
  // el primer mensaje de una conversación real, y no casaba porque «no
  // especifico» y «no especificado» no son la misma palabra.
  //
  // Van enumerados y no como «no + cualquier participio»: con la regla general,
  // «no amoblado» —que es una respuesta perfectamente buena a «¿lo quiere
  // amoblado?»— se caía como si no hubieran contestado.
  '|no (especificad|indicad|mencionad|proporcionad|definid|confirmad|suministrad|' +
      'aclarad|informad|contestad|respondid|entregad|brindad|compartid)[oa]' +
  '|no dicho' +
  '|no disponible|no aplica|desconocid[oa]|pendiente|ningun[oa]?|n/?a|null|none|vacio' +
  ')( (aun|todavia|por ahora|de momento|por el momento|hasta ahora))?$'
);

export function esNoRespuesta(valor) {
  const v = String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // fuera tildes
    .toLowerCase().trim()
    .replace(/^[\s.,;:¿?¡!—–-]+|[\s.,;:¿?¡!—–-]+$/g, '');
  if (!v) return true;
  return NO_RESPUESTA.test(v);
}

// Veredicto determinista: 'pendiente' mientras falten respuestas,
// 'calificado' o 'descartado' cuando ya están todas.
export function evaluar(regla, respuestas) {
  if (!regla?.activo) return { estado: 'inactivo' };
  const claves = regla.criterios.map(c => c.clave);
  const contestadas = claves.filter(k => respuestas?.[k]);
  const cumplidas = claves.filter(k => respuestas?.[k]?.cumple);
  const minimo = regla.minimo > 0 ? regla.minimo : claves.length;

  // Nada de descartar antes de tener todas las respuestas: el modelo a veces
  // reporta como respondido-y-no-cumple algo que todavía no ha preguntado, y
  // etiquetar a alguien de "no calificado" por eso es peor que preguntar de más.
  if (contestadas.length < claves.length) {
    return { estado: 'pendiente', cumplidas: cumplidas.length, total: claves.length, minimo };
  }
  return {
    estado: cumplidas.length >= minimo ? 'calificado' : 'descartado',
    cumplidas: cumplidas.length, total: claves.length, minimo,
  };
}

export function resumenLegible(regla, respuestas) {
  return (regla?.criterios || [])
    .filter(c => respuestas?.[c.clave])
    .map(c => `${c.pregunta} → ${respuestas[c.clave].valor || '—'} ${respuestas[c.clave].cumple ? '✅' : '❌'}`)
    .join('\n');
}

// Quién atiende un tablero. Vacío significa «nadie lo tiene marcado», no
// «todos»: aquí se necesita una lista de candidatos para rotar, y rotar entre
// todo el equipo mandaría arriendos a quien solo lleva ventas.
export async function asesoresDelTablero(userId, pipelineId) {
  if (!userId || !pipelineId) return [];
  try {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(userId)}` +
      `&status=eq.active&pipeline_ids=cs.{${encodeURIComponent(pipelineId)}}&select=member_user_id`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : []));
    return (filas || []).map(f => f.member_user_id).filter(Boolean);
  } catch { return []; }
}

// ── Efectos sobre el lead ───────────────────────────────────────────────────
// Silencioso a propósito: que falle esto no puede tumbar la respuesta al
// contacto, que es lo único que la persona del otro lado está esperando.
export async function aplicarVeredicto({ userId, leadId, regla, veredicto, respuestas, canal }) {
  if (!leadId || !regla?.activo) return;
  const califica = veredicto.estado === 'calificado';
  const etiqueta = califica ? regla.al_calificar.etiqueta : regla.al_descartar.etiqueta;

  try {
    const lead = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=*`, { headers: sb() })
      .then(r => r.json()).then(r => r?.[0]);
    if (!lead) return;

    // Un veredicto puede cambiar si la persona da un dato mejor más adelante, así
    // que la etiqueta contraria se quita: nadie debe quedar marcado como las dos.
    const contraria = califica ? regla.al_descartar.etiqueta : regla.al_calificar.etiqueta;
    const tags = Array.from(new Set(
      [...(lead.tags || []).filter(t => t !== contraria), etiqueta].filter(Boolean)
    ));
    const update = {
      tags,
      custom_fields: {
        ...(lead.custom_fields || {}),
        calificacion: {
          estado: veredicto.estado,
          cumplidas: veredicto.cumplidas,
          total: veredicto.total,
          respuestas,
          canal,
          fecha: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    };
    // La etapa solo se mueve hacia adelante y solo si califica: bajar de etapa
    // a alguien que un comercial ya movió a mano sería pisarle el trabajo.
    if (califica && regla.al_calificar.etapa && lead.stage === 'nuevo') {
      update.stage = regla.al_calificar.etapa;
    }

    // ── Enrutado: a qué proceso de venta y a quién ──────────────────────────
    let ruta = null;
    if (califica && regla.enrutado?.activo) {
      // El modelo debería reportar una cadena, pero a veces imita la forma de
      // los criterios y manda {valor, cumple}: se aceptan las dos.
      const bruto = respuestas?._ruta;
      const clave = String((bruto && typeof bruto === 'object' ? bruto.valor : bruto) ?? '')
        .trim().toLowerCase();
      ruta = regla.enrutado.rutas.find(r => r.clave === clave) || null;
    }
    if (ruta && ruta.pipeline_id !== lead.pipeline_id) {
      update.pipeline_id = ruta.pipeline_id;
      // La etapa TIENE que existir en el proceso destino. Si no, el lead cae en
      // una etapa fantasma y no se pinta en ninguna columna: estaría creado y
      // sería invisible, que es la peor forma de fallar.
      const claves = await fetch(
        `${SUPABASE_URL}/rest/v1/pipeline_stages?pipeline_id=eq.${encodeURIComponent(ruta.pipeline_id)}&select=key`,
        { headers: sb() }
      ).then(r => (r.ok ? r.json() : [])).then(f => new Set((f || []).map(x => x.key))).catch(() => new Set());
      const deseada = update.stage || lead.stage;
      update.stage = claves.has(deseada) ? deseada : 'nuevo';
    }


    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
      method: 'PATCH', headers: sb(), body: JSON.stringify(update),
    });

    // A quién le toca este lead.
    //
    // Dos caminos: el asesor fijo que alguien puso en la ruta, o el reparto
    // entre quienes atienden ese tablero.
    //
    // Antes, una ruta sin `asignar_a` dejaba el lead en el tablero correcto y
    // sin dueño, que es un lead que nadie llama. La salida fácil —un asesor
    // fijo por ruta— tampoco servía: el tablero de Arriendo de Certain lo
    // llevan tres personas, y le habría dado todos los arriendos a una sola.
    //
    // Va por `asignarLead` y no escribiendo `assigned_to` a mano, que es como
    // estaba primero. Escribiéndolo a mano el lead cambiaba de dueño EN
    // SILENCIO: sin correo al comercial, sin tarea de primer contacto y sin
    // nota en el historial. Exactamente «no me llegan las notificaciones».
    //
    // `asignarLead` además no toca un lead que ya tenga dueño, así que no le
    // quita a nadie lo suyo. Cuando hay calificación activa el lead se crea a
    // propósito sin asignar, esperando este momento.
    // Solo si CALIFICA. Un lead descartado no se le echa encima a un comercial:
    // hasta ahora se quedaba sin dueño a propósito y así sigue.
    if (ruta && califica && !lead.assigned_to) {
      try {
        const quienes = ruta.asignar_a ? null : await asesoresDelTablero(userId, ruta.pipeline_id);
        const hayLista = !!quienes?.length;
        const { asignarLead } = await import('./_assign.js');
        // Si nadie tiene ese tablero marcado, `entre` va vacío y `forzarTurnos`
        // en false: decide la regla de la fuente, igual que antes de existir
        // todo esto. El lead nunca se queda sin dueño por no haber marcado.
        //
        // Con lista, `forzarTurnos` evita que un «fijo a una persona» de la
        // fuente se salte a quienes de verdad atienden el tablero.
        const com = await asignarLead(userId, { ...lead, ...update }, canal,
          ruta.asignar_a || null, hayLista ? quienes : null, hayLista);
        // El lead que se devuelve tiene que llevar ya su dueño.
        //
        // Sin esto, quien llama ve `assigned_to` vacío —porque el PATCH de
        // arriba no lo escribe, lo escribe asignarLead— y su red de seguridad
        // vuelve a repartir. En la prueba real el lead se asignó DOS veces y
        // salieron DOS correos: uno a quien tocaba por tablero y otro a quien
        // tocaba por fuente.
        if (com) { update.assigned_to = com.id; update.assigned_name = com.nombre || null; }
      } catch (e) { /* que falle el reparto no puede tumbar la calificación */ }
    }

    await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({
        lead_id: leadId, user_id: userId, type: 'nota',
        content: (califica
          ? `Calificado por el agente de ${canal} (${veredicto.cumplidas} de ${veredicto.total})`
          : `No calificado por el agente de ${canal} (${veredicto.cumplidas} de ${veredicto.total})`)
          + (ruta ? `\nInterés detectado: ${ruta.etiqueta || ruta.clave}` +
              (ruta.asignar_nombre ? ` · asignado a ${ruta.asignar_nombre}` : '') : '')
          + '\n' + resumenLegible(regla, respuestas),
        metadata: { sistema: true, calificacion: veredicto.estado, canal },
      }),
    }).catch(() => {});

    return { ...lead, ...update };
  } catch (e) {
    console.error('aplicarVeredicto:', e);
  }
}
