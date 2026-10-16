// api/_tienda-vtex.js — VTEX, 16-10-2026.
//
// Se conecta con una App Key y un App Token que el comerciante genera en su
// admin (mejor una llave SOLO para Acuarius: VTEX admite un único aviso de
// pedidos por llave, y con una llave compartida pisaríamos el de otro).
//
// Lo que VTEX da y lo que no:
//   · Avisa cada cambio de estado de un pedido (Orders Hook) con {OrderId,
//     State}; el pedido completo se pide después a la API (lo hace el cron).
//     El aviso lleva una cabecera secreta que elegimos al configurarlo.
//   · NO tiene carrito abandonado por API ni avisa cambios de catálogo: el
//     catálogo se relee entero una vez al día.
//   · Los importes vienen en centavos.
//   · El correo del cliente puede venir enmascarado («ana@x.co-1a2b.ct.vtex.com.br»):
//     el real es lo de antes del sufijo.
// Solo se importa desde edge.

export const ESTADOS_PAGADO = ['payment-approved', 'ready-for-handling', 'start-handling', 'handling', 'window-to-cancel', 'invoice', 'invoiced'];

export function cuentaVtex(entrada) {
  const s = String(entrada || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const m = s.match(/^([a-z0-9][a-z0-9-]*)(\.vtexcommercestable\.com\.br|\.myvtex\.com)?$/);
  if (!m) return { error: 'Escribe el nombre de la cuenta VTEX (lo ves en la dirección del admin: micuenta.myvtex.com/admin → «micuenta»).' };
  return { cuenta: m[1], dominio: `https://${m[1]}.vtexcommercestable.com.br` };
}

export function errorVtex(status, cuerpo) {
  if (status === 401 || status === 403) return 'VTEX no aceptó la llave. Revisa la App Key y el App Token, y que la llave tenga un rol con acceso a Pedidos (OMS) y al Catálogo.';
  if (status === 404) return 'VTEX no encontró esa cuenta o esa ruta. Revisa el nombre de la cuenta.';
  if (status === 429) return 'VTEX nos pidió esperar un momento.';
  return 'VTEX respondió ' + status + (cuerpo ? ': ' + String(cuerpo).slice(0, 120) : '') + '.';
}

export async function vtexFetch(base, creds, ruta, opciones = {}) {
  const r = await fetch(base.replace(/\/+$/, '') + ruta, {
    ...opciones,
    headers: { 'X-VTEX-API-AppKey': creds.app_key, 'X-VTEX-API-AppToken': creds.app_token, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(errorVtex(r.status, texto));
  return texto ? JSON.parse(texto) : null;
}

/** Configura el aviso de pedidos hacia Acuarius, con nuestra cabecera secreta. */
export async function hookVtex(base, creds, destino, secreto) {
  await vtexFetch(base, creds, '/api/orders/hook/config', {
    method: 'POST',
    body: JSON.stringify({
      filter: { type: 'FromWorkflow', status: ['payment-pending', ...ESTADOS_PAGADO, 'canceled'] },
      hook: { url: destino, headers: { 'x-acuarius-secreto': secreto } },
    }),
  });
  return { ids: { orders: 'hook' }, fallidos: [] };
}

export async function borrarHookVtex(base, creds) {
  await vtexFetch(base, creds, '/api/orders/hook/config', { method: 'DELETE' }).catch(() => {});
}

// ── Normalización ───────────────────────────────────────────────────────────
const limpio = (v, n = 160) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const centavos = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n / 100 : null; };
const fecha = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const sinHtml = (h, n = 500) => limpio(String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'), n) || null;

/** El correo real detrás del enmascarado de VTEX; null si viene tapado con asteriscos. */
export function correoVtex(e) {
  const s = String(e || '').trim().toLowerCase();
  if (!s || s.includes('*')) return null;
  return s.replace(/-[a-z0-9]+\.ct\.vtex\.com\.br$/, '') || null;
}

export function normalizarPedidoVtex(o) {
  const cp = o.clientProfileData || {};
  const st = String(o.status || '').toLowerCase();
  let estado = 'pendiente';
  if (st === 'canceled' || st === 'cancel' || st === 'canceling') estado = 'cancelado';
  else if (st === 'invoiced') estado = 'enviado';
  else if (ESTADOS_PAGADO.includes(st)) estado = 'pagado';
  const telefono = String(cp.phone || '').includes('*') ? null : (cp.phone || null);
  return {
    externo_id: String(o.orderId),
    numero: limpio(o.orderId, 40),
    checkout: o.orderGroup || null,
    nombre: limpio([cp.firstName, cp.lastName].filter(Boolean).join(' '), 120) || null,
    email: correoVtex(cp.email),
    telefono: telefono && telefono.replace(/\D/g, '').length >= 7 ? telefono : null,
    total: centavos(o.value),
    moneda: (o.storePreferencesData || {}).currencyCode || null,
    estado,
    productos: (o.items || []).slice(0, 30).map(i => ({ nombre: limpio(i.name), cantidad: i.quantity || 1, precio: centavos(i.sellingPrice ?? i.price) })),
    enlace: null,
    creado_at: fecha(o.creationDate),
    pagado_at: ['pagado', 'enviado'].includes(estado) ? fecha(o.authorizedDate || o.lastChange || o.creationDate) : null,
    enviado_at: estado === 'enviado' ? fecha(o.invoicedDate || o.lastChange) : null,
  };
}

// De la búsqueda pública del catálogo: precio y stock del primer vendedor de
// cada SKU; el producto se ofrece si algún SKU tiene unidades.
export function normalizarProductoVtex(p) {
  const ofertas = (p.items || []).flatMap(i => (i.sellers || []).slice(0, 1).map(s => s.commertialOffer || {}));
  const precios = ofertas.map(o => Number(o.Price)).filter(n => n > 0);
  const unidades = ofertas.reduce((a, o) => a + Math.max(0, parseInt(o.AvailableQuantity, 10) || 0), 0);
  const categoria = String((p.categories || [])[0] || '').split('/').filter(Boolean).pop() || null;
  const tallas = [...new Set((p.items || []).map(i => i.name).filter(Boolean))].slice(0, 12);
  const desc = [sinHtml(p.description), tallas.length > 1 ? 'Opciones — ' + tallas.map(t => limpio(t, 40)).join(', ') : null].filter(Boolean).join('\n');
  return {
    referencia: 'VTEX-' + p.productId,
    nombre: limpio(p.productName, 200) || 'Producto sin nombre',
    tipo: limpio(categoria, 80) || null,
    coleccion: limpio(p.brand, 80) || null,
    precio: precios.length ? Math.min(...precios) : null,
    fotos: ((p.items || [])[0]?.images || []).slice(0, 4).map(i => i.imageUrl).filter(Boolean),
    url: p.link || null,
    descripcion: desc || null,
    disponible: unidades > 0,
    unidades,
  };
}
