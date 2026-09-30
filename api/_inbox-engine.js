// api/_inbox-engine.js
// Motor común del inbox: agente que contesta, captura de datos y entrada al
// pipeline. Lo usan los webhooks de Meta (WhatsApp, Messenger, Instagram) y el
// de TikTok, para que un canal nuevo no implique reescribir la conversación.
// El guion bajo evita que Vercel lo publique como endpoint.
//
// El envío al canal lo pone quien llama (cada plataforma tiene su API), así el
// motor no sabe nada de Graph ni de TikTok.

import { ensureCatalog, enqueueAutomations, pipelinePrincipal } from './_lead-intake.js';
import { getPolicy } from './_channel-policy.js';
import { asignarLead } from './_assign.js';
import { getRegla, bloqueDePrompt, extraerCalificacion, evaluar, aplicarVeredicto, resumenLegible, asesoresDelTablero } from './_qualify.js';
import { estadoDeCupo, sumarUno, avisarDelCupo } from './_cupo-agente.js';
import { pautaDeReferral } from './_lead-intake.js';
import { registrarUso } from './_uso-ia.js';
import { abrirConexion, cifrar } from './_cifrado.js';
import { reservasParaAgente, bloqueReservas, extraerReserva, ejecutarReserva, bloquesOcultos, pideConfirmacion,
  citasDelContacto, bloqueCitas, extraerCambio, ejecutarCambio, prometeAccion, traeBloqueDeCita } from './_reservas-agente.js';
import { registrarError } from './_registro-errores.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

