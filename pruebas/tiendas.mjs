// pruebas/tiendas.mjs
//
// Tiendas en línea (15-10-2026): Shopify y WooCommerce → pedidos, carritos,
// productos y automatizaciones de comercio. Se protege:
//
//   1. Que la dirección que pega la gente se entienda, y la que no sirve
//      (el dominio propio de Shopify, http://) se rechace diciendo por qué.
//   2. Que solo entren avisos firmados por la tienda.
//   3. Que cada plataforma se lea a la misma forma (estado, cliente, total).
//   4. El motor: un pedido pagado deja el lead GANADO con su valor y dispara
//      una sola vez; la primera compra es la primera; el carrito se avisa a la
//      hora y NUNCA a quien ya compró; comprar cancela el recordatorio en curso.
//   5. Que la ruta de una tienda pida conectar la tienda y recuperar carritos.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => readFileSync(join(RAIZ, f), 'utf8');
let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (c || extra === undefined ? '' : ' → ' + JSON.stringify(extra))); if (!c) mal++; };

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'k';
const T = await import('../api/_tienda.js');
const M = await import('../api/_tienda-motor.js');

console.log('\nLas direcciones\n');
{
  ok(T.dominioShopify('mitienda').dominio === 'mitienda.myshopify.com', 'Shopify: solo el nombre');
  ok(T.dominioShopify('https://MiTienda.myshopify.com/admin/products').dominio === 'mitienda.myshopify.com', 'Shopify: con https y ruta');
  ok(T.dominioShopify('https://admin.shopify.com/store/mi-tienda/orders').dominio === 'mi-tienda.myshopify.com', 'Shopify: la barra del admin nuevo');
  ok(/myshopify/.test(T.dominioShopify('mitienda.com').error || ''), 'Shopify: el dominio propio se rechaza diciendo cuál usar');
  ok(T.dominioWoo('mitienda.com/wp-admin/').dominio === 'https://mitienda.com', 'Woo: sin https y con /wp-admin');
  ok(T.dominioWoo('https://sitio.com/tienda').dominio === 'https://sitio.com', 'Woo: quita /tienda');
  ok(/https/.test(T.dominioWoo('http://mitienda.com').error || ''), 'Woo: http se rechaza (las llaves viajarían a la vista)');
}

console.log('\nLas firmas\n');
{
  // Vector conocido: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog") en base64.
  ok(await T.hmacBase64('key', 'The quick brown fox jumps over the lazy dog') === '97yD9DBThCSxMpjmqm+xQ+9NWaFJRhdZl0edvC0aPNg=', 'HMAC‑SHA256 en base64, como lo firman las dos');
  const firma = await T.hmacBase64('s3', '{"id":1}');
  ok(await T.firmaValida('s3', '{"id":1}', firma), 'una firma buena pasa');
  ok(!(await T.firmaValida('s3', '{"id": 1}', firma)), 'el mismo JSON con otros bytes no pasa (se firma el cuerpo crudo)');
  ok(!(await T.firmaValida('otro', '{"id":1}', firma)), 'con otro secreto no pasa');
  ok(!(await T.firmaValida('s3', '{"id":1}', null)), 'sin firma no pasa');
}

