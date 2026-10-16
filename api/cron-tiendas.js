// api/cron-tiendas.js — el trabajo de las tiendas en línea, cada 5 minutos.
//
//   1. Los avisos de la cola (tienda_eventos) → pedidos, carritos y productos.
//   2. Los carritos con una hora sin compra → «carrito abandonado».
//   3. Quien cumplió N días sin comprar → «sin comprar».
//   4. Las sincronizaciones de catálogo a medio camino.
//
// Es el ÚNICO que consume la cola (como cron-palomma): dos consumidores a la
// vez convertirían el mismo pedido en dos leads. Un aviso que falla se
// reintenta hasta 5 veces y después queda con su error a la vista.
export const config = { runtime: 'edge' };

import { latir } from './_latido.js';
import { registrarError } from './_registro-errores.js';
import { intakeLead } from './_lead-intake.js';
import { claseDeTema, normalizarPedidoShopify, normalizarCarritoShopify, normalizarPedidoWoo } from './_tienda.js';
import { procesarPedido, procesarCarrito, barrerCarritos, barrerRecompra } from './_tienda-motor.js';
import { sbTienda, guardarProducto, borrarProducto, sincronizarProductos } from './_tienda-catalogo.js';

const TOPE_MS = 22000;
const MAX_INTENTOS = 5;

const io = { sb: sbTienda, intake: intakeLead, ahora: () => Date.now() };

export async function procesarEvento(tienda, ev) {
  const clase = claseDeTema(tienda.plataforma, ev.tema);
  const p = ev.payload || {};
  if (clase === 'pedido') {
    const pedido = tienda.plataforma === 'shopify' ? normalizarPedidoShopify(p) : normalizarPedidoWoo(p);
    const r = await procesarPedido(io, tienda, pedido);
    return `pedido ${pedido.numero} ${pedido.estado}` + (r.disparados.length ? ' → ' + r.disparados.join(', ') : '');
  }
  if (clase === 'carrito') {
    const c = normalizarCarritoShopify(p);
    const r = await procesarCarrito(io, tienda, c);
    return 'carrito ' + r.estado;
  }
  if (clase === 'producto') { await guardarProducto(tienda, p); return 'producto ' + p.id; }
  if (clase === 'producto_borrado') { await borrarProducto(tienda, p); return 'producto borrado ' + p.id; }
  return 'ignorado';
}

export default async function handler() {
  const t0 = Date.now();
  await latir('cron-tiendas', { empezo: new Date().toISOString() });
  const cuenta = { eventos: 0, fallidos: 0, carritos: 0, recuperados: 0, recompra: 0, catalogos: 0 };
  try {
    const tiendas = (await sbTienda('/tiendas?activo=is.true&select=*')) || [];
    const porId = new Map(tiendas.map(t => [t.id, t]));

    // ── 1. La cola ─────────────────────────────────────────────────────────
    if (tiendas.length) {
      const evs = (await sbTienda(`/tienda_eventos?procesado_at=is.null&intentos=lt.${MAX_INTENTOS}&select=*&order=recibido_at.asc&limit=80`)) || [];
      for (const ev of evs) {
        if (Date.now() - t0 > TOPE_MS * 0.6) break;
        const tienda = porId.get(ev.tienda_id);
        if (!tienda) {
          await sbTienda(`/tienda_eventos?id=eq.${ev.id}`, 'PATCH', { procesado_at: new Date().toISOString(), resultado: 'tienda desconectada' }, 'return=minimal');
          continue;
        }
        try {
          const resultado = await procesarEvento(tienda, ev);
          await sbTienda(`/tienda_eventos?id=eq.${ev.id}`, 'PATCH', { procesado_at: new Date().toISOString(), resultado, error: null, intentos: (ev.intentos || 0) + 1 }, 'return=minimal');
          cuenta.eventos++;
        } catch (e) {
          cuenta.fallidos++;
          const intentos = (ev.intentos || 0) + 1;
          await sbTienda(`/tienda_eventos?id=eq.${ev.id}`, 'PATCH', { error: String(e.message || e).slice(0, 500), intentos }, 'return=minimal').catch(() => {});
          if (intentos >= MAX_INTENTOS) {
            await registrarError({ origen: 'servidor', donde: 'cron-tiendas.evento', error: e, usuario: tienda.user_id, detalle: ev.tema + ' #' + ev.id });
            await sbTienda(`/tiendas?id=eq.${tienda.id}`, 'PATCH', { ultimo_error: 'Un aviso de ' + ev.tema + ' no se pudo procesar: ' + String(e.message || e).slice(0, 200) }, 'return=minimal').catch(() => {});
          }
        }
      }
      // El contador de pedidos que ve la pantalla.
      for (const t of tiendas) {
        if (!(t.ultimo_evento_at && Date.parse(t.ultimo_evento_at) > t0 - 15 * 60000)) continue;
        const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/tienda_pedidos?tienda_id=eq.${t.id}&tipo=eq.pedido&pagado_at=not.is.null&select=id`, {
          headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, Prefer: 'count=exact', Range: '0-0' },
        }).catch(() => null);
        const n = parseInt((r?.headers.get('content-range') || '').split('/')[1] || '', 10);
        if (Number.isFinite(n)) await sbTienda(`/tiendas?id=eq.${t.id}`, 'PATCH', { pedidos: n }, 'return=minimal').catch(() => {});
      }
    }

    // ── 2 y 3. Carritos y recompra ─────────────────────────────────────────
    if (tiendas.length && Date.now() - t0 < TOPE_MS * 0.75) {
      const r = await barrerCarritos(io, tiendas);
      cuenta.carritos = r.avisados; cuenta.recuperados = r.recuperados;
    }
    if (Date.now() - t0 < TOPE_MS * 0.8) cuenta.recompra = await barrerRecompra(io);

    // ── 4. Catálogos a medio camino ────────────────────────────────────────
    for (const t of tiendas.filter(x => x.cursor_productos != null)) {
      const queda = TOPE_MS - (Date.now() - t0);
      if (queda < 4000) break;
      try {
        await sincronizarProductos(t, { topeMs: Math.min(8000, queda - 3000) });
        cuenta.catalogos++;
      } catch (e) {
        // Se suelta el cursor: reintentar cada 5 minutos con llaves revocadas
        // solo llena el registro. «Sincronizar» lo vuelve a empezar.
        await sbTienda(`/tiendas?id=eq.${t.id}`, 'PATCH', { ultimo_error: 'No se pudo leer el catálogo: ' + String(e.message || e).slice(0, 200), estado: 'error', cursor_productos: null }, 'return=minimal').catch(() => {});
        await registrarError({ origen: 'servidor', donde: 'cron-tiendas.catalogo', error: e, usuario: t.user_id });
      }
    }

    await latir('cron-tiendas', cuenta);
    return new Response(JSON.stringify(cuenta), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    await latir('cron-tiendas', { error: true, ...cuenta }, e?.message || String(e));
    return new Response(JSON.stringify({ error: e?.message || 'error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