// En WhatsApp el identificador del contacto ES su número (E.164 sin el +). Si
// no se aprovecha, el comercial recibe el lead sin teléfono y no tiene por
// dónde llamarlo, que es justo lo que un negocio de WhatsApp necesita.
export function telefonoDelCanal(channel, contactId) {
  if (channel !== 'whatsapp') return null;
  const d = String(contactId || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15 ? '+' + d : null;
}

export function cleanForUser(text) {
  return String(text || '')
    .replace(/\[CAPTURA:.*?\]/gs, '')
    .replace(/\[ESCALAR\]/g, '')
    .replace(/\[CALIFICACION:.*?\]/gs, '')
    .replace(/\[(RESERVA|CANCELAR_CITA|CAMBIAR_CITA|FOTOS):.*?\]/gs, '')
    // Si la respuesta se cortó a mitad de un bloque, fuera igual
    .replace(/\[(CAPTURA|CALIFICACION|ESCALAR|RESERVA|CANCELAR_CITA|CAMBIAR_CITA|FOTOS)\b[\s\S]*$/, '')
    // Al quitar un bloque de en medio quedaba su línea en blanco, y en el chat
    // se veía un hueco sin explicación entre dos frases.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// Datos de contacto sueltos en lo que escribe el propio cliente. Deliberadamente
// conservador: correo y teléfono son inequívocos; el nombre solo si lo dice de
// forma explícita ("soy Laura", "me llamo Laura"). Preferimos no captar un dato
// a meter basura en el CRM.
export function datosDelTexto(texto) {
  const t = String(texto || '');
  const out = {};

  const correo = t.match(/[^\s<>()[\],;:]+@[^\s<>()[\],;:]+\.[a-z]{2,}/i);
  if (correo) out.email = correo[0].toLowerCase();

  // 7 a 15 dígitos, admitiendo espacios, guiones y paréntesis. Se descartan los
  // que vengan pegados a un símbolo de precio o de porcentaje.
  const tel = t.replace(/[$%]\s?\d[\d.,]*/g, ' ')
    .match(/(?:\+?\(?\d[\d\s().-]{6,17}\d)/);
  if (tel) {
    const digitos = tel[0].replace(/\D/g, '');
    if (digitos.length >= 7 && digitos.length <= 15) out.phone = tel[0].trim();
  }

  // El teclado del móvil escribe "Soy" con mayúscula al empezar la frase: sin
  // contemplarlo, el caso más común se escapaba.
  const nombre = t.match(/\b(?:[Ss]oy|[Mm]e llamo|[Mm]i nombre es)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+){0,2})/);
  if (nombre) out.name = nombre[1].trim().slice(0, 80);

  return out;
}

export function extractCapturedData(text) {
  // TODOS los bloques, no el primero. A esta función se le pasa tanto UN
  // mensaje como el historial entero concatenado, y quedarse con el primero
  // devolvía la foto del primer turno: el nombre y el celular que aún no había
  // dado nadie. Se fusionan en orden y gana el último, que es el más completo y
  // el que recoge una corrección del cliente.
  // El objeto se acota a un nivel (`[^{}]`) para que un bloque con el JSON roto
  // no siga buscando la llave de cierre dentro del bloque siguiente y se lleve
  // por delante los datos buenos que venían después.
  const bloques = [...String(text || '').matchAll(/\[CAPTURA:\s*(\{[^{}]*\})\]/g)];
  const out = {};
  for (const b of bloques) {
    try { Object.assign(out, JSON.parse(b[1])); } catch { /* un bloque roto no tumba los buenos */ }
  }
  return out;
}

// ── Inventario del cliente en el contexto ───────────────────────────────────
// La regla de "no inventes" solo sirve si el agente tiene donde mirar. Aqui se
// le pasan las propiedades que encajan con lo que YA sabe de la conversacion.
// No se le pasan las 485: seria caro, lento y le costaria mas encontrar la
// buena. Es un filtro, no una busqueda semantica: deterministico y auditable.
const TOPE_PROPIEDADES = 25;

export async function propiedadesParaPrompt(userId, clientId, pistas = {}) {
  if (!userId) return { lineas: [], total: 0 };
  let q = `${SUPABASE_URL}/rest/v1/client_properties?user_id=eq.${encodeURIComponent(userId)}` +
    (clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null') +
    '&select=codigo,operacion,tipo,ciudad,barrio,habitaciones,banos,precio,' +
    `precio_arriendo,precio_venta,administracion,fotos,url&limit=${TOPE_PROPIEDADES}`;

  // La operacion sale del enrutado: si el agente ya dedujo 'arriendo', no tiene
  // sentido ofrecerle ventas. 'Arriendo/Venta' vale para las dos.
  //
  // Y decide tambien QUE precio se mira. Un inmueble que se vende y se arrienda
  // tiene dos, muy distintos: comparar un presupuesto de arriendo contra el de
  // venta escondia esos inmuebles de todas las busquedas de arriendo sin que
  // nada fallara a la vista.
  const op = String(pistas.operacion || '').toLowerCase();
  const esArriendo = op.includes('arriend') || op.includes('alquil');
  const esVenta = op.includes('vent') || op.includes('compr');
  if (esArriendo) q += '&operacion=in.(Arriendo,"Arriendo/Venta")';
  else if (esVenta) q += '&operacion=in.(Venta,"Arriendo/Venta")';

  if (pistas.ciudad) q += `&ciudad=ilike.*${encodeURIComponent(pistas.ciudad)}*`;
  if (pistas.barrio) q += `&barrio=ilike.*${encodeURIComponent(pistas.barrio)}*`;
  // Quien pide tres habitaciones no quiere ver de dos.
  //
  // Esto no se filtraba, y el efecto era peor que no ofrecer nada: alguien
  // pedía tres habitaciones, el motor le pasaba veinticinco opciones sin mirar
  // cuántas tenían, y el agente le respondía «no tengo de tres, pero mira
  // estas» — y las de la lista eran de dos. Quedaba como que no escucha.
  //
  // `gte` y no `eq`: nunca se ofrece menos de lo que pidió, y si algo más
  // grande le cabe en el presupuesto, que lo vea.
  if (pistas.habitaciones) q += `&habitaciones=gte.${pistas.habitaciones}`;
  // Y por tipo. Alguien que pide una casa no quiere que le ofrezcan un local:
  // pasó, y el agente lo presentó como «lo más cercano que tengo».
  if (pistas.tipo) q += `&tipo=eq.${encodeURIComponent(pistas.tipo)}`;
  if (pistas.presupuesto) {
    const tope = Math.round(pistas.presupuesto * 1.15);   // 15% de margen
    const col = esArriendo ? 'precio_arriendo' : esVenta ? 'precio_venta' : null;
    // Mientras el catalogo de un cliente no se haya vuelto a sincronizar, las
    // columnas nuevas estan vacias. Sin este respaldo el agente se quedaria sin
    // nada que ofrecer justo despues de desplegar, y en silencio.
    q += col
      ? `&or=(${col}.lte.${tope},and(${col}.is.null,precio.lte.${tope}))`
      : `&precio=lte.${tope}`;
  }
  q += '&order=precio.asc';

  try {
    let filas = await fetch(q, { headers: sb() }).then(r => (r.ok ? r.json() : [])).catch(() => []);

    // Si en ESE barrio no hay nada, se amplía a la ciudad en vez de devolver
    // una lista vacía.
    //
    // Certain no tiene ni un arriendo en Buenavista, pero sí siete de tres
    // habitaciones en Barranquilla dentro del presupuesto. Sin esto el agente
    // se quedaba sin nada que enseñar justo cuando tenía la respuesta buena, y
    // acababa ofreciendo lo primero que pillaba. Se avisa de que son otras
    // zonas para que lo diga, no para que lo disimule.
    let ampliado = false;
    if (!filas.length && pistas.barrio) {
      ampliado = true;
      filas = await fetch(q.replace(`&barrio=ilike.*${encodeURIComponent(pistas.barrio)}*`, ''),
        { headers: sb() }).then(r => (r.ok ? r.json() : [])).catch(() => []);
    }

    const lineas = (filas || []).map(f => {
      const propio = esArriendo ? f.precio_arriendo : esVenta ? f.precio_venta : null;
      const importe = propio ?? f.precio;
      const plata = (n) => '$' + Number(n).toLocaleString('es-CO');
      return [
        f.codigo,
        f.operacion,
        f.tipo,
        [f.barrio, f.ciudad].filter(Boolean).join(', '),
        f.habitaciones ? f.habitaciones + ' hab' : null,
        f.banos ? f.banos + ' baños' : null,
        importe ? plata(importe) : 'precio a confirmar',
        // La administracion se publica aparte del canon y cambia: se le pasa
        // marcada para que no la sume ni la presente como definitiva.
        esArriendo && f.administracion ? 'admón. ' + plata(f.administracion) + ' (por confirmar)' : null,
        // Para que el agente sepa de cuáles PUEDE ofrecer fotos y de cuáles no.
        f.fotos?.length ? 'con fotos' : null,
      ].filter(Boolean).join(' · ');
    });
    return { lineas, total: lineas.length, ampliado, barrioPedido: pistas.barrio || null };
  } catch { return { lineas: [], total: 0 }; }
}

// Cómo trata el agente a la persona.
//
// Esto era media línea colgada de otra instrucción —«Habla como una persona
// real, cálida y natural. Usa "usted".»— y no se cumplía. Un cliente con el
// agente en formal, sus 31 preguntas frecuentes puestas y ocho mil caracteres
// de contexto diciendo «trate siempre de usted», recibía «¡Hola! Te ayudo con
// gusto» en el primer mensaje.
//
// La razón no es que el modelo desobedezca: es que TODO el resto del prompt le
// habla de tú —«habla», «dilo», «hazlo», «no seas»— y arrastra el registro. Un
// modelo pequeño copia lo que tiene alrededor antes que una cláusula suelta.
// Así que la instrucción va primera, sola, con ejemplo y sin excepciones.
export function tratamiento(tono) {
  if (tono === 'formal') {
    return '- TRÁTALE DE USTED, siempre y en cada mensaje: «¿en qué puedo ayudarle?», ' +
      '«cuénteme qué está buscando», «su presupuesto». Nunca «tú», «te», «tu», «ti» ' +
      'ni «contigo», ni siquiera si la persona te tutea a ti. Esto no tiene excepciones';
  }
  return '- Háblale de tú, sin exagerar la informalidad: «¿en qué te ayudo?», «cuéntame qué buscas»';
}

// ── Lo que pidió la persona, leído de sus propias palabras ──────────────────
// El modelo tenía que reportar ciudad, zona, presupuesto y habitaciones en su
// bloque de captura. No lo hacía: se le pidió con ejemplos y en mayúsculas, y
// en una conversación real donde el contacto dijo «Buenavista en Barranquilla»
// y «máximo 3 millones» reportó solo «habitaciones: 3». El filtro se quedaba
// sin pistas y el agente ofrecía lo primero del inventario diciendo «tengo
// varias opciones en esa zona» — y eran de otro barrio.
//
// Así que esto no se le pide al modelo: se lee de lo que escribió la persona.
// Los barrios y ciudades salen del catálogo del propio cliente, así que no hay
// lista que mantener ni que adivinar.
const sinTildes = (t) => String(t || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export async function zonasDelCliente(userId, clientId) {
  try {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/client_properties?user_id=eq.${encodeURIComponent(userId)}` +
      (clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null') +
      '&select=ciudad,barrio,tipo',
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    const ciudades = new Map();
    const barrios = new Map();
    const tipos = new Map();
    for (const f of filas || []) {
      if (f.ciudad) ciudades.set(sinTildes(f.ciudad), f.ciudad);
      if (f.barrio) barrios.set(sinTildes(f.barrio), f.barrio);
      if (f.tipo) tipos.set(sinTildes(f.tipo), f.tipo);
    }
    return { ciudades, barrios, tipos };
  } catch { return { ciudades: new Map(), barrios: new Map(), tipos: new Map() }; }
}

// El nombre que aparezca MÁS TARDE en el texto; a igualdad de posición, el más
// largo.
//
// Más tarde, porque dentro de un mensaje la gente se corrige: «busco casa, no,
// mejor apartamento». Y el más largo porque «Alto Prado» contiene «Prado»: sin
// eso, quien pide Alto Prado acabaría viendo El Prado.
function nombreEnTexto(texto, mapa) {
  const t = sinTildes(texto);
  let mejor = null;
  for (const [clave, original] of mapa) {
    if (clave.length < 4) continue;
    // Con la «s» del plural opcional: la gente escribe «apartamentos» y el
    // catálogo dice «Apartamento». Sin esto, pedir «apartamentos de 4
    // habitaciones» después de haber dicho «casa» dejaba el tipo en Casa y el
    // agente seguía buscando casas toda la conversación.
    const esc = clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^a-z0-9])' + esc + '(e?s)?($|[^a-z0-9])', 'g');
    let donde = -1;
    for (const m of t.matchAll(re)) donde = m.index;
    if (donde < 0) continue;
    if (!mejor || donde > mejor.donde || (donde === mejor.donde && clave.length > mejor.clave.length)) {
      mejor = { clave, original, donde };
    }
  }
  return mejor?.original || null;
}

// Cuántas habitaciones pidió: «3 habitaciones», «de 3 alcobas», «3 hab».
export function habitacionesDelTexto(texto) {
  const t = sinTildes(texto);
  // La ÚLTIMA mención del mensaje, no la primera. «Busco casa de 4
  // habitaciones. No, mejor apartamento de 3 habitaciones» se quedaba en
  // cuatro, y el catálogo devolvía cero: con cero y sin nada más que decirle,
  // el agente se inventó tres apartamentos con precios que no existen.
  const todas = [...t.matchAll(/(\d{1,2})\s*(habitacion|habitaciones|alcoba|alcobas|cuarto|cuartos|dormitorio|dormitorios|hab\b|alc\b)/g)];
  if (!todas.length) return null;
  const n = parseInt(todas[todas.length - 1][1], 10);
  return n > 0 && n <= 20 ? n : null;
}

// Cuánto dijo que podía pagar. Solo si la frase habla de dinero: un «3
// habitaciones» suelto no es un presupuesto, y un código de inmueble tampoco.
// «cualquier rango de precio», «sin límite», «no importa cuánto». No es que no
// lo haya dicho: es que ha dicho que da igual, y eso tiene que BORRAR el
// presupuesto anterior en vez de dejarlo puesto.
const SIN_TOPE = /cualquier (rango|precio|valor)|sin (limite|tope|presupuesto)|no importa (el|cuanto)|el que sea|lo que sea/;

export function presupuestoDelTexto(texto) {
  const t = sinTildes(texto);
  if (SIN_TOPE.test(t)) return 'libre';
  // Las frases se cortan por punto y coma, salto de línea o punto SEGUIDO DE
  // ESPACIO. Cortando por cualquier punto, «$4.000.000» se partía en tres y el
  // presupuesto desaparecía.
  const frases = t.split(/[;\n]|\.\s+/)
    .filter(f => /\$|millon|millones|mil\b|presupuesto|pagar|canon|mensual|maximo|hasta/.test(f));
  // De la última frase hacia atrás, por lo mismo: dentro de un mensaje puede
  // corregirse («hasta 3 millones, bueno, mejor hasta 5»).
  for (let i = frases.length - 1; i >= 0; i--) {
    // Una frase que habla de habitaciones no habla de plata.
    if (/habitacion|alcoba|cuarto|dormitorio|bano/.test(frases[i])) continue;
    const v = aPlata(frases[i]);
    if (v) return v;
  }
  return null;
}

export async function pistasDelContacto(userId, clientId, mensajes = []) {
  const suyos = (mensajes || [])
    .filter(m => m && m.role === 'user')
    .map(m => String(m.content || ''))
    .filter(t => t.trim());
  if (!suyos.length) return {};
  const { ciudades, barrios, tipos } = await zonasDelCliente(userId, clientId);

  // Del ÚLTIMO mensaje hacia atrás, y gana el primero que diga algo de cada
  // cosa.
  //
  // Antes se leía todo el historial de golpe y ganaba la primera mención. Una
  // conversación real: «busco una casa de 4 habitaciones»… «¿y de 3
  // habitaciones?»… «¿y en cualquier rango de precio?». El filtro se quedó en
  // cuatro habitaciones y cinco millones toda la conversación, y el agente
  // contestó tres veces «no tengo» teniendo SEIS apartamentos de tres
  // habitaciones en Barranquilla. Decía la verdad sobre una pregunta que nadie
  // le había hecho.
  //
  // Una persona corrige sobre la marcha; lo último que dijo es lo que quiere.
  const buscar = (fn) => {
    for (let i = suyos.length - 1; i >= 0; i--) {
      const v = fn(suyos[i]);
      if (v != null) return v;
    }
    return null;
  };

  const plata = buscar(presupuestoDelTexto);
  return {
    ciudad: buscar(t => nombreEnTexto(t, ciudades)),
    barrio: buscar(t => nombreEnTexto(t, barrios)),
    tipo: buscar(t => nombreEnTexto(t, tipos)),
    // «cualquier rango de precio» no es un presupuesto: es quitarlo.
    presupuesto: plata === 'libre' ? null : plata,
    habitaciones: buscar(habitacionesDelTexto),
  };
}

// Las fotos que el agente pidió mandar.
//
// El modelo escribe [FOTOS: 121514301] al final de su mensaje y aquí se
// traducen a las URLs guardadas. El código se comprueba contra el catálogo del
// cliente: si el modelo se inventa uno, no hay fotos y no se manda nada — lo
// que NO puede pasar es que le llegue al contacto la foto de otro inmueble.
export async function fotosPedidas(texto, userId, clientId) {
  const m = String(texto || '').match(/\[FOTOS:\s*([A-Za-z0-9_-]{1,40})\s*\]/);
  if (!m) return [];
  try {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/client_properties?user_id=eq.${encodeURIComponent(userId)}` +
      (clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null') +
      `&codigo=eq.${encodeURIComponent(m[1])}&select=fotos&limit=1`,
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    return (filas?.[0]?.fotos || []).slice(0, 4);
  } catch { return []; }
}

// Un agente en «usted» que tutea.
//
// Es raro —17 turnos seguidos en producción sin uno— pero pasa, y cuando pasa
// en el primer mensaje la conversación entera se va detrás: el modelo mantiene
// el registro que empezó. Un cliente que pidió trato formal vería toda la
// conversación tuteada.
//
// Reescribir el texto del agente para quitarle las formas en segunda persona no
// cambia nada: medido, 0 de 12 con y sin ellas. Así que no se le pide mejor: se
// comprueba.
//
// La lista es corta y sin ambigüedad a propósito. «Tiene» es usted y «tienes»
// es tú; un falso positivo aquí cuesta una llamada de más al modelo, así que
// solo entran las formas que no pueden ser otra cosa.
const TUTEA = new RegExp('(^|[^a-záéíóúñ])(' + [
  'tú', 'tu', 'tus', 'te', 'ti', 'contigo', 'tuyo', 'tuya',
  'puedes', 'quieres', 'tienes', 'necesitas', 'buscas', 'estás', 'eres', 'sabes',
  'prefieres', 'deseas', 'quedas', 'vienes', 'vives', 'dispones',
  'dime', 'cuéntame', 'cuentame', 'escríbeme', 'escribeme', 'llámame', 'llamame',
  'avísame', 'avisame', 'mándame', 'mandame', 'confirmame', 'confírmame',
  // Subjuntivos e imperativos de tú. «Mira» y «elige» entran porque en usted
  // serían «mire» y «elija»: no hay forma de confundirlos.
  'hayas', 'hagas', 'digas', 'puedas', 'quieras', 'tengas', 'necesites', 'estés',
  'seas', 'sepas', 'vengas', 'vayas', 'mira', 'elige', 'dame',
].join('|') + ')([^a-záéíóúñ]|$)', 'i');

export function tutea(texto) {
  return TUTEA.test(String(texto || '').toLowerCase());
}

// ── El guardián: lo que el agente dice tiene que estar en lo que le dimos ────
//
// La regla de "no inventes" lleva en el prompt desde siempre, en mayúsculas y
// con la palabra INNEGOCIABLE. Y aun así, ante «muéstreme lo que tenga» y sin
// nada que enseñar, Haiku se inventó apartamentos con barrio y precio 7 de cada
// 8 veces. No es que no lea la regla: es que una regla es texto compitiendo con
// texto, y la conversación entera empuja hacia producir una lista.
//
// Una regla que de verdad no se puede romper no se le pide al modelo: se
// comprueba después. Nosotros sabemos exactamente qué lista le dimos.
//
// Se comprueban importes y códigos porque son verificables sin ambigüedad. Un
// barrio inventado no se puede distinguir de uno mencionado de paso; un
// «$1.800.000» que no está en ningún sitio, sí.

// Las cifras que hay que comprobar: importes y códigos. Solo esas tres formas,
// y no «cualquier número largo».
//
// Con un colador ancho, «contrato de 2026 a 2027» se leía como la cifra
// 20262027 y se marcaba como inventada: un mensaje perfectamente bueno se
// habría quedado sin enviar. Un falso positivo aquí cuesta una conversación
// escalada sin motivo, así que el colador va estrecho a propósito: prefiere
// dejar pasar un caso raro antes que bloquear lo bueno.
const FORMAS = [
  /\$\s?([\d][\d.,]*\d)/g,          // «$1.800.000»
  /\b(\d{1,3}(?:\.\d{3})+)\b/g,     // «1.800.000» sin el símbolo
  /\b(\d{6,10})\b/g,                // «121513056», un código
];

function cifrasDe(texto) {
  const t = String(texto || '');
  const out = new Set();
  for (const re of FORMAS) {
    for (const m of t.matchAll(re)) {
      const d = m[1].replace(/[^\d]/g, '');
      if (d.length >= 6 && d.length <= 12) out.add(d);
    }
  }
  return out;
}

// Lo que el agente dijo y no estaba en ninguna parte.
//
// `permitido` es todo lo que legítimamente puede citar: el inventario que se le
// pasó, su propio entrenamiento y lo que el contacto escribió —si la persona
// dice «puedo pagar 2.500.000», el agente puede repetirlo—.
export function inventos(respuesta, permitido) {
  // Un solo chorro de dígitos: así da igual cómo esté escrito el número a un
  // lado y al otro («$1.800.000» y «1800000» son lo mismo).
  const colchon = String(permitido || '').replace(/[^\d]/g, '');
  return [...cifrasDe(respuesta)].filter(c => !colchon.includes(c));
}

// Todo lo que el agente puede citar sin inventar.
export function loQuePuedeCitar(agent, inventario, mensajes) {
  const textos = (mensajes || []).map(m => String(m?.content || ''));
  // Una cifra que dijo el cliente con palabras cuenta como dicha.
  //
  // El cliente escribe «hasta 3 millones» y el agente lo confirma como
  // «$3.000.000»: en dígitos eso es un 3 contra un 3000000, así que el guardián
  // lo señalaba como inventado, bloqueaba la respuesta y escalaba. Repetirle su
  // presupuesto al cliente es lo más normal de una conversación comercial; con
  // esto saltaba en casi todas.
  const enCifras = textos.map(t => aPlata(t)).filter(Boolean).map(String);
  return [
    agent?.persona, agent?.business_ctx,
    ...(agent?.faqs || []).map(f => `${f.q} ${f.a}`),
    ...(inventario?.lineas || []),
    ...textos,
    ...enCifras,
  ].filter(Boolean).join(' \n ');
}

// Las pistas con las que se filtra el inventario, sacadas de los dos sitios
// donde el agente deja lo que ha entendido.
//
// Antes se leían solo del bloque de captura, y el bloque nunca pedía ciudad,
// zona ni presupuesto: se pedían en la calificación, que no alimentaba la
// búsqueda. Resultado, visto en la primera prueba real: alguien escribía
// «busco apartamento en Buenavista», el agente lo apuntaba como criterio
// cumplido, y el catálogo le pasaba los 25 arriendos más baratos de toda la
// costa. El agente contestaba con aplomo y preguntaba de qué Buenavista se
// trataba, porque efectivamente no lo tenía delante.
//
// Ahora se pide en la captura Y se recoge de la calificación, emparejando por
// el nombre del criterio: quien configura la regla los llama «presupuesto» o
// «zona» porque es lo que son.
export function pistasDeBusqueda(capturado = {}, respuestas = {}, delContacto = {}) {
  const deCriterio = (...nombres) => {
    for (const [clave, r] of Object.entries(respuestas || {})) {
      if (clave === '_ruta' || !r?.valor) continue;
      if (nombres.some(n => clave.toLowerCase().includes(n))) return r.valor;
    }
    return null;
  };
  const cuantas = (v) => {
    const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
    return n > 0 && n <= 20 ? n : null;
  };
  // Lo que dijo la persona manda sobre lo que el modelo reportó: es la fuente,
  // no una interpretación. Y el modelo llegó a poner como zona la del inmueble
  // que él mismo estaba ofreciendo.
  return {
    operacion: respuestas?._ruta || null,
    ciudad: delContacto.ciudad || capturado.ciudad || deCriterio('ciudad') || null,
    tipo: delContacto.tipo || null,
    barrio: delContacto.barrio || capturado.zona || capturado.barrio || deCriterio('zona', 'barrio', 'sector') || null,
    presupuesto: delContacto.presupuesto || aPlata(capturado.presupuesto) || aPlata(deCriterio('presupuesto', 'canon', 'precio')),
    habitaciones: delContacto.habitaciones || cuantas(capturado.habitaciones) || cuantas(deCriterio('habitacion', 'alcoba', 'cuarto', 'dormitorio')),
  };
}

// Cuánto dinero dice una frase.
//
// Quitar todo lo que no fuera un dígito bastaba mientras el presupuesto venía
// del bloque de captura, donde se pide en números. En cuanto se empezó a leer
// también de la calificación —que la escribe una persona— apareció «hasta 3
// millones», que se convertía en un presupuesto de 3 pesos. Y un filtro de
// «precio menor que 3» no da error: deja el catálogo vacío y el agente dice
// que no tiene nada. Callado y falso, lo peor de los dos mundos.
export function aPlata(texto) {
  const t = String(texto ?? '').toLowerCase().trim();
  if (!t) return null;

  // «3,5 millones», «2.5 M», «800 mil». La coma y el punto valen de decimal
  // cuando hay una unidad detrás; sin unidad son separadores de miles.
  // La ÚLTIMA cifra con unidad de la frase. Con la primera, «hasta 3 millones,
  // bueno, mejor hasta 5» se quedaba en tres. Y en un rango —«entre 2 y 3
  // millones»— la última es el tope, que es justo lo que hay que usar: el
  // filtro busca por DEBAJO del presupuesto.
  const conUnidades = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(millon|millón|millones|mill|m\b|mm\b|mil\b|k\b)/g)];
  const conUnidad = conUnidades.length ? conUnidades[conUnidades.length - 1] : null;
  if (conUnidad) {
    const n = parseFloat(conUnidad[1].replace(',', '.'));
    const esMillon = /^m(illon|illón|illones|ill|m)?$/.test(conUnidad[2]);
    const valor = Math.round(n * (esMillon ? 1e6 : 1e3));
    return valor >= UMBRAL_PLATA ? valor : null;
  }

  const n = Number(t.replace(/[^\d]/g, ''));
  if (!n) return null;
  // Por debajo de esto no es un presupuesto: es un dato mal leído. Devolver
  // null deja la búsqueda sin filtrar por precio, que enseña de más; devolver
  // el número enseñaría de menos, o nada.
  return n >= UMBRAL_PLATA ? n : null;
}
const UMBRAL_PLATA = 50000;

// Un agente entrenado atiende los cinco canales a la vez: `chat_agents` no
// tiene columna de canal, es la conexión la que apunta al agente. Pero el
// resaltado NO se escribe igual en todos, y esta regla iba fija en WhatsApp:
// en Instagram, Messenger, TikTok y el chat web —que pinta con `textContent`—
// no hay formato ninguno, así que el asterisco se veía tal cual. Era el mismo
// error que la línea decía evitar, cometido en los otros cuatro canales.
function reglaDeResaltado(canal) {
  if (canal === 'whatsapp') {
    return '- Para resaltar usa UN solo asterisco alrededor de la palabra, que es como se pone negrita en WhatsApp. Con dos asteriscos el cliente ve los asteriscos';
  }
  return '- Este chat no tiene negritas ni formato: escribe en texto plano. Nada de asteriscos, guiones bajos ni almohadillas para resaltar, porque el cliente los ve tal cual. Si algo es importante, dilo con palabras';
}

// `canal` por defecto en 'whatsapp': si alguna llamada futura se olvida de
// pasarlo, el comportamiento es el de antes y no el de un canal sin formato.
// Lo que el agente necesita saber de un anuncio de clic-a-WhatsApp.
//
// Sin esto trata igual a quien acaba de pulsar un anuncio de un apartamento
// concreto que a quien escribe en frío, y le pregunta qué busca cuando la
// persona ya lo dijo al hacer clic. Con el titular delante puede abrir por
// donde la conversación ya venía.
//
// El titular es del ANUNCIO, no algo que la persona haya dicho: por eso se
// advierte de no darlo por confirmado. Alguien puede pulsar un anuncio de
// arriendo y venir buscando compra.
// QUÉ HORA ES. El agente tenía el horario de atención en su contexto, pero
// nadie le decía la hora: la adivinaba. El 30-09-2026, a las 9:55 a. m. en
// Barranquilla, le dijo a una clienta de Certain que «a esta hora ya no
// estamos en la oficina». Con el horario escrito y sin reloj, la regla de
// respetarlo solo sirve para rechazar llamadas que sí se podían hacer.
//
// Va en la parte VARIABLE del prompt (después del corte de caché): cambia en
// cada mensaje y, arriba, invalidaría la caché de todas las conversaciones.
//
// La zona es la del negocio (la de su configuración de reservas cuando la
// tiene). Todas las cuentas de hoy están en Colombia, de ahí el valor por
// defecto; una cuenta de otro país necesita su zona_horaria en reservas.
const PAIS_DE_ZONA = {
  'America/Bogota': 'Colombia', 'America/Mexico_City': 'México', 'America/Lima': 'Perú',
  'America/Santiago': 'Chile', 'America/Argentina/Buenos_Aires': 'Argentina', 'America/Guayaquil': 'Ecuador',
  'America/Panama': 'Panamá', 'America/Costa_Rica': 'Costa Rica', 'America/Guatemala': 'Guatemala',
  'America/Santo_Domingo': 'República Dominicana', 'Europe/Madrid': 'España',
};
// El horario, leído del texto del contexto. Con Haiku no basta con darle la
// hora y el horario y pedirle que compare: con los dos delante, a las 7:00 p. m.
// seguía diciendo «estamos atendiendo» (y lo confunde «por chat se recibe a
// cualquier hora»). Así que la comparación la hace el código y al modelo le
// llega el veredicto. Si el horario no se entiende, no se inventa uno: el
// agente recibe solo la hora, como antes.
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
function minutosDe(h, m, suf, sufPar) {
  let hh = +h; const mm = +(m || 0);
  const s = (suf || sufPar || '').replace(/[\s.]/g, '');
  if (s === 'm') return 12 * 60 + mm;                  // «12:00 m.» es mediodía
  if (s === 'pm' && hh < 12) hh += 12;
  if (s === 'am' && hh === 12) hh = 0;
  if (!s && hh < 7) hh += 12;                           // «de 2 a 5» sin sufijo: la tarde
  return hh * 60 + mm;
}
export function horarioDelTexto(texto) {
  const franjas = [];   // { dias:Set, desde, hasta } en minutos
  const T = '(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?|m\\.(?!\\w))?';
  for (const linea of sinTildes(texto).split(/\n|(?<=\.)\s+(?=[A-Z])/)) {
    if (!/atencion|horario|atendemos|abrimos|oficina/.test(linea)) continue;
    // Tramos de la línea que empiezan por días: «lunes a viernes de …», «sábados de …»
    // Se corta antes de cada día que ABRE un tramo, no del que lo cierra: en
    // «lunes a viernes» el viernes es el final del rango, no un tramo nuevo.
    const tramos = linea.split(/(?<!\ba\s)(?=\b(?:lunes|martes|miercoles|jueves|viernes|sabados?|domingos?|todos los dias)\b)/);
    for (const tramo of tramos) {
      let dias = null;
      const rango = tramo.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\s+a\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\b/);
      if (/todos los dias/.test(tramo)) dias = [0, 1, 2, 3, 4, 5, 6];
      else if (rango) {
        const a = DIAS.indexOf(rango[1]), b = DIAS.indexOf(rango[2]);
        dias = []; for (let d = a; ; d = (d + 1) % 7) { dias.push(d); if (d === b || dias.length > 7) break; }
      } else {
        const uno = tramo.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\b/);
        if (uno) dias = [DIAS.indexOf(uno[1])];
      }
      if (!dias) continue;
      const re = new RegExp('de\\s+' + T + '\\s+a\\s+' + T, 'g');
      let m;
      while ((m = re.exec(tramo))) {
        const desde = minutosDe(m[1], m[2], m[3], m[6]);
        const hasta = minutosDe(m[4], m[5], m[6], null);
        if (hasta > desde) franjas.push({ dias: new Set(dias), desde, hasta });
      }
    }
  }
  return franjas.length ? franjas : null;
}
function horaBonita(min) {
  const h = Math.floor(min / 60), m = String(min % 60).padStart(2, '0');
  if (h === 12 && m === '00') return '12:00 m.';
  return (h % 12 || 12) + ':' + m + (h < 12 ? ' a. m.' : ' p. m.');
}
// ¿Dentro o fuera, y cuándo es la próxima franja? `dia` 0=domingo, `min` desde medianoche.
export function veredictoHorario(franjas, dia, min) {
  const hoy = franjas.filter(f => f.dias.has(dia)).sort((a, b) => a.desde - b.desde);
  const dentro = hoy.find(f => min >= f.desde && min < f.hasta);
  if (dentro) return { dentro: true, hasta: dentro.hasta };
  const luegoHoy = hoy.find(f => f.desde > min);
  if (luegoHoy) return { dentro: false, proxima: { enDias: 0, dia, desde: luegoHoy.desde } };
  for (let k = 1; k <= 7; k++) {
    const d = (dia + k) % 7;
    const f = franjas.filter(x => x.dias.has(d)).sort((a, b) => a.desde - b.desde)[0];
    if (f) return { dentro: false, proxima: { enDias: k, dia: d, desde: f.desde } };
  }
  return null;
}

export function bloqueDeAhora(zona, ahora = new Date(), contexto = '') {
  const tz = zona || 'America/Bogota';
  let cuando, manana, dia, min;
  try {
    const f = (d, o) => new Intl.DateTimeFormat('es-CO', { timeZone: tz, ...o }).format(d);
    cuando = f(ahora, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      + ', ' + f(ahora, { hour: 'numeric', minute: '2-digit', hour12: true });
    manana = f(new Date(ahora.getTime() + 86400000), { weekday: 'long', day: 'numeric', month: 'long' });
    const partes = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(ahora);
    const v = t => partes.find(p => p.type === t)?.value;
    dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday'));
    min = (+v('hour') % 24) * 60 + +v('minute');
  } catch (e) {
    return '';   // una zona inválida no puede tumbar la respuesta: sin reloj, como antes
  }
  const donde = PAIS_DE_ZONA[tz] ? 'hora de ' + PAIS_DE_ZONA[tz] : 'hora local del negocio';
  const franjas = horarioDelTexto(contexto);
  const ver = franjas ? veredictoHorario(franjas, dia, min) : null;
  let estado = '';
  if (ver && ver.dentro) {
    estado = `AHORA MISMO SE ESTA DENTRO DEL HORARIO DE ATENCION (hasta las ${horaBonita(ver.hasta)}). Si piden que les llamen ya, di que un asesor le contacta en cuanto pueda, sin prometer minutos exactos. No digas que no hay nadie.\n`;
  } else if (ver) {
    const p = ver.proxima;
    const cuandoAbre = p.enDias === 0 ? 'hoy a las ' + horaBonita(p.desde)
      : p.enDias === 1 ? 'mañana a las ' + horaBonita(p.desde)
      : 'el ' + DIAS[p.dia].replace('miercoles', 'miércoles').replace('sabado', 'sábado') + ' a las ' + horaBonita(p.desde);
    estado = `AHORA MISMO SE ESTA FUERA DEL HORARIO DE ATENCION: nadie puede llamar ahora. La proxima franja en la que un asesor puede contactar es ${cuandoAbre}; si piden que les llamen ya, dilo con naturalidad y ofrece esa franja. Por chat sigues atendiendo, pero una llamada no es ahora.\n`;
  }
  return `QUE DIA Y HORA ES AHORA MISMO (${donde}):
${cuando}
Mañana es ${manana}.
${estado}- Esta es la hora real: no la supongas ni la deduzcas de la conversacion
- "Hoy", "mañana" y los dias de la semana se cuentan desde esta fecha

`;
}

function bloqueDeAnuncio(referral) {
  if (!referral || typeof referral !== 'object') return '';
  const t = (v) => String(v || '').trim().slice(0, 200);
  const titular = t(referral.headline);
  const cuerpo = t(referral.body);
  if (!titular && !cuerpo) return '';
  const organico = referral.source_type === 'post';
  return `DE DÓNDE VIENE ESTA PERSONA:
Escribió tras pulsar ${organico ? 'una publicación' : 'un anuncio'} que decía:
${titular ? `Titular: ${titular}` : ''}${cuerpo ? `\nTexto: ${cuerpo}` : ''}

Úsalo para entrar en materia, no para dar nada por hecho: es lo que decía ${organico ? 'la publicación' : 'el anuncio'}, no lo que la persona te ha dicho. Puede haber pulsado buscando otra cosa. No repitas el anuncio palabra por palabra ni menciones que sabes de dónde viene.

`;
}

// El prompt, partido en dos: lo que NO cambia entre mensajes y lo que sí.
//
// Se parte justo antes del inventario, que es el primer trozo variable. Todo lo
// anterior —quién es, el contexto del negocio, sus preguntas frecuentes y las
// reglas de comportamiento— es idéntico en cada respuesta, y eso es lo que se
// puede cachear.
//
// El texto NO cambia ni un carácter: `buildSystemPrompt` sigue devolviendo
// exactamente lo mismo de antes, que es la unión de las dos partes. Una prueba
// lo comprueba, porque cambiar el prompt sin querer cambiaría el agente.
export function partesDelPrompt(...args) {
  const entero = buildSystemPrompt(...args);
  // El corte, buscado por su texto y no por una posición: si mañana se añade
  // una sección antes del inventario, el corte se mueve solo.
  const i = entero.indexOf(CORTE_CACHE);
  if (i < 0) return { estable: entero, variable: '' };
  const fin = i + CORTE_CACHE.length;
  return { estable: entero.slice(0, fin), variable: entero.slice(fin) };
}

// La última línea de lo que NO cambia. Justo después vienen el inventario y los
// datos capturados, que son distintos en cada mensaje.
const CORTE_CACHE = 'un precio inventado lo tiene que desmentir despues una persona\n';

export function buildSystemPrompt(agent, capturedData, reglaCalificacion = null, propiedades = null, canal = 'whatsapp', referral = null, reservas = null, suyas = null) {
  const faqs = (agent.faqs || []).map(f => `P: ${f.q}\nR: ${f.a}`).join('\n\n');
  const captured = Object.entries(capturedData || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'Ninguno aún';

  return `Eres ${agent.name}. ${agent.persona || ''}

${agent.business_ctx || ''}

${faqs ? `PREGUNTAS FRECUENTES:\n${faqs}` : ''}

CÓMO DEBES COMPORTARTE:
${tratamiento(agent.tone)}
- Habla como una persona real, cálida y natural
- Respuestas cortas (1-3 oraciones), como en una conversación de chat real
- Nunca uses listas de puntos ni numeraciones innecesarias, salvo al enumerar opciones concretas del inventario
${reglaDeResaltado(canal)}
- No menciones que eres IA, bot ni asistente virtual. Si alguien pregunta directamente si eres IA o humano, responde con naturalidad sin confirmar ni negar, como haría alguien que quiere mantener la conversación
- Si no sabes algo, dilo con naturalidad y ofrece ayudar de otra forma
- Cuando alguien muestre interés genuino, busca conocer su nombre de forma natural en la conversación
- Los datos que necesitas de esta persona son: ${(agent.capture_fields || ['nombre', 'celular']).join(', ')}. Pídelos dentro de la conversación, no de golpe como un formulario — pero el número de contacto no espera, mira más abajo
- Si alguien quiere hablar con una persona real, responde: "${agent.escalate_phrase || 'Claro, en un momento te comunico con un asesor. ¿Me das un segundo?'}" y en ese caso incluye [ESCALAR] al final de tu mensaje
- Nunca seas agresivo ni insistente con la venta

NINGUN MENSAJE TUYO TERMINA SIN UNA PREGUNTA:
- Cierra SIEMPRE con una pregunta que te acerque a saber lo que te falta de esta persona. Una sola, la mas util ahora mismo
- Tambien despues de mandar fotos, despues de responder una duda y despues de dar un precio. Un mensaje que termina sin pregunta deja a la persona sin saber que sigue, y ahi es donde se enfrian las conversaciones
- La unica excepcion es cuando te despides porque la persona se despidio

EL TELEFONO, PRONTO — PERO NUNCA A CAMBIO DE NADA:
- PRIMERO haces lo que te piden. Si piden fotos, las mandas; si piden un precio, lo das; si preguntan algo, lo respondes. Y en el MISMO mensaje, detras, pides el numero
- Asi: "Claro, le mando las fotos del de Riomar. Y para que un asesor le confirme disponibilidad, ¿me comparte un numero?"
- NUNCA "primero necesito su numero", ni "antes de enviarle las fotos necesito", ni nada parecido. Negarle algo a alguien para sacarle el telefono no consigue el telefono: pierde al cliente
- Pidelo pronto, en cuanto sepas QUE busca. Si no te lo da, sigues atendiendole igual y lo intentas mas adelante — nunca dos mensajes seguidos pidiendo lo mismo
- Una conversacion que avanza mucho y se corta sin telefono es un cliente al que ya no se puede llamar: eso es lo que hay que evitar

EL HORARIO DE ATENCION SE RESPETA — Y SE DICE:
- Si en tu contexto hay un horario de atencion, cualquier contacto que acuerdes tiene que caer DENTRO de el
- Si la persona pide una hora que queda fuera, NO respondas "perfecto" ni "de acuerdo". Di que a esa hora no hay nadie, cual es el horario, y ofrece la franja valida mas cercana
- Asi, no de otra forma: "A esa hora ya no estamos; atendemos hasta las 5:00 p. m. ¿Le viene bien que le llamen mañana sobre las 4:00?"
- Por chat puedes atender a cualquier hora, pero una llamada o un contacto de un asesor solo en horario

SI QUIEREN QUE LES VENDAMOS, ARRENDEMOS O ADMINISTREMOS SU INMUEBLE:
- NO digas que no. Ni "no manejamos ese estrato", ni "no esta en nuestro portafolio", ni "no trabajamos esa zona". Aunque en tu contexto figure que no se maneja
- Quien viene a ofrecernos un inmueble es una oportunidad, y quien decide si encaja es un asesor con el caso delante, no tu
- Tu trabajo aqui es uno solo: tomar los datos del inmueble y de la persona, y pasarla a un asesor. Nada de aclaraciones sobre lo que no hacemos
- Si sientes la tentacion de avisar de que quiza no encaje, callatelo y pasa la conversacion

LO QUE NO PUEDES INVENTAR — ESTO ES INNEGOCIABLE:
- Solo puedes afirmar precios, disponibilidad, direcciones, medidas, plazos y condiciones si aparecen literalmente aqui arriba, en tu contexto o en las preguntas frecuentes
- Si no aparecen, NO los estimes, NO des rangos, NO digas lo que suele costar ni lo que normalmente hay. Tampoco menciones nombres de productos, inmuebles, proyectos o sectores concretos que no esten en tu contexto
- Cuando te pregunten algo asi, di con naturalidad que eso te lo confirma un asesor y ofrece pasarle la conversacion. En ese caso incluye [ESCALAR] al final de tu mensaje
- Puedes hablar de lo general que si este en tu contexto, y puedes preguntar lo que necesites para entender que busca la persona
- Vale mucho mas decir "eso te lo confirmo con un asesor" que dar un dato que luego resulte falso: un precio inventado lo tiene que desmentir despues una persona

${propiedades && propiedades.lineas.length ? `LO QUE HAY DISPONIBLE AHORA MISMO (${propiedades.total} opciones que encajan con lo que te dijeron):
${propiedades.lineas.join('\n')}

Sobre esta lista:${propiedades.ampliado ? `
- OJO: en ${propiedades.barrioPedido} no hay NADA que encaje. Estas son de OTRAS zonas de la misma ciudad. Dilo antes de enseñarlas —"en ${propiedades.barrioPedido} no tengo nada ahora mismo, pero sí en otras zonas"— y no las presentes como si fueran de ahí` : ''}
- Es lo unico que puedes ofrecer. Si te preguntan por algo que no esta aqui, no lo inventes: dilo y ofrece pasar la conversacion a un asesor
- Menciona como mucho tres opciones por mensaje y pregunta cual le interesa
- Cada opcion va en SU PROPIA LINEA, no seguidas dentro de un parrafo. Una linea de presentacion, las opciones debajo separadas por salto de linea, y la pregunta al final. Asi se lee de un vistazo en el movil
- En cada linea: el barrio, las habitaciones, el precio y el codigo entre parentesis
- Los precios son los de la lista, sin redondear ni estimar` : ''}

PUEDES ENSEÑAR FOTOS:
- Las opciones marcadas «con fotos» las tienes en imágenes y se las puedes mandar por aquí
- No las mandes de golpe. Ofrécelas primero —«¿le mando unas fotos?»— y espera a que diga que sí: son datos de su teléfono y no todo el mundo quiere el chat lleno
- Cuando diga que sí, escribe al final de tu mensaje el bloque [FOTOS: codigo] con el código del inmueble, y las envío yo. No pongas enlaces a mano
- De una opción que NO esté marcada «con fotos», no las ofrezcas ni prometas mandarlas: dile que se las hace llegar un asesor
- Videos no tienes de ninguna. Si los piden, eso lo ve un asesor

${propiedades && !propiedades.lineas.length ? `NO TIENES NADA QUE ENCAJE CON LO QUE TE HAN PEDIDO.
Busqué en el inventario y no hay ni una opción con esas características. Esto es lo que toca hacer, y no hay alternativa:
- Dilo claramente: "en este momento no tengo nada así"
- NO te inventes opciones. Ni un barrio, ni un precio, ni una administración, ni "algo parecido". Si escribes un inmueble que no existe, esa persona va a pedir verlo
- Puedes preguntarle si flexibiliza algo —otra zona, otro número de habitaciones, otro presupuesto— y volvemos a buscar
- O pásale la conversación a un asesor, que puede mirar inmuebles que todavía no están publicados. En ese caso incluye [ESCALAR] al final

` : ''}SI TE MANDAN UN PDF:
- Lo lees. Usa lo que dice para responder: si trae un pago, una cedula, un certificado o una ficha, dilo con sus datos
- Si el PDF no trae lo que hacia falta, di que falta y que se necesita

SI TE MANDAN UNA FOTO:
- La ves. Comenta lo que hay en ella con naturalidad, sin decir "veo una imagen"
- Que se parezca a algo del listado NO significa que sea eso. No afirmes que es una propiedad concreta salvo que te lo diga la persona; si crees reconocerla, preguntale
- Si la foto no se entiende o no tiene que ver, dilo con amabilidad y pide lo que necesitas

${bloqueDeAhora(reservas?.zona, new Date(), [agent.business_ctx, faqs].filter(Boolean).join('\n'))}${bloqueDeAnuncio(referral)}${bloqueReservas(reservas, canal)}${bloqueCitas(suyas)}DATOS CAPTURADOS HASTA AHORA:
${captured}

Cuando detectes un dato nuevo en la conversación, incluye al final de tu respuesta (invisible para el usuario):
[CAPTURA: {"nombre": "...", "celular": "...", "email": "...", "interes": "...", "ciudad": "...", "zona": "...", "presupuesto": "...", "habitaciones": "..."}]
Solo incluye los campos que tengas. Omite este bloque si no hay datos nuevos.
Ciudad, zona, presupuesto y habitaciones son los que deciden qué te enseño del inventario: en cuanto los oigas, aunque sea de pasada, ponlos. «Un apartamento de 3 habitaciones en Buenavista» son las dos cosas. «Hasta tres millones» ya es un presupuesto, y va en números, sin puntos ni símbolos: 3000000.
IMPORTANTE: esos cuatro campos son lo que la persona PIDE, no lo que tú le ofreces. Si le enseñas un inmueble en otro barrio, la zona sigue siendo la que ella dijo. No la cambies nunca por la de una opción que mencionaste tú.${bloqueDePrompt(reglaCalificacion)}`;
}

// El agente de WhatsApp contesta con un guion cerrado y un inventario delante:
// no es la tarea que justifica el modelo más caro. Haiku cuesta un 67% menos.
//
// Va por variable de entorno para poder volver atrás sin desplegar: si la
// calidad de la calificación baja, se pone AGENTE_WA_MODELO=claude-sonnet-4-6 en
// Vercel y vuelve al anterior en el siguiente arranque.
//
// Aquí NO se cachea el prompt: su parte estable son ~500 tokens y Anthropic no
// cachea por debajo de 1.024. Escribir una caché que nunca se usa sale un 25%
// más caro que no cachear.
const MODELO_WA = process.env.AGENTE_WA_MODELO || 'claude-haiku-4-5-20251001';

// Lo que tarda como mínimo en aparecer una respuesta, contando desde que llega
// el mensaje. No es una pausa encima del modelo: es un suelo. Si pensar ya
// costó cuatro segundos, no se añade nada.
const ESCRIBIENDO_MIN_MS = 3000;

// Devuelve el texto y, aparte, lo que consumió. El uso se registra donde se
// sabe de quién es la conversación; aquí solo se recoge.
// Cuánto texto estable hace falta para que cachear valga la pena.
//
// Anthropic no cachea por debajo de 1.024 tokens. En español son unos 3.500
// caracteres; se pide 4.500 para no quedarse justo en el filo y pagar una
// escritura que luego no sirve.
//
// Esta guarda es la que hace que un agente recién creado —cuatro líneas de
// contexto— siga funcionando igual y sin coste extra.
const MINIMO_CACHE = 4500;

// El `system` que se le manda a la API.
//
// Cuando la parte estable es grande, va como bloque aparte marcado para
// cachear: el prompt de un agente bien entrenado son 5.682 tokens que NO
// cambian entre mensajes, y volver a procesarlos en cada respuesta es pagar
// cuatro veces por lo mismo.
//
// No cambia ni una palabra de lo que lee el modelo: es el mismo texto, partido.
function systemParaLaApi(system) {
  if (typeof system === 'string') return system;
  const { estable, variable } = system || {};
  if (!estable) return variable || '';
  if (estable.length < MINIMO_CACHE) return estable + variable;
  return [
    { type: 'text', text: estable, cache_control: { type: 'ephemeral' } },
    ...(variable ? [{ type: 'text', text: variable }] : []),
  ];
}

async function callClaude(systemPrompt, messages, alRegistrar) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO_WA,
      // Con la calificación activa el mensaje lleva dos bloques ocultos además
      // del texto; con 300 se truncaba a mitad y el bloque se le escapaba al
      // contacto.
      max_tokens: 700,
      system: systemParaLaApi(systemPrompt),
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const data = await res.json();
  if (data.usage && typeof alRegistrar === 'function') {
    await alRegistrar(data.usage, data.model || MODELO_WA).catch(() => {});
  }
  return data.content?.find(b => b.type === 'text')?.text || '';
}

// ── Respuesta sugerida ──────────────────────────────────────────────────────
// Le pregunta al agente qué contestaría, y devuelve el texto SIN guardarlo y SIN
// enviarlo. Quien atiende lo lee, lo ajusta y decide. Por eso no toca
// chat_messages: si se guardara, el agente creería en el siguiente mensaje que
// ya dijo algo que quizá nunca se envió.
export async function sugerirRespuesta(userId, conversationId) {
  const conv = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
  if (!conv) return { ok: false, error: 'Conversación no encontrada' };

  const connection = conv.connection_id ? await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?id=eq.${conv.connection_id}&select=*`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).then(abrirConexion).catch(() => null) : null;

  // El agente del canal; si el canal es manual, el que quedó ligado a la
  // conversación cuando se escaló.
  const agentId = connection?.agent_id || conv.agent_id || null;
  if (!agentId) {
    return { ok: false, error: 'Este canal se atiende a mano y no tiene agente, así que no hay a quién preguntarle. Asígnale uno en Marketing → Fuentes → Configurar canales.' };
  }
  const agent = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${agentId}&select=*`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
  if (!agent) return { ok: false, error: 'El agente de este canal ya no existe.' };

  const hist = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${conv.id}&select=role,content,adjunto_url,adjunto_tipo,adjunto_mime&order=created_at.desc&limit=12`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).then(r => (r || []).reverse()).catch(() => []);
  if (!hist.length) return { ok: false, error: 'Todavía no hay nada que responder en esta conversación.' };

  // La API continúa el último turno si es del asistente: sin esto la sugerencia
  // saldría como la segunda mitad del mensaje anterior, no como uno nuevo.
  const ultimo = hist[hist.length - 1];
  const extra = ultimo?.role === 'assistant' ? [{
    role: 'user',
    content: '(Aviso del sistema, no lo escribió el contacto) Redacta el siguiente mensaje que le enviarías a esta persona para retomar la conversación.',
  }] : [];

  const capturedData = extractCapturedData(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n'));
  const previas = extraerCalificacion(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n'));
  const clienteDelCanal = connection?.client_id || agent.client_id || null;
  const delContacto = await pistasDelContacto(userId, clienteDelCanal, hist).catch(() => ({}));
  const inventario = await propiedadesParaPrompt(userId, clienteDelCanal,
    pistasDeBusqueda(capturedData, previas, delContacto)).catch(() => ({ lineas: [], total: 0 }));

  // Sin la regla de calificación: los bloques ocultos solo tienen sentido cuando
  // el mensaje se guarda, y este no se guarda.
  const system = partesDelPrompt(
    agent,
    { ...capturedData, ...(conv.contact_name ? { nombre: conv.contact_name } : {}) },
    null,
    inventario,
    conv.channel,
    conv.referral || null
  );

  try {
    const bruto = await responderViendo(system, hist, extra, { userId, origen: 'whatsapp' });
    const texto = cleanForUser(bruto).trim();
    if (!texto) return { ok: false, error: 'El agente no devolvió nada. Reintenta.' };
    return { ok: true, texto };
  } catch (e) {
    return { ok: false, error: 'No se pudo consultar al agente: ' + (e?.message || 'error desconocido') };
  }
}

// ── Ensayo del agente, antes de encenderlo ──────────────────────────────────
// Hasta ahora un agente se publicaba a ciegas: la primera conversación de
// verdad era también la primera prueba, y la hacía un cliente del cliente.
//
// Esto responde igual que la conversación real —el MISMO prompt, el MISMO
// inventario, la MISMA regla— pero no escribe nada: ni conversación, ni
// mensajes, ni lead, ni etiquetas. Lo único que deja es el consumo en
// ai_usage, que es dinero gastado de verdad y tiene que constar.
//
// Devuelve además lo que en producción va oculto: qué capturó, qué pistas
// llegaron al filtro del catálogo, a qué ruta te manda y si te califica. Sin
// eso sería una demo; con eso es la herramienta para ajustar el entrenamiento.
export async function ensayarAgente({ userId, agentId, canal = 'whatsapp', mensajes = [], origen = 'ensayo' }) {
  if (!userId || !agentId) return { ok: false, error: 'Falta el agente.' };
  const limpios = (Array.isArray(mensajes) ? mensajes : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    .slice(-12);
  if (!limpios.length || limpios[limpios.length - 1].role !== 'user') {
    return { ok: false, error: 'El ensayo necesita un mensaje tuyo al final.' };
  }

  const agent = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${encodeURIComponent(agentId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
  if (!agent) return { ok: false, error: 'Ese agente no existe en tu cuenta.' };

  // Lo capturado y lo calificado se acumulan del historial del propio ensayo,
  // igual que en producción se acumulan del historial guardado. Aquí el
  // historial lo manda el navegador, así que los bloques ocultos tienen que
  // viajar dentro de los mensajes del asistente: si el navegador los limpiara
  // antes de devolverlos, el ensayo se quedaría amnésico y en 'pendiente' para
  // siempre, que es justo el fallo que este ensayo debe poder destapar.
  const deAsistente = limpios.filter(m => m.role === 'assistant').map(m => m.content).join('\n');
  const capturado = extractCapturedData(deAsistente);
  const previas = extraerCalificacion(deAsistente);

  const regla = await getRegla(userId, agentId).catch(() => null);

  // Las pistas, calculadas aparte y devueltas: son la explicación de por qué el
  // agente ofreció lo que ofreció. Un catálogo que no filtra no se nota en la
  // respuesta, se nota aquí.
  // El ensayo lee las pistas igual que la conversación real: de lo que escribió
  // la persona. Si aquí se leyeran de otro sitio, el probador daría luz verde a
  // un agente que luego se comporta distinto.
  const delContacto = await pistasDelContacto(userId, agent.client_id || null, limpios).catch(() => ({}));
  const pistas = pistasDeBusqueda(capturado, previas, delContacto);
  const inventario = await propiedadesParaPrompt(userId, agent.client_id || null, pistas)
    .catch(() => ({ lineas: [], total: 0 }));

  // Las mismas citas que en la conversación real, pero en el ensayo NUNCA se
  // guarda nada: se comprueba el hueco y se para ahí.
  const reservas = await reservasParaAgente(userId, agent.client_id || null).catch(() => null);
  // Sin citas propias (null): el ensayo no tiene contacto en el CRM. Se pasa a
  // propósito para que el prompt se arme con los mismos argumentos que en la
  // conversación real.
  const system = partesDelPrompt(agent, capturado, regla, inventario, canal, null, reservas, null);

  let bruto;
  try {
    bruto = await responderViendo(system, limpios, [], { userId, origen });
  } catch (e) {
    return { ok: false, error: 'No se pudo consultar al agente: ' + (e?.message || 'error desconocido') };
  }
  let texto = cleanForUser(bruto).trim();
  if (!texto) return { ok: false, error: 'El agente no devolvió texto. Suele ser el presupuesto de tokens: reintenta.' };

  // Los mismos guardianes que en una conversación real.
  //
  // Sin esto el probador mentía en las dos direcciones: enseñaba defectos que
  // en producción se corrigen —un tuteo que el guardián reescribe— y podía
  // enseñar como bueno un mensaje que allí sale distinto. Quien prueba aquí
  // está decidiendo si enciende el agente: tiene que ver lo que de verdad
  // recibiría su cliente.
  //
  // Se reintenta como en producción, pero sin escalar ni registrar nada: esto
  // es un ensayo y no hay conversación que pasar a nadie.
  const reintento = async (aviso) => responderViendo(system, limpios, [
    { role: 'assistant', content: bruto },
    { role: 'user', content: '(Aviso del sistema, no lo escribió el contacto) ' + aviso },
  ], { userId, origen }).catch(() => '');

  if (agent.tone === 'formal' && tutea(texto)) {
    const deUsted = await reintento('Tu mensaje anterior NO se envió: tuteaste, y este cliente pidió trato de usted. ' +
      'Escríbelo otra vez tratándole de USTED: «le ayudo», «cuénteme», «su presupuesto». Nada de «tú», «te», «tu» ni «ti». ' +
      'El contacto no vio nada y no te ha corregido: no te disculpes ni lo menciones.');
    if (deUsted && !tutea(cleanForUser(deUsted))) { bruto = deUsted; texto = cleanForUser(deUsted).trim(); }
  }

  // El de los inventos, que es el que de verdad protege al cliente: un precio
  // que no existe lo tiene que desmentir después una persona.
  const citable = loQuePuedeCitar(agent, inventario, limpios);
  const invento = inventos(texto, citable);
  if (invento.length) {
    const corregido = await reintento('Tu mensaje anterior NO se envió: citaste datos que no están en tu contexto ni en el inventario (' +
      invento.slice(0, 4).join(', ') + '). Escríbelo otra vez usando SOLO lo que tienes delante. ' +
      'Si te falta un dato, di que lo confirma un asesor. El contacto no vio nada: no te disculpes ni lo menciones.');
    if (corregido && !inventos(cleanForUser(corregido), citable).length) { bruto = corregido; texto = cleanForUser(corregido).trim(); }
  }

  if (quiereOfrecerInmueble(limpios) && descartaAlContacto(texto)) {
    const sinDescarte = await reintento('Tu mensaje anterior NO se envió. Esta persona viene a ofrecernos su inmueble, y le has dicho que no encaja: ' +
      'eso no lo decides tú, lo decide el asesor con el caso delante. Escríbelo otra vez SIN ninguna mención a estratos, portafolio, ' +
      'zonas que no se manejan ni a que quizá no podamos ayudarle. El contacto no vio nada: no te disculpes ni lo menciones.');
    if (sinDescarte && !descartaAlContacto(cleanForUser(sinDescarte))) { bruto = sinDescarte; texto = cleanForUser(sinDescarte).trim(); }
  }

  // Si el agente agendó, se enseña lo que habría pasado: la confirmación que
  // saldría, o el mensaje que sustituiría al suyo si la hora no está libre.
  let reserva = null;
  const pedidoCita = reservas && !pideConfirmacion(texto) ? extraerReserva(bruto) : null;
  if (pedidoCita) {
    const cap = { ...capturado, ...extractCapturedData(bruto) };
    reserva = await ejecutarReserva({
      info: reservas, pedido: pedidoCita, simular: true,
      // En el ensayo no hay chat de WhatsApp del que sacar el teléfono: se da
      // por puesto, que es lo que pasaría en el canal real.
      contacto: { nombre: cap.nombre || '', telefono: cap.celular || (canal === 'whatsapp' ? 'ensayo' : ''), correo: cap.email || '' },
    }).catch(e => ({ ok: false, texto: 'No se pudo comprobar la cita: ' + (e?.message || e) }));
    texto = reserva.ok ? texto + '\n\n' + reserva.texto : reserva.texto;
  }

  const respuestas = { ...previas, ...extraerCalificacion(bruto) };
  const veredicto = evaluar(regla, respuestas);
  const nuevo = extractCapturedData(bruto);
  const ruta = respuestas._ruta || null;
  const destino = ruta ? (regla?.enrutado?.rutas || []).find(r => r.clave === ruta) || null : null;
  // Cuántos atienden ese tablero: es lo que decide si el lead tendría dueño.
  const porTurnos = destino?.pipeline_id
    ? (await asesoresDelTablero(userId, destino.pipeline_id).catch(() => [])).length
    : 0;

  // Las fotos que se habrían enviado por WhatsApp. El ensayo no manda nada,
  // pero tiene que ENSEÑARLAS: sin esto el agente decía «le mando unas fotos»
  // y en la pantalla no aparecía ninguna. Una prueba que no se parece al
  // resultado no sirve para aprobarlo, y esta es la pantalla con la que se le
  // enseña el agente al cliente.
  const fotos = await fotosPedidas(bruto, userId, agent.client_id || null).catch(() => []);

  return {
    ok: true,
    texto,
    fotos,
    // En bruto para que el navegador lo devuelva tal cual en el siguiente turno.
    bruto,
    capturado: { ...capturado, ...nuevo },
    escalar: bruto.includes('[ESCALAR]') || !!(reserva && reserva.escalar),
    reserva: reserva ? { ok: !!reserva.ok, texto: reserva.texto, motivo: reserva.motivo || null } : null,
    calificacion: {
      activa: !!regla?.activo,
      estado: veredicto.estado,
      cumplidas: veredicto.cumplidas ?? null,
      total: veredicto.total ?? null,
      resumen: regla?.activo ? resumenLegible(regla, respuestas) : '',
    },
    ruta: ruta ? {
      clave: ruta,
      etiqueta: destino?.etiqueta || null,
      // Que el modelo devuelva una clave que el enrutado no conoce es un fallo
      // silencioso en producción: el lead se queda donde estaba. Aquí se ve.
      reconocida: !!destino,
      // Hay dos formas de tener dueño: un asesor fijo en la ruta, o el reparto
      // por turnos entre quienes atienden ese tablero. Mirando solo la primera,
      // la radiografía decía «Sin asesor asignado» con el equipo perfectamente
      // repartido — y eso es peor que no decir nada, porque manda a arreglar
      // algo que ya está bien.
      asignada: !!destino?.asignar_a || porTurnos > 0,
      asignar_nombre: destino?.asignar_nombre || null,
      por_turnos: destino?.asignar_a ? 0 : porTurnos,
    } : null,
    catalogo: { pistas, ofrecidas: inventario.total, lineas: inventario.lineas },
  };
}

// ── Entrada al pipeline ───────────────────────────────────────────────────────
// La regla del canal decide: 'manual' no crea nada (la conversación se queda en
// el inbox esperando decisión), 'on_contact' crea cuando hay nombre/teléfono/
// correo, y 'always' crea en cuanto llega el primer mensaje.
export async function upsertLeadFromConversation(userId, clientId, conv, captureData = {}, policy = null, esperarCalificacion = false, pipelineId = null) {
  const pol = policy || { mode: 'on_contact', stage: 'nuevo', tag: conv.channel };
  const hasContact = !!(captureData.nombre || captureData.celular || captureData.email);

  if (conv.lead_id) {
    const update = {};
    if (captureData.nombre && !conv.contact_name) update.name = captureData.nombre;
    if (captureData.celular && !conv.contact_phone) update.phone = captureData.celular;
    if (captureData.email && !conv.contact_email) update.email = captureData.email;
    if (Object.keys(update).length) {
      update.updated_at = new Date().toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${conv.lead_id}`, {
        method: 'PATCH', headers: sb(), body: JSON.stringify(update),
      });
    }
    return conv.lead_id;
  }

  if (pol.mode === 'manual') return null;
  if (pol.mode === 'on_contact' && !hasContact) return null;

  const channelTag = String(pol.tag || conv.channel || '').toLowerCase().slice(0, 30);
  const leadPayload = {
    user_id: userId,
    client_id: clientId || null,
    name: captureData.nombre || conv.contact_name || `Contacto ${conv.channel}`,
    phone: captureData.celular || conv.contact_phone || telefonoDelCanal(conv.channel, conv.contact_id) || null,
    email: captureData.email || conv.contact_email || null,
    stage: pol.stage || 'nuevo',
    stage_position: Date.now(),
    // Sin pipeline el lead no se pinta en ninguna columna del tablero, que
    // filtra por pipeline. Se usa el del canal o, si no, el principal de su
    // cliente.
    pipeline_id: pipelineId || await pipelinePrincipal(userId, clientId || null),
    source: conv.channel,
    tags: channelTag.length >= 2 ? [channelTag] : [],
    notes: captureData.interes ? `Interés: ${captureData.interes}` : null,
  };
  // De qué anuncio vino, si vino de uno. Va con LAS MISMAS claves que un lead
  // de Meta Lead Ads (`camposDePauta`), o el reporte de pauta saldría partido
  // en dos por la misma campaña.
  const pauta = pautaDeReferral(conv.referral);
  if (Object.keys(pauta).length) leadPayload.custom_fields = pauta;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST', headers: sb(), body: JSON.stringify(leadPayload),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const leadId = rows?.[0]?.id;
  if (!leadId) return null;

  await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
    method: 'PATCH', headers: sb(),
    body: JSON.stringify({
      lead_id: leadId,
      contact_name: captureData.nombre || conv.contact_name,
      contact_phone: captureData.celular || conv.contact_phone,
      contact_email: captureData.email || conv.contact_email,
    }),
  });
  await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
    method: 'POST', headers: sb(),
    body: JSON.stringify({
      lead_id: leadId, user_id: userId,
      type: 'creacion',
      content: `Lead capturado automáticamente desde ${conv.channel}`,
      metadata: { conversation_id: conv.id, channel: conv.channel },
    }),
  });
  // Reparto entre comerciales según la regla de la fuente.
  // Si el agente califica, el reparto espera al veredicto: repartir antes
  // significaría darle tarea y correo a un comercial por alguien que todavía
  // no sabemos si sirve — justo lo que la calificación existe para evitar.
  if (!esperarCalificacion) await asignarLead(userId, rows[0], conv.channel).catch(() => {});
  if (leadPayload.tags.length) await ensureCatalog(userId, clientId || null, leadPayload.tags, channelTag).catch(() => {});
  await enqueueAutomations(userId, rows[0], 'lead_created').catch(() => {});
  if (leadPayload.tags.length) await enqueueAutomations(userId, rows[0], 'tag_added', leadPayload.tags).catch(() => {});
  return leadId;
}

