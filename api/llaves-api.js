// api/llaves-api.js — Configuración → «API y agentes»
//
// Desde aquí el dueño de la cuenta (o un administrador del equipo) crea y
// revoca las llaves de la API pública y los avisos salientes (webhooks), y ve
// qué hizo cada llave. La API en sí está en api/v1.js.
//
// La llave completa y el secreto de un webhook se devuelven UNA sola vez, al
// crearlos. De la llave solo se guarda el hash; el secreto se guarda cifrado
// porque hay que firmar con él, pero no se vuelve a enseñar: quien lo pierde
// lo rota.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta } from './_perfiles.js';
import {
  sbHeaders, PERMISOS, CLAVES_PERMISOS, EVENTOS, CLAVES_EVENTOS, MAX_LLAVES, MAX_WEBHOOKS,
  generarLlave, generarSecretoWebhook, validarUrlWebhook, cuentaConApi, entregarAviso,
  enviarCodigo, verificarCodigo, liberarCodigo, avisarDueno, fechaAviso,
} from './_api-llaves.js';
import { cifrar } from './_cifrado.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS_LLAVE = 'id,nombre,prefijo,permisos,client_id,limite_minuto,limite_dia,creada_por_nombre,created_at,ultimo_uso_at,revocada_at';
const COLS_WEBHOOK = 'id,url,eventos,activo,client_id,created_at,ultimo_ok_at,ultimo_error,fallos_seguidos,desactivado_motivo';

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

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

// Si una acción que abre una puerta gastó un código de confirmación y luego
// falló (URL inválida, tope de llaves…), el código vuelve a valer: quien se
// equivocó en un campo no tiene que esperar otro correo.
export default async function handler(req) {
  const estado = {};
  const resp = await atender(req, estado);
  if (estado.codigo && resp.status >= 300) await liberarCodigo(estado.codigo.actor, estado.codigo.hash);
  return resp;
}

