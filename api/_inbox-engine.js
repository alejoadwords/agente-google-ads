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
import { pautaDeReferral } from './_lead-intake.js';
import { registrarUso } from './_uso-ia.js';
import { abrirConexion, cifrar } from './_cifrado.js';

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
    // Si la respuesta se cortó a mitad de un bloque, fuera igual
    .replace(/\[(CAPTURA|CALIFICACION|ESCALAR)\b[\s\S]*$/, '')
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
  const match = String(text || '').match(/\[CAPTURA:\s*(\{.*?\})\]/s);
  if (!match) return {};
  try { return JSON.parse(match[1]); } catch { return {}; }
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
    `precio_arriendo,precio_venta,administracion,url&limit=${TOPE_PROPIEDADES}`;

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
      '&select=ciudad,barrio',
      { headers: sb() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    const ciudades = new Map();
    const barrios = new Map();
    for (const f of filas || []) {
      if (f.ciudad) ciudades.set(sinTildes(f.ciudad), f.ciudad);
      if (f.barrio) barrios.set(sinTildes(f.barrio), f.barrio);
    }
    return { ciudades, barrios };
  } catch { return { ciudades: new Map(), barrios: new Map() }; }
}

// El nombre más largo que aparezca en el texto. El más largo y no el primero
// porque «Alto Prado» contiene «Prado»: con el primero, quien pide Alto Prado
// acabaría viendo El Prado.
function nombreEnTexto(texto, mapa) {
  const t = sinTildes(texto);
  let mejor = null;
  for (const [clave, original] of mapa) {
    if (clave.length < 4) continue;
    if (!new RegExp('(^|[^a-z0-9])' + clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(t)) continue;
    if (!mejor || clave.length > mejor.clave.length) mejor = { clave, original };
  }
  return mejor?.original || null;
}

// Cuántas habitaciones pidió: «3 habitaciones», «de 3 alcobas», «3 hab».
export function habitacionesDelTexto(texto) {
  const t = sinTildes(texto);
  const m = t.match(/(\d{1,2})\s*(habitacion|habitaciones|alcoba|alcobas|cuarto|cuartos|dormitorio|dormitorios|hab\b|alc\b)/);
  const n = m ? parseInt(m[1], 10) : null;
  return n > 0 && n <= 20 ? n : null;
}

// Cuánto dijo que podía pagar. Solo si la frase habla de dinero: un «3
// habitaciones» suelto no es un presupuesto, y un código de inmueble tampoco.
export function presupuestoDelTexto(texto) {
  const t = sinTildes(texto);
  // Las frases se cortan por punto y coma, salto de línea o punto SEGUIDO DE
  // ESPACIO. Cortando por cualquier punto, «$4.000.000» se partía en tres y el
  // presupuesto desaparecía.
  const frases = t.split(/[;\n]|\.\s+/)
    .filter(f => /\$|millon|millones|mil\b|presupuesto|pagar|canon|mensual|maximo|hasta/.test(f));
  for (const f of frases) {
    // Una frase que habla de habitaciones no habla de plata.
    if (/habitacion|alcoba|cuarto|dormitorio|bano/.test(f)) continue;
    const v = aPlata(f);
    if (v) return v;
  }
  return null;
}

export async function pistasDelContacto(userId, clientId, mensajes = []) {
  const texto = (mensajes || [])
    .filter(m => m && m.role === 'user')
    .map(m => String(m.content || ''))
    .join(' \n ');
  if (!texto.trim()) return {};
  const { ciudades, barrios } = await zonasDelCliente(userId, clientId);
  return {
    ciudad: nombreEnTexto(texto, ciudades),
    barrio: nombreEnTexto(texto, barrios),
    presupuesto: presupuestoDelTexto(texto),
    habitaciones: habitacionesDelTexto(texto),
  };
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
  const conUnidad = t.match(/(\d+(?:[.,]\d+)?)\s*(millon|millón|millones|mill|m\b|mm\b|mil\b|k\b)/);
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

export function buildSystemPrompt(agent, capturedData, reglaCalificacion = null, propiedades = null, canal = 'whatsapp', referral = null) {
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
- Para conseguir su contacto (${(agent.capture_fields || ['nombre', 'celular']).join(', ')}), hazlo dentro del flujo natural, no como formulario
- Si alguien quiere hablar con una persona real, responde: "${agent.escalate_phrase || 'Claro, en un momento te comunico con un asesor. ¿Me das un segundo?'}" y en ese caso incluye [ESCALAR] al final de tu mensaje
- Nunca seas agresivo ni insistente con la venta

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

SI TE MANDAN UN PDF:
- Lo lees. Usa lo que dice para responder: si trae un pago, una cedula, un certificado o una ficha, dilo con sus datos
- Si el PDF no trae lo que hacia falta, di que falta y que se necesita

SI TE MANDAN UNA FOTO:
- La ves. Comenta lo que hay en ella con naturalidad, sin decir "veo una imagen"
- Que se parezca a algo del listado NO significa que sea eso. No afirmes que es una propiedad concreta salvo que te lo diga la persona; si crees reconocerla, preguntale
- Si la foto no se entiende o no tiene que ver, dilo con amabilidad y pide lo que necesitas

${bloqueDeAnuncio(referral)}DATOS CAPTURADOS HASTA AHORA:
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

// Devuelve el texto y, aparte, lo que consumió. El uso se registra donde se
// sabe de quién es la conversación; aquí solo se recoge.
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
      system: systemPrompt,
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
  const system = buildSystemPrompt(
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

  const system = buildSystemPrompt(agent, capturado, regla, inventario, canal, null);

  let bruto;
  try {
    bruto = await responderViendo(system, limpios, [], { userId, origen });
  } catch (e) {
    return { ok: false, error: 'No se pudo consultar al agente: ' + (e?.message || 'error desconocido') };
  }
  const texto = cleanForUser(bruto).trim();
  if (!texto) return { ok: false, error: 'El agente no devolvió texto. Suele ser el presupuesto de tokens: reintenta.' };

  const respuestas = { ...previas, ...extraerCalificacion(bruto) };
  const veredicto = evaluar(regla, respuestas);
  const nuevo = extractCapturedData(bruto);
  const ruta = respuestas._ruta || null;
  const destino = ruta ? (regla?.enrutado?.rutas || []).find(r => r.clave === ruta) || null : null;
  // Cuántos atienden ese tablero: es lo que decide si el lead tendría dueño.
  const porTurnos = destino?.pipeline_id
    ? (await asesoresDelTablero(userId, destino.pipeline_id).catch(() => [])).length
    : 0;

  return {
    ok: true,
    texto,
    // En bruto para que el navegador lo devuelva tal cual en el siguiente turno.
    bruto,
    capturado: { ...capturado, ...nuevo },
    escalar: bruto.includes('[ESCALAR]'),
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
export async function processIncoming({ channel, externalId, contactId, contactName, text, providerMessageId, send, resolverNombre, media, referral }) {
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

  const reply = await responderViendo(
    buildSystemPrompt(agent, { ...capturedData, ...(conv.contact_name ? { nombre: conv.contact_name } : {}) }, reglaCal, inventario, conv.channel || channel, conv.referral || null),
    hist, [], { userId: connection.user_id, origen: 'whatsapp' }
  );

  await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST', headers: sb(),
    // OJO: se guarda la respuesta EN BRUTO, con sus bloques ocultos. No es
    // descuido: el motor relee esos bloques del historial para acumular lo
    // capturado y lo calificado entre mensajes. Limpiar aquí haría que la
    // conversación se quedara 'pendiente' para siempre. Se limpia al MOSTRAR,
    // en el inbox.
    body: JSON.stringify({ conversation_id: conv.id, role: 'assistant', content: reply }),
  });

  // Las respuestas se acumulan: cada mensaje del agente aporta las nuevas y las
  // anteriores siguen valiendo.
  const respuestas = {
    ...extraerCalificacion(hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n')),
    ...extraerCalificacion(reply),
  };
  const veredicto = evaluar(reglaCal, respuestas);

  // Pedir un humano siempre manda: si alguien lo pide, lo pide. Y un lead que
  // califica pasa al comercial, que es justo el objetivo de calificar.
  const needsEscalation = reply.includes('[ESCALAR]')
    || (veredicto.estado === 'calificado' && reglaCal.al_calificar.escalar);
  await fetch(`${SUPABASE_URL}/rest/v1/chat_conversations?id=eq.${conv.id}`, {
    method: 'PATCH', headers: sb(),
    body: JSON.stringify({
      // last_inbound_at NO se toca aquí: esto es nuestra respuesta. Se fijó al
    // guardar el mensaje del cliente, unas líneas más arriba.
    last_message: cleanForUser(reply).slice(0, 200),
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
    try { await send(connection, contactId, cleanForUser(reply)); } catch (e) { console.error('send error', e); }
  }

  return { ok: true, conversationId: conv.id, leadId, reply: cleanForUser(reply), escalated: needsEscalation, calificacion: veredicto };
}
