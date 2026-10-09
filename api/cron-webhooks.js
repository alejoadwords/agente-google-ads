// api/cron-webhooks.js — entrega los avisos salientes de la API pública
//
// La cola (`api_entregas`) la llenan disparadores de la base cuando entra un
// lead, cambia de etapa o de responsable, llega un mensaje o una conversación
// cambia de estado (sql/2026-10-api-publica.sql). Corre CADA MINUTO: un agente
// externo que reacciona a «llegó un mensaje» no puede esperar diez.
//
// Reintentos: 1, 5, 15 minutos, 1, 4 y 12 horas. Tras el séptimo intento la
// entrega queda «fallida» a la vista en Configuración. Un webhook que acumula
// 200 fallos seguidos sin un solo acierto en tres días se desactiva solo y se
// dice por qué: seguir golpeando una URL muerta no le sirve a nadie.
export const config = { runtime: 'edge' };

import { latir } from './_latido.js';
import { entregarAviso, sbHeaders } from './_api-llaves.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const ESPERAS_MIN = [1, 5, 15, 60, 240, 720];
const MAX_INTENTOS = ESPERAS_MIN.length + 1;
const LOTE = 25;
const PARALELO = 8;
// Una función edge tiene que empezar a responder en 25 s. Se deja de tomar
// lotes nuevos a los 15 y lo que quede sale en el minuto siguiente.
const PRESUPUESTO_MS = 15000;

