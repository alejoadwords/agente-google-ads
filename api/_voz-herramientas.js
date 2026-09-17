// api/_voz-herramientas.js — lo que el asistente de voz puede CONSULTAR.
//
// El catálogo cerrado de intenciones se quedaba corto: cualquier pregunta que
// no estuviera en la lista caía en «no entendí», y quien habla no tiene por qué
// conocer la lista. Así que ahora el modelo pregunta lo que necesite a través
// de estas herramientas y compone la respuesta con lo que devuelvan.
//
// TODAS SON DE SOLO LECTURA y todas aplican el alcance de quien pregunta: la
// cuenta del dueño y, si su perfil es de Ventas, solo los leads a su nombre.
// El modelo no escribe SQL ni ve la base: solo puede pedir estas cosas, con
// estos filtros. Lo que no está aquí, no se puede consultar.
//
// Solo para funciones EDGE. Ver la nota de CLAUDE.md sobre api/_*.js.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TZ = 'America/Bogota';

function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}
async function sb(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error('supabase ' + r.status);
  return r.json();
}

export function hoyLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function diaMas(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dias(iso) {
  return Math.round((Date.parse(hoyLocal() + 'T12:00:00Z') - Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z')) / 86400000);
}

// ── Lo que el modelo ve de cada herramienta ─────────────────────────────────
export const HERRAMIENTAS = [
  {
    name: 'buscar_leads',
    description: 'Busca leads y devuelve cuántos hay, la suma de sus importes y una muestra. Úsala para contar, listar, filtrar por etapa o responsable, o encontrar a alguien por su nombre.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Parte del nombre del lead. Búsqueda tolerante.' },
        etapa: { type: 'string', description: 'El nombre de la etapa TAL COMO SE VE en el tablero (por ejemplo «Cita de inmueble»). Para ganados o perdidos no uses esto: usa "estado".' },
        responsable: { type: 'string', description: 'Nombre de la persona del equipo a cargo.' },
        estado: { type: 'string', enum: ['abiertos', 'ganados', 'perdidos', 'todos'], description: 'Por defecto todos.' },
        sin_tocar_dias: { type: 'number', description: 'Solo los que llevan al menos estos días sin movimiento.' },
        creados_desde: { type: 'string', description: 'AAAA-MM-DD' },
        creados_hasta: { type: 'string', description: 'AAAA-MM-DD' },
        cerrados_desde: { type: 'string', description: 'AAAA-MM-DD. Usa esto para «cerrados este mes».' },
        cerrados_hasta: { type: 'string', description: 'AAAA-MM-DD' },
        fuente: { type: 'string', description: 'De dónde vino: web, fincaraiz, metrocuadrado, manual…' },
        etiqueta: { type: 'string', description: 'Una etiqueta del lead.' },
        limite: { type: 'number', description: 'Cuántos traer en la muestra. Por defecto 10, máximo 25.' },
      },
    },
  },
  {
    name: 'ficha_de_lead',
    description: 'Todo lo que sabemos de UN lead: etapa, tablero, responsable, teléfono, correo, importe, etiquetas, sus notas y su última actividad. Úsala cuando pregunten por una persona concreta.',
    input_schema: {
      type: 'object',
      properties: { nombre: { type: 'string', description: 'El nombre tal como lo oíste. Se busca tolerante.' } },
      required: ['nombre'],
    },
  },
  {
    name: 'buscar_tareas',
    description: 'Tareas y reuniones pendientes. Devuelve cuántas hay, cuántas vencidas y una muestra, con el responsable de cada una.',
    input_schema: {
      type: 'object',
      properties: {
        de_quien: { type: 'string', description: 'Nombre de la persona. "yo" para quien pregunta. Vacío = de todos los que puede ver.' },
        desde: { type: 'string', description: 'AAAA-MM-DD. Sin esto, incluye lo vencido.' },
        hasta: { type: 'string', description: 'AAAA-MM-DD. Por defecto hoy.' },
        limite: { type: 'number' },
      },
    },
  },
  {
    name: 'actividad_del_equipo',
    description: 'Cuánto trabajó cada persona en un periodo: leads distintos atendidos y actividades registradas (llamadas, correos, reuniones, notas). Solo para quien ve el trabajo de todos.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'AAAA-MM-DD. Por defecto hace 7 días.' },
        hasta: { type: 'string', description: 'AAAA-MM-DD. Por defecto hoy.' },
      },
    },
  },
  {
    name: 'cierres',
    description: 'Negocios ganados y perdidos en un periodo, con los importes, desglosados por persona. Úsala para «cuánto vendimos», «cómo va el equipo», «cuánto cerró Maira».',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'AAAA-MM-DD. Por defecto el 1 del mes en curso.' },
        hasta: { type: 'string', description: 'AAAA-MM-DD. Por defecto hoy.' },
      },
    },
  },
  {
    name: 'responder',
    description: 'LLÁMALA SIEMPRE AL FINAL, una sola vez, con la respuesta ya lista. Es la única forma de contestarle a la persona: nada de lo que escribas fuera de esta herramienta se le muestra.',
    input_schema: {
      type: 'object',
      properties: {
        voz: { type: 'string', description: 'Lo que se va a LEER EN VOZ ALTA. Una o dos frases, como se lo dirías hablando. Aquí va la respuesta, no un resumen de lo que hiciste. Nada de listas largas: el detalle va en "filas".' },
        etiqueta: { type: 'string', description: 'Una palabra para la cabecera: Agenda, Lead, Equipo, Cierres, Cartera, Números, Todavía no, No entendí…' },
        cifra: { type: 'string', description: 'Opcional. Un número o importe para destacar en grande.' },
        cifra_pie: { type: 'string', description: 'Opcional. Qué es esa cifra.' },
        filas: {
          type: 'array', description: 'Opcional. El detalle, que se ve en pantalla.',
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string' },
              detalle: { type: 'string' },
              alerta: { type: 'boolean', description: 'true para marcarla en rojo: vencida, sin actividad, en riesgo.' },
            },
            required: ['titulo'],
          },
        },
        escalera: {
          type: 'object', description: 'Opcional. Solo al hablar de la etapa de UN lead.',
          properties: { etapas: { type: 'array', items: { type: 'string' } }, actual: { type: 'string' } },
        },
        aviso: { type: 'string', description: 'Opcional. Para advertir algo o preguntar a cuál se refiere.' },
        opciones: { type: 'array', items: { type: 'string' }, description: 'Opcional. Nombres entre los que elegir cuando haya duda.' },
        acciones: { type: 'array', items: { type: 'string' }, description: 'Opcional y pocas: «Abrir su ficha», «Llamarlo», «Abrir la agenda», «Ver el tablero».' },
        nota_al_pie: { type: 'string', description: 'Opcional. Una salvedad sobre cómo se contó, cuando el número podría engañar.' },
      },
      required: ['voz', 'etiqueta'],
    },
  },
  {
    name: 'panorama',
    description: 'La foto general de la cuenta: cuántos leads hay en cada etapa de cada tablero, con los importes, y el tamaño del equipo. Úsala cuando la pregunta sea amplia o no sepas por dónde empezar.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ── Ejecución ───────────────────────────────────────────────────────────────
// `ctx` = { userId, actorId, filtroMios, soloLoSuyo, esDueno, veElEquipo,
//           leads, etapaDe, tableroDe, equipo }

function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Los nombres llegan deformados por el reconocimiento de voz. Se busca por
// parecido, no por igualdad, y si hay varios se devuelven todos para que el
// modelo pregunte en vez de adivinar.
function parecidos(lista, texto, campo = 'name') {
  const q = norm(texto);
  if (!q) return lista;
  const exactos = lista.filter(x => norm(x[campo]) === q);
  if (exactos.length) return exactos;
  const contiene = lista.filter(x => norm(x[campo]).includes(q) || q.includes(norm(x[campo])));
  if (contiene.length) return contiene;
  const palabras = q.split(/\s+/).filter(p => p.length > 2);
  return lista.filter(x => palabras.some(p => norm(x[campo]).includes(p)));
}

export async function ejecutar(nombre, args, ctx) {
  switch (nombre) {
    case 'buscar_leads':      return await buscarLeads(args || {}, ctx);
    case 'ficha_de_lead':     return await fichaDeLead(args || {}, ctx);
    case 'buscar_tareas':     return await buscarTareas(args || {}, ctx);
    case 'actividad_del_equipo': return await actividadEquipo(args || {}, ctx);
    case 'cierres':           return await cierres(args || {}, ctx);
    case 'panorama':          return await panorama(args || {}, ctx);
    default: return { error: 'Esa consulta no existe.' };
  }
}

const CERRADAS = new Set(['ganado', 'perdido']);

async function buscarLeads(a, ctx) {
  let filas = ctx.leads;
  if (a.nombre) filas = parecidos(filas, a.nombre);
  if (a.etapa) {
    // SOLO por el rótulo que se ve en el tablero, nunca por la clave interna.
    // En Certain la clave «propuesta» se llama «Cita de inmueble»: buscar por
    // clave devolvía una etapa distinta de la que la persona nombró, y con
    // toda la seguridad del mundo.
    const q = norm(a.etapa);
    filas = filas.filter(l => norm(l.etiquetaEtapa).includes(q));
  }
  if (a.responsable) {
    const p = parecidos(ctx.equipo, a.responsable, 'nombre')[0];
    filas = p ? filas.filter(l => l.assigned_to === p.id) : [];
  }
  if (a.estado === 'abiertos') filas = filas.filter(l => !CERRADAS.has(l.stage));
  if (a.estado === 'ganados') filas = filas.filter(l => l.stage === 'ganado');
  if (a.estado === 'perdidos') filas = filas.filter(l => l.stage === 'perdido');
  if (a.fuente) filas = filas.filter(l => norm(l.source).includes(norm(a.fuente)));
  if (a.etiqueta) filas = filas.filter(l => (l.tags || []).some(t => norm(t).includes(norm(a.etiqueta))));
  if (a.sin_tocar_dias) filas = filas.filter(l => l.updated_at && dias(l.updated_at) >= Number(a.sin_tocar_dias));
  if (a.creados_desde) filas = filas.filter(l => String(l.created_at).slice(0, 10) >= a.creados_desde);
  if (a.creados_hasta) filas = filas.filter(l => String(l.created_at).slice(0, 10) <= a.creados_hasta);
  if (a.cerrados_desde) filas = filas.filter(l => l.closed_at && String(l.closed_at).slice(0, 10) >= a.cerrados_desde);
  if (a.cerrados_hasta) filas = filas.filter(l => l.closed_at && String(l.closed_at).slice(0, 10) <= a.cerrados_hasta);

  // La muestra vuelve a entrar como texto en la siguiente llamada al modelo y
  // es la mitad del costo de la consulta. Así que va corta y sin campos vacíos:
  // un `"empresa": null` cuesta lo mismo que uno con contenido y no dice nada.
  const lim = Math.min(Math.max(Number(a.limite) || 8, 1), 20);
  const nombreDe = {}; ctx.equipo.forEach(m => { nombreDe[m.id] = m.nombre; });
  const sinVacios = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== '' && v !== 0));
  return {
    total: filas.length,
    suma_importes: filas.reduce((s, l) => s + (Number(l.value) || 0), 0),
    mostrando: Math.min(filas.length, lim),
    muestra: filas.slice(0, lim).map(l => sinVacios({
      nombre: l.name,
      etapa: l.etiquetaEtapa,
      tablero: l.tablero,
      responsable: l.assigned_to ? (nombreDe[l.assigned_to] || 'alguien que ya no está') : 'sin responsable',
      importe: Number(l.value) || 0,
      dias_quieto: l.updated_at ? dias(l.updated_at) : null,
      fuente: l.source || null,
    })),
  };
}

