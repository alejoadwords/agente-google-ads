// api/tiendas.js — conectar y ver las tiendas en línea (Shopify, WooCommerce).
//
//   GET                                   las tiendas del alcance y sus cifras de 30 días
//   GET ?ventas=1                         los datos del informe «Tienda» de Análisis (_tienda-ventas.js)
//   POST {accion:'conectar', plataforma, dominio, client_id, client_secret | token | ck, cs}
//   POST {accion:'sincronizar', id}       vuelve a leer todo el catálogo
//   POST {accion:'desconectar', id}       quita webhooks, productos y credenciales
//   POST {accion:'historial', id, rango}  trae los pedidos anteriores ('90' | '365' | 'todo')
//
// Conectar PRUEBA antes de guardar: las credenciales, que la API responde y
// que los webhooks se crean. Una tienda guardada «conectada» que nunca manda
// nada es el peor fallo posible: nadie se entera hasta que falta una venta.
//
// Solo el dueño y los administradores conectan o desconectan. Las
// credenciales nunca vuelven al navegador.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { quienPregunta, alcanceDeCliente, puedeVer, soloLoSuyo } from './_perfiles.js';
import { cifrar } from './_cifrado.js';
import { dominioShopify, dominioWoo, tokenShopify, gqlShopify, Q_TIENDA_SHOPIFY, webhooksShopify, borrarWebhooksShopify,
         wooFetch, webhooksWoo, borrarWebhooksWoo, APP } from './_tienda.js';
import { ventasDeTienda } from './_tienda-ventas.js';
import { sbTienda, credencialesDe, accesoShopify, sincronizarProductos, avanzarHistorial } from './_tienda-catalogo.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const jsonResp = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const enc = encodeURIComponent;
const CAMPOS = 'id,plataforma,dominio,dominio_publico,nombre,moneda,activo,estado,ultimo_error,productos,pedidos,ultimo_evento_at,ultimo_sync_at,cursor_productos,webhooks,historial,created_at';

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try { return await manejar(req); }
  catch (e) { return jsonResp({ error: e?.message || 'Error con la tienda' }, 500); }
}