console.log('\nCada plataforma, a la misma forma\n');
{
  const base = { id: 9, name: '#1001', email: 'Ana@Mail.com', total_price: '120000.00', currency: 'COP', checkout_token: 'ck1',
    customer: { first_name: 'Ana', last_name: 'Ruiz', phone: '+57 300 111 2233' }, line_items: [{ title: 'Camiseta', variant_title: 'M', quantity: 2, price: '60000' }],
    created_at: '2026-10-15T10:00:00-05:00', processed_at: '2026-10-15T10:01:00-05:00', order_status_url: 'https://x/status' };
  const pagado = T.normalizarPedidoShopify({ ...base, financial_status: 'paid' });
  ok(pagado.estado === 'pagado' && pagado.total === 120000 && pagado.email === 'ana@mail.com', 'Shopify pagado: estado, total y correo en minúscula', pagado);
  ok(pagado.nombre === 'Ana Ruiz' && pagado.telefono === '+57 300 111 2233' && pagado.productos[0].nombre === 'Camiseta — M', 'cliente, teléfono y productos');
  ok(T.normalizarPedidoShopify({ ...base, financial_status: 'paid', fulfillment_status: 'fulfilled' }).estado === 'enviado', 'Shopify enviado');
  ok(T.normalizarPedidoShopify({ ...base, financial_status: 'pending' }).estado === 'pendiente', 'Shopify pendiente de pago');
  ok(T.normalizarPedidoShopify({ ...base, financial_status: 'paid', cancelled_at: '2026-10-15' }).estado === 'cancelado', 'Shopify cancelado gana a pagado');
  const woo = { id: 55, number: '55', status: 'processing', total: '89.90', currency: 'USD', billing: { first_name: 'Luis', last_name: 'P', email: 'luis@x.co', phone: '3001234567' },
    line_items: [{ name: 'Gorra', quantity: 1, price: 89.9 }], date_created_gmt: '2026-10-15T15:00:00', date_paid_gmt: '2026-10-15T15:02:00', payment_url: 'https://pagar' };
  const w = T.normalizarPedidoWoo(woo);
  ok(w.estado === 'pagado' && w.total === 89.9 && w.pagado_at === '2026-10-15T15:02:00.000Z', 'Woo «processing» es pagado, con la fecha GMT leída como UTC', w);
  ok(T.normalizarPedidoWoo({ ...woo, status: 'completed' }).estado === 'enviado', 'Woo «completed» es enviado');
  const wp = T.normalizarPedidoWoo({ ...woo, status: 'pending' });
  ok(wp.estado === 'pendiente' && wp.sin_pagar && wp.enlace === 'https://pagar', 'Woo «pending» es su carrito abandonado, con el enlace de pago');
  const k = T.normalizarCarritoShopify({ token: 'tk', email: 'b@x.co', total_price: '50', abandoned_checkout_url: 'https://rec', updated_at: '2026-10-15T12:00:00Z', created_at: '2026-10-15T11:00:00Z', line_items: [{ title: '<b>Taza</b>', quantity: 1, price: '50' }] });
  ok(k.externo_id === 'tk' && k.enlace === 'https://rec' && k.creado_at === '2026-10-15T12:00:00.000Z', 'carrito: el reloj corre desde su último cambio');
  ok(k.productos[0].nombre === 'bTaza/b', 'el nombre de un producto no puede meter HTML en un correo');

  const prod = T.normalizarProductoShopify({ id: 7, title: 'Camiseta', handle: 'camiseta', product_type: 'Ropa', vendor: 'Marca', status: 'active', body_html: '<p>Algodón &amp; más</p>',
    options: [{ name: 'Talla', values: ['S', 'M'] }], images: [{ src: 'https://img/1' }],
    variants: [{ price: '50000', inventory_management: 'shopify', inventory_quantity: 0, inventory_policy: 'deny' }, { price: '45000', inventory_management: 'shopify', inventory_quantity: 3, inventory_policy: 'deny' }] }, 'https://mitienda.com');
  ok(prod.referencia === 'SHP-7' && prod.precio === 45000 && prod.unidades === 3 && prod.disponible, 'producto Shopify: precio mínimo, stock sumado, disponible si alguna variante lo está', prod);
  ok(prod.url === 'https://mitienda.com/products/camiseta' && /Talla: S, M/.test(prod.descripcion) && /Algodón & más/.test(prod.descripcion), 'enlace en el dominio propio y opciones en la descripción');
  ok(!T.normalizarProductoShopify({ id: 8, title: 'x', status: 'active', variants: [{ price: '1', inventory_management: 'shopify', inventory_quantity: 0, inventory_policy: 'deny' }] }).disponible, 'sin stock y sin venta en descubierto: agotado');
  ok(!T.normalizarProductoShopify({ id: 8, title: 'x', status: 'draft', variants: [{ price: '1' }] }).disponible, 'un borrador no se ofrece');
  const g = T.normalizarProductoShopify(T.shopifyGqlAProducto({ legacyResourceId: '7', title: 'Camiseta', handle: 'camiseta', status: 'ACTIVE', tracksInventory: true,
    options: [{ name: 'Talla', values: ['S', 'M'] }], media: { nodes: [{ preview: { image: { url: 'https://img/1' } } }] },
    variants: { nodes: [{ price: '45000', availableForSale: true, inventoryQuantity: 3, inventoryPolicy: 'DENY' }] } }), 'https://mitienda.com');
  ok(g.referencia === 'SHP-7' && g.disponible && g.fotos[0] === 'https://img/1', 'lo leído por GraphQL termina igual que lo del webhook');
  const pw = T.normalizarProductoWoo({ id: 3, name: 'Gorra', price: '89.9', status: 'publish', stock_status: 'instock', manage_stock: true, stock_quantity: 4, categories: [{ name: 'Accesorios' }], permalink: 'https://p' });
  ok(pw.referencia === 'WOO-3' && pw.precio === 89.9 && pw.unidades === 4 && pw.tipo === 'Accesorios', 'producto Woo');
  ok(!T.normalizarProductoWoo({ id: 3, name: 'x', status: 'publish', stock_status: 'outofstock' }).disponible, 'Woo agotado');

  ok(T.claseDeTema('shopify', 'orders/updated') === 'pedido' && T.claseDeTema('shopify', 'checkouts/update') === 'carrito' && T.claseDeTema('shopify', 'products/delete') === 'producto_borrado', 'temas de Shopify');
  ok(T.claseDeTema('woocommerce', 'order.updated') === 'pedido' && T.claseDeTema('woocommerce', 'product.deleted') === 'producto_borrado' && T.claseDeTema('woocommerce', 'action.woocommerce_x') === null, 'temas de Woo, y lo que no conocemos se ignora');
  ok(T.plata(120000, 'COP') === '$120.000 COP' && T.productosTexto([{ nombre: 'A', cantidad: 2 }, { nombre: 'B', cantidad: 1 }]) === '2 × A, B', 'cómo se lee en un mensaje');
}