async function sb(ruta, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, {
    method, headers: sbHeaders(prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${ruta.split('?')[0]} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (r.status === 204 || prefer === 'return=minimal') return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Toma un lote. Se «reserva» moviendo proximo_at cinco minutos adelante con la
// misma condición de la lectura: si dos ejecuciones se pisan, la segunda no
// encuentra nada que reservar y no hay aviso doble.
async function tomarLote() {
  const ahora = new Date().toISOString();
  const ids = (await sb(`/api_entregas?estado=eq.pendiente&proximo_at=lte.${encodeURIComponent(ahora)}&select=id&order=id.asc&limit=${LOTE}`) || []).map(f => f.id);
  if (!ids.length) return [];
  return await sb(`/api_entregas?id=in.(${ids.join(',')})&estado=eq.pendiente&proximo_at=lte.${encodeURIComponent(ahora)}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { proximo_at: new Date(Date.now() + 5 * 60000).toISOString() },
  }) || [];
}

async function procesar(e, webhook) {
  if (!webhook || !webhook.activo) {
    await sb(`/api_entregas?id=eq.${e.id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: { estado: 'fallida', ultimo_error: 'El webhook está desactivado o ya no existe.' } });
    return { ok: false };
  }
  const r = await entregarAviso(webhook, e);
  const intentos = e.intentos + 1;
  if (r.ok) {
    await sb(`/api_entregas?id=eq.${e.id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: { estado: 'enviada', intentos, ultimo_estado: r.estado, ultimo_error: null, enviada_at: new Date().toISOString() } });
    return { ok: true, webhook: webhook.id };
  }
  const agotado = intentos >= MAX_INTENTOS;
  await sb(`/api_entregas?id=eq.${e.id}`, { method: 'PATCH', prefer: 'return=minimal',
    body: {
      estado: agotado ? 'fallida' : 'pendiente', intentos,
      ultimo_estado: r.estado, ultimo_error: r.error,
      proximo_at: new Date(Date.now() + (ESPERAS_MIN[intentos - 1] || 720) * 60000).toISOString(),
    } });
  return { ok: false, webhook: webhook.id, error: r.error };
}

// Una sola escritura por webhook y ejecución, no una por entrega.
async function anotarWebhooks(resultados, webhooks) {
  const porWebhook = new Map();
  for (const r of resultados) {
    if (!r.webhook) continue;
    const v = porWebhook.get(r.webhook) || { ok: 0, mal: 0, error: null };
    if (r.ok) v.ok++; else { v.mal++; v.error = r.error; }
    porWebhook.set(r.webhook, v);
  }
  for (const [id, v] of porWebhook) {
    const w = webhooks.get(id);
    if (v.ok) {
      await sb(`/api_webhooks?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal',
        body: { fallos_seguidos: 0, ultimo_ok_at: new Date().toISOString(), ...(v.mal ? {} : { ultimo_error: null }) } });
      continue;
    }
    const fallos = (w?.fallos_seguidos || 0) + v.mal;
    const sinAciertos = !w?.ultimo_ok_at || Date.parse(w.ultimo_ok_at) < Date.now() - 3 * 86400000;
    const apagar = fallos >= 200 && sinAciertos;
    await sb(`/api_webhooks?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: {
        fallos_seguidos: fallos, ultimo_error: v.error,
        ...(apagar ? { activo: false, desactivado_motivo: `Se desactivó solo el ${new Date().toISOString().slice(0, 10)}: ${fallos} avisos seguidos sin respuesta. Último error: ${v.error}` } : {}),
      } });
  }
}

// Limpieza, una vez por hora: entregas de más de 30 días, contadores de uso
// viejos, el registro de llamadas de más de 30 días e idempotencia de más de 24 h.
async function limpiar() {
  const hace = (dias) => encodeURIComponent(new Date(Date.now() - dias * 86400000).toISOString());
  await sb(`/api_entregas?estado=neq.pendiente&created_at=lt.${hace(30)}`, { method: 'DELETE', prefer: 'return=minimal' });
  await sb(`/api_registro?created_at=lt.${hace(30)}`, { method: 'DELETE', prefer: 'return=minimal' });
  await sb(`/api_idempotencia?created_at=lt.${hace(1)}`, { method: 'DELETE', prefer: 'return=minimal' });
  const ayer = new Date(Date.now() - 86400000).toISOString();
  // Las ventanas son 'm:AAAA-MM-DDTHH:MM' y 'd:AAAA-MM-DD': se comparan como texto.
  await sb(`/api_uso?ventana=lt.${encodeURIComponent('m:' + ayer.slice(0, 16))}&ventana=like.m:*`, { method: 'DELETE', prefer: 'return=minimal' });
  await sb(`/api_uso?ventana=lt.${encodeURIComponent('d:' + new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10))}&ventana=like.d:*`, { method: 'DELETE', prefer: 'return=minimal' });
}

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  await latir('cron-webhooks', { empezo: new Date().toISOString() });
  const inicio = Date.now();
  const total = { enviadas: 0, fallidas: 0 };
  try {
    while (Date.now() - inicio < PRESUPUESTO_MS) {
      const lote = await tomarLote();
      if (!lote.length) break;
      const ids = [...new Set(lote.map(e => e.webhook_id))];
      const webhooks = new Map((await sb(`/api_webhooks?id=in.(${ids.join(',')})&select=*`) || []).map(w => [w.id, w]));
      const resultados = [];
      for (let i = 0; i < lote.length; i += PARALELO) {
        resultados.push(...await Promise.all(lote.slice(i, i + PARALELO).map(e =>
          procesar(e, webhooks.get(e.webhook_id)).catch(err => ({ ok: false, error: err.message })))));
      }
      await anotarWebhooks(resultados, webhooks);
      for (const r of resultados) { if (r.ok) total.enviadas++; else total.fallidas++; }
      if (lote.length < LOTE) break;
    }
    if (new Date().getUTCMinutes() === 7) await limpiar();
    // Un aviso que el receptor no acepta NO es un fallo del cron: es la URL de
    // un cliente que no responde, y se ve en su pantalla. Marcarlo aquí haría
    // sonar el vigilante de Acuarius por cada servidor ajeno caído.
    await latir('cron-webhooks', total);
    return new Response(JSON.stringify({ ok: true, ...total }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-webhooks', { error: true }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'falló la cola de avisos' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
