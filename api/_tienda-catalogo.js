// api/_tienda-catalogo.js — credenciales y catálogo de una tienda conectada.
//
// Lo comparten api/tiendas.js (al conectar y con «Sincronizar») y
// api/cron-tiendas.js (la sincronización por partes y los avisos de producto).
// Los productos van a client_products, el mismo catálogo que ya lee el agente
// (_inbox-engine.js): así el agente ofrece lo que hay, con su precio y stock.
// Solo se importa desde edge.

import { cifrar, descifrar } from './_cifrado.js';
import { tokenShopify, gqlShopify, wooFetch, Q_PRODUCTOS_SHOPIFY, shopifyGqlAProducto,
         normalizarProductoShopify, normalizarProductoWoo } from './_tienda.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });

export async function sbTienda(ruta, metodo = 'GET', cuerpo = null, prefer) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, {
    method: metodo, headers: sbH(prefer ? { Prefer: prefer } : {}),
    ...(cuerpo !== null ? { body: JSON.stringify(cuerpo) } : {}),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} en ${ruta.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
  if (r.status === 204 || prefer === 'return=minimal') return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export async function credencialesDe(tienda) {
  return JSON.parse((await descifrar(tienda.credenciales)) || '{}');
}

// El token de Shopify vence a las 24 h: se reusa mientras le queden 10
// minutos y se pide otro si no. El nuevo se guarda cifrado.
export async function accesoShopify(tienda, creds) {
  if (creds.token) return creds.token;
  if (tienda.acceso && tienda.acceso_vence && Date.parse(tienda.acceso_vence) - Date.now() > 10 * 60000) return descifrar(tienda.acceso);
  const t = await tokenShopify(tienda.dominio, creds);
  const acceso = await cifrar(t.token);
  await sbTienda(`/tiendas?id=eq.${tienda.id}`, 'PATCH', { acceso, acceso_vence: t.vence }, 'return=minimal').catch(() => {});
  tienda.acceso = acceso; tienda.acceso_vence = t.vence;
  return t.token;
}

function filaProducto(tienda, prod, ahoraIso) {
  return { ...prod, user_id: tienda.user_id, client_id: tienda.client_id || null, tienda_id: tienda.id, visto_en: ahoraIso };
}

/** Un producto que avisó la tienda (alta o cambio). */
export async function guardarProducto(tienda, payload) {
  const prod = tienda.plataforma === 'shopify'
    ? normalizarProductoShopify(payload, tienda.dominio_publico || null)
    : normalizarProductoWoo(payload);
  await sbTienda('/client_products?on_conflict=user_id,client_id,referencia', 'POST',
    filaProducto(tienda, prod, new Date().toISOString()), 'resolution=merge-duplicates,return=minimal');
}

export async function borrarProducto(tienda, payload) {
  const ref = (tienda.plataforma === 'shopify' ? 'SHP-' : 'WOO-') + payload.id;
  await sbTienda(`/client_products?tienda_id=eq.${tienda.id}&referencia=eq.${encodeURIComponent(ref)}`, 'DELETE', null, 'return=minimal');
}

/**
 * Sincronización completa por partes. `cursor_productos` guarda dónde va
 * ({c, desde}); cuando termina, borra lo que la tienda ya no tiene (lo que no
 * se vio desde que empezó) y cuenta. Devuelve {terminada, vistos}.
 */
export async function sincronizarProductos(tienda, { topeMs = 9000 } = {}) {
  const t0 = Date.now();
  let estado = {};
  try { estado = JSON.parse(tienda.cursor_productos || '{}') || {}; } catch {}
  const desde = estado.desde || new Date().toISOString();
  let cursor = estado.c || null, pagina = estado.p || 1, vistos = 0, terminada = false;
  const creds = await credencialesDe(tienda);
  const token = tienda.plataforma === 'shopify' ? await accesoShopify(tienda, creds) : null;

  while (Date.now() - t0 < topeMs) {
    let productos = [], sigue = false;
    if (tienda.plataforma === 'shopify') {
      const d = await gqlShopify(tienda.dominio, token, Q_PRODUCTOS_SHOPIFY, { c: cursor });
      productos = d.products.nodes.map(n => normalizarProductoShopify(shopifyGqlAProducto(n), tienda.dominio_publico || null));
      sigue = d.products.pageInfo.hasNextPage;
      cursor = d.products.pageInfo.endCursor;
    } else {
      const lista = await wooFetch(tienda.dominio, creds, `/products?per_page=50&page=${pagina}&status=publish`);
      productos = (lista || []).map(normalizarProductoWoo);
      sigue = (lista || []).length === 50;
      pagina++;
    }
    const ahoraIso = new Date().toISOString();
    if (productos.length) {
      await sbTienda('/client_products?on_conflict=user_id,client_id,referencia', 'POST',
        productos.map(p => filaProducto(tienda, p, ahoraIso)), 'resolution=merge-duplicates,return=minimal');
    }
    vistos += productos.length;
    if (!sigue) { terminada = true; break; }
  }

  if (terminada) {
    // Lo que no apareció en esta vuelta ya no está en la tienda.
    await sbTienda(`/client_products?tienda_id=eq.${tienda.id}&visto_en=lt.${encodeURIComponent(desde)}`, 'DELETE', null, 'return=minimal');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/client_products?tienda_id=eq.${tienda.id}&select=id`, { headers: sbH({ Prefer: 'count=exact', Range: '0-0' }) });
    const total = parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
    await sbTienda(`/tiendas?id=eq.${tienda.id}`, 'PATCH', { cursor_productos: null, productos: total, ultimo_sync_at: new Date().toISOString(), ultimo_error: null, estado: 'conectada' }, 'return=minimal');
  } else {
    await sbTienda(`/tiendas?id=eq.${tienda.id}`, 'PATCH', { cursor_productos: JSON.stringify({ c: cursor, p: pagina, desde }) }, 'return=minimal');
  }
  return { terminada, vistos };
}
