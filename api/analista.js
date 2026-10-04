// api/analista.js — Analista IA de la pauta (punto 7)
//
//   GET  /api/analista?client_id=        últimas revisiones, sus propuestas y el cupo
//   POST {accion:'revisar', client_id}   pide una revisión nueva
//
// La revisión tarda más de lo que Vercel deja a una función edge para EMPEZAR
// a responder (25 s): se contesta en streaming, con un espacio cada pocos
// segundos mientras se piensa, y el JSON al final. JSON.parse acepta espacios
// delante. Por eso el estado HTTP es 200 también cuando algo falla: el error
// viene en el cuerpo, y la pantalla mira `error`, no el estado.
//
// Las propuestas se aprueban por /api/reglas-pauta (aprobar / descartar), el
// mismo camino que las de las reglas.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, exigeModulo, soloSusLeads, alcanceDeCliente } from './_perfiles.js';
import { soporteDe } from './_soporte-sesion.js';
import { planDeCuenta } from './_cupo-agente.js';
import { registrarUso, consumoDelMes, costoDe } from './_uso-ia.js';
import { fotoDeCuenta, pedirRevision, validarRecomendaciones, guardarRevision, reservarRevision, revisionFallida, CUPOS, NOMBRE } from './_analista.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
async function sb(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return r.json();
}
const jsonResp = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const ORIGEN = 'analista';

/** El cupo del mes. `usadas: null` = no se pudo contar, y entonces se deja pasar. */
async function cupo(userId) {
  const [p, usadas] = await Promise.all([planDeCuenta(userId), consumoDelMes(userId, ORIGEN)]);
  const plan = p.ok ? (p.plan || 'free') : null;
  const tope = plan ? (CUPOS[plan] ?? CUPOS.free) : null;
  return { plan, tope, usadas, quedan: tope !== null && usadas !== null ? Math.max(0, tope - usadas) : null };
}

async function listar(quien, url) {
  const cliente = alcanceDeCliente(quien, url.searchParams.get('client_id'));
  const uid = encodeURIComponent(quien.userId);
  const fc = cliente ? `&client_id=eq.${encodeURIComponent(cliente)}` : '&client_id=is.null';
  const desde = encodeURIComponent(new Date(Date.now() - 60 * 86400000).toISOString());
  const [revisiones, acciones, c] = await Promise.all([
    sb(`/revisiones_pauta?user_id=eq.${uid}${fc}&resumen=not.is.null&select=id,created_at,resumen,recomendaciones,pedida_por&order=created_at.desc&limit=10`),
    sb(`/acciones_pauta?user_id=eq.${uid}&regla=eq.${encodeURIComponent(NOMBRE)}&created_at=gte.${desde}&select=id,estado,resultado,accion,campana,porcentaje,detalle,red&limit=300`),
    cupo(quien.userId),
  ]);
  return jsonResp({ revisiones, acciones, cupo: c, puede_editar: !soloSusLeads(quien.perfil) });
}

/** Responde en streaming: espacios mientras se trabaja, el JSON al final. */
function enStreaming(trabajo) {
  const enc = new TextEncoder();
  const cuerpo = new ReadableStream({
    async start(ctrl) {
      const latido = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch {} }, 4000);
      let fin;
      try { fin = await trabajo(); }
      catch (e) { console.error('[analista]', e); fin = { error: 'No pudimos terminar la revisión. Vuelve a intentarlo en un momento.' }; }
      clearInterval(latido);
      ctrl.enqueue(enc.encode(JSON.stringify(fin)));
      ctrl.close();
    },
  });
  return new Response(cuerpo, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function revisar(quien, body) {
  const cliente = alcanceDeCliente(quien, body.client_id);
  const c = await cupo(quien.userId);
  if (c.quedan === 0) {
    return jsonResp({ error: 'Ya usaste las ' + c.tope + ' revisiones de este mes de tu plan. Se renuevan el día 1.', cupo: c }, 429);
  }
  // Un doble clic no paga dos revisiones.
  const uid = encodeURIComponent(quien.userId);
  const hace = encodeURIComponent(new Date(Date.now() - 90000).toISOString());
  const recientes = await sb(`/revisiones_pauta?user_id=eq.${uid}&created_at=gte.${hace}&select=id&limit=1`).catch(() => []);
  if (recientes.length) return jsonResp({ error: 'Acabas de pedir una revisión. Espera un momento antes de pedir otra.' }, 409);
  const reserva = await reservarRevision({ userId: quien.userId, clientId: cliente, pedidaPor: quien.actorId || quien.userId });

  return enStreaming(async () => {
    const falla = async (error) => { await revisionFallida(reserva.id, error); return { error }; };
    const foto = await fotoDeCuenta(quien.userId, cliente, !quien.cliente);
    // Sin campañas no hay nada que revisar: no se gasta una llamada en decirlo.
    if (foto.vacia === 'sin_conexion') return falla('Conecta Google Ads o Meta para que el analista tenga qué revisar.');
    if (foto.vacia === 'sin_gasto') return falla('No hay campañas con gasto ni leads en los últimos 30 días: no hay nada que revisar todavía.');
    const r = await pedirRevision(foto);
    // Se registra también si falló a medias: los tokens se pagaron igual.
    if (r.uso) await registrarUso({ userId: quien.userId, actorId: quien.actorId, origen: ORIGEN, agente: NOMBRE, modelo: r.modelo, uso: r.uso });
    if (r.error) return falla(r.error);
    const recs = validarRecomendaciones(r.recomendaciones, foto);
    const rev = await guardarRevision({
      rev: reserva, userId: quien.userId, clientId: cliente, foto,
      resumen: r.resumen, recs, modelo: r.modelo, costo: r.uso ? costoDe(r.modelo, r.uso) : null,
    });
    return { ok: true, revision: { id: rev.id, created_at: rev.created_at, resumen: rev.resumen, recomendaciones: rev.recomendaciones } };
  });
}

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'analista'), 401);
  try {
    const quien = await quienPregunta(sesion.id);
    const corte = exigeModulo(quien, 'marketing');
    if (corte) return corte;
    if (req.method === 'GET') return await listar(quien, new URL(req.url));
    if (soloSusLeads(quien.perfil)) return jsonResp({ error: 'Tu perfil no puede pedir revisiones. Pídeselo al administrador.' }, 403);
    // Gasta el cupo del cliente y le crea propuestas: lo decide el propio cliente.
    if (await soporteDe(sesion)) return jsonResp({ error: 'Esto lo pide el propio cliente.' }, 403);
    const body = await req.json().catch(() => ({}));
    if (body.accion === 'revisar') return await revisar(quien, body);
    return jsonResp({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error('[analista]', e);
    return jsonResp({ error: 'No pudimos atender esto ahora mismo. Vuelve a intentarlo en un momento.' }, 500);
  }
}