async function fichaDeLead(a, ctx) {
  const cand = parecidos(ctx.leads, a.nombre);
  if (!cand.length) return { encontrado: false, mensaje: 'Ningún lead se parece a ese nombre.' };
  if (cand.length > 1 && cand.length <= 5) {
    return { encontrado: false, varios: cand.map(l => l.name),
             mensaje: 'Varios leads se parecen. Pregúntale a cuál se refiere antes de responder.' };
  }
  const l = cand[0];
  const [detalle, acts] = await Promise.all([
    sb(`/leads?id=eq.${l.id}&user_id=eq.${encodeURIComponent(ctx.userId)}&select=phone,email,company,value,tags,notes,created_at,updated_at,closed_at,close_reason,source,expected_close_date`),
    sb(`/lead_activities?lead_id=eq.${l.id}&select=type,content,created_at,metadata&order=created_at.desc&limit=3`),
  ]);
  const d = detalle?.[0] || {};
  const nombreDe = {}; ctx.equipo.forEach(m => { nombreDe[m.id] = m.nombre; });
  return {
    encontrado: true,
    nombre: l.name,
    etapa: l.etiquetaEtapa,
    tablero: l.tablero,
    responsable: l.assigned_to ? (nombreDe[l.assigned_to] || 'alguien que ya no está') : 'sin responsable',
    telefono: d.phone || null, correo: d.email || null, empresa: d.company || null,
    importe: Number(d.value) || 0,
    etiquetas: d.tags || [],
    fuente: d.source || null,
    creado_hace_dias: d.created_at ? dias(d.created_at) : null,
    sin_movimiento_dias: d.updated_at ? dias(d.updated_at) : null,
    cierre_esperado: d.expected_close_date || null,
    motivo_de_cierre: d.close_reason || null,
    notas: (d.notes || '').slice(0, 500) || null,
    ultimas_actividades: (acts || []).map(x => ({
      tipo: x.type, hace_dias: dias(x.created_at),
      quien: (x.metadata && x.metadata.actor) || null,
      texto: (x.content || '').slice(0, 140),
    })),
  };
}