// ── Una base PostgREST de juguete, lo justo para el motor ───────────────────
function baseFalsa() {
  const t = { leads: [], lead_activities: [], automations: [], automation_jobs: [], tienda_pedidos: [], tiendas: [] };
  let n = 0;
  const id = () => 'id' + (++n);
  const valor = (fila, col) => col.includes('->>') ? (fila[col.split('->>')[0]] || {})[col.split('->>')[1]] : fila[col];
  const cmp = (a, b) => (!isNaN(a) && !isNaN(b) && a !== '' && b !== '' && a !== null) ? Number(a) - Number(b) : String(a ?? '').localeCompare(String(b ?? ''));
  function cumple(fila, col, expr) {
    const v = valor(fila, col);
    if (expr === 'is.null') return v == null;
    if (expr === 'not.is.null') return v != null;
    if (expr === 'is.true') return v === true;
    const [op, ...resto] = expr.split('.'); const x = resto.join('.');
    if (op === 'eq') return String(v) === x;
    if (op === 'neq') return String(v) !== x;
    if (op === 'in') return x.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    if (v == null) return false;
    if (op === 'gt') return cmp(v, x) > 0;
    if (op === 'gte') return cmp(v, x) >= 0;
    if (op === 'lt') return cmp(v, x) < 0;
    if (op === 'lte') return cmp(v, x) <= 0;
    throw new Error('op ' + op);
  }
  function filtrar(filas, params) {
    return filas.filter(f => params.every(([k, v]) => {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
      if (k === 'or') return v.replace(/^\(|\)$/g, '').split(',').some(c => { const [col, ...r] = c.split('.'); return cumple(f, col, r.join('.')); });
      return cumple(f, k, v);
    }));
  }
  async function sb(ruta, metodo = 'GET', cuerpo = null, prefer = '') {
    const [tab, qs = ''] = ruta.replace(/^\//, '').split('?');
    const params = qs ? qs.split('&').map(p => { const i = p.indexOf('='); return [decodeURIComponent(p.slice(0, i)), decodeURIComponent(p.slice(i + 1))]; }) : [];
    const tabla = t[tab]; if (!tabla) throw new Error('tabla ' + tab);
    if (metodo === 'GET') {
      let r = filtrar(tabla, params);
      const lim = params.find(p => p[0] === 'limit'); if (lim) r = r.slice(0, +lim[1]);
      return r.map(x => ({ ...x }));
    }
    if (metodo === 'POST') {
      const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      const conf = params.find(p => p[0] === 'on_conflict');
      const out = [];
      for (const f of filas) {
        const existe = conf && tabla.find(x => conf[1].split(',').every(c => String(x[c] ?? '') === String(f[c] ?? '')));
        if (existe) { Object.assign(existe, f); out.push({ ...existe }); }
        else { const nueva = { id: id(), created_at: new Date(reloj.ahora).toISOString(), ...f }; tabla.push(nueva); out.push({ ...nueva }); }
      }
      return out;
    }
    if (metodo === 'PATCH') { const r = filtrar(tabla, params); r.forEach(x => Object.assign(x, cuerpo)); return r.map(x => ({ ...x })); }
    if (metodo === 'DELETE') { const r = filtrar(tabla, params); t[tab] = tabla.filter(x => !r.includes(x)); return null; }
  }
  const reloj = { ahora: Date.parse('2026-10-15T15:00:00Z') };
  const intakes = [];
  // Como intakeLead: se suma a la oportunidad ABIERTA de la persona; si solo
  // tiene cerradas, abre una nueva.
  async function intake(userId, clientId, d) {
    intakes.push(d);
    let lead = t.leads.find(l => l.user_id === userId && !['ganado', 'perdido'].includes(l.stage) && ((d.email && l.email === d.email) || (d.phone && l.phone === d.phone)));
    if (lead) { lead.tags = [...new Set([...(lead.tags || []), ...(d.tags || [])])]; return { lead: { ...lead }, created: false }; }
    lead = { id: id(), user_id: userId, client_id: clientId, name: d.name, email: d.email, phone: d.phone, stage: 'nuevo', tags: d.tags || [], deleted_at: null };
    t.leads.push(lead);
    return { lead: { ...lead }, created: true };
  }
  return { t, io: { sb, intake, ahora: () => reloj.ahora }, reloj, intakes };
}

console.log('\nEl motor: pedidos\n');
{
  const { t, io, intakes } = baseFalsa();
  const tienda = { id: 'T1', user_id: 'u1', client_id: null, nombre: 'Moda Ana', moneda: 'COP', plataforma: 'shopify' };
  t.automations.push(
    { id: 'A1', user_id: 'u1', client_id: null, active: true, trigger: { type: 'pedido_pagado' } },
    { id: 'A2', user_id: 'u1', client_id: null, active: true, trigger: { type: 'primera_compra' } },
    { id: 'A3', user_id: 'u1', client_id: null, active: true, trigger: { type: 'pedido_enviado' } },
    { id: 'A4', user_id: 'u1', client_id: null, active: true, trigger: { type: 'stage_changed', stage: 'ganado' } },
    { id: 'A5', user_id: 'u1', client_id: null, active: false, trigger: { type: 'pedido_pagado' } },
  );
  const pedido = T.normalizarPedidoShopify({ id: 1, name: '#1001', email: 'ana@x.co', financial_status: 'paid', total_price: '120000', currency: 'COP',
    customer: { first_name: 'Ana' }, line_items: [{ title: 'Camiseta', quantity: 2, price: '60000' }], created_at: '2026-10-15T14:00:00Z', processed_at: '2026-10-15T14:01:00Z' });
  const r = await M.procesarPedido(io, tienda, pedido);
  const lead = t.leads[0];
  ok(intakes.length === 1 && intakes[0].sinPrimerContacto === true && intakes[0].source === 'tienda', 'la persona entra como lead de la tienda, sin tarea de primer contacto');
  ok(lead.stage === 'ganado' && lead.value === 120000 && lead.closed_at, 'el pedido pagado deja el lead GANADO con su valor y su fecha de cierre', lead);
  ok(t.lead_activities.some(a => a.type === 'stage_change' && a.metadata.to === 'ganado'), 'y queda en su historial');
  const jobs = t.automation_jobs.map(j => j.automation_id).sort();
  ok(JSON.stringify(jobs) === '["A1","A2","A4"]', 'dispara «pedido pagado», «primera compra» y «pasa a Ganado»; nunca una automatización apagada', jobs);
  const ctx = t.automation_jobs.find(j => j.automation_id === 'A1').context;
  ok(ctx.pedido === '#1001' && ctx.total === '$120.000 COP' && ctx.productos === '2 × Camiseta' && ctx.tienda === 'Moda Ana', 'el flujo lleva el pedido para sus {{variables}}', ctx);
  ok(r.disparados.join() === 'pedido_pagado,primera_compra', 'y lo dice');

  await M.procesarPedido(io, tienda, pedido);
  await M.procesarPedido(io, tienda, pedido);
  ok(t.automation_jobs.length === 3 && intakes.length === 1, 'Shopify avisa el mismo pedido varias veces: se dispara UNA');

  await M.procesarPedido(io, tienda, { ...pedido, estado: 'enviado' });
  await M.procesarPedido(io, tienda, { ...pedido, estado: 'enviado' });
  ok(t.automation_jobs.filter(j => j.automation_id === 'A3').length === 1, '«pedido enviado» también una sola vez');

  const segundo = { ...pedido, externo_id: '2', numero: '#1002', total: 50000 };
  await M.procesarPedido(io, tienda, segundo);
  ok(t.automation_jobs.filter(j => j.automation_id === 'A2').length === 1, 'la segunda compra NO es primera compra');
  ok(t.automation_jobs.filter(j => j.automation_id === 'A1').length === 2, 'pero sí es un pedido pagado más');
  ok(t.leads.length === 2 && t.leads[1].contacto_id === undefined && t.leads[1].stage === 'ganado', 'cada compra es una venta ganada (la anterior ya estaba cerrada)');

  const sinContacto = T.normalizarPedidoShopify({ id: 3, name: '#1003', financial_status: 'paid', total_price: '10' });
  await M.procesarPedido(io, tienda, sinContacto);
  ok(intakes.length === 2 && t.tienda_pedidos.some(p => p.externo_id === '3' && !p.lead_id), 'un pedido sin correo ni teléfono se guarda para las cifras, sin inventar un lead');
}

console.log('\nEl motor: carritos\n');
{
  const { t, io, reloj, intakes } = baseFalsa();
  const tienda = { id: 'T1', user_id: 'u1', client_id: null, nombre: 'Moda Ana', moneda: 'COP', plataforma: 'shopify' };
  t.automations.push({ id: 'C1', user_id: 'u1', client_id: null, active: true, trigger: { type: 'carrito_abandonado' } });
  const iso = (min) => new Date(reloj.ahora + min * 60000).toISOString();
  const k = (token, email, minutos, extra = {}) => T.normalizarCarritoShopify({ token, email, total_price: '80000', currency: 'COP', abandoned_checkout_url: 'https://rec/' + token,
    updated_at: iso(minutos), line_items: [{ title: 'Taza', quantity: 1, price: '80000' }], ...extra });

  await M.procesarCarrito(io, tienda, k('k1', 'bea@x.co', 0));
  reloj.ahora += 30 * 60000;
  let r = await M.barrerCarritos(io, [tienda]);
  ok(r.avisados === 0 && !t.automation_jobs.length, 'a la media hora todavía no es un carrito abandonado');
  reloj.ahora += 31 * 60000;
  r = await M.barrerCarritos(io, [tienda]);
  const job = t.automation_jobs[0];
  ok(r.avisados === 1 && job && job.context.enlace_carrito === 'https://rec/k1', 'a la hora sí: entra la persona y se dispara con el enlace del carrito', job);
  ok(intakes[0].tags.includes('carrito-abandonado'), 'con la etiqueta «carrito-abandonado»');
  r = await M.barrerCarritos(io, [tienda]);
  ok(r.avisados === 0 && t.automation_jobs.length === 1, 'un carrito se avisa una vez');

  // Compra mientras el flujo espera: se cancela el resto.
  const p = T.normalizarPedidoShopify({ id: 77, name: '#2001', email: 'bea@x.co', checkout_token: 'k1', financial_status: 'paid', total_price: '80000', currency: 'COP', created_at: iso(0), processed_at: iso(0) });
  await M.procesarPedido(io, tienda, p);
  ok(t.automation_jobs[0].status === 'cancelled', 'quien termina de comprar no recibe el segundo «se te olvidó algo»');
  ok(t.tienda_pedidos.find(x => x.tipo === 'carrito' && x.externo_id === 'k1').estado === 'recuperado', 'y su carrito cuenta como recuperado');

  // Compró por otro camino antes de que pase la hora.
  await M.procesarCarrito(io, tienda, k('k2', 'cris@x.co', 0));
  await M.procesarPedido(io, tienda, T.normalizarPedidoShopify({ id: 78, name: '#2002', email: 'cris@x.co', financial_status: 'paid', total_price: '1', created_at: iso(10), processed_at: iso(10) }));
  reloj.ahora += 61 * 60000;
  const antes = t.automation_jobs.filter(j => j.automation_id === 'C1').length;
  await M.barrerCarritos(io, [tienda]);
  ok(t.automation_jobs.filter(j => j.automation_id === 'C1').length === antes, 'a quien ya compró no se le escribe por su carrito');

  await M.procesarCarrito(io, tienda, k('k3', null, 0));
  reloj.ahora += 61 * 60000;
  await M.barrerCarritos(io, [tienda]);
  ok(t.tienda_pedidos.find(x => x.externo_id === 'k3').estado === 'sin_contacto', 'sin correo ni teléfono no hay a quién recordarle');

  await M.procesarCarrito(io, tienda, k('k4', 'dan@x.co', 0, { completed_at: iso(0) }));
  ok(t.tienda_pedidos.find(x => x.externo_id === 'k4').estado === 'recuperado', 'un checkout completado no es un abandono');

  await M.procesarCarrito(io, tienda, k('k5', 'eva@x.co', -5 * 24 * 60));
  await M.barrerCarritos(io, [tienda]);
  ok(t.tienda_pedidos.find(x => x.externo_id === 'k5').estado === 'pendiente', 'un carrito de hace 5 días ya no se avisa');
}

console.log('\nEl motor: WooCommerce y la recompra\n');
{
  const { t, io, reloj } = baseFalsa();
  const tienda = { id: 'W1', user_id: 'u1', client_id: null, nombre: 'Gorras', moneda: 'USD', plataforma: 'woocommerce' };
  const o = { id: 55, number: '55', status: 'pending', total: '89.90', currency: 'USD', billing: { first_name: 'Luis', email: 'luis@x.co' }, line_items: [{ name: 'Gorra', quantity: 1, price: 89.9 }], date_created_gmt: '2026-10-15T14:00:00', payment_url: 'https://pagar' };
  await M.procesarPedido(io, tienda, T.normalizarPedidoWoo(o));
  const carrito = t.tienda_pedidos.find(x => x.tipo === 'carrito');
  ok(carrito && carrito.estado === 'pendiente' && carrito.enlace === 'https://pagar', 'el pedido sin pagar de Woo queda como carrito, con su enlace de pago');
  await M.procesarPedido(io, tienda, T.normalizarPedidoWoo({ ...o, status: 'processing', date_paid_gmt: '2026-10-15T14:20:00' }));
  ok(t.tienda_pedidos.find(x => x.tipo === 'carrito').estado === 'recuperado', 'cuando se paga, el carrito queda recuperado');

  t.automations.push({ id: 'R1', user_id: 'u1', client_id: null, active: true, trigger: { type: 'sin_comprar', days: 30 } });
  t.tiendas.push({ id: 'W1', nombre: 'Gorras', moneda: 'USD' });
  let n = await M.barrerRecompra(io);
  ok(n === 0, 'recién comprado no es «sin comprar»');
  reloj.ahora += 31 * 86400000;
  n = await M.barrerRecompra(io);
  ok(n === 1 && t.automation_jobs.at(-1).automation_id === 'R1' && t.automation_jobs.at(-1).context.productos === 'Gorra', 'a los 30 días, una vez, con lo que compró');
  n = await M.barrerRecompra(io);
  ok(n === 0, 'y no dos');
  reloj.ahora += 60 * 86400000;
  n = await M.barrerRecompra(io);
  ok(n === 0, 'pasada la ventana de 3 días ya no se manda tarde');
}

console.log('\nEl receptor de webhooks\n');
{
  const { default: handler } = await import('../api/tienda-webhook.js');
  const guardados = [];
  const tiendaFila = { id: 'T1', user_id: 'u1', plataforma: 'shopify', credenciales: JSON.stringify({ client_id: 'c', client_secret: 'sec' }), secreto: null, activo: true };
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    if (u.includes('/tiendas?token=')) return new Response(JSON.stringify([tiendaFila]), { status: 200 });
    if (u.includes('/tienda_eventos')) { guardados.push(JSON.parse(op.body)); return new Response(null, { status: 201 }); }
    return new Response('[]', { status: 200 });
  };
  const cuerpo = JSON.stringify({ id: 1, name: '#1' });
  const pedir = async (headers) => handler(new Request('https://app/api/tienda-webhook?t=' + 'a'.repeat(40), { method: 'POST', body: cuerpo, headers }));
  let r = await pedir({ 'x-shopify-topic': 'orders/updated', 'x-shopify-hmac-sha256': 'malo', 'x-shopify-webhook-id': 'w1' });
  ok(r.status === 401 && !guardados.length, 'sin la firma de la tienda no entra nada');
  r = await pedir({ 'x-shopify-topic': 'orders/updated', 'x-shopify-hmac-sha256': await T.hmacBase64('sec', cuerpo), 'x-shopify-webhook-id': 'w1' });
  ok(r.status === 200 && guardados[0]?.entrega === 'w1' && guardados[0]?.tema === 'orders/updated', 'firmado, se guarda con su id de entrega (los reintentos entran una vez)', guardados[0]);
  r = await pedir({ 'x-shopify-topic': 'app/uninstalled', 'x-shopify-hmac-sha256': await T.hmacBase64('sec', cuerpo) });
  ok(r.status === 200 && guardados.length === 1, 'un tema que no usamos se contesta y se ignora');
  Object.assign(tiendaFila, { plataforma: 'woocommerce', secreto: 'wsec' });
  r = await handler(new Request('https://app/api/tienda-webhook?t=' + 'a'.repeat(40), { method: 'POST', body: 'webhook_id=12' }));
  ok(r.status === 200, 'el «ping» de WooCommerce al crear el webhook se contesta 200 (si no, lo deja inactivo)');
  tiendaFila.activo = false;
  r = await pedir({ 'x-wc-webhook-topic': 'order.updated' });
  ok(r.status === 200, 'una tienda desconectada responde 200: con 4xx Shopify reintentaría 48 horas');
  r = await handler(new Request('https://app/api/tienda-webhook?t=corto', { method: 'POST', body: '{}' }));
  ok(r.status === 404, 'un token mal formado ni se busca');
}

