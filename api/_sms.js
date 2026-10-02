// api/_sms.js — mensajes de texto (SMS) a móviles de Colombia.
//
// Lo usan las campañas, las automatizaciones y la pantalla de saldo. Todo lo
// que decide si un SMS sale vive AQUÍ y no en cada motor, para que ninguno se
// salte una regla por olvido:
//
//   · el saldo: créditos comprados por paquetes, en un libro de movimientos
//     (sms_movimientos). Se reserva ANTES de enviar con sms_reservar(), que
//     bloquea por cuenta: dos envíos a la vez no gastan el mismo crédito. Si
//     el proveedor rechaza el mensaje, sms_devolver() los devuelve;
//   · el horario: la Ley 2300 de 2023 limita el contacto comercial a lunes a
//     viernes de 7:00 a 19:00 y sábados de 8:00 a 15:00, nunca domingos ni
//     festivos. Fuera de ahí no sale nada; el motor espera al siguiente hueco;
//   · la baja: quien tiene la etiqueta `no-sms` no recibe más;
//   · el RNE de la CRC: quien inscribió su móvil para no recibir SMS
//     comerciales no los recibe de nadie (ver _rne.js);
//   · el costo: un SMS con á, í, ó o ú pasa a Unicode y cabe en 70 caracteres
//     en vez de 160. Esas tildes se cambian por su letra sin tilde (la ñ se
//     queda: sí cabe) para que un mensaje normal no cueste el doble.
//
// Proveedor: LabsMobile (api.labsmobile.com). Sin credenciales en el entorno
// funciona en modo SIMULADO: reserva y descuenta igual, pero no manda nada y
// el envío queda como «simulado». Así se prueba el circuito completo sin
// proveedor, y nadie cree que se envió algo que no salió.
//
// El guion bajo evita que Vercel lo publique como endpoint.

import { consultarRne, aDiezDigitos } from './_rne.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TZ_OFFSET_H = -5; // Bogotá no tiene horario de verano

export const ETIQUETA_BAJA = 'no-sms';

// Los paquetes que se venden. Los créditos se suman y no vencen: quien
// necesita 4.000 compra 3.000 + 1.000.
export const PAQUETES = [
  { creditos: 1000, usd: 8 },
  { creditos: 3000, usd: 22 },
  { creditos: 5000, usd: 35 },
  { creditos: 7000, usd: 47 },
  { creditos: 10000, usd: 65 },
  { creditos: 15000, usd: 90 },
  { creditos: 20000, usd: 110 },
];

/**
 * ¿Esta cuenta ve y usa el módulo? Mientras LabsMobile no esté contratado, solo
 * las cuentas de SMS_BETA (ids de Clerk separados por coma); SMS_ACTIVO=1 lo
 * abre a todas. Los motores también lo miran: una campaña de SMS de una cuenta
 * fuera de la beta no sale aunque alguien la cree a mano.
 */
export function smsActivo(cuentaId) {
  if (process.env.SMS_ACTIVO === '1') return true;
  return String(process.env.SMS_BETA || '').split(',').map(x => x.trim()).filter(Boolean).includes(cuentaId);
}

/** Enlace de pago de Hotmart de cada paquete: SMS_PAGO_1000, SMS_PAGO_3000… */
export function paquetesConPago() {
  return PAQUETES.map(p => ({ ...p, pago: process.env['SMS_PAGO_' + p.creditos] || null }));
}

function sbHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}
async function rpc(nombre, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) {
    const e = new Error(`${nombre}: ${t.slice(0, 200)}`);
    e.saldoInsuficiente = t.includes('saldo_insuficiente');
    throw e;
  }
  return t ? JSON.parse(t) : null;
}

// ── Teléfono ────────────────────────────────────────────────────────────────
/** Móvil colombiano en formato internacional sin «+» (573001234567), o null. */
export function normalizarTelefono(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('0057')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('3')) d = '57' + d;
  return /^573\d{9}$/.test(d) ? d : null;
}