async function buscarTareas(a, ctx) {
  const hasta = (a.hasta || hoyLocal()) + 'T23:59:59Z';
  let q = `/activities?user_id=eq.${encodeURIComponent(ctx.userId)}&done=is.false&cancelled_at=is.null` +
          `&due_at=lte.${encodeURIComponent(hasta)}&select=title,due_at,lead_id,type&order=due_at.asc&limit=300`;
  if (a.desde) q += `&due_at=gte.${encodeURIComponent(a.desde + 'T00:00:00Z')}`;
  const todas = await sb(q);

  const duenoDe = {}; ctx.leads.forEach(l => { duenoDe[l.id] = l.assigned_to; });
  const nombreLead = {}; ctx.leads.forEach(l => { nombreLead[l.id] = l.name; });
  const nombreDe = {}; ctx.equipo.forEach(m => { nombreDe[m.id] = m.nombre; });

  // Solo las que cuelgan de un lead que esta persona puede ver.
  let filas = todas.filter(t => !t.lead_id || Object.prototype.hasOwnProperty.call(duenoDe, t.lead_id));

  const quien = norm(a.de_quien);
  if (quien === 'yo' || quien === 'mi' || quien === 'mis') {
    filas = filas.filter(t => {
      if (!t.lead_id) return true;
      const d = duenoDe[t.lead_id];
      return d === ctx.actorId || (!d && ctx.esDueno);
    });
  } else if (quien) {
    const p = parecidos(ctx.equipo, a.de_quien, 'nombre')[0];
    if (!p) return { total: 0, mensaje: 'No hay nadie en el equipo con ese nombre.' };
    filas = filas.filter(t => t.lead_id && duenoDe[t.lead_id] === p.id);
  }

  const ahora = Date.now();
  const lim = Math.min(Math.max(Number(a.limite) || 8, 1), 20);
  return {
    total: filas.length,
    vencidas: filas.filter(t => Date.parse(t.due_at) < ahora).length,
    muestra: filas.slice(0, lim).map(t => ({
      titulo: t.title,
      vence: String(t.due_at).slice(0, 10),
      vencida: Date.parse(t.due_at) < ahora,
      lead: t.lead_id ? (nombreLead[t.lead_id] || null) : null,
      responsable: t.lead_id && duenoDe[t.lead_id] ? (nombreDe[duenoDe[t.lead_id]] || null) : 'sin responsable',
    })),
  };
}