console.log('\nLas automatizaciones\n');
{
  const A = await import('../api/cron-automations.js');
  ok(A.enlazar('termina aquí: https://rec/k1\nlisto') === 'termina aquí: <a href="https://rec/k1" style="color:#1E2BCC">https://rec/k1</a>\nlisto', 'el enlace del carrito sale tocable en el correo');
  ok(A.enlazar('<a href="https://ya">x</a>') === '<a href="https://ya">x</a>', 'un enlace que ya es enlace no se toca');
  const cron = leer('api/cron-automations.js');
  ok(/if \(job\.context && typeof job\.context === 'object'\) lead = \{ \.\.\.lead, _ctx: job\.context \};/.test(cron), 'el motor pasa el pedido del trabajo a las variables');
  ok(/pedido: '', total: '', productos: '', enlace_carrito: ''/.test(cron), 'fuera de un flujo de tienda, las variables de tienda quedan vacías');
  const validos = leer('api/automations.js');
  ok(M.TRIGGERS_TIENDA.every(x => validos.includes("'" + x + "'")), 'el servidor acepta los cinco disparadores');
  const app = leer('public/app.js');
  ok(M.TRIGGERS_TIENDA.every(x => new RegExp("\\['" + x + "', '").test(app)), 'y el constructor los ofrece');
  ok(/sinPrimerContacto: true/.test(leer('api/_tienda-motor.js')), 'quien compra no genera tarea de «primer contacto»');
}

