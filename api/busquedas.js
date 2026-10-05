// api/busquedas.js — búsquedas de Google y palabras negativas (punto 6)
//
//   GET  /api/busquedas?client_id=&dias=30|90      análisis por cuenta de Google
//   POST {accion:'negativa', conexion_id, campanas:[id], texto, tipo:'EXACT'|'PHRASE', motivo}
//   POST {accion:'deshacer', id}                   quita una negativa puesta desde aquí
//
// Excluir una búsqueda solo resta: el anuncio deja de salir para ella. Aun así
// puede costar ventas si se excluye algo bueno, así que lo decide siempre una
// persona (nunca una regla) y cada negativa se puede deshacer desde la app.
// Quién: los mismos que pueden pausar (dueño, administrador, Mercadeo).

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, exigeModulo, soloSusLeads, alcanceDeCliente } from './_perfiles.js';
import { soporteDe } from './_soporte-sesion.js';
import { conexionesDe, leadsDelPeriodo, gaql, accesoGoogleDeFila, mutarGoogle, conexionDePauta } from './pauta.js';
export { limpiarNegativa } from './_busquedas.js';
import { leerBusquedas, analizarTerminos, calidadPorPalabra, ponerNegativaEnRed } from './_busquedas.js';
import { completarPalabras, consultaDelDia, filasAClics } from './_gclid.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return r.status === 204 ? null : r.json().catch(() => null);
}
const jsonResp = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const dia = (ms) => new Date(ms - 5 * 3600000).toISOString().slice(0, 10);   // hora de Colombia

async function analisis(quien, url) {
  const cliente = alcanceDeCliente(quien, url.searchParams.get('client_id'));
  const dias = url.searchParams.get('dias') === '90' ? 90 : 30;
  const hasta = dia(Date.now() - 86400000), desde = dia(Date.now() - dias * 86400000);
  const conexiones = (await conexionesDe(quien.userId, cliente, !quien.cliente)).filter(c => c.platform === 'google_ads' && c.account_id);

  const cuentas = await Promise.all(conexiones.map(async (c) => {
    try {
      const d = await leerBusquedas(c, desde, hasta);
      const a = analizarTerminos({ ...d, marca: [c.account_name].filter(Boolean) });
      return { conexion_id: c.id, nombre: c.account_name || c.account_id, moneda: d.moneda, crm_activo: d.crmActivo, aviso_crm: d.avisoCrm, ...a };
    } catch (e) {
      const m = String(e?.message || e);
      return { conexion_id: c.id, nombre: c.account_name || c.account_id,
        error: /auth|caduc/.test(m) ? 'El permiso de Google caducó. Vuelve a conectar la cuenta.' : 'No se pudo leer esta cuenta ahora mismo.' };
    }
  }));

  // La palabra clave de cada lead de Google, para ver cuáles traen leads que
  // no avanzan. Se completa aquí lo que falte (una vez por lead).
  let calidad = [], avisoCalidad = null;
  if (conexiones.length) {
    try {
      const desde90 = dia(Date.now() - 90 * 86400000);
      const leads = await leadsDelPeriodo(quien.userId, cliente, desde90, dia(Date.now()), null);
      for (const [i, c] of conexiones.entries()) {
        const g = await accesoGoogleDeFila(c);
        if (g.error) continue;
        await completarPalabras({
          leads, marcar: i === conexiones.length - 1,
          consultarDia: async (d) => filasAClics(await gaql(g.cid, g.token, consultaDelDia(d), g.login)),
          guardar: async (id, campos) => {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: sbH(), body: JSON.stringify({ custom_fields: campos }) });
            if (!r.ok) throw new Error('no se guardó la palabra clave: ' + r.status);
          },
        });
      }
      calidad = calidadPorPalabra(leads);
    } catch (e) {
      console.error('[busquedas] calidad', e?.message);
      avisoCalidad = 'No se pudo leer qué palabras clave trajeron tus leads.';
    }
  }

  const hechas = await sb(`/acciones_pauta?user_id=eq.${encodeURIComponent(quien.userId)}&accion=eq.negativa` +
    (cliente ? `&client_id=eq.${encodeURIComponent(cliente)}` : '') +
    `&select=id,campana,campana_id,conexion_id,motivo,resultado,estado,created_at,decidida_at&order=created_at.desc&limit=100`);
  return jsonResp({ desde, hasta, dias, cuentas, calidad, aviso_calidad: avisoCalidad, hechas: hechas || [], puede_editar: !soloSusLeads(quien.perfil) });
}

