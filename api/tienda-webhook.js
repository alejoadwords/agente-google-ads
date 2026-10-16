// api/tienda-webhook.js — receptor de los avisos de Shopify y WooCommerce.
//
//   POST https://app.acuarius.app/api/tienda-webhook?t=<token de la tienda>
//
// Comprueba la firma, guarda el aviso crudo en tienda_eventos y responde. Nada
// más: Shopify corta a los 5 segundos y, si falla muchas veces, BORRA la
// suscripción. El trabajo de verdad lo hace api/cron-tiendas.js.
//
// Si la base no responde se devuelve 503: las dos plataformas reintentan, así
// que el aviso vuelve. Un aviso repetido (mismo id de entrega) entra una vez.
export const config = { runtime: 'edge' };

import { descifrar } from './_cifrado.js';
import { firmaValida, claseDeTema, hmacBase64 } from './_tienda.js';

// Tiendanube firma con el secreto de NUESTRA app; según la versión la firma
// llega en hex o en base64, así que se aceptan las dos.
async function firmaNubeValida(secreto, cuerpo, recibida) {
  if (!secreto || !recibida) return false;
  const b64 = await hmacBase64(secreto, cuerpo);
  const hex = [...atob(b64)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return iguales(b64, recibida) || iguales(hex, String(recibida).toLowerCase());
}
function iguales(a, b) {
  a = String(a || ''); b = String(b || '').trim();
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
import { registrarError } from './_registro-errores.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
const MAX_BYTES = 2 * 1024 * 1024;

const resp = (status, cuerpo) => new Response(cuerpo ? JSON.stringify(cuerpo) : null, { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return resp(405, { error: 'Solo POST' });
  const token = new URL(req.url).searchParams.get('t') || '';
  if (!/^[a-f0-9]{40}$/.test(token)) return resp(404, { error: 'Tienda desconocida' });

  const cuerpo = await req.text();
  if (cuerpo.length > MAX_BYTES) return resp(413, { error: 'Demasiado grande' });

  let tienda;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?token=eq.${token}&select=id,user_id,plataforma,credenciales,secreto,activo&limit=1`, { headers: sbH() });
    if (!r.ok) throw new Error('Supabase ' + r.status);
    tienda = (await r.json())?.[0];
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'tienda-webhook.tienda', error: e });
    return resp(503, { error: 'No disponible, reintenta' });
  }
  // Una tienda desconectada responde 200 igual: con un 4xx Shopify sigue
  // reintentando durante 48 horas algo que ya no queremos.
  if (!tienda || !tienda.activo) return resp(200, { ok: true, ignorado: 'tienda desconectada' });

  const plataforma = tienda.plataforma;
  const esShopify = plataforma === 'shopify';

  // VTEX, al configurar el aviso, manda un {hookConfig: 'ping'} que tiene que
  // recibir 200; si no, no guarda la configuración.
  if (plataforma === 'vtex' && /"hookConfig"\s*:\s*"ping"/.test(cuerpo)) return resp(200, { ok: true, ping: true });

  let tema = null;
  if (esShopify) tema = req.headers.get('x-shopify-topic');
  else if (plataforma === 'woocommerce') tema = req.headers.get('x-wc-webhook-topic');
  // WooCommerce, al crear el webhook, manda un «ping» sin tema ni firma
  // (webhook_id=123). Responder 200 es lo que lo deja activo.
  if (plataforma === 'woocommerce' && !tema) return resp(200, { ok: true, ping: true });

  let secreto = null;
  try {
    if (esShopify) secreto = JSON.parse(await descifrar(tienda.credenciales) || '{}').client_secret || null;
    else if (plataforma === 'tiendanube') secreto = process.env.TIENDANUBE_CLIENT_SECRET || null;
    else secreto = await descifrar(tienda.secreto);
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'tienda-webhook.secreto', error: e, usuario: tienda.user_id });
    return resp(503, { error: 'No disponible, reintenta' });
  }
  let valida = false;
  if (esShopify) valida = await firmaValida(secreto, cuerpo, req.headers.get('x-shopify-hmac-sha256'));
  else if (plataforma === 'woocommerce') valida = await firmaValida(secreto, cuerpo, req.headers.get('x-wc-webhook-signature'));
  else if (plataforma === 'tiendanube') valida = await firmaNubeValida(secreto, cuerpo, req.headers.get('x-linkedstore-hmac-sha256'));
  else valida = iguales(secreto, req.headers.get('x-acuarius-secreto'));
  if (!valida) {
    await registrarError({ origen: 'servidor', donde: 'tienda-webhook.firma', error: new Error('Firma de ' + plataforma + ' inválida'), usuario: tienda.user_id });
    return resp(401, { error: 'Firma inválida' });
  }

  let payload;
  try { payload = JSON.parse(cuerpo); } catch { return resp(200, { ok: true, ignorado: 'no es JSON' }); }
  if (plataforma === 'tiendanube') tema = payload.event || null;
  if (plataforma === 'vtex') tema = payload.OrderId ? 'orden' : null;
  if (!claseDeTema(plataforma, tema)) return resp(200, { ok: true, ignorado: tema });

  // El id de entrega: con él, un aviso reintentado entra una vez. Tiendanube y
  // VTEX no mandan uno, pero cada evento ocurre una vez por pedido y estado.
  let entrega;
  if (esShopify) entrega = req.headers.get('x-shopify-webhook-id') || req.headers.get('x-shopify-event-id');
  else if (plataforma === 'woocommerce') entrega = req.headers.get('x-wc-webhook-delivery-id');
  else if (plataforma === 'tiendanube') entrega = tema + ':' + payload.id + (tema.startsWith('product/') && tema !== 'product/deleted' ? ':' + Date.now() : '');
  else entrega = 'orden:' + payload.OrderId + ':' + (payload.State || '') + ':' + (payload.LastChange || '');
  entrega = entrega || (tema + ':' + (payload.id || payload.token || '') + ':' + (payload.updated_at || payload.date_modified_gmt || cuerpo.length));
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tienda_eventos?on_conflict=tienda_id,entrega`, {
      method: 'POST',
      headers: sbH({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify({ tienda_id: tienda.id, user_id: tienda.user_id, tema, entrega: String(entrega).slice(0, 200), payload }),
    });
    if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
    await fetch(`${SUPABASE_URL}/rest/v1/tiendas?id=eq.${tienda.id}`, {
      method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ ultimo_evento_at: new Date().toISOString() }),
    }).catch(() => {});
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'tienda-webhook.guardar', error: e, usuario: tienda.user_id });
    return resp(503, { error: 'No disponible, reintenta' });
  }
  return resp(200, { ok: true });
}