// ── Texto y créditos ────────────────────────────────────────────────────────
// Alfabeto GSM 03.38: lo que cabe en un SMS de 160 caracteres. Las del
// conjunto extendido ocupan dos posiciones.
const GSM_BASICO = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDIDO = '^{}\\[~]|€\f';
const EQUIVALENTES = {
  'á': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u', 'Á': 'A', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
  'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u', 'ë': 'e', 'ï': 'i', 'ç': 'c',
  'È': 'E', 'Ì': 'I', 'Ò': 'O', 'Ù': 'U', 'À': 'A', 'ã': 'a', 'õ': 'o',
  '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'", '´': "'", '`': "'",
  '–': '-', '—': '-', '…': '...', '•': '-', ' ': ' ', '\t': ' ',
};

/** El texto como saldrá: sin las tildes que obligarían a Unicode. */
export function prepararTexto(texto) {
  return Array.from(String(texto || '')).map(c => EQUIVALENTES[c] ?? c).join('').trim();
}

/**
 * Cuántos SMS (créditos) ocupa un texto ya preparado.
 * GSM: 160 en uno solo, 153 por parte si son varios. Unicode (un emoji, por
 * ejemplo): 70 y 67. Unicode cuenta en unidades UTF-16, como el operador.
 */
export function contarSegmentos(texto) {
  const t = String(texto || '');
  let gsm = true, largo = 0;
  for (const c of t) {
    if (GSM_BASICO.includes(c)) largo += 1;
    else if (GSM_EXTENDIDO.includes(c)) largo += 2;
    else { gsm = false; break; }
  }
  if (!gsm) {
    const u = t.length;
    return { codificacion: 'unicode', caracteres: u, segmentos: u <= 70 ? 1 : Math.ceil(u / 67), porSegmento: u <= 70 ? 70 : 67 };
  }
  return { codificacion: 'gsm', caracteres: largo, segmentos: largo <= 160 ? 1 : Math.ceil(largo / 153), porSegmento: largo <= 160 ? 160 : 153 };
}

// Más de 6 partes ya no es un SMS, es un correo mal enviado: se corta aquí
// para que un error de plantilla no se lleve el saldo de la cuenta.
export const MAX_SEGMENTOS = 6;

/**
 * Créditos que costaría un texto con {{variables}} para estos leads. El nombre
 * sale del lead; el resto de variables se cuenta como 15 caracteres, que es
 * holgado para una empresa, una etapa o un asesor. Es una estimación para
 * avisar ANTES de encolar; el cobro real lo hace enviarSms con el texto final.
 */
export function creditosEstimados(plantilla, leads, remitente = '') {
  let total = 0;
  for (const l of leads) {
    const t = String(plantilla || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v) => v === 'nombre' ? String(l.name || '') : 'x'.repeat(15));
    total += contarSegmentos(prepararTexto(remitente ? componerSms(remitente, t, TOKEN_EJEMPLO) : t)).segmentos;
  }
  return total;
}

// ── El remitente ────────────────────────────────────────────────────────────
// LabsMobile envía desde un código corto COMPARTIDO con otras empresas: quien
// recibe el SMS ve un número que no dice quién le escribe. Por eso cada SMS
// empieza con el nombre del negocio («Certain Pezzano: Hola Ana…»). Lo
// configura la cuenta —una vez por cliente en las agencias— y se pone aquí,
// en el único sitio por el que sale todo SMS, para que nadie lo olvide.
export const REMITENTE_KEY = '__sms_remitente__';
export const REMITENTE_MIN = 2;
export const REMITENTE_MAX = 20;

/** El nombre tal como saldrá: sin las tildes que pasan a Unicode y sin espacios de más. */
export function normalizarRemitente(v) {
  return prepararTexto(String(v || '')).replace(/[\s:]+$/, '').replace(/\s+/g, ' ').trim();
}

/** null si sirve; si no, el motivo para enseñarlo. */
export function validarRemitente(v) {
  const r = normalizarRemitente(v);
  if (r.length < REMITENTE_MIN) return 'Escribe el nombre de tu negocio, como lo reconocen tus clientes.';
  if (r.length > REMITENTE_MAX) return `El nombre del negocio puede tener hasta ${REMITENTE_MAX} caracteres.`;
  if (contarSegmentos(r).codificacion !== 'gsm') return 'El nombre del negocio no puede llevar emojis ni símbolos especiales.';
  if (/https?:|www\.|\.(com|co|net|org|app|io|ly)\b/i.test(r)) return 'El nombre del negocio no puede ser un enlace.';
  return null;
}

/** El texto con la firma: «Remitente: mensaje». */
export function conRemitente(remitente, texto) {
  return normalizarRemitente(remitente) + ': ' + String(texto || '').trim();
}

// ── La baja ──────────────────────────────────────────────────────────────────
// En Colombia LabsMobile no puede recibir respuestas (no hay números de
// recepción), así que un «Responde SALIR» no le llegaría a nadie y la persona
// creería que se dio de baja. Cada SMS termina con un enlace corto que la da
// de baja de verdad (api/sms-baja.js). El token es de 8 caracteres y es el
// mismo para el contacto en todos sus SMS (sms_token_baja).
export const BAJA_URL = 'app.acuarius.app/b/';
export const TOKEN_EJEMPLO = '3fa9c2d1';

/** El SMS entero, tal como sale: «Remitente: mensaje Baja: app.acuarius.app/b/xxxxxxxx». */
export function componerSms(remitente, texto, token) {
  return conRemitente(remitente, texto) + ' Baja: ' + BAJA_URL + token;
}

/**
 * El remitente guardado para la cuenta (o para ese cliente de la agencia).
 * null si nunca se configuró. Lanza si la base no responde: un envío sin
 * saber si hay remitente debe esperar, no salir sin firma.
 */
export async function leerRemitente(userId, clientId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}` +
    `&agent_key=eq.${REMITENTE_KEY}&select=profile_data&limit=1`, { headers: sbHeaders() });
  if (!r.ok) throw new Error('No se pudo leer el remitente de SMS (Supabase ' + r.status + ')');
  const todo = (await r.json())?.[0]?.profile_data || {};
  const v = todo[clientId || '_cuenta'];
  return v && !validarRemitente(v) ? normalizarRemitente(v) : null;
}

