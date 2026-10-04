// api/_agente-voz.js — el agente de voz (módulo extra de pago).
//
// No confundir con api/voz.js, que es el «CRM por voz» (dictarle al CRM).
// Esto es un agente que CONTESTA LLAMADAS en nombre del negocio.
//
// Cómo está montado (decisión del 03-10-2026, infraestructura propia):
//   número colombiano (Telnyx) → SIP → LiveKit → nuestro worker (voz-agente/)
//   con Deepgram (oído), Claude Haiku (cerebro) y Cartesia (voz).
// El worker vive fuera de Vercel —una llamada dura minutos y Vercel corta las
// funciones mucho antes— y le pregunta a api/agente-voz.js todo lo que es del
// negocio: quién es, qué instrucciones tiene, si le quedan minutos, y ejecuta
// por aquí sus herramientas (guardar el lead, buscar inmuebles, agendar). Así
// las reglas viven en un solo sitio y el worker no toca la base.
//
// Se cobra por MINUTO O FRACCIÓN: cada llamada se redondea al minuto siguiente
// (una de 2:10 son 3). Lo decidió Alejandro: es lo más fácil de entender y en
// Colombia la gente ya lo conoce de los planes de celular.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Precios aprobados el 03-10-2026 (USD al mes). El número colombiano va
// incluido. Nunca «ilimitado»: cada minuto nos cuesta.
export const PLANES_VOZ = [
  { id: 'inicial', nombre: 'Inicial', usd: 79, minutos: 300 },
  { id: 'crecimiento', nombre: 'Crecimiento', usd: 199, minutos: 900 },
  { id: 'pro', nombre: 'Pro', usd: 399, minutos: 2000 },
];
export const USD_MINUTO_EXTRA = 0.25;

// Lo que nos cuesta un minuto, para medir el margen de cada llamada. Es una
// estimación (Telnyx en Colombia aún sin confirmar); se corrige con lo real.
export const COSTO_MINUTO_USD = 0.08;

export const PROPOSITOS = ['recepcion', 'calificacion'];

const H = () => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` });

/** ¿La cuenta ve el módulo? En beta: AGENTE_VOZ_BETA (ids separados por coma) o todas con AGENTE_VOZ_ACTIVO=1. */
export function agenteVozActivo(cuentaId) {
  if (process.env.AGENTE_VOZ_ACTIVO === '1') return true;
  return String(process.env.AGENTE_VOZ_BETA || '').split(',').map(x => x.trim()).filter(Boolean).includes(cuentaId);
}

/** Minuto o fracción. Una llamada que no llegó a conectar (0 s) no se cobra. */
export function minutosCobrados(segundos) {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  return s === 0 ? 0 : Math.ceil(s / 60);
}

/** Lo que nos costó, con los segundos reales (el redondeo es margen, no costo). */
export function costoEstimado(segundos) {
  return Math.round(Math.max(0, Number(segundos) || 0) / 60 * COSTO_MINUTO_USD * 10000) / 10000;
}

/** Número en dígitos, como lo guarda agentes_voz.numero (573001234567). */
export function normalizarNumero(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('3')) d = '57' + d;
  return d.length >= 8 ? d : null;
}

// ── Saldo de minutos ────────────────────────────────────────────────────────
export async function saldoMinutos(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/minutos_voz_saldo`, { method: 'POST', headers: H(), body: JSON.stringify({ p_user: userId }) });
  if (!r.ok) throw new Error('No se pudo leer el saldo de minutos (' + r.status + ')');
  return Number(await r.json()) || 0;
}