console.log('\nLa ruta de una tienda\n');
{
  const R = await import('../api/_ruta.js');
  const pasos = R.pasosPara('E-commerce / Retail');
  const ids = pasos.map(p => p.id);
  ok(ids.includes('tienda') && ids.includes('carrito') && ids.includes('postcompra') && ids.includes('recompra'), 'trae los pasos de comercio');
  ok(!R.pasosPara('Inmobiliaria').some(p => p.id === 'tienda'), 'una inmobiliaria no los ve');
  ok(pasos.find(p => p.id === 'tienda').esencial && pasos.find(p => p.id === 'carrito').esencial, 'conectar la tienda y recuperar carritos son esenciales para el premio');
  const todo = Object.fromEntries(pasos.map(p => [p.id, !!p.esencial]));
  ok(R.esencialesCumplidos(todo, pasos), 'la tienda cuenta como entrada de leads');
  ok(!R.esencialesCumplidos({ ...todo, tienda: false, whatsapp: true }, pasos), 'sin la tienda conectada no hay premio, aunque tenga WhatsApp');
  const h = R.detectar({ tiendas: [{ activo: true }], automatizaciones: [{ active: true, trigger: { type: 'carrito_abandonado' } }, { active: true, trigger: { type: 'primera_compra' } }] });
  ok(h.tienda && h.carrito && h.postcompra && !h.recompra, 'se detectan solos');
  const app = leer('public/app.js');
  ok(pasos.filter(p => /^auto_/.test(p.hazlo || '')).every(p => new RegExp('\\b' + p.hazlo + ': \\{').test(app)), 'cada «Hazlo por mí» de automatización tiene su plantilla');
  ok(/id="src-tienda"/.test(app) && /tiendaEstado\(\)/.test(app), 'la tienda tiene su sitio en Fuentes');
  ok(/'tiendas', 'tienda'|tiendas\?user_id=eq\.\$\{U\}&activo=is\.true/.test(leer('api/_ruta.js')), 'la ruta mira las tiendas conectadas');
}

console.log(mal ? `\n${mal} fallo(s)\n` : '\nTodo en orden\n');
process.exit(mal ? 1 : 0);
