// api/_tienda-nube.js — Tiendanube (Nuvemshop), 16-10-2026.
//
// A diferencia de Shopify y WooCommerce, en Tiendanube el comerciante no crea
// llaves: se instala una APP. Acuarius tiene la suya en el portal de Partners
// (TIENDANUBE_APP_ID / TIENDANUBE_CLIENT_SECRET en Vercel); el cliente la
// autoriza con un clic y volvemos con un código que se cambia por un token que
// no vence. Lo que cambia por eso:
//   · El token y la firma de los avisos son de NUESTRA app, no de la tienda.
//   · Los avisos solo traen {store_id, event, id}: el pedido completo se pide
//     después a la API (lo hace el cron).
//   · No hay aviso de carrito abandonado: se consultan /checkouts cada 30 min.
//   · Los textos de producto vienen por idioma: {es, pt, en}.
// Solo se importa desde edge.

import { APP } from './_tienda.js';

const API = 'https://api.tiendanube.com/v1';
// Tiendanube exige un User-Agent con el nombre de la app y un correo.
const UA = 'Acuarius (soporte@acuarius.app)';

export const EVENTOS_NUBE = ['order/created', 'order/paid', 'order/fulfilled', 'order/cancelled', 'product/created', 'product/updated', 'product/deleted'];

export function nubeConfigurada() {
  return !!(process.env.TIENDANUBE_APP_ID && process.env.TIENDANUBE_CLIENT_SECRET);
}

