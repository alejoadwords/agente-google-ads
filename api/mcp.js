// api/mcp.js — servidor MCP de Acuarius (Model Context Protocol)
//
// Para que un asistente de IA —el agente de Karvio hecho con Claude, Claude
// Code, cualquier cliente MCP— vea las herramientas del CRM solo, sin que
// nadie las programe a mano. Se conecta con la MISMA llave de la API.
//
// Es una capa delgada a propósito: cada herramienta se traduce a una llamada
// de api/v1.js, ejecutada aquí mismo (sin salir a la red). Así la llave, los
// permisos, el límite de uso, las reglas de negocio, la firma en el historial
// y el registro son exactamente los de la API. Si este fichero tuviera su
// propia lógica, el día que una regla cambie en un sitio y no en el otro un
// agente podría hacer por MCP lo que la API le niega.
//
// Transporte: «Streamable HTTP» sin estado. Cada mensaje JSON-RPC llega por
// POST y se responde con JSON; no hay sesión ni flujo SSE (GET → 405), que el
// protocolo permite. Regla de Alejandro: nada del módulo de Marketing.
export const config = { runtime: 'edge' };

import v1 from './v1.js';

const VERSIONES = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVIDOR = { name: 'acuarius', title: 'Acuarius CRM', version: '1.0.0' };

const INSTRUCCIONES = [
  'Herramientas del CRM de Acuarius. Actúas sobre la cuenta como una persona del equipo y todo lo que hagas queda firmado en el historial con el nombre de tu llave.',
  'Antes de mover prospectos, consulta ver_procesos (etapas de cada proceso: cuáles cierran y cuáles piden cita) y ver_motivos_cierre. No adivines ids, etapas ni motivos: búscalos.',
  'Las fechas con hora van con zona horaria, por ejemplo 2026-10-09T15:00:00-05:00 (Colombia es -05:00).',
  'Si una herramienta devuelve un error, lee el mensaje: casi siempre trae las opciones válidas para corregir y reintentar.',
  'No puedes borrar nada ni enviar mensajes o campañas; eso lo hace el equipo desde Acuarius.',
].join('\n');

// ── Herramientas ─────────────────────────────────────────────────────────────
// [nombre, permiso, título, descripción, esquema, traducción a la API, soloLectura]
const id = { type: 'string', description: 'Id del prospecto (uuid).' };
const fechaHora = d => ({ type: 'string', description: d + ' Fecha y hora ISO 8601 con zona, p. ej. 2026-10-09T15:00:00-05:00.' });
const obj = (props, req = []) => ({ type: 'object', properties: props, required: req, additionalProperties: false });

