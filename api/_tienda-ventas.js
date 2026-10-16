// api/_tienda-ventas.js — los datos del informe «Tienda» de Análisis.
//
// Lo leen dos: api/tiendas.js?ventas=1 (la app) y api/informes-compartidos.js
// (el enlace vivo y su PDF). Una sola consulta para los dos, o un día la app y
// el enlace dirían cifras distintas de la misma tienda.
//
// Sin datos personales: la persona de cada pedido es una clave opaca (el id de
// su lead, o un resumen de su correo), nunca su nombre, correo o teléfono. El
// informe solo necesita saber si dos pedidos son de la misma persona.
// Solo se importa desde edge.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
const enc = encodeURIComponent;
const TECHO = 20000;

async function todas(ruta) {
  const filas = [];
  for (let desde = 0; desde < TECHO; desde += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: sbH({ Range: `${desde}-${desde + 999}`, 'Range-Unit': 'items' }) });
    if (!r.ok && r.status !== 416) throw new Error('No se pudieron leer los pedidos (HTTP ' + r.status + ')');
    const pag = r.status === 416 ? [] : await r.json();
    filas.push(...pag);
    if (pag.length < 1000) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}

async function clave(email) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('acu-persona:' + email)));
  return 'e' + [...d.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * { tiendas: [{nombre, plataforma, moneda}], pedidos: [...], carritos: [...], truncado }
 *   pedido:  { total, moneda, estado, pagado_at, persona, fuente, lead_desde, productos: [{nombre, cantidad, precio}] }
 *   carrito: { total, estado, creado_at }
 * Pedidos: todos los pagados (la historia hace falta para saber quién repite).
 * Carritos: los del último año.
 */
export async function ventasDeTienda(userId, clientId) {
  const alcance = `user_id=eq.${enc(userId)}` + (clientId ? `&client_id=eq.${enc(clientId)}` : '&client_id=is.null');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/tiendas?${alcance}&activo=is.true&select=id,nombre,plataforma,moneda`, { headers: sbH() });
  if (!r.ok) throw new Error('No se pudo leer la tienda (HTTP ' + r.status + ')');
  const tiendas = await r.json();
  if (!tiendas.length) return { tiendas: [], pedidos: [], carritos: [], truncado: false };
  const ids = tiendas.map(t => t.id).join(',');
  const haceUnAno = new Date(Date.now() - 366 * 86400000).toISOString();
  const [ped, car] = await Promise.all([
    todas(`tienda_pedidos?tienda_id=in.(${ids})&tipo=eq.pedido&pagado_at=not.is.null&select=total,moneda,estado,pagado_at,email,telefono,lead_id,productos&order=pagado_at.asc`),
    todas(`tienda_pedidos?tienda_id=in.(${ids})&tipo=eq.carrito&creado_at=gte.${enc(haceUnAno)}&select=total,estado,creado_at&order=creado_at.asc`),
  ]);

  // De qué fuente era cada cliente y desde cuándo estaba en el CRM: así se ve
  // cuánto de lo que se vende en la tienda pasó antes por una conversación.
  const leadIds = [...new Set(ped.filas.map(p => p.lead_id).filter(Boolean))];
  const deLead = new Map();
  for (let i = 0; i < leadIds.length; i += 150) {
    const lote = leadIds.slice(i, i + 150);
    const lr = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${lote.join(',')})&select=id,source,created_at`, { headers: sbH() });
    if (lr.ok) for (const l of await lr.json()) deLead.set(l.id, l);
  }

  const pedidos = [];
  for (const p of ped.filas) {
    const l = p.lead_id ? deLead.get(p.lead_id) : null;
    pedidos.push({
      total: Number(p.total) || 0, moneda: p.moneda || null, estado: p.estado, pagado_at: p.pagado_at,
      persona: p.email ? await clave(String(p.email).toLowerCase()) : (p.lead_id || (p.telefono ? await clave(String(p.telefono).replace(/\D/g, '')) : null)),
      fuente: l ? l.source || null : null,
      lead_desde: l ? l.created_at : null,
      productos: (p.productos || []).slice(0, 30).map(x => ({ nombre: x.nombre, cantidad: x.cantidad || 1, precio: x.precio })),
    });
  }
  return {
    tiendas: tiendas.map(t => ({ nombre: t.nombre, plataforma: t.plataforma, moneda: t.moneda })),
    pedidos,
    carritos: car.filas.map(c => ({ total: Number(c.total) || 0, estado: c.estado, creado_at: c.creado_at })),
    truncado: ped.truncado || car.truncado,
  };
}