/** Lo guarda para la cuenta o el cliente, sin tocar el de los demás clientes. */
export async function guardarRemitente(userId, clientId, valor) {
  const error = validarRemitente(valor);
  if (error) return { error };
  const r1 = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}` +
    `&agent_key=eq.${REMITENTE_KEY}&select=profile_data&limit=1`, { headers: sbHeaders() });
  if (!r1.ok) throw new Error('No se pudo leer el remitente de SMS (Supabase ' + r1.status + ')');
  const todo = (await r1.json())?.[0]?.profile_data || {};
  const remitente = normalizarRemitente(valor);
  todo[clientId || '_cuenta'] = remitente;
  const r2 = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ user_id: userId, agent_key: REMITENTE_KEY, profile_data: todo, updated_at: new Date().toISOString() }),
  });
  if (!r2.ok) throw new Error('No se pudo guardar el remitente de SMS: ' + (await r2.text()).slice(0, 150));
  return { remitente };
}

// ── Horario legal ───────────────────────────────────────────────────────────
function pascua(anio) {
  // Algoritmo de Meeus/Jones/Butcher.
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(anio, mes - 1, dia);
}
const DIA = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const alLunes = (t) => { const w = new Date(t).getUTCDay(); return w === 1 ? t : t + ((8 - w) % 7) * DIA; };

/** Festivos de Colombia de un año, como 'aaaa-mm-dd' (Ley 51 de 1983, «Emiliani»). */
export function festivosColombia(anio) {
  const fijo = (m, d) => Date.UTC(anio, m - 1, d);
  const p = pascua(anio);
  return new Set([
    fijo(1, 1), fijo(5, 1), fijo(7, 20), fijo(8, 7), fijo(12, 8), fijo(12, 25),
    alLunes(fijo(1, 6)), alLunes(fijo(3, 19)), alLunes(fijo(6, 29)), alLunes(fijo(8, 15)),
    alLunes(fijo(10, 12)), alLunes(fijo(11, 1)), alLunes(fijo(11, 11)),
    p - 3 * DIA, p - 2 * DIA,                       // jueves y viernes santo
    alLunes(p + 39 * DIA), alLunes(p + 60 * DIA), alLunes(p + 68 * DIA), // Ascensión, Corpus, Sagrado Corazón
  ].map(iso));
}

// Horas de Bogotá [desde, hasta) por día de la semana (0 = domingo).
const FRANJAS = { 1: [7, 19], 2: [7, 19], 3: [7, 19], 4: [7, 19], 5: [7, 19], 6: [8, 15] };

/** ¿Se puede enviar un SMS comercial en este instante? */
export function enHorarioPermitido(fecha = new Date()) {
  const local = new Date(fecha.getTime() + TZ_OFFSET_H * 3600000);
  if (festivosColombia(local.getUTCFullYear()).has(iso(local.getTime()))) return false;
  const franja = FRANJAS[local.getUTCDay()];
  if (!franja) return false;
  const h = local.getUTCHours() + local.getUTCMinutes() / 60;
  return h >= franja[0] && h < franja[1];
}

/** El próximo instante (Date) en que se puede enviar; el mismo si ya se puede. */
export function siguienteHorario(fecha = new Date()) {
  if (enHorarioPermitido(fecha)) return fecha;
  let local = new Date(fecha.getTime() + TZ_OFFSET_H * 3600000);
  for (let n = 0; n < 15; n++) {
    const dia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const franja = FRANJAS[new Date(dia).getUTCDay()];
    if (franja && !festivosColombia(new Date(dia).getUTCFullYear()).has(iso(dia))) {
      const abre = dia + franja[0] * 3600000, cierra = dia + franja[1] * 3600000;
      if (local.getTime() < abre) return new Date(abre - TZ_OFFSET_H * 3600000);
      if (local.getTime() < cierra) return new Date(local.getTime() - TZ_OFFSET_H * 3600000);
    }
    local = new Date(dia + DIA);
  }
  throw new Error('sin horario permitido en 15 días');
}

// ── Saldo ───────────────────────────────────────────────────────────────────
export async function saldoSms(userId) {
  return Number(await rpc('sms_saldo', { p_user: userId })) || 0;
}

/** Suma créditos una sola vez por referencia (la transacción de Hotmart). */
export async function acreditarSms(userId, creditos, referencia, detalle = null, motivo = 'compra') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/sms_movimientos?on_conflict=motivo,referencia`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
    body: JSON.stringify({ user_id: userId, cantidad: creditos, motivo, referencia, detalle }),
  });
  if (!r.ok) throw new Error('No se pudieron acreditar los SMS: ' + (await r.text()).slice(0, 200));
  const filas = await r.json();
  return { nuevo: filas.length > 0 };
}