// ── El estado del OAuth ─────────────────────────────────────────────────────
// Viaja a Tiendanube y vuelve en la redirección: dice de qué cuenta (y de qué
// cliente) es la instalación. Va firmado y vence a la hora, o cualquiera podría
// colgar su tienda de la cuenta de otro.
async function hmacHex(clave, texto) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(clave)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const f = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)));
  return [...f].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64url(s) {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function deB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export async function firmarEstado(datos, secreto = process.env.CRON_SECRET, ahora = Date.now()) {
  const cuerpo = b64url(JSON.stringify({ ...datos, exp: ahora + 3600000 }));
  return cuerpo + '.' + (await hmacHex(secreto || '', 'nube:' + cuerpo)).slice(0, 40);
}

export async function leerEstado(estado, secreto = process.env.CRON_SECRET, ahora = Date.now()) {
  const [cuerpo, firma] = String(estado || '').split('.');
  if (!cuerpo || !firma) return null;
  if ((await hmacHex(secreto || '', 'nube:' + cuerpo)).slice(0, 40) !== firma) return null;
  let d;
  try { d = JSON.parse(deB64url(cuerpo)); } catch { return null; }
  return d.exp > ahora ? d : null;
}

export function urlAutorizar(estado) {
  return `https://www.tiendanube.com/apps/${encodeURIComponent(process.env.TIENDANUBE_APP_ID)}/authorize?state=${encodeURIComponent(estado)}`;
}

/** Cambia el código de la redirección por {token, storeId}. */
export async function tokenNube(codigo) {
  const r = await fetch('https://www.tiendanube.com/apps/authorize/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ client_id: process.env.TIENDANUBE_APP_ID, client_secret: process.env.TIENDANUBE_CLIENT_SECRET, grant_type: 'authorization_code', code: codigo }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token || !d.user_id) throw new Error('Tiendanube no aceptó la autorización' + (d.error_description ? ': ' + d.error_description : '') + '. Vuelve a intentarlo desde Acuarius.');
  return { token: d.access_token, storeId: String(d.user_id), scope: d.scope || '' };
}

export function errorNube(status, cuerpo) {
  if (status === 401) return 'Tiendanube ya no reconoce la autorización de Acuarius. Vuelve a conectar la tienda.';
  if (status === 403) return 'A la app de Acuarius le falta un permiso en Tiendanube (' + String(cuerpo || '').slice(0, 120) + ').';
  if (status === 404) return 'Tiendanube no encontró lo que se pidió (404).';
  if (status === 429) return 'Tiendanube nos pidió esperar un momento.';
  return 'Tiendanube respondió ' + status + '.';
}

export async function nubeFetch(storeId, token, ruta, opciones = {}) {
  const r = await fetch(`${API}/${encodeURIComponent(storeId)}${ruta}`, {
    ...opciones,
    headers: { Authentication: 'bearer ' + token, 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const texto = await r.text();
  // Una lista vacía responde 404 en algunas rutas de Tiendanube: no es un error.
  if (r.status === 404 && opciones.vacioSi404) return [];
  if (!r.ok) throw new Error(errorNube(r.status, texto));
  return texto ? JSON.parse(texto) : null;
}

export async function webhooksNube(storeId, token, destino) {
  const ids = {}, fallidos = [];
  for (const ev of EVENTOS_NUBE) {
    try {
      const d = await nubeFetch(storeId, token, '/webhooks', { method: 'POST', body: JSON.stringify({ event: ev, url: destino }) });
      if (d && d.id) ids[ev] = d.id; else fallidos.push({ tema: ev, motivo: 'sin id' });
    } catch (e) {
      if (/already|ya existe|422/i.test(e.message)) ids[ev] = 'existente';
      else fallidos.push({ tema: ev, motivo: e.message });
    }
  }
  return { ids, fallidos };
}

export async function borrarWebhooksNube(storeId, token, ids) {
  for (const id of Object.values(ids || {})) {
    if (id === 'existente') continue;
    await nubeFetch(storeId, token, '/webhooks/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
  }
}

// ── Normalización ───────────────────────────────────────────────────────────
// Un texto de Tiendanube puede ser una cadena o {es, pt, en}.
export function tx(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v.es || v.pt || v.en || Object.values(v).find(x => typeof x === 'string') || '';
}
const limpio = (v, n = 160) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fecha = (v) => { if (!v) return null; const d = new Date(String(v).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')); return isNaN(d) ? null : d.toISOString(); };
const tel = (...c) => { for (const x of c) { const t = String(x || '').trim(); if (t.replace(/\D/g, '').length >= 7) return t; } return null; };
const sinHtml = (h, n = 500) => limpio(String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'), n) || null;

export function normalizarPedidoNube(o) {
  const c = o.customer || {};
  const pago = String(o.payment_status || '').toLowerCase();
  const envio = String(o.shipping_status || '').toLowerCase();
  let estado = 'pendiente';
  if (o.status === 'cancelled' || o.cancelled_at || pago === 'voided') estado = 'cancelado';
  else if (pago === 'refunded') estado = 'reembolsado';
  else if (pago === 'paid') estado = ['fulfilled', 'shipped', 'delivered'].includes(envio) ? 'enviado' : 'pagado';
  return {
    externo_id: String(o.id),
    numero: '#' + limpio(o.number || o.id, 30),
    checkout: o.checkout_id ? String(o.checkout_id) : null,
    nombre: limpio(o.contact_name || c.name, 120) || null,
    email: String(o.contact_email || c.email || '').trim().toLowerCase() || null,
    telefono: tel(o.contact_phone, c.phone, o.billing_phone),
    total: num(o.total),
    moneda: o.currency || null,
    estado,
    productos: (o.products || []).slice(0, 30).map(p => ({ nombre: limpio(tx(p.name)), cantidad: parseInt(p.quantity, 10) || 1, precio: num(p.price) })),
    enlace: null,
    creado_at: fecha(o.created_at),
    pagado_at: ['pagado', 'enviado'].includes(estado) ? fecha(o.paid_at || o.updated_at) : null,
    enviado_at: estado === 'enviado' ? fecha(o.shipped_at || o.updated_at) : null,
  };
}

export function normalizarCarritoNube(k) {
  return {
    externo_id: String(k.id),
    checkout: String(k.id),
    nombre: limpio(k.contact_name || (k.customer || {}).name, 120) || null,
    email: String(k.contact_email || (k.customer || {}).email || '').trim().toLowerCase() || null,
    telefono: tel(k.contact_phone, (k.customer || {}).phone),
    total: num(k.total),
    moneda: k.currency || null,
    completado: !!k.completed_at,
    productos: (k.products || []).slice(0, 30).map(p => ({ nombre: limpio(tx(p.name)), cantidad: parseInt(p.quantity, 10) || 1, precio: num(p.price) })),
    enlace: k.abandoned_checkout_url || null,
    creado_at: fecha(k.updated_at || k.created_at),
  };
}

export function normalizarProductoNube(p) {
  const variantes = p.variants || [];
  const precios = variantes.map(v => num(v.promotional_price) || num(v.price)).filter(v => v != null);
  // stock null = ilimitado (sin control de inventario).
  const ilimitado = variantes.some(v => v.stock == null || v.stock_management === false);
  const unidades = ilimitado ? null : variantes.reduce((a, v) => a + Math.max(0, parseInt(v.stock, 10) || 0), 0);
  const opciones = (p.attributes || []).map((a, i) => {
    const valores = [...new Set(variantes.map(v => tx((v.values || [])[i])).filter(Boolean))].slice(0, 12);
    return valores.length > 1 ? limpio(tx(a), 30) + ': ' + valores.map(x => limpio(x, 30)).join(', ') : null;
  }).filter(Boolean).join(' · ');
  const desc = [sinHtml(tx(p.description)), opciones ? 'Opciones — ' + opciones : null].filter(Boolean).join('\n');
  return {
    referencia: 'TN-' + p.id,
    nombre: limpio(tx(p.name), 200) || 'Producto sin nombre',
    tipo: limpio(tx((p.categories || [])[0]?.name), 80) || null,
    coleccion: limpio(p.brand, 80) || null,
    precio: precios.length ? Math.min(...precios) : null,
    fotos: (p.images || []).slice(0, 4).map(i => i.src).filter(Boolean),
    url: p.canonical_url || null,
    descripcion: desc || null,
    disponible: p.published !== false && (ilimitado || (unidades || 0) > 0),
    unidades,
  };
}

export const DESTINO_OAUTH = `${APP}/api/tienda-oauth`;