async function atender(req, estado) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'llaves-api'), 401);

  let quien;
  try { quien = await quienPregunta(sesion.id); }
  catch (e) {
    if (e.suspendida) return jsonResp({ error: 'Esta cuenta está suspendida. Escríbenos a soporte@acuarius.app.' }, 403);
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }
  // Una llave opera la cuenta entera: la crea quien manda en ella, no un asesor.
  if (!quien.esDueno && quien.perfil !== 'admin') {
    return jsonResp({ error: 'Solo el dueño de la cuenta o un administrador gestionan la API.', sin_permiso: true }, 403);
  }
  const cuenta = quien.userId;
  const plan = await cuentaConApi(cuenta);
  if (!plan.ok) return jsonResp({ error: 'No se pudo comprobar tu plan. Reintenta en unos segundos.' }, 503);

  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      // Registro de lo que hicieron las llaves: escrituras y errores.
      if (url.searchParams.get('registro')) {
        const filas = await sb(`/api_registro?user_id=eq.${encodeURIComponent(cuenta)}` +
          `&select=llave_id,metodo,ruta,estado,ms,error,created_at&order=created_at.desc&limit=100`) || [];
        return jsonResp({ registro: filas });
      }
      // Últimas entregas de un webhook.
      const wid = url.searchParams.get('entregas');
      if (wid) {
        if (!UUID.test(wid)) return jsonResp({ error: 'Id inválido' }, 400);
        const filas = await sb(`/api_entregas?webhook_id=eq.${wid}&user_id=eq.${encodeURIComponent(cuenta)}` +
          `&select=id,evento,estado,intentos,ultimo_estado,ultimo_error,created_at,enviada_at,proximo_at&order=created_at.desc&limit=30`) || [];
        return jsonResp({ entregas: filas });
      }
      const [llaves, webhooks] = await Promise.all([
        sb(`/api_llaves?user_id=eq.${encodeURIComponent(cuenta)}&select=${COLS_LLAVE}&order=created_at.desc`),
        sb(`/api_webhooks?user_id=eq.${encodeURIComponent(cuenta)}&select=${COLS_WEBHOOK}&order=created_at.asc`),
      ]);
      return jsonResp({
        plan_permite: plan.permitido,
        permisos: PERMISOS, eventos: EVENTOS,
        llaves: llaves || [], webhooks: webhooks || [],
        cliente_fijo: quien.cliente || null,
      });
    }

    if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
    let b;
    try { b = await req.json(); } catch { return jsonResp({ error: 'Cuerpo inválido' }, 400); }
    const accion = b?.accion;

    // Lo que crea algo nuevo exige el plan; revocar y desactivar, nunca: una
    // cuenta que bajó de plan tiene que poder apagar lo que dejó encendido.
    const crea = ['crear_llave', 'crear_webhook', 'rotar_secreto', 'probar_webhook', 'pedir_codigo'].includes(accion);
    if (crea && !plan.permitido) {
      return jsonResp({ error: 'La API está en los planes Pro y Agency. Mejora tu plan para conectar sistemas externos.', plan_sin_api: true }, 403);
    }
    // Abrir o redirigir una puerta a la cuenta exige un código que llega al
    // correo de QUIEN lo hace (no del dueño): una contraseña robada no basta
    // para crear una llave que luego sobrevive al cambio de contraseña.
    // Revocar, desactivar y eliminar nunca lo piden: cerrar tiene que ser fácil.
    if (accion === 'pedir_codigo') {
      const para = {
        crear_llave: 'crear una llave de la API', crear_webhook: 'añadir un webhook',
        rotar_secreto: 'generar un secreto nuevo para un webhook', editar_webhook: 'cambiar la dirección de un webhook',
      }[b.para] || 'un cambio en la API';
      const r = await enviarCodigo(quien.actorId, cuenta, para);
      return r.ok ? jsonResp(r) : jsonResp({ error: r.error }, r.status);
    }
    const abre = ['crear_llave', 'crear_webhook', 'rotar_secreto'].includes(accion) ||
      (accion === 'editar_webhook' && b.url !== undefined);
    if (abre) {
      if (!b.codigo) {
        return jsonResp({ error: 'Para esto hace falta confirmar con el código que te enviamos al correo.', requiere_codigo: true }, 403);
      }
      const v = await verificarCodigo(quien.actorId, b.codigo);
      if (!v.ok) return jsonResp({ error: v.error, requiere_codigo: true, codigo_vencido: !!v.vencido }, 403);
      estado.codigo = { actor: quien.actorId, hash: v.hash };
    }
    const quienLoHizo = quien.esDueno ? 'El dueño de la cuenta' : (quien.nombre || 'Un administrador del equipo');
    // Un administrador atado a un cliente solo crea llaves de ese cliente.
    const cliente = quien.cliente || (typeof b.client_id === 'string' && b.client_id.trim() ? b.client_id.trim().slice(0, 80) : null);

    if (accion === 'crear_llave') {
      const nombre = String(b.nombre || '').trim().slice(0, 60);
      if (nombre.length < 3) return jsonResp({ error: 'Ponle un nombre a la llave (al menos 3 letras). Es el que firma en el historial: «Agente de Karvio».' }, 400);
      const permisos = [...new Set((Array.isArray(b.permisos) ? b.permisos : []).filter(p => CLAVES_PERMISOS.includes(p)))];
      if (!permisos.length) return jsonResp({ error: 'Elige al menos un permiso.' }, 400);
      const vivas = await sb(`/api_llaves?user_id=eq.${encodeURIComponent(cuenta)}&revocada_at=is.null&select=id`) || [];
      if (vivas.length >= MAX_LLAVES) return jsonResp({ error: `Ya tienes ${MAX_LLAVES} llaves activas. Revoca alguna antes de crear otra.` }, 400);
      const { llave, prefijo, hash } = await generarLlave();
      const filas = await sb('/api_llaves', {
        method: 'POST', prefer: 'return=representation',
        body: {
          user_id: cuenta, client_id: cliente, nombre, prefijo, hash, permisos,
          creada_por: quien.actorId, creada_por_nombre: quien.nombre || null,
        },
      });
      const f = filas?.[0];
      const aviso = await avisarDueno(cuenta, {
        asunto: 'Se creó una llave de la API en tu cuenta de Acuarius',
        titulo: 'Se creó una llave de la API',
        intro: 'Con esta llave un sistema externo puede entrar a tu cuenta con los permisos de abajo.',
        filas: [
          ['Llave', `${nombre} (${prefijo}…)`], ['Creada por', quienLoHizo], ['Cuándo', fechaAviso()],
          ['Permisos', permisos.map(p => (PERMISOS.find(x => x.clave === p) || {}).nombre || p).join(', ')],
          ['Alcance', cliente ? 'Un cliente' : 'Toda la cuenta'],
        ],
      });
      return jsonResp({ llave, aviso, fila: Object.fromEntries(COLS_LLAVE.split(',').map(k => [k, f?.[k] ?? null])) }, 201);
    }

    if (accion === 'revocar_llave') {
      if (!UUID.test(String(b.id || ''))) return jsonResp({ error: 'Id inválido' }, 400);
      const filas = await sb(`/api_llaves?id=eq.${b.id}&user_id=eq.${encodeURIComponent(cuenta)}&revocada_at=is.null`, {
        method: 'PATCH', prefer: 'return=representation',
        body: { revocada_at: new Date().toISOString(), revocada_por: quien.actorId },
      });
      if (!filas?.length) return jsonResp({ error: 'Esa llave no existe o ya estaba revocada.' }, 404);
      const aviso = await avisarDueno(cuenta, {
        asunto: 'Se revocó una llave de la API de tu cuenta de Acuarius',
        titulo: 'Se revocó una llave de la API',
        intro: 'Esta llave ya no puede entrar a tu cuenta.',
        filas: [['Llave', `${filas[0].nombre} (${filas[0].prefijo}…)`], ['Revocada por', quienLoHizo], ['Cuándo', fechaAviso()]],
        pie: 'Si no reconoces este cambio, escríbenos a soporte@acuarius.app.',
      });
      return jsonResp({ ok: true, aviso });
    }

    if (accion === 'crear_webhook') {
      const v = validarUrlWebhook(b.url);
      if (!v.ok) return jsonResp({ error: v.error }, 400);
      const eventos = [...new Set((Array.isArray(b.eventos) ? b.eventos : []).filter(e => CLAVES_EVENTOS.includes(e)))];
      if (!eventos.length) return jsonResp({ error: 'Elige al menos un evento.' }, 400);
      const todos = await sb(`/api_webhooks?user_id=eq.${encodeURIComponent(cuenta)}&select=id`) || [];
      if (todos.length >= MAX_WEBHOOKS) return jsonResp({ error: `Ya tienes ${MAX_WEBHOOKS} webhooks. Elimina alguno antes de crear otro.` }, 400);
      const secreto = generarSecretoWebhook();
      const filas = await sb('/api_webhooks', {
        method: 'POST', prefer: 'return=representation',
        body: { user_id: cuenta, client_id: cliente, url: v.url, eventos, secreto: await cifrar(secreto), creado_por: quien.actorId },
      });
      const f = filas?.[0];
      const aviso = await avisarDueno(cuenta, {
        asunto: 'Se añadió un webhook a tu cuenta de Acuarius',
        titulo: 'Se añadió un webhook',
        intro: 'Acuarius va a enviar a esta dirección los datos de los eventos de abajo.',
        filas: [
          ['Dirección', v.url], ['Añadido por', quienLoHizo], ['Cuándo', fechaAviso()],
          ['Avisa cuando', eventos.map(e => (EVENTOS.find(x => x.clave === e) || {}).nombre || e).join(', ')],
        ],
      });
      return jsonResp({ secreto, aviso, fila: Object.fromEntries(COLS_WEBHOOK.split(',').map(k => [k, f?.[k] ?? null])) }, 201);
    }

    // Lo que sigue opera sobre un webhook existente de esta cuenta.
    if (!UUID.test(String(b.id || ''))) return jsonResp({ error: 'Id inválido' }, 400);
    const webhook = (await sb(`/api_webhooks?id=eq.${b.id}&user_id=eq.${encodeURIComponent(cuenta)}&select=*&limit=1`))?.[0];
    if (!webhook) return jsonResp({ error: 'Ese webhook no existe.' }, 404);

    if (accion === 'editar_webhook') {
      const cambio = {};
      if (b.url !== undefined) {
        const v = validarUrlWebhook(b.url);
        if (!v.ok) return jsonResp({ error: v.error }, 400);
        cambio.url = v.url;
      }
      if (b.eventos !== undefined) {
        const eventos = [...new Set((Array.isArray(b.eventos) ? b.eventos : []).filter(e => CLAVES_EVENTOS.includes(e)))];
        if (!eventos.length) return jsonResp({ error: 'Elige al menos un evento.' }, 400);
        cambio.eventos = eventos;
      }
      if (b.activo !== undefined) {
        cambio.activo = !!b.activo;
        // Reactivar borra el motivo y la cuenta de fallos: arranca de cero.
        if (cambio.activo) { cambio.desactivado_motivo = null; cambio.fallos_seguidos = 0; }
        else cambio.desactivado_motivo = 'Desactivado a mano el ' + new Date().toISOString().slice(0, 10) + '.';
      }
      if (!Object.keys(cambio).length) return jsonResp({ error: 'No llegó nada para cambiar.' }, 400);
      const filas = await sb(`/api_webhooks?id=eq.${webhook.id}`, { method: 'PATCH', prefer: 'return=representation', body: cambio });
      const f = filas?.[0];
      // Cambiar la dirección es mandar los datos a otro sitio: se avisa siempre.
      // Encender o apagar, también: un webhook que se enciende solo es raro.
      let aviso = null;
      if (cambio.url && cambio.url !== webhook.url) {
        aviso = await avisarDueno(cuenta, {
          asunto: 'Cambió la dirección de un webhook de tu cuenta de Acuarius',
          titulo: 'Cambió la dirección de un webhook',
          intro: 'Desde ahora los avisos de este webhook van a la dirección nueva.',
          filas: [['Antes', webhook.url], ['Ahora', cambio.url], ['Cambiado por', quienLoHizo], ['Cuándo', fechaAviso()]],
        });
      } else if (cambio.activo !== undefined && cambio.activo !== webhook.activo) {
        aviso = await avisarDueno(cuenta, {
          asunto: `Se ${cambio.activo ? 'activó' : 'desactivó'} un webhook de tu cuenta de Acuarius`,
          titulo: `Se ${cambio.activo ? 'activó' : 'desactivó'} un webhook`,
          intro: cambio.activo ? 'Acuarius vuelve a enviar avisos a esta dirección.' : 'Acuarius deja de enviar avisos a esta dirección.',
          filas: [['Dirección', webhook.url], ['Por', quienLoHizo], ['Cuándo', fechaAviso()]],
        });
      }
      return jsonResp({ aviso, fila: Object.fromEntries(COLS_WEBHOOK.split(',').map(k => [k, f?.[k] ?? null])) });
    }

    if (accion === 'rotar_secreto') {
      const secreto = generarSecretoWebhook();
      await sb(`/api_webhooks?id=eq.${webhook.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { secreto: await cifrar(secreto) } });
      const aviso = await avisarDueno(cuenta, {
        asunto: 'Se cambió el secreto de un webhook de tu cuenta de Acuarius',
        titulo: 'Se cambió el secreto de un webhook',
        intro: 'Los avisos a esta dirección se firman desde ahora con un secreto nuevo.',
        filas: [['Dirección', webhook.url], ['Cambiado por', quienLoHizo], ['Cuándo', fechaAviso()]],
      });
      return jsonResp({ secreto, aviso });
    }

    if (accion === 'probar_webhook') {
      // Se manda ahora mismo, no por la cola: quien pulsa «Probar» quiere
      // saber ya si su servidor contesta.
      const r = await entregarAviso(webhook, {
        evento: 'prueba', evento_id: crypto.randomUUID(), created_at: new Date().toISOString(),
        datos: { mensaje: 'Aviso de prueba de Acuarius. Si lo recibes, el webhook está bien configurado.' },
      });
      return jsonResp({ resultado: r });
    }

    if (accion === 'eliminar_webhook') {
      // Borra la suscripción (configuración), no datos del CRM. Sus entregas
      // pendientes se van con ella (on delete cascade).
      await sb(`/api_webhooks?id=eq.${webhook.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      const aviso = await avisarDueno(cuenta, {
        asunto: 'Se eliminó un webhook de tu cuenta de Acuarius',
        titulo: 'Se eliminó un webhook',
        intro: 'Acuarius dejó de enviar avisos a esta dirección.',
        filas: [['Dirección', webhook.url], ['Eliminado por', quienLoHizo], ['Cuándo', fechaAviso()]],
        pie: 'Si no reconoces este cambio, escríbenos a soporte@acuarius.app.',
      });
      return jsonResp({ ok: true, aviso });
    }

    return jsonResp({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    try {
      const { registrarError } = await import('./_registro-errores.js');
      await registrarError({ origen: 'api', donde: 'llaves-api', error: e, usuario: cuenta });
    } catch {}
    return jsonResp({ error: 'No se pudo completar. Reintenta en unos segundos.' }, 500);
  }
}