const HERRAMIENTAS = [
  {
    name: 'quien_soy', permiso: null, lectura: true, title: 'Quién soy',
    description: 'Nombre de esta llave, sus permisos, sus límites de uso y cuánto lleva hoy.',
    inputSchema: obj({}),
    api: () => ['GET', ''],
  },
  {
    name: 'ver_procesos', permiso: 'leads:leer', lectura: true, title: 'Ver procesos y etapas',
    description: 'Los procesos de venta con sus etapas. Cada etapa trae key (lo que se usa para mover), label (lo que ve el equipo), cierre (ganado, perdido o null) y pide_cita.',
    inputSchema: obj({}),
    api: () => ['GET', 'procesos'],
  },
  {
    name: 'ver_equipo', permiso: 'leads:leer', lectura: true, title: 'Ver equipo',
    description: 'Las personas a las que se puede asignar un prospecto, con su id: el dueño de la cuenta y los miembros activos.',
    inputSchema: obj({}),
    api: () => ['GET', 'equipo'],
  },
  {
    name: 'ver_motivos_cierre', permiso: 'leads:leer', lectura: true, title: 'Ver motivos de cierre',
    description: 'Los motivos que la cuenta acepta al cerrar un prospecto como ganado o como perdido.',
    inputSchema: obj({}),
    api: () => ['GET', 'motivos-cierre'],
  },
  {
    name: 'ver_etiquetas', permiso: 'leads:leer', lectura: true, title: 'Ver etiquetas',
    description: 'El catálogo de etiquetas de la cuenta.',
    inputSchema: obj({}),
    api: () => ['GET', 'etiquetas'],
  },
  {
    name: 'buscar_prospectos', permiso: 'leads:leer', lectura: true, title: 'Buscar prospectos',
    description: 'Lista prospectos con filtros. Para seguimiento usa sin_actividad_dias (sin ningún movimiento en N días) con estado=abiertos. Devuelve hasta 100 por página; «siguiente» trae el valor de «desde» para la próxima, o null.',
    inputSchema: obj({
      buscar: { type: 'string', description: 'Texto en nombre, correo, teléfono o empresa.' },
      etapa: { type: 'string', description: 'Clave de etapa, o varias separadas por coma.' },
      proceso: { type: 'string', description: 'Id del proceso.' },
      asignado: { type: 'string', description: 'Id de la persona responsable, o «nadie».' },
      estado: { type: 'string', enum: ['abiertos', 'cerrados', 'todos'] },
      sin_actividad_dias: { type: 'integer', minimum: 1 },
      fuente: { type: 'string' },
      etiqueta: { type: 'string' },
      actualizado_desde: fechaHora('Solo los cambiados desde esta fecha.'),
      creado_desde: fechaHora('Solo los creados desde esta fecha.'),
      orden: { type: 'string', enum: ['actualizado', 'creado'] },
      limite: { type: 'integer', minimum: 1, maximum: 100, description: 'Por defecto 20.' },
      desde: { type: 'integer', minimum: 0 },
    }),
    api: a => ['GET', 'leads', { limite: 20, ...a }],
  },
  {
    name: 'ver_prospecto', permiso: 'leads:leer', lectura: true, title: 'Ver la ficha de un prospecto',
    description: 'La ficha completa: datos, etapa, responsable, campos propios, las últimas 50 líneas del historial con su autor y, según los permisos de la llave, sus tareas, citas y conversaciones.',
    inputSchema: obj({ id }, ['id']),
    api: a => ['GET', `leads/${enc(a.id)}`],
  },
  {
    name: 'crear_prospecto', permiso: 'leads:escribir', title: 'Crear un prospecto',
    description: 'Crea un prospecto. Entra como uno de formulario: se reparte según las reglas de la cuenta y se le crea la tarea de primer contacto. Si ya existe uno con el mismo correo o teléfono devuelve error con su id; con si_existe=actualizar completa ese en vez de crear otro. No se crea en etapas de cierre ni en las que piden cita.',
    inputSchema: obj({
      name: { type: 'string', description: 'Nombre completo.' },
      email: { type: 'string' }, phone: { type: 'string' }, company: { type: 'string' },
      value: { type: 'number', description: 'Valor del negocio.' },
      etapa: { type: 'string', description: 'Clave o nombre de la etapa inicial. Por defecto la primera.' },
      proceso: { type: 'string', description: 'Id del proceso. Por defecto el principal.' },
      etiquetas: { type: 'array', items: { type: 'string' } },
      campos: { type: 'object', description: 'Campos propios {nombre: valor}.', additionalProperties: { type: 'string' } },
      nota: { type: 'string' },
      fuente: { type: 'string', description: 'De dónde viene. Por defecto «api».' },
      asignado_a: { type: 'string', description: 'Id de la persona responsable (requiere permiso leads:asignar).' },
      si_existe: { type: 'string', enum: ['error', 'actualizar'] },
    }, ['name']),
    api: a => ['POST', 'leads', null, a],
  },
  {
    name: 'editar_prospecto', permiso: 'leads:escribir', title: 'Editar un prospecto',
    description: 'Cambia los datos de un prospecto. Los campos propios se suman a los que hay; para quitar uno, envíalo con valor null. La etapa, el responsable y las etiquetas tienen su propia herramienta.',
    inputSchema: obj({
      id, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, company: { type: 'string' },
      value: { type: 'number' },
      expected_close_date: { type: 'string', description: 'AAAA-MM-DD.' },
      campos: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
    }, ['id']),
    api: ({ id: x, ...resto }) => ['PATCH', `leads/${enc(x)}`, null, resto],
  },
  {
    name: 'mover_etapa', permiso: 'leads:etapa', title: 'Mover de etapa o cerrar',
    description: 'Mueve un prospecto a otra etapa (por clave o por nombre) y, si se pide, a otro proceso. Para cerrar como ganado o perdido el motivo es obligatorio y tiene que ser uno de ver_motivos_cierre; al ganar envía también el valor. Si la etapa pide cita, envía la cita. Cerrar anula las tareas pendientes del prospecto.',
    inputSchema: obj({
      id,
      etapa: { type: 'string', description: 'Clave o nombre de la etapa destino.' },
      proceso: { type: 'string', description: 'Id del proceso destino, si cambia de proceso.' },
      motivo: { type: 'string', description: 'Obligatorio al pasar a ganado o perdido.' },
      valor: { type: 'number', description: 'Valor de la venta, al ganar.' },
      moneda: { type: 'string', description: 'Código de 3 letras. Por defecto COP.' },
      fecha_cierre: { type: 'string', description: 'AAAA-MM-DD. Por defecto hoy.' },
      nota: { type: 'string', description: 'Nota que queda en el historial junto al cambio.' },
      cita: obj({
        inicio: fechaHora('Inicio de la cita.'), fin: fechaHora('Fin. Por defecto según la etapa.'),
        titulo: { type: 'string' }, descripcion: { type: 'string' },
        invitar_lead: { type: 'boolean', description: 'Si la cuenta tiene Google Calendar, le llega la invitación al prospecto.' },
      }, ['inicio']),
    }, ['id']),
    api: ({ id: x, ...resto }) => ['POST', `leads/${enc(x)}/etapa`, null, resto],
  },
  {
    name: 'asignar_prospecto', permiso: 'leads:asignar', title: 'Asignar responsable',
    description: 'Cambia quién lleva el prospecto (id de ver_equipo), o null para dejarlo sin responsable. A la persona le llega el aviso.',
    inputSchema: obj({ id, asignado_a: { type: ['string', 'null'] } }, ['id', 'asignado_a']),
    api: ({ id: x, ...resto }) => ['POST', `leads/${enc(x)}/asignar`, null, resto],
  },
  {
    name: 'etiquetar_prospecto', permiso: 'leads:escribir', title: 'Poner o quitar etiquetas',
    description: 'Agrega y/o quita etiquetas de un prospecto.',
    inputSchema: obj({ id, agregar: { type: 'array', items: { type: 'string' } }, quitar: { type: 'array', items: { type: 'string' } } }, ['id']),
    api: ({ id: x, ...resto }) => ['POST', `leads/${enc(x)}/etiquetas`, null, resto],
  },
  {
    name: 'dejar_nota', permiso: 'leads:escribir', title: 'Dejar una nota',
    description: 'Deja una línea en el historial del prospecto. Con avisar_responsable=true le llega a la persona que lo lleva, por correo y al teléfono.',
    inputSchema: obj({
      id, texto: { type: 'string' },
      tipo: { type: 'string', enum: ['nota', 'llamada', 'email', 'reunion', 'visita'] },
      avisar_responsable: { type: 'boolean' },
    }, ['id', 'texto']),
    api: ({ id: x, ...resto }) => ['POST', `leads/${enc(x)}/notas`, null, resto],
  },
  {
    name: 'buscar_tareas', permiso: 'tareas:leer', lectura: true, title: 'Buscar tareas y citas',
    description: 'Tareas y citas de la agenda. Por defecto solo las pendientes.',
    inputSchema: obj({
      lead_id: { type: 'string' },
      estado: { type: 'string', enum: ['pendientes', 'hechas', 'todas'] },
      tipo: { type: 'string', enum: ['tarea', 'cita'] },
      desde: fechaHora('Vencen desde.'), hasta: fechaHora('Vencen antes de.'),
      limite: { type: 'integer', minimum: 1, maximum: 100 },
      pagina_desde: { type: 'integer', minimum: 0 },
    }),
    api: a => ['GET', 'tareas', a],
  },
  {
    name: 'crear_tarea', permiso: 'tareas:escribir', title: 'Crear una tarea o cita',
    description: 'Crea una tarea o una cita, vinculada o no a un prospecto. Las citas se sincronizan con Google Calendar si la cuenta lo tiene conectado.',
    inputSchema: obj({
      lead_id: { type: 'string' },
      tipo: { type: 'string', enum: ['tarea', 'cita'] },
      titulo: { type: 'string' }, descripcion: { type: 'string' },
      vence: fechaHora('Cuándo vence la tarea o empieza la cita.'),
      termina: fechaHora('Fin de la cita.'),
      invitar_lead: { type: 'boolean' },
    }, ['titulo', 'vence']),
    api: a => ['POST', 'tareas', null, a],
  },
  {
    name: 'editar_tarea', permiso: 'tareas:escribir', title: 'Editar o completar una tarea',
    description: 'Marca una tarea como hecha (hecha=true) o cambia su título, descripción o fechas.',
    inputSchema: obj({
      id: { type: 'string', description: 'Id de la tarea.' },
      hecha: { type: 'boolean' }, titulo: { type: 'string' }, descripcion: { type: 'string' },
      vence: fechaHora('Nueva fecha.'), termina: fechaHora('Nuevo fin.'),
    }, ['id']),
    api: ({ id: x, ...resto }) => ['PATCH', `tareas/${enc(x)}`, null, resto],
  },
  {
    name: 'buscar_conversaciones', permiso: 'conversaciones:leer', lectura: true, title: 'Buscar conversaciones',
    description: 'Conversaciones del inbox. estado: bot (la atiende un agente), human (una persona) o resolved.',
    inputSchema: obj({
      lead_id: { type: 'string' },
      estado: { type: 'string', enum: ['bot', 'human', 'resolved'] },
      canal: { type: 'string' },
      actualizado_desde: fechaHora('Con mensajes desde.'),
      limite: { type: 'integer', minimum: 1, maximum: 100 },
      desde: { type: 'integer', minimum: 0 },
    }),
    api: a => ['GET', 'conversaciones', a],
  },
  {
    name: 'leer_mensajes', permiso: 'conversaciones:leer', lectura: true, title: 'Leer los mensajes de una conversación',
    description: 'Los mensajes de una conversación, del más viejo al más nuevo. «de» es contacto o negocio. Para ir hacia atrás usa «antes» con la fecha del primero que tienes.',
    inputSchema: obj({
      id: { type: 'string', description: 'Id de la conversación.' },
      limite: { type: 'integer', minimum: 1, maximum: 200 },
      antes: fechaHora('Mensajes anteriores a esta fecha.'),
    }, ['id']),
    api: ({ id: x, ...resto }) => ['GET', `conversaciones/${enc(x)}/mensajes`, resto],
  },
];