async function actividadEquipo(a, ctx) {
  if (!ctx.veElEquipo) return { permitido: false, mensaje: 'Su perfil solo ve su propia gestión.' };
  const desde = a.desde || diaMas(hoyLocal(), -7);
  const hasta = a.hasta || hoyLocal();
  const act = await sb(`/lead_activities?user_id=eq.${encodeURIComponent(ctx.userId)}` +
    `&type=in.(llamada,email,reunion,nota)` +
    `&created_at=gte.${desde}T00:00:00Z&created_at=lte.${hasta}T23:59:59Z` +
    `&select=lead_id,metadata&limit=3000`);
  // El autor está en metadata.actor_id; `actor` es el NOMBRE.
  const porNombre = {}; ctx.equipo.forEach(m => { porNombre[m.nombre] = m.id; });
  const cuenta = {};
  ctx.equipo.forEach(m => { cuenta[m.id] = { leads: new Set(), actividades: 0 }; });
  act.forEach(x => {
    const md = x.metadata || {};
    const id = md.actor_id || porNombre[md.actor];
    if (!id || !cuenta[id]) return;
    cuenta[id].actividades++;
    if (x.lead_id) cuenta[id].leads.add(x.lead_id);
  });
  return {
    desde, hasta,
    por_persona: ctx.equipo.map(m => ({
      nombre: m.nombre,
      leads_atendidos: cuenta[m.id].leads.size,
      actividades: cuenta[m.id].actividades,
    })).sort((x, y) => x.leads_atendidos - y.leads_atendidos),
    nota: 'Solo cuenta la actividad que quedó registrada a nombre de alguien. Las notas que escribe el sistema no tienen autor.',
  };
}