/** Descuenta una llamada una sola vez (la referencia es la llamada). */
export async function cobrarLlamada(userId, llamadaId, minutos, detalle = null) {
  if (!minutos) return { nuevo: false };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/minutos_voz?on_conflict=motivo,referencia`, {
    method: 'POST', headers: { ...H(), Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, cantidad: -minutos, motivo: 'llamada', referencia: String(llamadaId), detalle }),
  });
  if (!r.ok) throw new Error('No se pudo descontar la llamada: ' + (await r.text()).slice(0, 200));
  return { nuevo: (await r.json()).length > 0 };
}

// ── El worker ───────────────────────────────────────────────────────────────
/** El worker se identifica con AGENTE_VOZ_SECRETO. Comparación de tiempo constante. */
export function esElWorker(req) {
  const esperado = process.env.AGENTE_VOZ_SECRETO || '';
  const dado = req.headers.get('x-agente-voz') || '';
  if (!esperado || dado.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ dado.charCodeAt(i);
  return dif === 0;
}

// ── Token de LiveKit (para la llamada de prueba desde el navegador) ─────────
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlTexto = (t) => b64url(new TextEncoder().encode(t));

/**
 * JWT de acceso a una sala, firmado con LIVEKIT_API_SECRET (HS256, WebCrypto:
 * sin dependencias, como el resto del proyecto). `agente` despacha nuestro
 * worker a la sala en cuanto la persona entra, con la metadata que lleva.
 */
export async function tokenLiveKit({ identidad, nombre, sala, agente, metadata, segundos = 600 }) {
  const key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw new Error('Falta configurar LiveKit (LIVEKIT_API_KEY / LIVEKIT_API_SECRET)');
  const ahora = Math.floor(Date.now() / 1000);
  const claims = {
    iss: key, sub: identidad, nbf: ahora, exp: ahora + segundos, name: nombre || identidad,
    video: { room: sala, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    ...(agente ? { roomConfig: { agents: [{ agentName: agente, metadata: metadata || '' }] } } : {}),
  };
  const cuerpo = b64urlTexto(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64urlTexto(JSON.stringify(claims));
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(cuerpo)));
  return cuerpo + '.' + b64url(firma);
}

export const NOMBRE_WORKER = 'acuarius-voz';

// ── Las instrucciones ───────────────────────────────────────────────────────
// Hablar no es escribir. Lo que en el chat es un buen mensaje, dicho en voz
// alta es un discurso que nadie aguanta: por eso las reglas de brevedad y de
// turnos van PRIMERO. Lo vio Alejandro en la prueba de un competidor: frases
// cortadas y «audio no reconocido» cuando el agente no sabe ceder el turno.
const REGLAS_DE_VOZ = `CÓMO HABLAS (esto es una llamada telefónica, no un chat):
- Frases cortas: una idea por frase, como mucho dos frases por turno. Si hay más que decir, dilo en varios turnos.
- Una sola pregunta por turno.
- Nunca leas listas, viñetas, enlaces, correos letra por letra ni símbolos. Di los precios en palabras naturales («un millón ochocientos mil pesos»).
- Si la persona empieza a hablar mientras hablas, cállate y escúchala. Nunca digas «déjame terminar».
- Si no entendiste, pide que lo repita con naturalidad («perdona, se cortó, ¿me repites?»).
- Confirma en voz alta solo lo importante: nombre, día y hora de una cita, un número.
- No inventes nada: precios, inmuebles, horarios ni disponibilidad que no te haya dado una herramienta o este texto.
- Si te piden algo que no puedes resolver o quieren hablar con una persona, usa la herramienta pasar_a_asesor.
- Cuando la conversación termine, despídete en una frase y usa la herramienta colgar.`;

const OBJETIVO = {
  recepcion: 'Atiendes las llamadas que entran al negocio: resuelves dudas, tomas los datos de quien llama y, si quiere, le agendas una cita.',
  calificacion: 'Calificas a quien llama: entiendes qué busca, su presupuesto y su urgencia, guardas sus datos y le ofreces el siguiente paso (una cita o que lo llame un asesor).',
};

/**
 * Las instrucciones completas del agente. Todo lo que es del negocio llega
 * ya leído (quién es, su catálogo, sus citas): esta función no toca la base,
 * así se prueba sin red.
 */
export function instruccionesDeVoz({ agente, negocio, ahora = '', conocido = null, hayCatalogo = false, citas = '', tratamiento = '' }) {
  const partes = [
    `Eres ${agente.nombre || 'el asistente'}, el asistente telefónico de ${negocio || 'este negocio'}. Hablas en español de Colombia, con calidez y naturalidad.`,
    OBJETIVO[agente.proposito] || OBJETIVO.recepcion,
    tratamiento,
    REGLAS_DE_VOZ,
    ahora,
  ];
  if (conocido) {
    partes.push(`QUIEN LLAMA YA ESTÁ EN EL CRM: ${conocido}. Salúdalo por su nombre y no le pidas datos que ya tienes.`);
  } else {
    partes.push('Quien llama no está en el CRM todavía. Pide su nombre con naturalidad y guárdalo con guardar_datos en cuanto lo tengas. El número de teléfono ya lo tienes: no lo pidas.');
  }
  if (hayCatalogo) partes.push('Tienes un catálogo de inmuebles: cuando la persona diga qué busca, usa buscar_inmuebles y menciona como mucho dos opciones por turno, con lo esencial.');
  if (citas) partes.push(citas);
  if (agente.instrucciones) partes.push('INDICACIONES DEL NEGOCIO:\n' + String(agente.instrucciones).slice(0, 4000));
  return partes.filter(Boolean).join('\n\n');
}

/** El saludo con el que arranca la llamada. */
export function saludoDe(agente, negocio, conocidoNombre = null) {
  if (agente.saludo) {
    // Sin nombre conocido se quita la variable CON su coma: «Buenas, {{nombre}},
    // gracias» queda «Buenas, gracias» y no «Buenas, , gracias».
    const s = String(agente.saludo);
    return (conocidoNombre ? s.replace(/\{\{\s*nombre\s*\}\}/gi, conocidoNombre) : s.replace(/,?\s*\{\{\s*nombre\s*\}\}/gi, '')).replace(/\s{2,}/g, ' ').trim();
  }
  return conocidoNombre
    ? `Hola ${conocidoNombre}, te habla ${agente.nombre || 'el asistente'} de ${negocio}. ¿En qué te ayudo?`
    : `Hola, te habla ${agente.nombre || 'el asistente'} de ${negocio}. ¿En qué te puedo ayudar?`;
}

/** Las citas que puede agendar, dichas para una llamada (sin el bloque [RESERVA] del chat). */
export function bloqueCitasVoz(info) {
  if (!info || !info.servicios?.length) return '';
  const lineas = info.servicios.map(s =>
    `- ${s.nombre} (clave ${s.clave}, ${s.minutos} min): ` +
    (s.huecos.length ? s.huecos.slice(0, 3).map(h => `${h.dia} a las ${h.horas.slice(0, 4).join(', ')}`).join('; ') : 'sin huecos próximos'));
  return `PUEDES AGENDAR CITAS con la herramienta agendar_cita. Hoy es ${info.hoy}. Servicios y algunas horas libres:
${lineas.join('\n')}
Ofrece como mucho dos horas por turno. Antes de agendar, confirma servicio, día y hora en una frase y espera el sí. Usa la clave del servicio, el día en formato AAAA-MM-DD y la hora en HH:MM.`;
}

// Las herramientas que el worker le ofrece al modelo. El worker las declara
// con sus parámetros; aquí está la lista de las que este servidor ejecuta,
// para que pruebas/agente-voz.mjs vigile que no se separen.
export const HERRAMIENTAS_SERVIDOR = ['guardar_datos', 'buscar_inmuebles', 'agendar_cita', 'pasar_a_asesor'];