async function ponerNegativa(quien, body) {
  if (!body.conexion_id) return jsonResp({ error: 'Falta la cuenta.' }, 400);
  const fila = await conexionDePauta(quien.userId, body.conexion_id);
  if (!fila || fila.platform !== 'google_ads') return jsonResp({ error: 'Esa conexión no es de tu cuenta.' }, 404);
  if (quien.cliente && fila.client_id && fila.client_id !== quien.cliente) return jsonResp({ error: 'Esa cuenta publicitaria es de otro cliente.' }, 403);
  const r = await ponerNegativaEnRed(fila, Array.isArray(body.campanas) ? body.campanas : [], body.texto, body.tipo);
  if (r.error) return jsonResp({ error: r.error }, 400);
  const quienDecide = quien.actorId || quien.userId;
  const etiqueta = r.tipo === 'PHRASE' ? 'frase' : 'exacta';
  // Cada campaña queda en el historial, también las que fallaron: con su motivo.
  for (const x of r.resultados.filter(x => x.campana)) {
    const fila_ = {
      user_id: quien.userId, client_id: fila.client_id || null, regla: 'Búsquedas', red: 'google', conexion_id: fila.id,
      campana_id: x.campana_id, campana: x.campana, accion: 'negativa', motivo: String(body.motivo || '').slice(0, 300) || null,
      estado: x.ok && !x.dup ? 'ejecutada' : x.dup ? 'descartada' : 'fallida', recurso: x.recurso, detalle: { texto: r.texto, tipo: r.tipo },
      resultado: x.ok && !x.dup ? 'Negativa «' + r.texto + '» (' + etiqueta + ') agregada.' : x.dup ? '«' + r.texto + '» ya era negativa en esta campaña.' : x.error,
      decidida_por: quienDecide, decidida_at: new Date().toISOString(),
    };
    await sb('/acciones_pauta', { method: 'POST', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(fila_) }).catch(e => console.error('[busquedas] historial', e.message));
  }
  return r.resultados.some(x => x.ok)
    ? jsonResp({ ok: true, texto: r.texto, resultados: r.resultados })
    : jsonResp({ error: r.resultados[0]?.error || 'No se pudo agregar la negativa.', resultados: r.resultados }, 502);
}

async function deshacer(quien, body) {
  const [a] = await sb(`/acciones_pauta?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${encodeURIComponent(quien.userId)}&accion=eq.negativa&select=*`) || [];
  if (!a || (quien.cliente && a.client_id !== quien.cliente)) return jsonResp({ error: 'Esa negativa no existe.' }, 404);
  if (a.estado !== 'ejecutada' || !a.recurso) return jsonResp({ error: 'Esta negativa no se puede deshacer desde aquí.' }, 409);
  const fila = await conexionDePauta(quien.userId, a.conexion_id);
  if (!fila) return jsonResp({ error: 'La conexión de esta cuenta ya no existe.' }, 404);
  const g = await accesoGoogleDeFila(fila);
  if (g.error) return jsonResp({ error: g.error }, 502);
  // El recurso tiene que ser de esta cuenta.
  if (!String(a.recurso).startsWith(`customers/${g.cid}/campaignCriteria/`)) return jsonResp({ error: 'Esa negativa no es de la cuenta conectada.' }, 409);
  const r = await mutarGoogle(g.cid, g.h, 'campaignCriteria', { operations: [{ remove: a.recurso }] });
  // Si ya la habían quitado en Google, el resultado es el mismo: deshecha.
  const yaNo = !r.ok && /NOT_FOUND|not found|RESOURCE_NOT_FOUND/i.test(r.error || '');
  if (!r.ok && !yaNo) return jsonResp({ error: 'Google no dejó quitarla: ' + String(r.error || '').slice(0, 160) }, 502);
  await sb(`/acciones_pauta?id=eq.${encodeURIComponent(a.id)}`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ estado: 'deshecha', resultado: (a.resultado || '') + ' Quitada después.', decidida_at: new Date().toISOString() }),
  });
  return jsonResp({ ok: true });
}

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'busquedas'), 401);
  try {
    const quien = await quienPregunta(sesion.id);
    const corte = exigeModulo(quien, 'marketing');
    if (corte) return corte;
    if (req.method === 'GET') return await analisis(quien, new URL(req.url));

    if (soloSusLeads(quien.perfil)) return jsonResp({ error: 'Tu perfil no puede cambiar campañas. Pídeselo al administrador.' }, 403);
    if (await soporteDe(sesion)) return jsonResp({ error: 'Esto lo decide el propio cliente.' }, 403);
    const body = await req.json().catch(() => ({}));
    if (body.accion === 'negativa') return await ponerNegativa(quien, body);
    if (body.accion === 'deshacer') return await deshacer(quien, body);
    return jsonResp({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error('[busquedas]', e);
    return jsonResp({ error: 'No pudimos atender esto ahora mismo. Vuelve a intentarlo en un momento.' }, 500);
  }
}
