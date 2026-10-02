// api/_rne.js — el Registro de Números Excluidos (RNE) de la CRC.
//
// La Ley 2300 de 2023 («Dejen de fregar») deja que cualquier persona inscriba
// su móvil para no recibir mensajes comerciales. Quien envía tiene que
// consultar el registro ANTES de contactar. LabsMobile no lo filtra, así que lo
// hacemos nosotros, para todas las cuentas, antes de cada SMS.
//
// Cómo responde la CRC (manual del web service, v3.1):
//   · POST validarExcluidos con {type:'TEL', keys:[móviles de 10 dígitos]}.
//   · Devuelve SOLO los números inscritos, con lo que aceptan por canal
//     (opcionesContacto.sms === false → no quiere SMS). Si un número no
//     aparece, no está inscrito.
//   · Actualiza a las 2:00 de Bogotá con lo del día anterior y entre las 2:00 y
//     las 2:59 responde 509. Por eso una respuesta vale hasta las 3:00 del día
//     siguiente y se guarda en rne_consultas: cada número se pregunta una vez
//     al día aunque esté en diez campañas.
//   · El token dura 6 meses y generar otro anula el anterior. Se renueva solo
//     (renovarTokenRne, desde cron-trials) y se guarda cifrado en rne_token.
//
// Sin token funciona en modo SIMULADO: nadie está inscrito salvo los móviles
// de RNE_SIMULADO_EXCLUIDOS (separados por coma), para probar el circuito. Con
// SMS_ACTIVO=1 (el módulo abierto a todas las cuentas) el modo simulado NO
// vale: no sale ningún SMS hasta que el RNE esté conectado.
//
// Si el RNE no responde, no se envía: el error lleva `rneNoDisponible` y quien
// llama deja el SMS pendiente para la próxima vuelta. Un retraso de diez
// minutos sale más barato que una multa de la SIC.

import { cifrar, descifrar } from './_cifrado.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRC = 'https://tramitescrcom.gov.co/excluidosback/consultaMasiva';
const LOTE_CACHE = 200;      // teléfonos por `in.()` al leer la caché
const LOTE_CRC = 10000;      // la CRC acepta ~500.000, pero responde en ~1 min
const ESPERA_CRC_MS = 55000;

const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });

function noDisponible(mensaje) {
  const e = new Error(mensaje);
  e.rneNoDisponible = true;
  return e;
}

/** Móvil colombiano en los 10 dígitos que usa la CRC (3001234567), o null. */
export function aDiezDigitos(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('0057')) d = d.slice(4);
  else if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? d : null;
}

/**
 * Desde cuándo vale una respuesta: las 3:00 de Bogotá (8:00 UTC) más
 * recientes. La CRC carga a las 2:00 lo inscrito el día anterior; lo que se
 * consultó antes de esa carga ya no sirve.
 */
export function inicioVigencia(ahora = new Date()) {
  const corte = new Date(ahora);
  corte.setUTCHours(8, 0, 0, 0);
  if (corte > ahora) corte.setUTCDate(corte.getUTCDate() - 1);
  return corte;
}

// ── Token ───────────────────────────────────────────────────────────────────
/** Lo que dice el JWT de sí mismo (iat, exp), sin verificar: no es nuestro. */
export function datosToken(token) {
  try {
    const b64 = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)));
  } catch { return {}; }
}

/**
 * El token vigente. Puede estar en dos sitios: RNE_TOKEN en Vercel (el que se
 * pega a mano la primera vez, o si alguien genera otro en la web de la CRC) y
 * rne_token (el que renueva el cron). Gana el emitido más tarde: la CRC solo
 * acepta el último y anula los demás.
 */
export async function tokenRne() {
  const env = process.env.RNE_TOKEN || null;
  let guardado = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rne_token?id=eq.1&select=token`, { headers: sbH() });
    if (r.ok) {
      const [fila] = await r.json();
      if (fila?.token) guardado = await descifrar(fila.token);
    }
  } catch (e) {
    console.error('[rne] no se pudo leer el token guardado:', e.message);
  }
  if (!guardado) return env;
  if (!env) return guardado;
  return (datosToken(env).iat || 0) > (datosToken(guardado).iat || 0) ? env : guardado;
}

function excluidosSimulados() {
  return new Set(String(process.env.RNE_SIMULADO_EXCLUIDOS || '').split(',').map(aDiezDigitos).filter(Boolean));
}

// ── Consulta ────────────────────────────────────────────────────────────────
async function leerCache(diez, desde) {
  const vistos = new Map();
  for (let i = 0; i < diez.length; i += LOTE_CACHE) {
    const tanda = diez.slice(i, i + LOTE_CACHE);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rne_consultas?telefono=in.(${tanda.join(',')})` +
      `&consultado_at=gte.${encodeURIComponent(desde.toISOString())}&select=telefono,inscrito,sms`, { headers: sbH() });
    // Sin caché se pregunta a la CRC: es más lento, pero no deja de filtrar.
    if (!r.ok) { console.error('[rne] caché ilegible:', r.status); return vistos; }
    for (const f of await r.json()) vistos.set(f.telefono, { inscrito: f.inscrito, sms: f.sms });
  }
  return vistos;
}

