// api/_tienda-agente.js — lo que el agente IA sabe de las compras de quien le
// escribe (17-10-2026).
//
// Con una tienda conectada, quien escribe por WhatsApp muchas veces ya compró:
// pregunta por su pedido, quiere repetir o dejó un carrito a medias. Sin esto
// el agente lo trataba como a un desconocido. Aquí se arma el bloque del prompt.
//
// Las compras salen SOLO de las oportunidades de la persona de ESTA
// conversación (su lead y las enlazadas a él), nunca de buscar un teléfono o un
// correo suelto: un número mal guardado le enseñaría las compras de otro.
// Solo se importa desde edge.

import { plata, productosTexto } from './_tienda.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` });
const enc = encodeURIComponent;

// Quién no tiene tienda, para no preguntarlo en cada mensaje.
const _sinTienda = new Map();   // userId → hasta cuándo (ms)

async function leer(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: sbH() });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' en ' + ruta.split('?')[0]);
  return r.json();
}

/**
 * {pedidos, carrito} de la persona de la conversación, o null si la cuenta no
 * tiene tienda o la persona nunca compró ni dejó un carrito.
 */
export async function comprasDelContacto(userId, leadId, { ahora = Date.now(), consultar = leer } = {}) {
  if (!userId || !leadId) return null;
  if ((_sinTienda.get(userId) || 0) > ahora) return null;
  const tiendas = await consultar(`tiendas?user_id=eq.${enc(userId)}&activo=is.true&select=id,nombre,moneda&limit=5`);
  if (!tiendas?.length) { _sinTienda.set(userId, ahora + 5 * 60000); return null; }

  const [lead] = await consultar(`leads?id=eq.${enc(leadId)}&user_id=eq.${enc(userId)}&select=id,contacto_id&limit=1`) || [];
  if (!lead) return null;
  const grupo = lead.contacto_id || lead.id;
  const suyos = ((await consultar(`leads?user_id=eq.${enc(userId)}&or=(id.eq.${grupo},contacto_id.eq.${grupo})&deleted_at=is.null&select=id&limit=50`)) || []).map(l => l.id);
  if (!suyos.length) return null;

  const ids = tiendas.map(t => t.id).join(',');
  const desdeCarrito = new Date(ahora - 3 * 86400000).toISOString();
  const [pedidos, carritos] = await Promise.all([
    consultar(`tienda_pedidos?tienda_id=in.(${ids})&tipo=eq.pedido&lead_id=in.(${suyos.join(',')})&select=numero,estado,total,moneda,productos,creado_at,pagado_at,enviado_at,enlace&order=creado_at.desc&limit=8`),
    consultar(`tienda_pedidos?tienda_id=in.(${ids})&tipo=eq.carrito&lead_id=in.(${suyos.join(',')})&estado=in.(pendiente,abandonado)&creado_at=gte.${enc(desdeCarrito)}&select=total,moneda,productos,creado_at,enlace&order=creado_at.desc&limit=1`),
  ]);
  if (!pedidos?.length && !carritos?.length) return null;
  return { tienda: tiendas[0].nombre || 'la tienda', moneda: tiendas[0].moneda || null, pedidos: pedidos || [], carrito: (carritos || [])[0] || null };
}

const ESTADO = {
  pendiente: 'pendiente de pago',
  pagado: 'pagado, en preparación',
  enviado: 'enviado',
  cancelado: 'cancelado',
  reembolsado: 'reembolsado',
};

function fechaCorta(iso, zona) {
  try { return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: zona || 'America/Bogota' }); }
  catch { return String(iso || '').slice(0, 10); }
}

/** El bloque del prompt. '' si no hay nada que decir. */
export function bloqueCompras(c, zona) {
  if (!c || (!c.pedidos.length && !c.carrito)) return '';
  let txt = '';
  if (c.pedidos.length) {
    const pagados = c.pedidos.filter(p => ['pagado', 'enviado'].includes(p.estado));
    txt += `ESTA PERSONA YA LE HA COMPRADO A ${String(c.tienda).toUpperCase()} (sus pedidos más recientes):\n` +
      // «pagado el …» y no la fecha sola: el modelo la leía como fecha de envío
      // («ya salieron el 20 de septiembre»).
      c.pedidos.map(p => '- ' + [p.numero, (p.pagado_at ? 'pagado el ' : 'hecho el ') + fechaCorta(p.pagado_at || p.creado_at, zona), plata(p.total, p.moneda || c.moneda),
        p.estado === 'enviado' ? (p.enviado_at ? 'enviado el ' + fechaCorta(p.enviado_at, zona) : 'enviado (no sé qué día salió)') : (ESTADO[p.estado] || p.estado),
        productosTexto(p.productos)].filter(Boolean).join(' · ') + (p.enlace ? ' · seguimiento: ' + p.enlace : '')).join('\n') +
      `\n\nAtiéndele como a ${pagados.length > 1 ? 'alguien que vuelve a comprar' : 'alguien que ya te compró'}:
- Si pregunta por su pedido, dile el estado tal como está aquí. «Pagado, en preparación» = ya lo estamos preparando; «enviado» = ya salió.
- La fecha de cada pedido es la de PAGO, no la de envío. Solo sabes cuándo salió si dice «enviado el …»; si no, no lo sabes.
- NO inventes fechas de entrega, transportadora ni número de guía. Si los pide y no están aquí, dile que se lo confirma un asesor e incluye [ESCALAR]. Si el pedido trae enlace de seguimiento, puedes compartirlo.
- Si quiere cambiar, devolver o reclamar algo de un pedido, eso lo resuelve un asesor: tómale el detalle e incluye [ESCALAR].
- Puedes recomendarle algo que vaya con lo que ya compró, pero solo del catálogo que tienes.
- No le recites su historial si no viene al caso: úsalo para atenderle mejor. Y nunca menciones compras de otras personas.

`;
  }
  if (c.carrito) {
    txt += `TIENE UN CARRITO SIN TERMINAR desde el ${fechaCorta(c.carrito.creado_at, zona)}: ${productosTexto(c.carrito.productos) || 'productos'} por ${plata(c.carrito.total, c.carrito.moneda || c.moneda)}.
- Si viene al caso (pregunta por esos productos, por el pago o por cómo comprar), ofrécele terminar la compra${c.carrito.enlace ? ' con este enlace: ' + c.carrito.enlace : ''}.
- No se lo menciones de entrada si escribe por otra cosa: primero atiende lo que pregunta.

`;
  }
  return txt;
}