async function manejar(req) {
  const sesion = await verificarSesion(req);
  if (!sesion.id) return jsonResp(await cuerpoSinSesion(sesion, 'tiendas'), 401);
  let quien;
  try { quien = await quienPregunta(sesion.id); }
  catch (e) { return jsonResp({ error: e.message }, e.suspendida ? 403 : 503); }
  const userId = quien.userId;
  const clientId = alcanceDeCliente(quien, new URL(req.url).searchParams.get('client_id') || null) || null;
  const alcance = `user_id=eq.${enc(userId)}` + (clientId ? `&client_id=eq.${enc(clientId)}` : '&client_id=is.null');

  if (req.method === 'GET' && new URL(req.url).searchParams.get('ventas')) {
    // Lo que vende la tienda es cifra de quien dirige: un perfil que en
    // Análisis solo ve su propia gestión no ve el total del negocio.
    if (quien.esMiembro && (!puedeVer(quien.perfil, 'analisis') || soloLoSuyo(quien.perfil))) {
      return jsonResp({ error: 'El informe de la tienda lo ven el dueño y los administradores.', sin_permiso: true }, 403);
    }
    return jsonResp(await ventasDeTienda(userId, clientId));
  }
  if (req.method === 'GET') {
    const tiendas = (await sbTienda(`/tiendas?${alcance}&activo=is.true&select=${CAMPOS}&order=created_at.asc`)) || [];
    const desde = new Date(Date.now() - 30 * 86400000).toISOString();
    const filas = tiendas.length
      ? (await sbTienda(`/tienda_pedidos?tienda_id=in.(${tiendas.map(t => t.id).join(',')})&updated_at=gte.${enc(desde)}&select=tienda_id,tipo,estado,total,pagado_at&limit=5000`)) || []
      : [];
    for (const t of tiendas) {
      const mias = filas.filter(f => f.tienda_id === t.id);
      const pagados = mias.filter(f => f.tipo === 'pedido' && f.pagado_at && Date.parse(f.pagado_at) >= Date.parse(desde) && !['cancelado', 'reembolsado'].includes(f.estado));
      t.resumen = {
        pedidos: pagados.length,
        ventas: pagados.reduce((a, f) => a + (Number(f.total) || 0), 0),
        carritos: mias.filter(f => f.tipo === 'carrito' && f.estado === 'abandonado').length,
        recuperados: mias.filter(f => f.tipo === 'carrito' && f.estado === 'recuperado').length,
      };
      t.sincronizando = t.cursor_productos != null;
      t.webhooks_fallidos = (t.webhooks && t.webhooks.fallidos) || [];
      delete t.cursor_productos; delete t.webhooks;
    }
    return jsonResp({ tiendas });
  }
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  if (quien.esMiembro && quien.perfil !== 'admin') return jsonResp({ error: 'Solo el dueño o un administrador puede conectar la tienda.' }, 403);
  const body = await req.json().catch(() => ({}));

  if (body.accion === 'conectar') return conectar(body, userId, clientId);

  const tienda = body.id ? ((await sbTienda(`/tiendas?id=eq.${enc(body.id)}&${alcance}&select=*&limit=1`)) || [])[0] : null;
  if (!tienda) return jsonResp({ error: 'No encontramos esa tienda.' }, 404);

  if (body.accion === 'sincronizar') {
    await sbTienda(`/tiendas?id=eq.${tienda.id}`, 'PATCH', { cursor_productos: JSON.stringify({ desde: new Date().toISOString() }) }, 'return=minimal');
    tienda.cursor_productos = JSON.stringify({ desde: new Date().toISOString() });
    const r = await sincronizarProductos(tienda, { topeMs: 8000 }).catch(e => ({ error: e.message }));
    if (r.error) return jsonResp({ error: r.error }, 502);
    return jsonResp({ ok: true, ...r });
  }

  if (body.accion === 'historial') {
    if (tienda.historial?.estado === 'corriendo') return jsonResp({ error: 'El historial ya se está trayendo.' }, 409);
    const dias = { '90': 90, '365': 365 }[String(body.rango)] || null;
    if (!dias && body.rango !== 'todo') return jsonResp({ error: 'Elige desde cuándo.' }, 400);
    const h = {
      estado: 'corriendo', rango: String(body.rango),
      desde: dias ? new Date(Date.now() - dias * 86400000).toISOString() : null,
      pagina: null, pedidos: 0, clientes: 0, leidos: 0, empezo_at: new Date().toISOString(),
    };
    await sbTienda(`/tiendas?id=eq.${tienda.id}`, 'PATCH', { historial: h }, 'return=minimal');
    // La primera tanda ya mismo, para ver que arrancó; el resto, el cron.
    const r = await avanzarHistorial({ ...tienda, historial: h }, { topeMs: 15000 });
    if (r.estado === 'error') return jsonResp({ error: r.error }, 502);
    return jsonResp({ ok: true, historial: r });
  }

  if (body.accion === 'desconectar') {
    // Primero los webhooks de su lado, para que deje de mandarnos avisos. Si
    // la tienda ya no responde (llaves revocadas) se sigue igual: lo que manden
    // después se ignora porque la tienda queda inactiva.
    try {
      const creds = await credencialesDe(tienda);
      const ids = (tienda.webhooks && tienda.webhooks.ids) || {};
      if (tienda.plataforma === 'shopify') await borrarWebhooksShopify(tienda.dominio, await accesoShopify(tienda, creds), ids);
      else await borrarWebhooksWoo(tienda.dominio, creds, ids);
    } catch {}
    await sbTienda(`/client_products?tienda_id=eq.${tienda.id}`, 'DELETE', null, 'return=minimal');
    await sbTienda(`/tiendas?id=eq.${tienda.id}`, 'PATCH', {
      activo: false, credenciales: '', acceso: null, acceso_vence: null, secreto: null, cursor_productos: null,
      productos: 0, estado: 'desconectada', updated_at: new Date().toISOString(),
    }, 'return=minimal');
    return jsonResp({ ok: true });
  }
  return jsonResp({ error: 'Acción no válida' }, 400);
}