// ── Proveedor ───────────────────────────────────────────────────────────────
export function proveedorSms() {
  return process.env.LABSMOBILE_USUARIO && process.env.LABSMOBILE_TOKEN ? 'labsmobile' : 'simulado';
}

function nuevoSubid() {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); // 20 caracteres, el máximo de LabsMobile
}

/** Firma del enlace de confirmación de entrega: solo LabsMobile la conoce. */
export async function firmaAck(subid) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode('sms-ack:' + subid));
  return Array.from(new Uint8Array(s).slice(0, 12), x => x.toString(16).padStart(2, '0')).join('');
}

async function mandarLabsmobile({ telefono, texto, subid }) {
  const auth = btoa(`${process.env.LABSMOBILE_USUARIO}:${process.env.LABSMOBILE_TOKEN}`);
  const cuerpo = {
    message: texto,
    recipient: [{ msisdn: telefono }],
    subid,
    ackurl: `https://app.acuarius.app/api/sms-ack?k=${await firmaAck(subid)}`,
    long: 1,
    ...(contarSegmentos(texto).codificacion === 'unicode' ? { ucs2: 1 } : {}),
    ...(process.env.LABSMOBILE_REMITENTE ? { tpoa: process.env.LABSMOBILE_REMITENTE } : {}),
    ...(process.env.SMS_PRUEBA === '1' ? { test: 1 } : {}),
  };
  const r = await fetch('https://api.labsmobile.com/json/send', {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  });
  const d = await r.json().catch(() => ({}));
  // code 0 = aceptado. Cualquier otro es un rechazo y el crédito se devuelve.
  if (r.ok && String(d.code) === '0') return { ok: true };
  return { ok: false, detalle: `LabsMobile ${d.code ?? r.status}: ${d.message || 'sin detalle'}` };
}

// ── Enviar ──────────────────────────────────────────────────────────────────
/**
 * Envía un SMS a un lead. Nunca lanza por motivos del destinatario: devuelve
 * { estado, detalle } y quien llama decide. Estados:
 *   enviado | simulado          salió (o salió en simulación) y se cobró
 *   omitido                     no aplica: sin móvil válido, dado de baja, vacío o demasiado largo
 *   sin_saldo                   la cuenta no tiene créditos para este mensaje
 *   fuera_de_horario            no se puede ahora; `siguiente` dice cuándo
 *   rne_no_disponible           no se pudo consultar el RNE: no sale, se reintenta
 *   fallido                     el proveedor lo rechazó; los créditos se devolvieron
 * Lanza solo si la base no responde: ese envío no se sabe cobrado o no, y
 * quien llama debe dejarlo pendiente para reintentar, no darlo por hecho.
 */