// ── Ver las imágenes ────────────────────────────────────────────────────────
// Hasta ahora el agente solo sabía que había llegado una foto. Ahora la mira:
// para una inmobiliaria eso es la diferencia entre «déjame verla» y «ese es el
// del Prado, código 698».
const IMG_VISIBLES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const TOPE_IMAGENES = 3;   // solo las últimas: cada una cuesta, y las viejas ya se comentaron

// Solo PDF: es el único documento que el modelo sabe leer. Un Word o un Excel
// llegarían como bytes que no entiende y tumbarían la llamada.
const TOPE_DOCS = 1;       // un PDF son miles de tokens por página; con el último basta

function mimeDe(m) {
  return String(m.adjunto_mime || '').split(';')[0].toLowerCase();
}

function esImagenLegible(m) {
  return m.adjunto_tipo === 'image' && !!m.adjunto_url && IMG_VISIBLES.includes(mimeDe(m));
}

// Solo los que manda el CLIENTE. Los que enviamos nosotros ya sabemos lo que
// dicen, y releerlos en cada turno se paga por página cada vez.
function esDocLegible(m) {
  return m.role === 'user' && !!m.adjunto_url && mimeDe(m) === 'application/pdf';
}

function llevaAdjuntoLegible(hist) {
  return hist.some(m => esImagenLegible(m) || esDocLegible(m));
}