function enc(v) { return encodeURIComponent(String(v ?? '')); }

// ── Llamar a la API v1 aquí mismo ────────────────────────────────────────────
async function llamarApi(autorizacion, metodo, ruta, query, cuerpo) {
  const u = new URL('https://app.acuarius.app/api/v1');
  u.searchParams.set('ruta', ruta);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  const r = await v1(new Request(u.toString(), {
    method: metodo,
    headers: { authorization: autorizacion, 'content-type': 'application/json' },
    body: cuerpo === undefined || cuerpo === null ? undefined : JSON.stringify(cuerpo),
  }));
  let datos = null;
  try { datos = await r.json(); } catch {}
  return { estado: r.status, datos, retryAfter: r.headers.get('retry-after') };
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────
const resultado = (id, result) => ({ jsonrpc: '2.0', id, result });
const errorRpc = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });

function respuesta(cuerpo, estado = 200, extra = {}) {
  return new Response(cuerpo === null ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...(cuerpo === null ? {} : { 'Content-Type': 'application/json' }), 'Cache-Control': 'no-store', ...extra },
  });
}

async function atender(msg, autorizacion, quien) {
  const { id, method, params } = msg || {};
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') {
    return errorRpc(id ?? null, -32600, 'Mensaje JSON-RPC inválido.');
  }
  const esNotificacion = id === undefined || id === null;
  if (esNotificacion) return null;   // notifications/initialized y compañía: nada que responder

  if (method === 'initialize') {
    const pedida = params?.protocolVersion;
    return resultado(id, {
      protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVIDOR,
      instructions: INSTRUCCIONES,
    });
  }
  if (method === 'ping') return resultado(id, {});

  if (method === 'tools/list') {
    // Solo las herramientas que esta llave puede usar: ofrecerle al modelo una
    // que siempre le va a fallar es invitarlo a perder vueltas.
    const permisos = new Set(quien.llave?.permisos || []);
    return resultado(id, {
      tools: HERRAMIENTAS.filter(h => !h.permiso || permisos.has(h.permiso)).map(h => ({
        name: h.name, title: h.title, description: h.description, inputSchema: h.inputSchema,
        annotations: { title: h.title, readOnlyHint: !!h.lectura, destructiveHint: false, idempotentHint: !!h.lectura, openWorldHint: false },
      })),
    });
  }

  if (method === 'tools/call') {
    const h = HERRAMIENTAS.find(x => x.name === params?.name);
    if (!h) return errorRpc(id, -32602, `No existe la herramienta «${params?.name}».`);
    const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    let r;
    try {
      const [metodo, ruta, query, cuerpo] = h.api(args);
      r = await llamarApi(autorizacion, metodo, ruta, query, cuerpo);
    } catch (e) {
      return resultado(id, { isError: true, content: [{ type: 'text', text: 'No se pudo ejecutar: ' + (e?.message || e) }] });
    }
    // Los errores de la API vuelven como resultado con isError, no como error
    // de protocolo: así el modelo lee el mensaje (que trae las opciones
    // válidas) y se corrige solo.
    const texto = JSON.stringify(r.datos ?? { error: 'Respuesta vacía', estado: r.estado });
    if (r.estado >= 400) {
      const pista = r.estado === 429 && r.retryAfter ? ` Espera ${r.retryAfter} segundos antes de reintentar.` : '';
      return resultado(id, { isError: true, content: [{ type: 'text', text: `Error ${r.estado}.${pista} ${texto}` }] });
    }
    return resultado(id, { content: [{ type: 'text', text: texto }] });
  }

  if (method === 'resources/list') return resultado(id, { resources: [] });
  if (method === 'prompts/list') return resultado(id, { prompts: [] });
  return errorRpc(id, -32601, `Método no soportado: ${method}.`);
}