async function preguntarCrc(token, diez) {
  let r;
  try {
    r = await fetch(`${CRC}/validarExcluidos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'TEL', keys: diez }),
      signal: AbortSignal.timeout(ESPERA_CRC_MS),
    });
  } catch (e) {
    console.error('[rne] sin conexión con la CRC:', e.message);
    throw noDisponible('El RNE de la CRC no respondió');
  }
  if (r.status === 401) throw noDisponible('El token del RNE venció o no es válido: hay que generar otro en tramitescrcom.gov.co');
  if (r.status === 403) throw noDisponible('El usuario del RNE no tiene el rol de Proveedor de Bienes y Servicios');
  if (r.status === 509) throw noDisponible('El RNE se está actualizando (2:00 a 2:59)');
  if (!r.ok) throw noDisponible(`El RNE respondió con error ${r.status}`);
  const lista = await r.json().catch(() => null);
  if (!Array.isArray(lista)) throw noDisponible('El RNE devolvió una respuesta que no se entiende');
  return lista;
}

/**
 * ¿Qué móviles aceptan SMS comerciales? Devuelve un Map de 10 dígitos →
 * { inscrito, sms }. `sms: false` = no se le puede enviar. Lanza con
 * `rneNoDisponible` si no hay cómo saberlo.
 */
export async function consultarRne(telefonos, { ahora = new Date() } = {}) {
  const diez = [...new Set((telefonos || []).map(aDiezDigitos).filter(Boolean))];
  const resultado = new Map();
  if (!diez.length) return resultado;

  const token = await tokenRne();
  if (!token) {
    if (process.env.SMS_ACTIVO === '1') throw noDisponible('Falta conectar el RNE de la CRC (RNE_TOKEN): sin él no sale ningún SMS');
    // Lo simulado no se guarda en la caché: el día que llegue el token, la
    // primera consulta tiene que ir a la CRC de verdad.
    const excl = excluidosSimulados();
    for (const t of diez) resultado.set(t, { inscrito: excl.has(t), sms: !excl.has(t), simulado: true });
    return resultado;
  }

  const cache = await leerCache(diez, inicioVigencia(ahora));
  for (const [t, v] of cache) resultado.set(t, v);
  const faltan = diez.filter(t => !resultado.has(t));

  for (let i = 0; i < faltan.length; i += LOTE_CRC) {
    const tanda = faltan.slice(i, i + LOTE_CRC);
    const inscritos = new Map();
    for (const reg of await preguntarCrc(token, tanda)) {
      const t = aDiezDigitos(reg?.llave);
      if (t) inscritos.set(t, reg.opcionesContacto || {});
    }
    const consultado_at = new Date().toISOString();
    const filas = tanda.map(t => {
      const op = inscritos.get(t);
      // Inscrito sin decir nada del SMS: se toma como que no quiere. Ante la
      // duda, el que pierde es un mensaje, no el cliente con una multa.
      return op
        ? { telefono: t, inscrito: true, sms: op.sms === true, aplicacion: op.aplicacion ?? null, llamada: op.llamada ?? null, consultado_at }
        : { telefono: t, inscrito: false, sms: true, aplicacion: null, llamada: null, consultado_at };
    });
    for (const f of filas) resultado.set(f.telefono, { inscrito: f.inscrito, sms: f.sms });
    // Guardar es para no volver a preguntar; si falla, la respuesta de hoy
    // sigue valiendo para este envío.
    for (let j = 0; j < filas.length; j += 1000) {
      const g = await fetch(`${SUPABASE_URL}/rest/v1/rne_consultas?on_conflict=telefono`, {
        method: 'POST', headers: sbH({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(filas.slice(j, j + 1000)),
      }).catch(e => ({ ok: false, status: e.message }));
      if (!g.ok) console.error('[rne] no se pudo guardar la caché:', g.status);
    }
  }
  return resultado;
}

/** Para la pantalla de saldo: ¿con qué RNE se está filtrando? */
export async function estadoRne() {
  const token = await tokenRne();
  if (!token) return { modo: 'simulado', exigido: process.env.SMS_ACTIVO === '1' };
  const exp = datosToken(token).exp;
  return { modo: 'crc', vence: exp ? new Date(exp * 1000).toISOString() : null };
}

// ── Renovación ──────────────────────────────────────────────────────────────
export const RENOVAR_DIAS_ANTES = 30;

/**
 * Renueva el token si le quedan menos de RENOVAR_DIAS_ANTES días. La CRC da
 * uno nuevo a cambio del vigente y anula el viejo, así que el nuevo se guarda
 * ANTES de dar nada por hecho. Lanza si hacía falta y no se pudo: el cron lo
 * registra y el aviso de errores llega con semanas de margen.
 */
export async function renovarTokenRne({ ahora = new Date() } = {}) {
  const token = await tokenRne();
  if (!token) return { renovado: false, motivo: 'sin token' };
  const exp = datosToken(token).exp;
  const quedan = exp ? (exp * 1000 - ahora.getTime()) / 86400000 : 0;
  if (quedan > RENOVAR_DIAS_ANTES) return { renovado: false, motivo: `quedan ${Math.floor(quedan)} días` };

  const r = await fetch(`${CRC}/generateApiToken`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.data) throw new Error(`No se pudo renovar el token del RNE (HTTP ${r.status}${d.errorCode ? ', ' + d.errorCode : ''}); vence en ${Math.max(0, Math.floor(quedan))} días`);
  const nuevoExp = datosToken(d.data).exp;
  const g = await fetch(`${SUPABASE_URL}/rest/v1/rne_token?on_conflict=id`, {
    method: 'POST', headers: sbH({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ id: 1, token: await cifrar(d.data), expira_at: nuevoExp ? new Date(nuevoExp * 1000).toISOString() : null, updated_at: new Date().toISOString() }),
  });
  // El viejo ya no sirve: si no se guardó el nuevo, el RNE queda sin token.
  // Que se vea con todo el detalle, no como un fallo cualquiera.
  if (!g.ok) throw new Error('La CRC renovó el token del RNE pero NO se pudo guardar: el anterior quedó anulado. Hay que generar otro en tramitescrcom.gov.co');
  return { renovado: true, vence: nuevoExp ? new Date(nuevoExp * 1000).toISOString() : null };
}