// Convierte el historial en lo que espera la API, metiendo las imágenes como
// bloques. Junta los mensajes seguidos del mismo lado, que la API rechaza y que
// aparecen en cuanto alguien responde a mano después del agente.
function historialParaModelo(hist, conImagenes = true) {
  // Solo las últimas imágenes llevan bloque; de las anteriores queda su texto.
  const conFoto = hist.filter(esImagenLegible);
  const permitidas = new Set(conFoto.slice(-TOPE_IMAGENES).map(m => m.adjunto_url));
  const conDoc = hist.filter(esDocLegible);
  const permitidosDoc = new Set(conDoc.slice(-TOPE_DOCS).map(m => m.adjunto_url));

  const salida = [];
  for (const m of hist) {
    const pintaImagen = conImagenes && esImagenLegible(m) && permitidas.has(m.adjunto_url);
    const pintaDoc = conImagenes && esDocLegible(m) && permitidosDoc.has(m.adjunto_url);
    let texto = String(m.content || '').trim();
    // Un adjunto sin texto —una foto que se manda sin pie— se quedaba fuera del
    // historial entero. El modelo no se enteraba de que existió.
    if (!texto && m.adjunto_url && !pintaImagen && !pintaDoc) {
      const q = { image: 'una imagen', video: 'un video', audio: 'una nota de voz' }[m.adjunto_tipo] || 'un archivo';
      texto = m.role === 'user' ? `(te enviaron ${q})` : `(le enviaste ${q})`;
    }
    const partes = [];
    if (pintaImagen) partes.push({ type: 'image', source: { type: 'url', url: m.adjunto_url } });
    if (pintaDoc) partes.push({ type: 'document', source: { type: 'url', url: m.adjunto_url } });
    if (texto) partes.push({ type: 'text', text: texto });
    if (!partes.length) continue;

    const ult = salida[salida.length - 1];
    if (ult && ult.role === m.role) ult.content.push(...partes);
    else salida.push({ role: m.role, content: partes });
  }
  return salida;
}

