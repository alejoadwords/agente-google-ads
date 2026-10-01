// api/conversiones.js — configurar y ver el envío de ventas a Meta y a Google
//
//   GET  ?client_id=…                     estado de las dos redes + los últimos envíos
//   POST {accion:'meta-guardar', dataset, token, test_event_code}
//   POST {accion:'meta-probar', test_event_code}   evento de prueba, no cuenta en informes
//   POST {accion:'meta-activar', activo}
//   POST {accion:'meta-quitar'}
//   POST {accion:'google-activar', activo}         al activar crea «Venta en Acuarius»
//   POST {accion:'reintentar', id}
//
// Meta NO pasa por el inicio de sesión de nuestra app (que espera el App
// Review): el cliente pega el id de su conjunto de datos y un token de la API
// de conversiones que genera en su Administrador de eventos. Ese token solo
// sirve para mandar eventos a ESE conjunto, y se guarda cifrado; el navegador
// nunca lo vuelve a ver.
//
// Lo configura el dueño o un administrador: decide qué datos de sus clientes
// salen hacia Meta y Google.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, alcanceDeCliente } from './_perfiles.js';
import { soporteDe } from './_soporte-sesion.js';
import { cifrar, abrirConexion } from './_cifrado.js';
import { GRAPH, mandarAMeta, asegurarAccionGoogle, NOMBRE_ACCION_GOOGLE, metaComoConexion } from './_conversiones.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
const jsonResp = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sb(ruta, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { headers: sbH(), ...(init || {}) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return r.status === 204 ? null : r.json().catch(() => null);
}

// La conexión de ESTE ámbito: la del cliente si se trabaja en un cliente, la
// de la cuenta si no. No se mezclan: configurar Meta para un cliente no puede
// tocar la de la cuenta ni la de otro.
const ambito = (clientId) => clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';

async function conexionMeta(userId, clientId) {
  const f = await sb(`/conversiones_conexion?user_id=eq.${encodeURIComponent(userId)}&red=eq.meta${ambito(clientId)}&select=*&limit=1`);
  return f?.[0] ? metaComoConexion(f[0]) : null;
}
// Google se conecta desde Plataformas de pauta; aquí solo se le enciende el
// envío. Una conexión de la cuenta vale también dentro de un cliente.
async function conexionGoogle(userId, clientId) {
  const filtro = clientId ? `&or=(client_id.eq.${encodeURIComponent(clientId)},client_id.is.null)` : '&client_id=is.null';
  const f = await sb(`/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.google_ads${filtro}&select=*`);
  const lista = f || [];
  const fila = lista.find(x => clientId && x.client_id === clientId) || lista.find(x => !x.client_id) || null;
  return fila ? abrirConexion(fila) : null;
}

// extra_data se FUSIONA: dondePreguntar() guarda ahí el login de Google y
// pisarlo obligaría a buscarlo otra vez.
async function guardarExtra(id, cambio) {
  const f = await sb(`/platform_connections?id=eq.${encodeURIComponent(id)}&select=extra_data&limit=1`);
  const extra = { ...(f?.[0]?.extra_data || {}), ...cambio };
  await sb(`/platform_connections?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ extra_data: extra, updated_at: new Date().toISOString() }),
  });
  return extra;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'conversiones'), 401);

  let quien;
  try { quien = await quienPregunta(sesion.id); }
  catch (e) { return jsonResp({ error: e.message }, e.suspendida ? 403 : 502); }
  const userId = quien.userId;
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const clientId = alcanceDeCliente(quien, body.client_id ?? url.searchParams.get('client_id')) || null;
  const puede = quien.esDueno || quien.perfil === 'admin';

  // ── Estado y registro ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const [meta, google] = await Promise.all([conexionMeta(userId, clientId), conexionGoogle(userId, clientId)]);
      const filtroEnvios = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '';
      const envios = await sb(`/conversiones_pauta?user_id=eq.${encodeURIComponent(userId)}${filtroEnvios}` +
        `&select=id,lead_id,red,estado,valor,moneda,llave,motivo,intentos,ocurrio_at,enviado_at,created_at&order=created_at.desc&limit=60`) || [];
      const ids = [...new Set(envios.map(e => e.lead_id))];
      const nombres = ids.length
        ? await sb(`/leads?id=in.(${ids.join(',')})&select=id,name`).catch(() => []) : [];
      const nom = new Map((nombres || []).map(l => [l.id, l.name]));
      return jsonResp({
        puede_configurar: puede,
        meta: meta ? {
          conectado: true, dataset: meta.account_id, nombre: meta.account_name || null,
          activo: !!meta.extra_data?.activo, prueba: meta.extra_data?.test_event_code || null,
        } : { conectado: false },
        google: google ? {
          conectado: !!google.account_id, cuenta: google.account_name || google.account_id || null,
          activo: !!google.extra_data?.conversiones?.activo, accion: google.extra_data?.conversiones?.accion ? NOMBRE_ACCION_GOOGLE : null,
          de_la_cuenta: !google.client_id && !!clientId,
        } : { conectado: false },
        envios: envios.map(e => ({ ...e, lead: nom.get(e.lead_id) || null })),
      });
    } catch (e) {
      return jsonResp({ error: 'No se pudo leer la configuración: ' + e.message }, 502);
    }
  }

  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  if (!puede) return jsonResp({ error: 'Solo el dueño de la cuenta o un administrador puede configurar esto.' }, 403);
  // Quien revisa la cuenta de un cliente no decide qué datos suyos salen a Meta.
  if (await soporteDe(sesion)) return jsonResp({ error: 'Esto lo configura el propio cliente.' }, 403);

  try {
    // ── Meta ────────────────────────────────────────────────────────────────
    if (body.accion === 'meta-guardar') {
      const dataset = String(body.dataset || '').replace(/\D/g, '');
      const token = String(body.token || '').trim();
      const prueba = String(body.test_event_code || '').trim().slice(0, 40) || null;
      const actual = await conexionMeta(userId, clientId);
      if (!/^\d{8,20}$/.test(dataset)) return jsonResp({ error: 'El ID del conjunto de datos son solo números (lo ves en el Administrador de eventos).' }, 400);
      // Sin token nuevo se conserva el guardado: cambiar solo el código de
      // prueba no debería obligar a generar otro.
      const tokenFinal = token || actual?.access_token;
      if (!tokenFinal) return jsonResp({ error: 'Falta el token de la API de conversiones.' }, 400);
      // Se comprueba ANTES de guardar: un token equivocado guardado como bueno
      // dejaría las ventas fallando una a una sin que nadie lo viera venir.
      const r = await fetch(`${GRAPH}/${dataset}?fields=id,name&access_token=${encodeURIComponent(tokenFinal)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) {
        const m = d?.error?.code === 190 ? 'Ese token no es válido o venció.'
          : 'Meta no deja leer ese conjunto de datos con ese token. Revisa que el token sea de ese mismo conjunto.';
        return jsonResp({ error: m, detalle: d?.error?.message || null }, 400);
      }
      // Un conjunto recién guardado queda ACTIVO: quien pega el token quiere
      // que se usen. Al cambiarlo se respeta lo que hubiera decidido antes.
      const activo = actual ? !!actual.extra_data?.activo : true;
      const fila = {
        user_id: userId, client_id: clientId, red: 'meta', dataset, nombre: d.name || null,
        token: await cifrar(tokenFinal), activo, test_event_code: prueba, updated_at: new Date().toISOString(),
      };
      if (actual) {
        await sb(`/conversiones_conexion?id=eq.${encodeURIComponent(actual.id)}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(fila) });
      } else {
        await sb('/conversiones_conexion', { method: 'POST', headers: sbH({ Prefer: 'return=minimal' }), body: JSON.stringify(fila) });
      }
      return jsonResp({ ok: true, nombre: d.name || null, activo });
    }

    if (body.accion === 'meta-probar') {
      const con = await conexionMeta(userId, clientId);
      if (!con) return jsonResp({ error: 'Primero guarda el conjunto de datos y el token.' }, 400);
      const code = String(body.test_event_code || con.extra_data?.test_event_code || '').trim();
      if (!code) return jsonResp({ error: 'Para probar sin ensuciar tus informes hace falta el código de prueba: Administrador de eventos → Probar eventos.' }, 400);
      const r = await mandarAMeta({
        dataset: con.account_id, token: con.access_token, testCode: code,
        eventos: [{
          event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: 'acu-prueba-' + Date.now(),
          action_source: 'system_generated',
          user_data: { em: ['973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b'] },   // sha256 de test@example.com
          custom_data: { value: 1000, currency: 'COP', lead_event_source: 'Acuarius', event_source: 'crm' },
        }],
      });
      if (!r.ok) return jsonResp({ error: r.motivo }, 400);
      return jsonResp({ ok: true, recibidos: r.respuesta?.events_received || 0 });
    }

    if (body.accion === 'meta-activar') {
      const con = await conexionMeta(userId, clientId);
      if (!con) return jsonResp({ error: 'Primero guarda el conjunto de datos y el token.' }, 400);
      await sb(`/conversiones_conexion?id=eq.${encodeURIComponent(con.id)}`, {
        method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ activo: !!body.activo, updated_at: new Date().toISOString() }),
      });
      return jsonResp({ ok: true, activo: !!body.activo });
    }

    if (body.accion === 'meta-quitar') {
      const con = await conexionMeta(userId, clientId);
      if (con) await sb(`/conversiones_conexion?id=eq.${encodeURIComponent(con.id)}`, { method: 'DELETE', headers: sbH({ Prefer: 'return=minimal' }) });
      return jsonResp({ ok: true });
    }

    // ── Google ──────────────────────────────────────────────────────────────
    if (body.accion === 'google-activar') {
      const con = await conexionGoogle(userId, clientId);
      if (!con || !con.account_id) return jsonResp({ error: 'Primero conecta Google Ads y elige la cuenta en Plataformas de pauta → Conexiones.' }, 400);
      if (!body.activo) {
        await guardarExtra(con.id, { conversiones: { ...(con.extra_data?.conversiones || {}), activo: false } });
        return jsonResp({ ok: true, activo: false });
      }
      let moneda = 'COP';
      try { moneda = (await sb(`/onboarding_cuenta?user_id=eq.${encodeURIComponent(userId)}&select=moneda&limit=1`))?.[0]?.moneda || 'COP'; } catch {}
      // Crea la acción (o reutiliza la que ya hay). Si Google no deja, se
      // dice por qué y NO se activa: activar sin acción encolaría ventas que
      // no tienen adónde ir.
      const accion = await asegurarAccionGoogle(con, moneda);
      await guardarExtra(con.id, { conversiones: { activo: true, accion, desde: new Date().toISOString() } });
      return jsonResp({ ok: true, activo: true, accion: NOMBRE_ACCION_GOOGLE });
    }

    // ── Reintentar uno ──────────────────────────────────────────────────────
    if (body.accion === 'reintentar') {
      const id = String(body.id || '');
      const filas = await sb(`/conversiones_pauta?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id,estado&limit=1`);
      if (!filas?.length) return jsonResp({ error: 'Ese envío no existe' }, 404);
      if (filas[0].estado === 'enviado') return jsonResp({ error: 'Ese ya se envió' }, 400);
      await sb(`/conversiones_pauta?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ estado: 'pendiente', intentos: 0, proximo_at: new Date().toISOString(), motivo: null }),
      });
      return jsonResp({ ok: true });
    }

    return jsonResp({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return jsonResp({ error: String(e?.message || e) }, 502);
  }
}