async function cierres(a, ctx) {
  const desde = a.desde || hoyLocal().slice(0, 8) + '01';
  const hasta = a.hasta || hoyLocal();
  const nombreDe = {}; ctx.equipo.forEach(m => { nombreDe[m.id] = m.nombre; });

  const dentro = ctx.leads.filter(l => l.closed_at &&
    String(l.closed_at).slice(0, 10) >= desde && String(l.closed_at).slice(0, 10) <= hasta &&
    CERRADAS.has(l.stage));

  const por = {};
  dentro.forEach(l => {
    const k = l.assigned_to || '_sin';
    por[k] = por[k] || { ganados: 0, importe: 0, perdidos: 0 };
    if (l.stage === 'ganado') { por[k].ganados++; por[k].importe += Number(l.value) || 0; }
    else por[k].perdidos++;
  });
  const ganados = dentro.filter(l => l.stage === 'ganado');
  // Un ganado sin fecha de cierre no cabe en ningún periodo. Decirlo es lo que
  // hace que este número pueda cuadrarse con el del tablero.
  const sinFecha = ctx.leads.filter(l => l.stage === 'ganado' && !l.closed_at).length;

  return {
    desde, hasta,
    ganados: ganados.length,
    importe_ganado: ganados.reduce((s, l) => s + (Number(l.value) || 0), 0),
    perdidos: dentro.length - ganados.length,
    por_persona: Object.entries(por)
      .map(([k, r]) => ({ nombre: k === '_sin' ? 'sin responsable' : (nombreDe[k] || 'alguien que ya no está'), ...r }))
      .sort((x, y) => y.importe - x.importe || y.ganados - x.ganados),
    ganados_sin_fecha_de_cierre: sinFecha,
  };
}

async function panorama(_a, ctx) {
  const porTablero = {};
  ctx.leads.forEach(l => {
    const t = l.tablero || 'Sin tablero';
    porTablero[t] = porTablero[t] || {};
    const e = l.etiquetaEtapa || l.stage;
    porTablero[t][e] = porTablero[t][e] || { leads: 0, importe: 0 };
    porTablero[t][e].leads++;
    porTablero[t][e].importe += Number(l.value) || 0;
  });
  return {
    total_leads: ctx.leads.length,
    tableros: Object.entries(porTablero).map(([t, etapas]) => ({
      tablero: t,
      // Sin las etapas vacías: ocupan sitio en cada llamada y no dicen nada.
      etapas: Object.entries(etapas).filter(([, v]) => v.leads > 0).map(([e, v]) => ({ etapa: e, ...v })),
    })),
    equipo: ctx.equipo.map(m => m.nombre),
    alcance: ctx.soloLoSuyo ? 'solo los leads a su nombre' : 'toda la cuenta',
  };
}