// Un adjunto puede romper la llamada —pesa demasiado, la URL no responde, el
// PDF tiene 400 páginas, el formato no es el que dice su mime—. Si pasa, se
// reintenta SIN adjuntos: una respuesta que no vio la foto es mucho mejor que
// ninguna respuesta.
async function responderViendo(systemPrompt, hist, extra = [], quien = null) {
  const conAdjuntos = [...historialParaModelo(hist, true), ...extra];
  if (!conAdjuntos.length) throw new Error('No hay nada que responder');
  const anotar = quien
    ? (uso, modelo) => registrarUso({ userId: quien.userId, origen: quien.origen, modelo, uso })
    : null;
  try {
    return await callClaude(systemPrompt, conAdjuntos, anotar);
  } catch (e) {
    if (!llevaAdjuntoLegible(hist)) throw e;
    console.error('reintento sin adjuntos:', e?.message);
    return callClaude(systemPrompt, [...historialParaModelo(hist, false), ...extra], anotar);
  }
}

// ── Adjuntos que llegan ─────────────────────────────────────────────────────
// Lo que manda el cliente hay que copiarlo a nuestro almacén: WhatsApp guarda
// el archivo unos días y detrás de su token, y el CDN de Messenger caduca. Sin
// copiarlo, en una semana el hilo tendría enlaces muertos.
const TOPE_ENTRANTE = 12 * 1024 * 1024;   // por encima, la función de Vercel no llega a tiempo

