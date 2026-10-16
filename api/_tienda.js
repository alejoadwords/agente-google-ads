// api/_tienda.js — tiendas en línea: Shopify y WooCommerce (15-10-2026).
//
// Lo que entra de una tienda es lo que mueve el negocio de quien vende en
// línea: pedidos, carritos que se quedan a medias y el catálogo con su stock.
// Este módulo habla con las dos plataformas y traduce lo que mandan a UNA sola
// forma, para que el motor (_tienda-motor.js) no sepa de dónde vino cada cosa.
//
// Cómo se conecta cada una, y por qué así:
//   · Shopify: desde enero de 2026 ya no se crean «apps personalizadas» desde
//     el admin; la tienda crea una app en el Dev Dashboard, la instala en su
//     tienda y nos da su Client ID y su secreto. Con eso pedimos un token de
//     24 h (client credentials) cada vez que vence. Sin app pública, sin
//     revisión de la App Store. Si alguien trae un token viejo (shpat_…) de
//     una app de las de antes, también sirve.
//   · WooCommerce: llaves de la API REST (ck_/cs_) con permiso de lectura y
//     escritura; escritura solo porque crear los webhooks lo exige.
//
// Solo se importa desde funciones edge.

export const SHOPIFY_API = '2025-07';
export const APP = 'https://app.acuarius.app';

// ── Dominios ────────────────────────────────────────────────────────────────
// La gente pega lo que tiene en la barra: «mitienda», «mitienda.myshopify.com»,
// «https://admin.shopify.com/store/mitienda». La API de Shopify solo responde
// en el dominio .myshopify.com, nunca en el propio (mitienda.com).
export function dominioShopify(entrada) {
  const s = String(entrada || '').trim().toLowerCase();
  const admin = s.match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin) return { dominio: admin[1] + '.myshopify.com' };
  const limpio = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(limpio)) return { dominio: limpio };
  if (/^[a-z0-9][a-z0-9-]*$/.test(limpio)) return { dominio: limpio + '.myshopify.com' };
  if (limpio.includes('.')) return { error: 'Usa la dirección que termina en .myshopify.com (la ves en Shopify → Configuración → Dominios). Con el dominio propio la API de Shopify no responde.' };
  return { error: 'Escribe la dirección de tu tienda, por ejemplo mitienda.myshopify.com.' };
}

export function dominioWoo(entrada) {
  let s = String(entrada || '').trim();
  if (!s) return { error: 'Escribe la dirección de tu tienda, por ejemplo https://mitienda.com.' };
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return { error: 'Esa dirección no es válida.' }; }
  // Las llaves viajan en cada petición: por http irían a la vista de cualquiera.
  if (u.protocol !== 'https:') return { error: 'La tienda tiene que abrir con https:// — WooCommerce no deja usar la API sin él.' };
  const ruta = u.pathname.replace(/\/(wp-admin|wp-json|tienda|shop)(\/.*)?$/i, '').replace(/\/+$/, '');
  return { dominio: u.origin + ruta };
}

// ── Firmas ──────────────────────────────────────────────────────────────────
// Las dos firman igual: HMAC‑SHA256 del cuerpo CRUDO, en base64. Shopify con el
// secreto de la app; WooCommerce con el que elegimos al crear el webhook. Se
// firma el texto tal como llegó: re-serializar el JSON cambia los bytes.
export async function hmacBase64(secreto, cuerpo) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secreto)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(cuerpo)));
  let s = '';
  for (const b of firma) s += String.fromCharCode(b);
  return btoa(s);
}