export async function enviarSms({ userId, lead, texto, campaignId = null, automationId = null, ahora = new Date(), remitente, rne }) {
  if (!smsActivo(userId)) return { estado: 'omitido', detalle: 'El módulo de SMS no está activo en esta cuenta' };
  const telefono = normalizarTelefono(lead?.phone);
  if (!telefono) return { estado: 'omitido', detalle: 'Sin móvil colombiano válido' };
  if ((lead.tags || []).includes(ETIQUETA_BAJA)) return { estado: 'omitido', detalle: 'Dado de baja de SMS' };
  if (!prepararTexto(texto)) return { estado: 'omitido', detalle: 'Mensaje vacío' };
  // Quien llama puede pasar el remitente (una campaña lo lee una vez para
  // todos); si no, se busca. Sin remitente no sale: un SMS anónimo desde un
  // código compartido parece spam y nadie sabe a quién decirle «SALIR».
  if (remitente === undefined) remitente = await leerRemitente(userId, lead.client_id || null);
  if (!remitente) return { estado: 'omitido', detalle: 'Falta el nombre del negocio para los SMS: configúralo en Créditos de SMS' };
  // El RNE. Una campaña lo consulta de una vez para toda la tanda y pasa el
  // Map en `rne`; un envío suelto (automatización) pregunta por su número.
  const diez = aDiezDigitos(telefono);
  let enRne = rne?.get(diez);
  if (!enRne) {
    try { enRne = (await consultarRne([telefono], { ahora })).get(diez); }
    catch (e) {
      if (e.rneNoDisponible) return { estado: 'rne_no_disponible', detalle: e.message };
      throw e;
    }
  }
  if (enRne && enRne.sms === false) return { estado: 'omitido', detalle: 'Inscrito en el RNE de la CRC: no acepta SMS comerciales' };
  const token = await rpc('sms_token_baja', { p_user: userId, p_lead: lead.id || null, p_tel: telefono });
  const mensaje = prepararTexto(componerSms(remitente, texto, token));
  const { segmentos } = contarSegmentos(mensaje);
  if (segmentos > MAX_SEGMENTOS) return { estado: 'omitido', detalle: `El mensaje ocupa ${segmentos} SMS; el máximo es ${MAX_SEGMENTOS}` };
  if (!enHorarioPermitido(ahora)) return { estado: 'fuera_de_horario', siguiente: siguienteHorario(ahora).toISOString(), detalle: 'Fuera del horario permitido' };

  const subid = nuevoSubid();
  let envioId;
  try {
    envioId = await rpc('sms_reservar', {
      p_user: userId, p_creditos: segmentos,
      p_envio: { client_id: lead.client_id || null, lead_id: lead.id || '', campaign_id: campaignId || '', automation_id: automationId || '', telefono, mensaje, subid },
    });
  } catch (e) {
    if (e.saldoInsuficiente) return { estado: 'sin_saldo', detalle: 'Sin créditos de SMS suficientes' };
    throw e;
  }

  const proveedor = proveedorSms();
  let resultado;
  try {
    resultado = proveedor === 'labsmobile' ? await mandarLabsmobile({ telefono, texto: mensaje, subid }) : { ok: true };
  } catch (e) {
    resultado = { ok: false, detalle: 'Sin respuesta del proveedor: ' + e.message };
  }
  if (!resultado.ok) {
    await rpc('sms_devolver', { p_envio: envioId, p_detalle: resultado.detalle });
    return { estado: 'fallido', detalle: resultado.detalle, creditos: 0 };
  }
  const estado = proveedor === 'labsmobile' ? 'enviado' : 'simulado';
  await fetch(`${SUPABASE_URL}/rest/v1/sms_envios?id=eq.${envioId}`, {
    method: 'PATCH', headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ estado, updated_at: new Date().toISOString() }),
  });
  return { estado, creditos: segmentos, envioId, detalle: estado === 'simulado' ? 'Simulado: sin proveedor configurado' : null };
}