export default async function handler(req) {
  // Igual que la API: la llave no es para un navegador. Una página web no
  // puede usar este servidor aunque conozca la llave.
  const origen = req.headers.get('origin');
  if (origen && origen !== 'https://app.acuarius.app') {
    return respuesta({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Este servidor no acepta llamadas desde un navegador.' } }, 403);
  }
  if (req.method === 'GET' || req.method === 'DELETE') {
    // Sin sesión ni flujo de avisos del servidor: el protocolo lo permite.
    return respuesta(null, 405, { Allow: 'POST' });
  }
  if (req.method !== 'POST') return respuesta(null, 405, { Allow: 'POST' });

  // La llave se comprueba UNA vez por petición, con la misma puerta de la API.
  const autorizacion = req.headers.get('authorization') || '';
  const yo = await llamarApi(autorizacion, 'GET', '');
  if (yo.estado !== 200) {
    return respuesta({ jsonrpc: '2.0', id: null, error: { code: -32001, message: yo.datos?.error || 'Llave no válida.', data: { codigo: yo.datos?.codigo } } },
      yo.estado === 429 ? 429 : yo.estado >= 500 ? 503 : yo.estado === 403 ? 403 : 401,
      yo.estado === 401 ? { 'WWW-Authenticate': 'Bearer realm="acuarius"' } : {});
  }

  let cuerpo;
  try {
    const t = await req.text();
    if (t.length > 200000) return respuesta(errorRpc(null, -32600, 'El mensaje pasa de 200 KB.'), 413);
    cuerpo = JSON.parse(t);
  } catch {
    return respuesta(errorRpc(null, -32700, 'El cuerpo no es JSON válido.'), 400);
  }

  const lote = Array.isArray(cuerpo);
  const mensajes = lote ? cuerpo.slice(0, 20) : [cuerpo];
  const salidas = [];
  for (const m of mensajes) {
    const s = await atender(m, autorizacion, yo.datos);
    if (s) salidas.push(s);
  }
  if (!salidas.length) return respuesta(null, 202);
  return respuesta(lote ? salidas : salidas[0]);
}