export async function firmaValida(secreto, cuerpo, recibida) {
  if (!secreto || !recibida) return false;
  const esperada = await hmacBase64(secreto, cuerpo);
  const a = String(recibida).trim();
  if (a.length !== esperada.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ esperada.charCodeAt(i);
  return dif === 0;
}

// ── Temas de los webhooks ───────────────────────────────────────────────────
// A cuáles se suscribe cada tienda. Shopify: orders/updated ya trae el pago,
// el envío y la cancelación; no hace falta un aviso por cada cosa.
export const TEMAS_SHOPIFY = ['ORDERS_CREATE', 'ORDERS_UPDATED', 'CHECKOUTS_CREATE', 'CHECKOUTS_UPDATE', 'PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE'];
export const TEMAS_WOO = ['order.created', 'order.updated', 'product.created', 'product.updated', 'product.deleted'];

/** 'pedido' | 'carrito' | 'producto' | 'producto_borrado' | null (se ignora). */
export function claseDeTema(plataforma, tema) {
  const t = String(tema || '').toLowerCase();
  if (plataforma === 'shopify') {
    if (t.startsWith('orders/')) return 'pedido';
    if (t.startsWith('checkouts/')) return 'carrito';
    if (t === 'products/delete') return 'producto_borrado';
    if (t.startsWith('products/')) return 'producto';
    return null;
  }
  // Tiendanube: order/paid, product/updated… (el aviso solo trae el id).
  if (plataforma === 'tiendanube') {
    if (t.startsWith('order/')) return 'pedido';
    if (t === 'product/deleted') return 'producto_borrado';
    if (t.startsWith('product/')) return 'producto';
    return null;
  }
  // VTEX solo avisa pedidos; el receptor lo guarda con el tema 'orden'.
  if (plataforma === 'vtex') return t === 'orden' ? 'pedido' : null;
  if (t.startsWith('order.')) return t === 'order.deleted' ? null : 'pedido';
  if (t === 'product.deleted') return 'producto_borrado';
  if (t.startsWith('product.')) return 'producto';
  return null;
}

// ── Normalización ───────────────────────────────────────────────────────────
// El nombre de un producto acaba dentro del HTML de un correo: sin < ni >, y
// corto. Viene de una tienda ajena, no de quien escribe la automatización.
const limpio = (v, n = 160) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fecha = (v) => { if (!v) return null; const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? v : String(v) + 'Z'); return isNaN(d) ? null : d.toISOString(); };
const nombreDe = (...partes) => limpio(partes.filter(Boolean).join(' '), 120) || null;
const sinHtml = (h, n = 600) => limpio(String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'), n) || null;

function telefonoDe(...candidatos) {
  for (const c of candidatos) { const t = String(c || '').trim(); if (t.replace(/\D/g, '').length >= 7) return t; }
  return null;
}

export function normalizarPedidoShopify(o) {
  const c = o.customer || {}, b = o.billing_address || {}, s = o.shipping_address || {};
  const financiero = String(o.financial_status || '').toLowerCase();
  let estado = 'pendiente';
  if (o.cancelled_at) estado = 'cancelado';
  else if (financiero === 'refunded') estado = 'reembolsado';
  else if (['paid', 'partially_refunded'].includes(financiero)) estado = String(o.fulfillment_status || '').toLowerCase() === 'fulfilled' ? 'enviado' : 'pagado';
  return {
    externo_id: String(o.id),
    numero: limpio(o.name || ('#' + (o.order_number || o.id)), 40),
    checkout: o.checkout_token || null,
    nombre: nombreDe(c.first_name, c.last_name) || nombreDe(b.first_name, b.last_name) || nombreDe(s.first_name, s.last_name),
    email: String(o.email || o.contact_email || c.email || '').trim().toLowerCase() || null,
    telefono: telefonoDe(o.phone, c.phone, b.phone, s.phone),
    total: num(o.total_price),
    moneda: o.currency || null,
    estado,
    productos: (o.line_items || []).slice(0, 30).map(l => ({ nombre: limpio(l.title + (l.variant_title ? ' — ' + l.variant_title : '')), cantidad: l.quantity || 1, precio: num(l.price) })),
    enlace: o.order_status_url || null,
    creado_at: fecha(o.created_at),
    pagado_at: ['pagado', 'enviado'].includes(estado) ? fecha(o.processed_at || o.updated_at) : null,
    enviado_at: estado === 'enviado' ? fecha(o.updated_at) : null,
  };
}

export function normalizarCarritoShopify(k) {
  const c = k.customer || {}, b = k.billing_address || {}, s = k.shipping_address || {};
  return {
    externo_id: String(k.token || k.id),
    checkout: k.token || null,
    nombre: nombreDe(c.first_name, c.last_name) || nombreDe(b.first_name, b.last_name) || nombreDe(s.first_name, s.last_name),
    email: String(k.email || c.email || '').trim().toLowerCase() || null,
    telefono: telefonoDe(k.phone, c.phone, b.phone, s.phone),
    total: num(k.total_price),
    moneda: k.currency || k.presentment_currency || null,
    completado: !!k.completed_at,
    productos: (k.line_items || []).slice(0, 30).map(l => ({ nombre: limpio(l.title + (l.variant_title ? ' — ' + l.variant_title : '')), cantidad: l.quantity || 1, precio: num(l.price) })),
    enlace: k.abandoned_checkout_url || null,
    // El reloj del abandono corre desde lo ÚLTIMO que hizo: quien vuelve a
    // tocar el carrito a los 50 minutos no lo abandonó a la hora de abrirlo.
    creado_at: fecha(k.updated_at || k.created_at),
  };
}

export function normalizarPedidoWoo(o) {
  const b = o.billing || {}, s = o.shipping || {};
  const st = String(o.status || '').toLowerCase();
  const estado = { processing: 'pagado', completed: 'enviado', cancelled: 'cancelado', refunded: 'reembolsado' }[st] || 'pendiente';
  return {
    externo_id: String(o.id),
    numero: '#' + limpio(o.number || o.id, 30),
    checkout: null,
    nombre: nombreDe(b.first_name, b.last_name) || nombreDe(s.first_name, s.last_name),
    email: String(b.email || '').trim().toLowerCase() || null,
    telefono: telefonoDe(b.phone, s.phone),
    total: num(o.total),
    moneda: o.currency || null,
    estado,
    // Un pedido «pendiente de pago» o «fallido» es el carrito abandonado de
    // WooCommerce: no tiene checkouts como Shopify, pero el pedido a medias sí.
    sin_pagar: st === 'pending' || st === 'failed',
    productos: (o.line_items || []).slice(0, 30).map(l => ({ nombre: limpio(l.name), cantidad: l.quantity || 1, precio: num(l.price) ?? (num(l.total) != null && l.quantity ? num(l.total) / l.quantity : null) })),
    enlace: o.payment_url || null,
    creado_at: fecha(o.date_created_gmt || o.date_created),
    pagado_at: ['pagado', 'enviado'].includes(estado) ? fecha(o.date_paid_gmt || o.date_paid || o.date_modified_gmt) : null,
    enviado_at: estado === 'enviado' ? fecha(o.date_completed_gmt || o.date_modified_gmt) : null,
  };
}

// Un producto con sus variantes es UNA fila del catálogo: el agente ofrece
// «la camiseta básica, en S, M y L», no tres camisetas. Las opciones van a la
// descripción, que es lo que el agente lee.
export function normalizarProductoShopify(p, dominioPublico) {
  const variantes = p.variants || [];
  const precios = variantes.map(v => num(v.price)).filter(v => v != null);
  const rastreadas = variantes.filter(v => v.inventory_management || v.inventory_quantity != null);
  const unidades = rastreadas.length ? rastreadas.reduce((a, v) => a + Math.max(0, parseInt(v.inventory_quantity, 10) || 0), 0) : null;
  const vendible = variantes.some(v => v.available === true || v.inventory_policy === 'continue' || !v.inventory_management || (parseInt(v.inventory_quantity, 10) || 0) > 0);
  const opciones = (p.options || []).filter(o => (o.values || []).length > 1 || (o.values || [])[0] !== 'Default Title')
    .map(o => limpio(o.name, 30) + ': ' + (o.values || []).slice(0, 12).map(v => limpio(v, 30)).join(', ')).join(' · ');
  const desc = [sinHtml(p.body_html, 500), opciones ? 'Opciones — ' + opciones : null].filter(Boolean).join('\n');
  return {
    referencia: 'SHP-' + p.id,
    nombre: limpio(p.title, 200) || 'Producto sin nombre',
    tipo: limpio(p.product_type, 80) || null,
    coleccion: limpio(p.vendor, 80) || null,
    precio: precios.length ? Math.min(...precios) : null,
    fotos: (p.images || []).slice(0, 4).map(i => i.src).filter(Boolean),
    url: p.handle && dominioPublico ? dominioPublico.replace(/\/+$/, '') + '/products/' + p.handle : null,
    descripcion: desc || null,
    disponible: String(p.status || 'active').toLowerCase() === 'active' && vendible,
    unidades,
  };
}

// El mismo producto leído por GraphQL (la sincronización completa) se pasa a
// la forma del webhook, para que haya UN solo lector.
export function shopifyGqlAProducto(n) {
  return {
    id: n.legacyResourceId,
    title: n.title, handle: n.handle, product_type: n.productType, vendor: n.vendor,
    status: n.status, body_html: n.descriptionHtml || n.description || '',
    options: (n.options || []).map(o => ({ name: o.name, values: o.values })),
    images: (n.media?.nodes || []).map(m => ({ src: m.preview?.image?.url })).filter(i => i.src),
    variants: (n.variants?.nodes || []).map(v => ({
      price: v.price, available: v.availableForSale,
      inventory_quantity: v.inventoryQuantity,
      inventory_management: n.tracksInventory ? 'shopify' : null,
      inventory_policy: v.inventoryPolicy ? String(v.inventoryPolicy).toLowerCase() : null,
    })),
  };
}

export function normalizarProductoWoo(p) {
  const opciones = (p.attributes || []).filter(a => (a.options || []).length)
    .map(a => limpio(a.name, 30) + ': ' + a.options.slice(0, 12).map(v => limpio(v, 30)).join(', ')).join(' · ');
  const desc = [sinHtml(p.short_description || p.description, 500), opciones ? 'Opciones — ' + opciones : null].filter(Boolean).join('\n');
  return {
    referencia: 'WOO-' + p.id,
    nombre: limpio(p.name, 200) || 'Producto sin nombre',
    tipo: limpio(p.categories?.[0]?.name, 80) || null,
    coleccion: limpio(p.categories?.[1]?.name, 80) || null,
    precio: num(p.price),
    fotos: (p.images || []).slice(0, 4).map(i => i.src).filter(Boolean),
    url: p.permalink || null,
    descripcion: desc || null,
    disponible: String(p.status || 'publish') === 'publish' && p.stock_status !== 'outofstock',
    unidades: p.manage_stock ? Math.max(0, parseInt(p.stock_quantity, 10) || 0) : null,
  };
}

// ── Formato para los mensajes ───────────────────────────────────────────────
export function plata(total, moneda) {
  if (total == null) return '';
  const sinDecimales = ['COP', 'CLP', 'PYG', 'ARS'].includes(String(moneda || '').toUpperCase());
  const n = Number(total).toLocaleString('es-CO', { minimumFractionDigits: sinDecimales ? 0 : 0, maximumFractionDigits: sinDecimales ? 0 : 2 });
  return '$' + n + (moneda ? ' ' + String(moneda).toUpperCase() : '');
}

export function productosTexto(productos) {
  const l = (productos || []).filter(p => p.nombre);
  if (!l.length) return '';
  const partes = l.slice(0, 4).map(p => (p.cantidad > 1 ? p.cantidad + ' × ' : '') + p.nombre);
  return partes.join(', ') + (l.length > 4 ? ' y ' + (l.length - 4) + ' más' : '');
}

// ── Shopify: token, GraphQL ─────────────────────────────────────────────────
// Lo que dice Shopify, traducido a lo que hay que hacer.
export function errorShopify(status, cuerpo) {
  const t = String(cuerpo || '').toLowerCase();
  if (t.includes('shop_not_permitted') || t.includes('app_not_installed')) return 'La app no está instalada en esta tienda. En el Dev Dashboard, abre la app y pulsa «Instalar» en tu tienda.';
  if (t.includes('invalid_client') || status === 401) return 'Shopify no reconoce el Client ID o el secreto. Cópialos de nuevo desde la configuración de la app.';
  if (status === 404) return 'Esa tienda no existe en Shopify. Revisa la dirección .myshopify.com.';
  if (status === 402) return 'La tienda está pausada o sin plan en Shopify.';
  if (status === 423) return 'La tienda está bloqueada en Shopify.';
  if (status === 429) return 'Shopify nos pidió esperar un momento. Reintenta en un minuto.';
  return 'Shopify respondió ' + status + '.';
}

/** Pide un token de 24 h con las credenciales de la app. */
export async function tokenShopify(dominio, creds) {
  if (creds.token) return { token: creds.token, vence: null };
  const r = await fetch(`https://${dominio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.client_id, client_secret: creds.client_secret }).toString(),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(errorShopify(r.status, texto));
  let d = {};
  try { d = JSON.parse(texto); } catch {}
  if (!d.access_token) throw new Error('Shopify no devolvió un token.');
  const seg = parseInt(d.expires_in, 10) || 86399;
  return { token: d.access_token, vence: new Date(Date.now() + seg * 1000).toISOString(), scope: d.scope || '' };
}

export async function gqlShopify(dominio, token, query, variables = {}) {
  const r = await fetch(`https://${dominio}/admin/api/${SHOPIFY_API}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(errorShopify(r.status, texto));
  const d = JSON.parse(texto);
  if (d.errors?.length) {
    const m = d.errors.map(e => e.message).join(' · ');
    if (/access denied|ACCESS_DENIED|scope/i.test(m)) throw new Error('A la app le falta un permiso en Shopify (' + m.slice(0, 160) + '). Revisa que tenga read_products, read_orders, read_customers y read_inventory, publica la versión e instálala de nuevo.');
    throw new Error('Shopify: ' + m.slice(0, 200));
  }
  return d.data;
}

export const Q_TIENDA_SHOPIFY = `{ shop { name currencyCode primaryDomain { url } } }`;

export const Q_PRODUCTOS_SHOPIFY = `query($c: String) {
  products(first: 40, after: $c) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId title handle productType vendor status descriptionHtml tracksInventory
      options { name values }
      media(first: 4) { nodes { preview { image { url } } } }
      variants(first: 50) { nodes { price availableForSale inventoryQuantity inventoryPolicy } }
    }
  }
}`;

const M_WEBHOOK = `mutation($t: WebhookSubscriptionTopic!, $s: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $t, webhookSubscription: $s) { webhookSubscription { id } userErrors { field message } }
}`;
const M_WEBHOOK_BORRAR = `mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } } }`;

/** Crea las suscripciones. Devuelve {ids, fallidos: [{tema, motivo}]}. */
export async function webhooksShopify(dominio, token, destino) {
  const ids = {}, fallidos = [];
  for (const t of TEMAS_SHOPIFY) {
    try {
      const d = await gqlShopify(dominio, token, M_WEBHOOK, { t, s: { callbackUrl: destino, format: 'JSON' } });
      const res = d.webhookSubscriptionCreate;
      const err = (res.userErrors || []).map(e => e.message).join(' · ');
      if (res.webhookSubscription?.id) ids[t] = res.webhookSubscription.id;
      // Volver a conectar la misma tienda: la suscripción ya existe y sigue
      // apuntando a nosotros. No es un fallo.
      else if (/already been taken|ya existe/i.test(err)) ids[t] = 'existente';
      else fallidos.push({ tema: t, motivo: err || 'sin respuesta' });
    } catch (e) { fallidos.push({ tema: t, motivo: e.message }); }
  }
  return { ids, fallidos };
}

export async function borrarWebhooksShopify(dominio, token, ids) {
  for (const id of Object.values(ids || {})) {
    if (!String(id).startsWith('gid://')) continue;
    await gqlShopify(dominio, token, M_WEBHOOK_BORRAR, { id }).catch(() => {});
  }
}

// ── WooCommerce: REST ───────────────────────────────────────────────────────
export function errorWoo(status, cuerpo) {
  const t = String(cuerpo || '').toLowerCase();
  if (status === 401 || t.includes('woocommerce_rest_cannot') || t.includes('invalid_signature') || t.includes('authentication')) return 'WooCommerce no aceptó las llaves. Revisa que copiaste la clave (ck_…) y el secreto (cs_…) completos y que tengan permiso de Lectura/Escritura.';
  if (status === 404 || t.includes('rest_no_route')) return 'Esa dirección no tiene la API de WooCommerce. Revisa que WooCommerce esté activo y que los enlaces permanentes no estén en «Simple» (Ajustes → Enlaces permanentes).';
  if (status === 403) return 'Tu hosting o un plugin de seguridad está bloqueando la API de WooCommerce (403). Hay que permitir /wp-json/wc/.';
  return 'WooCommerce respondió ' + status + '.';
}

// Muchos hostings se comen la cabecera Authorization antes de llegar a
// WordPress. Si con ella responde 401, se prueba con las llaves en la URL,
// que es la otra forma que WooCommerce acepta por https.
export async function wooFetch(base, creds, ruta, opciones = {}) {
  const url = base.replace(/\/+$/, '') + '/wp-json/wc/v3' + ruta;
  const auth = 'Basic ' + btoa(creds.ck + ':' + creds.cs);
  const h = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Acuarius/1.0 (+https://acuarius.app)' };
  let r = await fetch(url, { ...opciones, headers: { ...h, Authorization: auth } });
  if (r.status === 401) {
    const sep = url.includes('?') ? '&' : '?';
    r = await fetch(url + sep + 'consumer_key=' + encodeURIComponent(creds.ck) + '&consumer_secret=' + encodeURIComponent(creds.cs), { ...opciones, headers: h });
  }
  const texto = await r.text();
  if (!r.ok) throw new Error(errorWoo(r.status, texto));
  try { return JSON.parse(texto); } catch { throw new Error('WooCommerce no devolvió datos legibles: ¿la dirección es la de la tienda?'); }
}

export async function webhooksWoo(base, creds, destino, secreto) {
  const ids = {}, fallidos = [];
  for (const t of TEMAS_WOO) {
    try {
      const d = await wooFetch(base, creds, '/webhooks', { method: 'POST', body: JSON.stringify({ name: 'Acuarius · ' + t, topic: t, delivery_url: destino, secret: secreto, status: 'active' }) });
      if (d.id) ids[t] = d.id; else fallidos.push({ tema: t, motivo: 'sin id' });
    } catch (e) { fallidos.push({ tema: t, motivo: e.message }); }
  }
  return { ids, fallidos };
}

export async function borrarWebhooksWoo(base, creds, ids) {
  for (const id of Object.values(ids || {})) {
    await wooFetch(base, creds, '/webhooks/' + encodeURIComponent(id) + '?force=true', { method: 'DELETE' }).catch(() => {});
  }
}

// ── Historial de pedidos ────────────────────────────────────────────────────
// Por páginas, del más viejo al más nuevo. Shopify por REST y no GraphQL: el
// REST devuelve el pedido con la MISMA forma que el webhook, así que lo lee el
// mismo normalizarPedidoShopify. Sin el permiso read_all_orders Shopify solo
// entrega los últimos 60 días (lo decimos en la pantalla).
const CAMPOS_PEDIDO_SHOPIFY = 'id,name,order_number,email,contact_email,phone,customer,billing_address,shipping_address,financial_status,fulfillment_status,cancelled_at,total_price,currency,line_items,created_at,processed_at,updated_at,order_status_url,checkout_token';

export function siguienteDeLink(link) {
  const m = String(link || '').split(',').find(p => /rel="next"/.test(p));
  const pi = m && m.match(/[?&]page_info=([^&>]+)/);
  return pi ? decodeURIComponent(pi[1]) : null;
}

export async function pedidosShopifyPagina(dominio, token, { desde, pagina }) {
  const base = `https://${dominio}/admin/api/${SHOPIFY_API}/orders.json?limit=50&fields=${CAMPOS_PEDIDO_SHOPIFY}`;
  const url = pagina ? base + '&page_info=' + encodeURIComponent(pagina)
    : base + '&status=any&order=created_at+asc' + (desde ? '&created_at_min=' + encodeURIComponent(desde) : '');
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' } });
  const texto = await r.text();
  if (!r.ok) throw new Error(errorShopify(r.status, texto));
  return { pedidos: JSON.parse(texto).orders || [], siguiente: siguienteDeLink(r.headers.get('link')) };
}

export async function pedidosWooPagina(base, creds, { desde, pagina = 1 }) {
  const lista = await wooFetch(base, creds, `/orders?per_page=50&page=${pagina}&orderby=date&order=asc` + (desde ? '&after=' + encodeURIComponent(desde) : ''));
  return { pedidos: lista || [], siguiente: (lista || []).length === 50 ? pagina + 1 : null };
}