async function conectar(body, userId, clientId) {
  const plataforma = body.plataforma;
  if (!['shopify', 'woocommerce'].includes(plataforma)) return jsonResp({ error: 'Elige Shopify o WooCommerce.' }, 400);
  const d = plataforma === 'shopify' ? dominioShopify(body.dominio) : dominioWoo(body.dominio);
  if (d.error) return jsonResp({ error: d.error }, 400);
  const dominio = d.dominio;

  // Reconectar la misma tienda reusa su fila (y su token de webhook).
  const previa = ((await sbTienda(`/tiendas?user_id=eq.${enc(userId)}${clientId ? `&client_id=eq.${enc(clientId)}` : '&client_id=is.null'}&plataforma=eq.${plataforma}&dominio=eq.${enc(dominio)}&select=id,token&limit=1`)) || [])[0];
  const token = previa?.token || hex(20);
  const destino = `${APP}/api/tienda-webhook?t=${token}`;

  let creds, nombre = null, moneda = null, dominioPublico = null, secreto = null, acceso = null, accesoVence = null, webhooks;
  try {
    if (plataforma === 'shopify') {
      creds = {
        client_id: String(body.client_id || '').trim(),
        client_secret: String(body.client_secret || '').trim(),
        ...(String(body.token || '').trim() ? { token: String(body.token).trim() } : {}),
      };
      if (!creds.client_secret || (!creds.client_id && !creds.token)) return jsonResp({ error: 'Faltan el Client ID y el secreto de la app.' }, 400);
      const t = await tokenShopify(dominio, creds);
      const info = await gqlShopify(dominio, t.token, Q_TIENDA_SHOPIFY);
      nombre = info.shop?.name || null;
      moneda = info.shop?.currencyCode || null;
      dominioPublico = info.shop?.primaryDomain?.url || ('https://' + dominio);
      if (t.vence) { acceso = await cifrar(t.token); accesoVence = t.vence; }
      webhooks = await webhooksShopify(dominio, t.token, destino);
    } else {
      creds = { ck: String(body.ck || '').trim(), cs: String(body.cs || '').trim() };
      if (!/^ck_/.test(creds.ck) || !/^cs_/.test(creds.cs)) return jsonResp({ error: 'La clave empieza por ck_ y el secreto por cs_. Cópialos completos desde WooCommerce → Ajustes → Avanzado → API REST.' }, 400);
      await wooFetch(dominio, creds, '/products?per_page=1');
      const mon = await wooFetch(dominio, creds, '/settings/general/woocommerce_currency').catch(() => null);
      moneda = mon?.value || null;
      nombre = await fetch(dominio + '/wp-json/').then(r => r.ok ? r.json() : null).then(x => x?.name || null).catch(() => null);
      secreto = hex(24);
      webhooks = await webhooksWoo(dominio, creds, destino, secreto);
    }
  } catch (e) {
    return jsonResp({ error: e.message }, 400);
  }

  // Sin los avisos de pedidos la conexión no sirve para lo que se conecta.
  const pedidosOk = plataforma === 'shopify'
    ? ['ORDERS_CREATE', 'ORDERS_UPDATED'].some(t => webhooks.ids[t])
    : ['order.created', 'order.updated'].some(t => webhooks.ids[t]);
  if (!pedidosOk) {
    const motivo = webhooks.fallidos.map(f => f.motivo).join(' · ');
    const protegidos = /protected customer data|customer data|datos de clientes/i.test(motivo);
    return jsonResp({
      error: protegidos
        ? 'Shopify no deja enviar los pedidos hasta que la app pida acceso a los datos de clientes. En el Dev Dashboard, abre la app → «Acceso a datos protegidos de clientes» y marca nombre, correo, teléfono y dirección; luego vuelve a conectar.'
        : 'La tienda respondió, pero no pudimos crear los avisos de pedidos: ' + motivo.slice(0, 300),
    }, 400);
  }

  const fila = {
    user_id: userId, client_id: clientId, plataforma, dominio, dominio_publico: dominioPublico,
    credenciales: await cifrar(JSON.stringify(creds)), acceso, acceso_vence: accesoVence,
    token, secreto: secreto ? await cifrar(secreto) : null, nombre: nombre || dominio.replace(/^https?:\/\//, ''), moneda,
    activo: true, estado: 'conectada', ultimo_error: null, webhooks,
    cursor_productos: JSON.stringify({ desde: new Date().toISOString() }),
    updated_at: new Date().toISOString(),
  };
  const guardada = ((await sbTienda('/tiendas?on_conflict=user_id,client_id,plataforma,dominio', 'POST', fila, 'resolution=merge-duplicates,return=representation')) || [])[0];
  if (!guardada) return jsonResp({ error: 'No se pudo guardar la tienda.' }, 502);

  // La primera parte del catálogo ya mismo: ver «32 productos» al conectar es
  // la prueba de que funcionó. El resto lo termina el cron.
  const sync = await sincronizarProductos(guardada, { topeMs: 7000 }).catch(e => ({ error: e.message }));
  return jsonResp({
    ok: true, id: guardada.id, nombre: guardada.nombre, productos: sync.vistos || 0, terminada: !!sync.terminada,
    aviso_catalogo: sync.error || null,
    avisos_webhooks: webhooks.fallidos.map(f => f.tema),
  });
}
