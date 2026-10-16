// api/tienda-oauth.js — la vuelta de Tiendanube al autorizar la app de Acuarius.
//
//   GET /api/tienda-oauth?code=…&state=…
//
// Tiendanube redirige aquí (es la URL configurada en la app del portal de
// Partners). El `state` lo firmamos al empezar (api/tiendas.js?conectar=…) y
// dice de qué cuenta es; sin él válido no se conecta nada. Al terminar se
// vuelve a la app, a Fuentes, con el resultado en la URL para mostrarlo.
export const config = { runtime: 'edge' };

import { cifrar } from './_cifrado.js';
import { APP } from './_tienda.js';
import { leerEstado, tokenNube, nubeFetch, webhooksNube, tx } from './_tienda-nube.js';
import { sbTienda, sincronizarProductos } from './_tienda-catalogo.js';
import { registrarError } from './_registro-errores.js';

const enc = encodeURIComponent;
const volver = (q) => Response.redirect(`${APP}/?ir=fuentes&${q}`, 302);
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

export default async function handler(req) {
  const url = new URL(req.url);
  const estado = await leerEstado(url.searchParams.get('state'));
  if (!estado || !estado.u) return volver('tienda_error=' + enc('El enlace de autorización venció o no es válido. Vuelve a conectar desde Acuarius.'));
  const codigo = url.searchParams.get('code');
  if (!codigo) return volver('tienda_error=' + enc('Tiendanube no autorizó la conexión.'));
  const userId = estado.u, clientId = estado.c || null;
  try {
    const { token, storeId } = await tokenNube(codigo);
    const info = await nubeFetch(storeId, token, '/store');
    const dominio = 'https://' + (info.original_domain || (storeId + '.mitiendanube.com'));
    const previa = ((await sbTienda(`/tiendas?user_id=eq.${enc(userId)}${clientId ? `&client_id=eq.${enc(clientId)}` : '&client_id=is.null'}&plataforma=eq.tiendanube&dominio=eq.${enc(dominio)}&select=id,token&limit=1`)) || [])[0];
    const tokenWebhook = previa?.token || hex(20);
    const webhooks = await webhooksNube(storeId, token, `${APP}/api/tienda-webhook?t=${tokenWebhook}`);
    if (!['order/created', 'order/paid'].some(e => webhooks.ids[e])) {
      throw new Error('Tiendanube no dejó crear los avisos de pedidos: ' + webhooks.fallidos.map(f => f.motivo).join(' · ').slice(0, 200));
    }
    const nombre = tx(info.name) || dominio.replace(/^https:\/\//, '');
    const fila = {
      user_id: userId, client_id: clientId, plataforma: 'tiendanube', dominio,
      dominio_publico: info.url_with_protocol || dominio,
      credenciales: await cifrar(JSON.stringify({ store_id: storeId, token })),
      token: tokenWebhook, nombre, moneda: info.main_currency || null,
      activo: true, estado: 'conectada', ultimo_error: null, webhooks,
      cursor_productos: JSON.stringify({ desde: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    };
    const guardada = ((await sbTienda('/tiendas?on_conflict=user_id,client_id,plataforma,dominio', 'POST', fila, 'resolution=merge-duplicates,return=representation')) || [])[0];
    if (guardada) await sincronizarProductos(guardada, { topeMs: 6000 }).catch(() => {});
    return volver('tienda=ok&nombre=' + enc(nombre));
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'tienda-oauth', error: e, usuario: userId });
    return volver('tienda_error=' + enc(e.message || 'error'));
  }
}