const TIPO_POR_MIME = m => {
  const x = String(m || '').toLowerCase();
  if (x.startsWith('image/')) return 'image';
  if (x.startsWith('video/')) return 'video';
  if (x.startsWith('audio/')) return 'audio';
  return 'document';
};

const EXT_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/amr': 'amr', 'audio/aac': 'aac',
  'audio/mp4': 'm4a', 'text/plain': 'txt', 'text/csv': 'csv',
  // Ofimática: sin estas, un .docx se guardaba como .bin y al cliente le bajaba
  // un archivo que su equipo no sabía abrir.
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

// Devuelve {url,tipo,nombre,mime} o {error} — nunca lanza: que falle el archivo
// no puede costar el mensaje entero.
async function espejarAdjunto(connection, media) {
  try {
    let bytes, mime = media.mime || null, nombre = media.nombre || null;

    if (media.fuente === 'whatsapp') {
      // WhatsApp da un id; hay que pedir la URL y luego descargar CON el token.
      const meta = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(media.id)}`, {
        headers: { Authorization: `Bearer ${connection.access_token}` },
      }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (!meta?.url) return { error: 'No se pudo localizar el archivo en WhatsApp' };
      mime = mime || meta.mime_type;
      if (Number(meta.file_size || 0) > TOPE_ENTRANTE) return { error: 'archivo demasiado grande' };
      const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${connection.access_token}` } });
      if (!bin.ok) return { error: 'No se pudo descargar el archivo de WhatsApp' };
      bytes = new Uint8Array(await bin.arrayBuffer());
    } else {
      // Messenger e Instagram dan una URL directa, pero temporal.
      if (!media.url) return { error: 'sin url' };
      const bin = await fetch(media.url);
      if (!bin.ok) return { error: 'No se pudo descargar el archivo' };
      mime = mime || bin.headers.get('content-type') || 'application/octet-stream';
      bytes = new Uint8Array(await bin.arrayBuffer());
    }

    if (!bytes?.length) return { error: 'archivo vacío' };
    if (bytes.length > TOPE_ENTRANTE) return { error: 'archivo demasiado grande' };

    const tipo = media.tipo || TIPO_POR_MIME(mime);
    const ext = EXT_POR_MIME[String(mime).split(';')[0].toLowerCase()] || 'bin';
    const azar = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const ruta = `${connection.user_id}/entrantes/${Date.now()}_${azar}.${ext}`;

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/inbox-adjuntos/${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': mime },
      body: bytes,
    });
    if (!up.ok) return { error: 'No se pudo guardar el archivo' };

    return {
      url: `${SUPABASE_URL}/storage/v1/object/public/inbox-adjuntos/${ruta}`,
      tipo, mime,
      nombre: nombre || `archivo.${ext}`,
    };
  } catch (e) {
    return { error: 'Error copiando el archivo: ' + (e?.message || 'desconocido') };
  }
}

// Lo que el agente lee cuando el mensaje es solo un archivo. Sin esto se le
// pasaría una cadena vacía y contestaría a ciegas, como si no hubiera llegado
// nada.
function textoDeAdjunto(adj, error) {
  if (error) return '(el contacto envió un archivo que no se pudo recibir)';
  const q = { image: 'una imagen', video: 'un video', audio: 'una nota de voz' }[adj?.tipo] || 'un archivo';
  return `(el contacto envió ${q}${adj?.nombre && adj.tipo === 'document' ? ': ' + adj.nombre : ''})`;
}

// ── Mensaje entrante ──────────────────────────────────────────────────────────
// send: (connection, contactId, texto) => Promise — lo pone el webhook del canal
// resolverNombre: (connection, contactId) => Promise<string|null> — lo pone el
// webhook del canal. Meta no manda el nombre en el evento, solo el id, así que
// sin esto el lead entra como "Contacto messenger" y el comercial recibe una
// ficha sin nombre.
// Aviso al responsable cuando su lead escribe y la conversación ya está en
// manos de una persona.
//
// Se reutiliza la campana que ya existe —una nota del lead con `metadata.para`—
// en vez de inventar una tabla de notificaciones: así el aviso sale en el mismo
// panel donde el comercial ya mira, y se marca como leído por el mismo camino.
//
// Uno por conversación hasta que lo lea: un cliente que escribe cinco mensajes
// seguidos es UNA cosa que atender, no cinco. Sin este freno la campana se
// llenaría de avisos del mismo lead y dejaría de leerse, que es como muere un
// sistema de avisos.
async function avisarAlResponsable(userId, conv, texto) {
  if (!conv?.lead_id) return;
  const lead = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${conv.lead_id}&select=id,name,assigned_to&limit=1`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
  // Sin responsable no hay a quién avisar, y al dueño de la cuenta no se le
  // avisa de cada mensaje: es el mismo criterio que en el reparto de leads.
  if (!lead?.assigned_to || lead.assigned_to === userId) return;

  const yaHay = await fetch(
    `${SUPABASE_URL}/rest/v1/lead_activities?lead_id=eq.${conv.lead_id}&type=eq.nota` +
    `&metadata->>para=eq.${encodeURIComponent(lead.assigned_to)}` +
    `&metadata->>motivo=eq.mensaje_entrante&metadata->>leida_at=is.null&select=id&limit=1`,
    { headers: sb() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  if (yaHay?.length) return;

  const recorte = String(texto || '').slice(0, 160);
  await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
    method: 'POST', headers: sb(),
    body: JSON.stringify({
      lead_id: conv.lead_id, user_id: userId, type: 'nota',
      content: `Te escribió por ${conv.channel || 'el inbox'}: «${recorte}»`,
      metadata: { sistema: true, para: lead.assigned_to, motivo: 'mensaje_entrante', actor: 'Acuarius' },
    }),
  }).catch(() => {});

  try {
    const { enviarPushA } = await import('./_push.js');
    await enviarPushA(lead.assigned_to, {
      titulo: (lead.name || 'Un contacto tuyo') + ' te escribió',
      texto: recorte,
      url: '/conversaciones?c=' + conv.id,
      // Una etiqueta por conversación: si llegan dos, el móvil reemplaza el
      // aviso en vez de apilar dos que dicen lo mismo.
      etiqueta: 'inbox-' + conv.id,
    });
  } catch (e) { console.error('[push] mensaje al responsable:', e?.message); }
}

// ¿Esta persona viene a OFRECERNOS su inmueble?
//
// Se mira lo que escribió ella, no lo que dedujo el modelo: es la fuente, y el
// enrutado puede no haberse decidido todavía en el primer mensaje.
export function quiereOfrecerInmueble(mensajes = []) {
  const suyo = (mensajes || []).filter(m => m?.role === 'user').map(m => String(m.content || '')).join(' ').toLowerCase();
  // «vender mi apartamento», «que me lo administren», «tengo un local para arrendar».
  return /(vender|arrendar|alquilar|administr\w+|promocionar|captar)\s+(mi|mis|nuestro|nuestra|su)\b/.test(suyo)
    || /\b(mi|nuestro)\s+(apartamento|casa|local|oficina|bodega|inmueble|propiedad|lote|finca)\b/.test(suyo)
    || /(quiero|quisiera|necesito|me ayudan|pueden)\s+(que\s+)?(me\s+)?(lo\s+)?(vend|arriend|alquil|administr|promocion)/.test(suyo)
    // «tengo un local para arrendar»: el inmueble es suyo aunque no diga «mi».
    || /\btengo (un|una|el|la|unos|unas)\s+[\wáéíóúñ]+.{0,40}?\bpara\s+(vender|arrendar|alquilar|administrar|promocionar)/.test(suyo);
}

// ¿Le estamos diciendo que no?
export function descartaAlContacto(texto) {
  const t = String(texto || '').toLowerCase();
  return /no (manejamos|trabajamos|atendemos|tenemos|se manejan|maneja)/.test(t)
    || /(no|fuera de)\s+(esta|está|estaría|estarían|entra|entran)\s+(dentro\s+)?(de\s+)?(nuestro|el)\s+portafolio/.test(t)
    || /normalmente no (est|entr)/.test(t)
    || /solo (manejamos|trabajamos) (con )?(vivienda|inmuebles|estratos)/.test(t);
}

// La pregunta del final, separada del resto del mensaje.
//
// Cuando el agente manda fotos, su texto sale ANTES de las imágenes: la persona
// ve tres o cuatro fotos y el último mensaje de la pantalla es una foto, así
// que la conversación se queda ahí parada. Lo dijo el cliente mirando sus
// propias pruebas: «después de enviarlas queda ahí y el usuario queda en el
// aire».
//
// Partiendo la última pregunta y mandándola detrás de las fotos, lo último que
// se lee vuelve a ser una pregunta. Solo se hace cuando hay fotos: en un
// mensaje normal partirlo en dos sería ruido.
export function partirPregunta(texto) {
  const t = String(texto || '').trimEnd();
  if (!t) return { cuerpo: '', pregunta: '' };
  const lineas = t.split('\n');
  const ultima = lineas[lineas.length - 1].trim();
  // Solo si de verdad es una pregunta y va suelta al final. Y no si es lo único
  // que hay: entonces no hay nada que partir.
  if (!/[?？]\s*$/.test(ultima) || lineas.length < 2 || !ultima) return { cuerpo: t, pregunta: '' };
  const cuerpo = lineas.slice(0, -1).join('\n').trimEnd();
  if (!cuerpo) return { cuerpo: t, pregunta: '' };
  return { cuerpo, pregunta: ultima };
}

export async function processIncoming({ channel, externalId, contactId, contactName, text, providerMessageId, send, escribiendo, resolverNombre, media, referral }) {
  // Un mensaje puede ser solo un archivo, sin una palabra. Exigir texto era lo
  // que hacía desaparecer las fotos que manda el cliente.
  if ((!text && !media) || !externalId || !contactId) return { ok: false, reason: 'payload incompleto' };

  const connection = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?channel=eq.${encodeURIComponent(channel)}&external_id=eq.${encodeURIComponent(externalId)}&is_active=eq.true&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).then(abrirConexion).catch(() => null);
  if (!connection) return { ok: false, reason: 'canal no conectado' };

  // Un canal puede atenderse de dos formas: con un agente que contesta solo, o
  // a mano desde el inbox. Sin agente —porque el canal se conecto sin uno o
  // porque esta desactivado— NO se descarta el mensaje: se guarda y se marca la
  // conversacion como humana. Antes se devolvia aqui mismo y el mensaje del
  // cliente se perdia entero: ni conversacion, ni aviso, ni rastro.
  const agent = connection.agent_id ? await fetch(
    `${SUPABASE_URL}/rest/v1/chat_agents?id=eq.${connection.agent_id}&is_active=eq.true&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).catch(() => null) : null;
  const aMano = !agent;

  // El cliente lo manda el CANAL. El del agente queda de respaldo para los
  // canales conectados antes de que existiera esta columna.
  const clienteDelCanal = connection.client_id || (agent ? agent.client_id : null) || null;

  // El archivo se copia ANTES de guardar el mensaje: así la burbuja nace ya con
  // su imagen y no aparece un mensaje vacío que luego cambia.
  let adjunto = null, adjuntoError = null;
  if (media) {
    const r = await espejarAdjunto(connection, media);
    if (r.error) adjuntoError = r.error; else adjunto = r;
  }
  // El texto para el agente y para la vista previa. El pie de foto manda si lo
  // hay; si no, se describe lo que llegó.
  const textoMensaje = text || textoDeAdjunto(adjunto, adjuntoError);
  const camposAdjunto = adjunto ? {
    adjunto_url: adjunto.url, adjunto_tipo: adjunto.tipo,
    adjunto_nombre: adjunto.nombre, adjunto_mime: adjunto.mime,
  } : {};

  const policy = await getPolicy(connection.user_id, channel);
  const reglaCal = connection.agent_id
    ? await getRegla(connection.user_id, connection.agent_id)
    : { activo: false };

  let conv = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_conversations?connection_id=eq.${connection.id}&contact_id=eq.${encodeURIComponent(contactId)}&select=*`,
    { headers: sb() }
  ).then(r => r.json()).then(r => r?.[0]).catch(() => null);

  if (!conv && !contactName && typeof resolverNombre === 'function') {
    contactName = await resolverNombre(connection, contactId).catch(() => null);
  }

  if (!conv) {
    conv = await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({
        user_id: connection.user_id,
        agent_id: connection.agent_id,
        connection_id: connection.id,
        channel,
        contact_id: contactId,
        contact_name: contactName || null,
        contact_phone: telefonoDelCanal(channel, contactId),
        status: aMano ? 'human' : 'bot',
        last_inbound_at: new Date().toISOString(),
        unread_count: 1,
        referral: referral || null,
      }),
    }).then(r => r.json()).then(r => r?.[0]).catch(() => null);
    if (!conv) return { ok: false, reason: 'no se pudo crear la conversación' };
    // Regla "siempre": el lead nace con la conversación, sin esperar datos
    if (policy.mode === 'always') {
      const leadId = await upsertLeadFromConversation(connection.user_id, clienteDelCanal, conv, {}, policy,
        reglaCal.activo, connection.pipeline_id || null).catch(() => null);
      if (leadId) conv.lead_id = leadId;
    }
  }

  // La conversación ya existía pero el anuncio llega ahora: alguien que escribió
  // antes y hoy vuelve por una pauta. Se guarda solo si no había nada.
  //
  // Es una decisión, no un descuido: la atribución se queda con el PRIMER
  // origen. Si se sobrescribiera, un contacto viejo que hoy pulsa un anuncio
  // haría desaparecer de dónde salió de verdad, y el reporte le daría el mérito
  // a la campaña equivocada.
  if (referral && !conv.referral) {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
      method: 'PATCH', headers: sb(), body: JSON.stringify({ referral }),
    }).catch(() => {});
    conv.referral = referral;
  }

  // A mano, o ya escalado a una persona: se guarda el mensaje y ahi acaba. El
  // comercial responde desde el inbox.
  if (aMano || conv.status === 'human') {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: textoMensaje, meta_message_id: providerMessageId, ...camposAdjunto }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
      method: 'PATCH', headers: sb(),
      body: JSON.stringify({
        last_message: textoMensaje.slice(0, 200),
        last_message_at: new Date().toISOString(),
        // La ventana de 24h se cuenta desde el mensaje del CLIENTE, no desde
        // el último mensaje a secas: si no, escribirle nosotros la reiniciaría.
        last_inbound_at: new Date().toISOString(),
        unread_count: (conv.unread_count || 0) + 1,
      }),
    });

    // El lead nace del bloque [CAPTURA] del agente, pero con la conversación ya
    // en manos de una persona el agente no vuelve a hablar. En WhatsApp da
    // igual: el contact_id ES el teléfono. En el chat web el visitante es
    // anónimo, así que si escala pronto y luego suelta su correo o su celular,
    // ese contacto se perdía entero. Aquí se rescata de lo que escribe él.
    const sueltos = datosDelTexto(textoMensaje);
    if (!conv.lead_id && Object.values(sueltos).some(Boolean)) {
      const nuevoLead = await upsertLeadFromConversation(
        connection.user_id, clienteDelCanal, conv, sueltos, policy, false,
        connection.pipeline_id || null
      ).catch(() => null);
      if (nuevoLead) conv.lead_id = nuevoLead;
    }

    // Y se le avisa al responsable. Sin esto la conversación se quedaba muda:
    // el agente ya no contesta porque está en manos de una persona, y esa
    // persona no se entera de que el cliente escribió salvo que entre al inbox
    // a mirar. Sube el contador de no leídos y se acabó.
    await avisarAlResponsable(connection.user_id, conv, textoMensaje).catch(() => {});

    return { ok: true, escalated: true, manual: aMano, conversationId: conv.id, leadId: conv.lead_id || null };
  }

  // Conversaciones creadas antes de tener el nombre: se rellena al vuelo
  if (conv && !conv.contact_name && typeof resolverNombre === 'function') {
    const n = await resolverNombre(connection, contactId).catch(() => null);
    if (n) {
      conv.contact_name = n;
      await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
        method: 'PATCH', headers: sb(), body: JSON.stringify({ contact_name: n }),
      }).catch(() => {});
    }
  }

  const msgRows = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { ...sb(), Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: textoMensaje, meta_message_id: providerMessageId, ...camposAdjunto }),
  }).then(r => r.json()).catch(() => null);
  if (!msgRows?.[0]) return { ok: true, duplicate: true, conversationId: conv.id };

  // La ventana de 24h se reinicia AQUI, con el mensaje del cliente. Sin esto,
  // una conversación atendida por el agente parecería caducada aunque el
  // cliente acabara de escribir.
  await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
    method: 'PATCH', headers: sb(),
    body: JSON.stringify({ last_inbound_at: new Date().toISOString() }),
  }).catch(() => {});

  // ── El cupo del mes ────────────────────────────────────────────────────────
  //
  // Si la cuenta agotó sus mensajes, el agente no contesta. Pero agotar el cupo
  // NO puede ser un silencio: el mensaje del cliente ya está guardado, la
  // conversación pasa a manos del equipo con su aviso, y al cliente se le dice
  // que le responde una persona. Un cliente que escribe y no recibe nada es un
  // lead perdido, y la culpa sería nuestra, no suya.
  //
  // Un fallo al consultar el cupo NO corta. Dejar mudo al agente de un cliente
  // que paga porque una consulta nuestra falló es mucho peor que dejar pasar
  // unos mensajes de más.
  const cupo = await estadoDeCupo(connection.user_id, { cacheado: true }).catch(() => ({ error: true }));
  if (cupo && !cupo.error && cupo.agotado) {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
      method: 'PATCH', headers: sb(),
      body: JSON.stringify({
        status: 'human',
        unread_count: (conv.unread_count || 0) + 1,
        last_message: textoMensaje.slice(0, 200),
        last_message_at: new Date().toISOString(),
      }),
    }).catch(() => {});

    // El aviso de cortesía sale UNA sola vez porque la conversación queda en
    // 'human': el siguiente mensaje entra por la rama de arriba y ya no llega
    // aquí. Es texto fijo, no cuesta un mensaje de agente.
    const cortes = agent?.tone === 'informal'
      ? 'Gracias por escribirnos. En un momento te responde una persona del equipo.'
      : 'Gracias por escribirnos. En un momento le responde una persona del equipo.';
    if (typeof send === 'function') {
      await send(connection, contactId, cortes).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
        method: 'POST', headers: sb(),
        body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: cortes }),
      }).catch(() => {});
    }

    await avisarAlResponsable(connection.user_id, conv, textoMensaje).catch(() => {});
    await avisarDelCupo(connection.user_id, cupo).catch(() => {});
    return { ok: true, cupoAgotado: true, conversationId: conv.id, leadId: conv.lead_id || null };
  }
  // Y si le queda poco, se le avisa a la cuenta antes de que se acabe.
  if (cupo && !cupo.error && cupo.avisar) await avisarDelCupo(connection.user_id, cupo).catch(() => {});

  const hist = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_messages?conversation_id=eq.${conv.id}&select=role,content,adjunto_url,adjunto_tipo,adjunto_mime&order=created_at.desc&limit=12`,
    { headers: sb() }
  ).then(r => r.json()).then(r => (r || []).reverse()).catch(() => []);

  const capturedData = extractCapturedData(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n'));
  // Pistas: lo que el agente ya dedujo. La operacion sale del enrutado; el resto,
  // de lo que haya capturado. Sin pistas se le pasan las primeras del inventario.
  const previas = extraerCalificacion(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n'));
  const delContacto = await pistasDelContacto(connection.user_id, clienteDelCanal, hist).catch(() => ({}));
  const inventario = await propiedadesParaPrompt(connection.user_id, clienteDelCanal,
    pistasDeBusqueda(capturedData, previas, delContacto)).catch(() => ({ lineas: [], total: 0 }));

  // Lo que el agente puede agendar, con sus próximos huecos. Si esto falla, el
  // agente contesta igual pero sin ofrecer citas —dirá que lo confirma un
  // asesor—: es preferible a no contestar. Y queda en el registro.
  const reservas = await reservasParaAgente(connection.user_id, clienteDelCanal).catch(async (e) => {
    await registrarError({ origen: 'inbox', donde: 'huecos para el agente', error: e, usuario: connection.user_id });
    return null;
  });
  // Las citas que YA tiene esta persona, para que pueda cancelarlas o
  // cambiarlas desde el chat. Solo las de SU contacto: el lead lo decide la
  // conversación, no nada que escriba el modelo.
  const suyas = conv.lead_id
    ? await citasDelContacto(connection.user_id, clienteDelCanal, conv.lead_id).catch(async (e) => {
        await registrarError({ origen: 'inbox', donde: 'citas del contacto', error: e, usuario: connection.user_id });
        return null;
      })
    : null;

  const system = partesDelPrompt(agent, { ...capturedData, ...(conv.contact_name ? { nombre: conv.contact_name } : {}) }, reglaCal, inventario, conv.channel || channel, conv.referral || null, reservas, suyas);
  // «Escribiendo…» antes de pensar.
  //
  // El modelo contesta en medio segundo y eso delata al bot más que cualquier
  // error de redacción: una persona tarda en leer y en teclear. El indicador se
  // manda ya —Meta lo mantiene hasta que respondemos, o 25 segundos— y el suelo
  // de tres segundos se cuenta desde aquí: si pensar ya costó cuatro, no se
  // añade nada.
  const empezoAPensar = Date.now();
  if (typeof escribiendo === 'function') {
    await escribiendo(connection, providerMessageId).catch(() => {});
  }

  let reply = await responderViendo(system, hist, [], { userId: connection.user_id, origen: 'whatsapp' });

  // ── El guardián ──────────────────────────────────────────────────────────
  // Si el agente citó un importe o un código que no está en ninguna parte, ese
  // mensaje NO sale. Se le da una oportunidad de corregirse con el fallo
  // señalado, y si vuelve a inventar se manda un texto seguro y lo coge una
  // persona.
  //
  // Esto es lo único que hace la regla irrompible: no depende de que el modelo
  // obedezca. Un precio inventado no se desmiente después, porque el contacto
  // ya lo leyó.
  // Y el trato: un agente en «usted» que tutea en el primer mensaje arrastra el
  // registro toda la conversación. Se comprueba aquí, por lo mismo que los
  // inventos: pedírselo mejor al modelo ya se intentó y no basta siempre.
  if (agent.tone === 'formal' && tutea(cleanForUser(reply))) {
    const deUsted = await responderViendo(system, hist, [
      { role: 'assistant', content: reply },
      { role: 'user', content: '(Aviso del sistema, no lo escribió el contacto) Tu mensaje anterior NO se envió: tuteaste, y este cliente pidió trato de usted. ' +
        'Escríbelo otra vez tratándole de USTED: «le ayudo», «cuénteme», «su presupuesto». Nada de «tú», «te», «tu» ni «ti». ' +
        'El contacto no vio nada y no te ha corregido: no te disculpes ni lo menciones, escribe el mensaje como si fuera el primero.' },
    ], { userId: connection.user_id, origen: 'whatsapp' }).catch(() => '');
    if (deUsted && !tutea(cleanForUser(deUsted))) reply = deUsted;
    await registrarError({
      origen: 'inbox', donde: 'el agente tuteó estando en usted',
      error: new Error('Tuteo en un agente formal'),
      usuario: connection.user_id,
      detalle: (deUsted && !tutea(cleanForUser(deUsted))) ? 'corregido al segundo intento' : 'NO se pudo corregir, salió tuteando',
    }).catch(() => {});
  }

  // Y no descartar a quien viene a OFRECERNOS un inmueble.
  //
  // Pedírselo al modelo no basta: el contexto del cliente dice «NO se manejan
  // estratos 1, 2 y 3» y el modelo lo trata como un hecho que debe contarle a
  // la persona, por encima de cualquier instrucción de estilo. Se comprobó
  // midiendo: con la regla escrita de tres formas distintas, siguió diciendo
  // «no está dentro de nuestro portafolio».
  //
  // Quien viene a ofrecernos algo es una oportunidad, y quien decide si encaja
  // es un asesor con el caso delante.
  if (quiereOfrecerInmueble(hist) && descartaAlContacto(cleanForUser(reply))) {
    const sinDescarte = await responderViendo(system, hist, [
      { role: 'assistant', content: reply },
      { role: 'user', content: '(Aviso del sistema, no lo escribió el contacto) Tu mensaje anterior NO se envió. ' +
        'Esta persona viene a ofrecernos su inmueble, y le has dicho que no encaja: eso no lo decides tú, lo decide el asesor con el caso delante. ' +
        'Escríbelo otra vez SIN ninguna mención a estratos, portafolio, zonas que no se manejan ni a que quizá no podamos ayudarle. ' +
        'Solo: toma nota de lo que te ha dicho, pídele lo que te falte del inmueble o su contacto, y sigue. ' +
        'El contacto no vio nada y no te ha corregido: no te disculpes ni lo menciones.' },
    ], { userId: connection.user_id, origen: 'whatsapp' }).catch(() => '');
    if (sinDescarte && !descartaAlContacto(cleanForUser(sinDescarte))) reply = sinDescarte;
    await registrarError({
      origen: 'inbox', donde: 'el agente descartó a quien ofrecía un inmueble',
      error: new Error('descarte en captación: ' + cleanForUser(reply).slice(0, 160)),
      usuario: connection.user_id,
    }).catch(() => {});
  }

  const citable = loQuePuedeCitar(agent, inventario, hist);
  let invento = inventos(cleanForUser(reply), citable);
  // Lo que se inventó la PRIMERA vez, para el registro. `invento` se vacía al
  // corregirse, y al escribirlo después quedaba la nota sin ningún dato: un
  // instrumento que no mide nada.
  const inventoOriginal = [...invento];
  let inventoForzado = false;
  if (invento.length) {
    const otra = await responderViendo(system, hist, [
      { role: 'assistant', content: reply },
      { role: 'user', content: '(Aviso del sistema, no lo escribió el contacto) Tu mensaje anterior NO se envió. Traía estos datos que no están en tu inventario ni en tu contexto: ' +
        invento.join(', ') + '. Eso es inventado y no se le puede decir a nadie.\n' +
        'Escribe otra vez ese mensaje usando SOLO lo que tienes delante. Si no tienes nada que encaje, dilo con naturalidad y ofrece pasar la conversación a un asesor añadiendo [ESCALAR] al final.\n' +
        'IMPORTANTE: el contacto no vio nada de esto y no te ha corregido. No empieces con «tienes razón», «disculpa» ni «me equivoqué»: quedaría pidiéndole perdón por algo que él no dijo. Escribe tu mensaje como si fuera el primero.' },
    ], { userId: connection.user_id, origen: 'whatsapp' }).catch(() => '');
    const segundo = otra ? inventos(cleanForUser(otra), citable) : ['sin respuesta'];
    if (otra && !segundo.length) {
      reply = otra;
      invento = [];
    } else {
      inventoForzado = true;
      reply = 'Déjeme confirmar eso con un asesor especializado y le respondemos enseguida. [ESCALAR]';
    }
    await registrarError({
      origen: 'inbox', donde: 'el agente se inventó datos',
      error: new Error('Datos que no están en el inventario: ' + inventoOriginal.join(', ')),
      usuario: connection.user_id,
      detalle: (inventoForzado ? 'NO se pudo corregir, se escaló' : 'corregido al segundo intento') +
        ' · inventario a la vista: ' + (inventario?.total ?? 0) +
        (segundo.length ? ' · al reintentar: ' + segundo.join(', ') : ''),
    }).catch(() => {});
  }

  // «Te estoy agendando, en un momento te llega la confirmación»… sin el
  // bloque. Pasó con Claude de verdad: la persona se quedaría esperando una
  // confirmación que nunca sale. Se le pide al modelo UNA vez que lo escriba;
  // si tampoco, la conversación pasa a una persona (más abajo).
  let promesaSinBloque = false;
  if ((reservas || suyas) && !reply.includes('[ESCALAR]') && prometeAccion(cleanForUser(reply)) && !traeBloqueDeCita(reply) && !pideConfirmacion(cleanForUser(reply))) {
    const otra = await responderViendo(system, hist, [
      { role: 'assistant', content: reply },
      { role: 'user', content: '(Aviso del sistema, no lo escribió el contacto) En tu mensaje anterior dijiste que estabas haciendo la cita, pero no escribiste el bloque, así que no se hizo nada. Repite tu mensaje y añade al final el bloque [RESERVA], [CAMBIAR_CITA] o [CANCELAR_CITA] que corresponde. Si en realidad la persona todavía no te ha dicho que sí, reescríbelo como pregunta.' },
    ], { userId: connection.user_id, origen: 'whatsapp' }).catch(() => '');
    if (otra && (traeBloqueDeCita(otra) || pideConfirmacion(cleanForUser(otra)))) reply = otra;
    else {
      promesaSinBloque = true;
      await registrarError({ origen: 'inbox', donde: 'cita prometida sin bloque', error: new Error('El agente anunció una cita sin escribir el bloque'),
        usuario: connection.user_id, detalle: cleanForUser(reply).slice(0, 400) });
    }
  }

  // ── La cita, si el agente la pidió ──────────────────────────────────────
  // Se ejecuta ANTES de guardar y enviar su mensaje, porque de lo que pase
  // depende qué se envía: si la hora ya no está libre, el «te agendo» del
  // agente no puede salir.
  let guardado = reply;            // lo que queda en el historial
  let visible = cleanForUser(reply);
  let confirmacionCita = null;
  let escalarPorReserva = false;
  // Si el mismo mensaje pregunta «¿te parece bien?», la persona aún no ha
  // dicho que sí: no se agenda. En su «sí» el agente volverá a pedirla.
  const conSi = !pideConfirmacion(cleanForUser(reply));
  // Una sola acción por mensaje. Cancelar o cambiar va antes que reservar: si
  // el modelo mezclara las dos, lo que la persona tenía es lo que manda.
  const pedidoCambio = suyas && conSi ? extraerCambio(reply) : null;
  const pedidoCita = !pedidoCambio && reservas && conSi ? extraerReserva(reply) : null;
  if (pedidoCambio) {
    const r = await ejecutarCambio({ suyas, info: reservas, pedido: pedidoCambio })
      .catch(async (e) => {
        await registrarError({ origen: 'inbox', donde: 'cambio de cita del agente', error: e, usuario: connection.user_id });
        return { ok: false, texto: 'No pude hacer ese cambio por un problema de nuestro lado. Tu cita sigue como estaba; ya le aviso a un asesor.', escalar: true };
      });
    if (r.ok) {
      confirmacionCita = r.texto;
      if (r.cerrar) await r.cerrar;
    } else {
      visible = r.texto;
      guardado = r.texto + '\n' + bloquesOcultos(reply);
      escalarPorReserva = !!r.escalar;
    }
  }
  if (pedidoCita) {
    const captura = { ...capturedData, ...extractCapturedData(reply) };
    const contacto = {
      nombre: pedidoCita.nombre || captura.nombre || conv.contact_name || '',
      telefono: telefonoDelCanal(conv.channel || channel, contactId) || captura.celular || '',
      correo: captura.email || '',
    };
    // La cita se cuelga del contacto de ESTA conversación. Si todavía no
    // existe, nace ahora aunque el canal esperase: quien agenda ya dio todo.
    if (!conv.lead_id) {
      const nuevo = await upsertLeadFromConversation(
        connection.user_id, clienteDelCanal, conv,
        { nombre: contacto.nombre, celular: contacto.telefono, email: contacto.correo },
        { ...policy, mode: 'always' }, false, connection.pipeline_id || null
      ).catch(() => null);
      if (nuevo) conv.lead_id = nuevo;
    }
    const r = await ejecutarReserva({ info: reservas, pedido: pedidoCita, contacto, leadId: conv.lead_id || null })
      .catch(async (e) => {
        await registrarError({ origen: 'inbox', donde: 'reserva del agente', error: e, usuario: connection.user_id });
        return { ok: false, texto: 'No pude agendarla por un problema de nuestro lado. Ya le aviso a un asesor para que te la confirme.', escalar: true };
      });
    if (r.ok) {
      confirmacionCita = r.texto;
      if (r.cerrar) await r.cerrar;
    } else {
      // El texto del agente se cambia; sus bloques ocultos se conservan, que
      // son lo que el motor relee en el siguiente mensaje.
      visible = r.texto;
      guardado = r.texto + '\n' + bloquesOcultos(reply);
      escalarPorReserva = !!r.escalar;
    }
  }

  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: sb(),
    // OJO: se guarda la respuesta EN BRUTO, con sus bloques ocultos. No es
    // descuido: el motor relee esos bloques del historial para acumular lo
    // capturado y lo calificado entre mensajes. Limpiar aquí haría que la
    // conversación se quedara 'pendiente' para siempre. Se limpia al MOSTRAR,
    // en el inbox.
    body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: guardado }),
  });
  // La confirmación va como mensaje aparte, también en el historial: así el
  // inbox la enseña y el agente sabe en el siguiente turno que ya quedó.
  if (confirmacionCita) {
    await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST', headers: sb(),
      body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: confirmacionCita }),
    });
  }

  // Las respuestas se acumulan: cada mensaje del agente aporta las nuevas y las
  // anteriores siguen valiendo.
  const respuestas = {
    ...extraerCalificacion(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n')),
    ...extraerCalificacion(reply),
  };
  const veredicto = evaluar(reglaCal, respuestas);

  // Pedir un humano siempre manda: si alguien lo pide, lo pide. Y un lead que
  // califica pasa al comercial, que es justo el objetivo de calificar.
  // Si prometió una cita sin hacerla, que la confirme una persona: es mejor que
  // la conversación le llegue a alguien que dejar al cliente esperando.
  const needsEscalation = reply.includes('[ESCALAR]') || escalarPorReserva || promesaSinBloque
    || (veredicto.estado === 'calificado' && reglaCal.al_calificar.escalar);
  await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
    method: 'PATCH', headers: sb(),
    body: JSON.stringify({
      // last_inbound_at NO se toca aquí: esto es nuestra respuesta. Se fijó al
    // guardar el mensaje del cliente, unas líneas más arriba.
    last_message: (confirmacionCita || visible).slice(0, 200),
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      ...(needsEscalation ? { status: 'human' } : {}),
    }),
  });

  const newCapture = extractCapturedData(reply);
  let leadId = conv.lead_id || null;
  // Un lead que califica entra al pipeline aunque la regla del canal fuese
  // 'manual': no tiene sentido calificarlo y dejarlo fuera del CRM.
  const politicaEfectiva = veredicto.estado === 'calificado'
    ? { ...policy, mode: 'always', stage: reglaCal.al_calificar.etapa || policy.stage }
    : policy;
  if (Object.values(newCapture).some(v => v) || veredicto.estado === 'calificado') {
    leadId = await upsertLeadFromConversation(
      connection.user_id, clienteDelCanal, conv, newCapture, politicaEfectiva,
      // Esperar al veredicto TAMBIÉN cuando hay enrutado, aunque el lead ya
      // venga calificado en este mismo mensaje.
      //
      // Si no, la regla de la fuente asigna primero y gana siempre: en una
      // conversación corta el lead se crea ya calificado, se repartía entre
      // TODO el equipo y le tocaba a quien no atiende ese tablero. Luego el
      // reparto por tablero no podía corregirlo sin quitárselo a alguien, que
      // es peor. Lo vimos con un lead de prueba: cayó en Arriendo y se lo
      // llevó una administradora que no lleva arriendos.
      //
      // Quien decide entonces es `aplicarVeredicto`, que si no encuentra a
      // nadie marcado para ese tablero cae en la regla de la fuente de todas
      // formas. El lead nunca se queda sin dueño.
      reglaCal.activo && (reglaCal.enrutado?.activo || veredicto.estado !== 'calificado'),
      connection.pipeline_id || null
    ).catch(() => leadId);
  }

  if (reglaCal.activo && leadId && (veredicto.estado === 'calificado' || veredicto.estado === 'descartado')) {
    const lead = await aplicarVeredicto({
      userId: connection.user_id, leadId, regla: reglaCal, veredicto, respuestas, canal: channel,
    });
    // Si califica y todavía no tiene dueño, se reparte ahora: el aviso al
    // comercial es lo que hace que la calificación sirva de algo.
    if (veredicto.estado === 'calificado' && lead && !lead.assigned_to) {
      await asignarLead(connection.user_id, lead, channel).catch(() => {});
    }
  }

  if (typeof send === 'function') {
    // El suelo de tres segundos se aplica UNA vez, antes del primer mensaje.
    // La confirmación de la cita sale detrás sin más espera: son dos mensajes
    // seguidos de la misma persona, que es como escribe la gente.
    const faltan = ESCRIBIENDO_MIN_MS - (Date.now() - empezoAPensar);
    if (faltan > 0) await new Promise(r => setTimeout(r, faltan));
    const fotos = await fotosPedidas(reply, connection.user_id, clienteDelCanal).catch(() => []);
    // Con fotos, la pregunta final viaja detrás de ellas: si no, lo último que
    // ve la persona es una imagen y la conversación se queda parada ahí.
    const { cuerpo, pregunta } = fotos.length ? partirPregunta(visible) : { cuerpo: visible, pregunta: '' };

    if (cuerpo) {
      try { await send(connection, contactId, cuerpo); } catch (e) { console.error('send error', e); }
      // Ese mensaje ya está gastado. Se suma al vuelo porque el conteo se
      // cachea un minuto: sin esto, una ráfaga de mensajes seguidos seguiría
      // viendo el número de hace un rato y el corte llegaría tarde.
      sumarUno(connection.user_id);
    }
    // Si el envío de una falla, se sigue con las demás: media galería es mejor
    // que ninguna, y el texto ya salió.
    for (const url of fotos) {
      try { await send(connection, contactId, '', { tipo: 'image', url }); }
      catch (e) { console.error('foto no enviada', e); }
    }
    // La pregunta no cuenta como mensaje aparte del cupo: es el mismo mensaje
    // del agente, partido para que se lea en el orden correcto.
    if (pregunta) {
      try { await send(connection, contactId, pregunta); } catch (e) { console.error('send error', e); }
    }
    if (confirmacionCita) {
      try { await send(connection, contactId, confirmacionCita); } catch (e) { console.error('send error', e); }
    }
  }

  return { ok: true, conversationId: conv.id, leadId, reply: visible, cita: confirmacionCita, escalated: needsEscalation, calificacion: veredicto };
}
