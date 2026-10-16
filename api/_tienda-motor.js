// api/_tienda-motor.js — lo que pasa en Acuarius cuando la tienda avisa algo.
//
//   pedido pagado    → el cliente queda como lead GANADO con el valor del
//                      pedido, se disparan «pedido pagado» y, si es la primera
//                      vez que compra, «primera compra»; y se CANCELA el
//                      recordatorio de carrito que tuviera en curso.
//   pedido enviado   → «pedido enviado».
//   carrito a medias → a los 60 minutos sin compra, «carrito abandonado».
//   sin comprar      → a los N días de su última compra, «sin comprar».
//
// Cada disparo va UNA vez por pedido (tienda_pedidos.disparos): Shopify manda
// orders/updated varias veces por pedido, y cada vez no puede ser un correo.
//
// Todo lo de fuera entra por `io` ({ sb, intake, ahora }) para poder probarlo
// sin base (pruebas/tiendas.mjs). Solo se importa desde edge.

import { plata, productosTexto } from './_tienda.js';

export const ESPERA_CARRITO_MIN = 60;
export const TRIGGERS_TIENDA = ['pedido_pagado', 'primera_compra', 'pedido_enviado', 'carrito_abandonado', 'sin_comprar'];

const enc = encodeURIComponent;

/** Lo que las automatizaciones pueden usar como {{variable}}. */
export function contextoDe(tienda, p) {
  return {
    tienda: tienda.nombre || '',
    pedido: p.numero || '',
    total: plata(p.total, p.moneda || tienda.moneda),
    productos: productosTexto(p.productos),
    enlace_carrito: p.tipo === 'carrito' || p.sin_pagar ? (p.enlace || '') : '',
    enlace_pedido: p.tipo === 'carrito' ? '' : (p.enlace || ''),
  };
}

/** Encola las automatizaciones de ese disparo, con el pedido como contexto. */
export async function encolar(io, userId, lead, tipo, contexto, filtro = () => true) {
  const scope = lead.client_id ? `&client_id=eq.${enc(lead.client_id)}` : '&client_id=is.null';
  const autos = ((await io.sb(`/automations?user_id=eq.${enc(userId)}${scope}&active=eq.true&select=id,trigger`)) || [])
    .filter(a => a.trigger?.type === tipo && filtro(a));
  if (!autos.length) return 0;
  await io.sb('/automation_jobs', 'POST', autos.map(a => ({
    automation_id: a.id, user_id: userId, lead_id: lead.id, step_index: 0,
    status: 'pending', run_at: new Date(io.ahora()).toISOString(), context: contexto,
  })), 'return=minimal');
  return autos.length;
}

// Quien terminó de comprar no puede recibir «se te olvidó algo» media hora
// después. Se cancelan los recordatorios de carrito en curso de esa persona.
export async function cancelarCarritos(io, userId, leadIds) {
  const ids = [...new Set(leadIds.filter(Boolean))];
  if (!ids.length) return 0;
  const autos = ((await io.sb(`/automations?user_id=eq.${enc(userId)}&trigger->>type=eq.carrito_abandonado&select=id`)) || []).map(a => a.id);
  if (!autos.length) return 0;
  const r = await io.sb(`/automation_jobs?status=eq.pending&lead_id=in.(${ids.join(',')})&automation_id=in.(${autos.join(',')})`,
    'PATCH', { status: 'cancelled' }, 'return=representation');
  return (r || []).length;
}

async function previo(io, tiendaId, tipo, externoId) {
  return ((await io.sb(`/tienda_pedidos?tienda_id=eq.${tiendaId}&tipo=eq.${tipo}&externo_id=eq.${enc(externoId)}&select=*&limit=1`)) || [])[0] || null;
}

async function guardar(io, fila) {
  const r = await io.sb('/tienda_pedidos?on_conflict=tienda_id,tipo,externo_id', 'POST',
    { ...fila, updated_at: new Date(io.ahora()).toISOString() }, 'resolution=merge-duplicates,return=representation');
  return (r || [])[0] || fila;
}

async function leadVivo(io, id) {
  if (!id) return null;
  return ((await io.sb(`/leads?id=eq.${id}&deleted_at=is.null&select=*&limit=1`)) || [])[0] || null;
}

function notaDe(tienda, p, que) {
  const prods = productosTexto(p.productos);
  return `${que} ${p.numero || ''} en ${tienda.nombre || 'la tienda'}${p.total != null ? ' por ' + plata(p.total, p.moneda || tienda.moneda) : ''}${prods ? ': ' + prods : ''}`.replace(/\s+/g, ' ').trim();
}

// ── Pedidos ─────────────────────────────────────────────────────────────────
export async function procesarPedido(io, tienda, p) {
  const userId = tienda.user_id, clientId = tienda.client_id || null;
  const antes = await previo(io, tienda.id, 'pedido', p.externo_id);
  const disparos = { ...(antes?.disparos || {}) };
  const res = { lead: null, disparados: [] };

  // Sin correo ni teléfono no hay persona a quien escribirle ni a quien
  // reconocer después: el pedido queda guardado para las cifras, nada más.
  let lead = await leadVivo(io, antes?.lead_id);
  const conContacto = !!(p.email || p.telefono);
  if (!lead && conContacto && p.estado !== 'cancelado') {
    const r = await io.intake(userId, clientId, {
      name: p.nombre, email: p.email, phone: p.telefono,
      source: 'tienda', sourceLabel: tienda.nombre || 'Tienda',
      tags: ['tienda'],
      note: notaDe(tienda, p, p.estado === 'pendiente' ? 'Pedido sin pagar' : 'Pedido'),
      // Quien compró en la tienda no está esperando que lo llamen: la tarea
      // de «primer contacto» solo ensuciaría la lista del asesor.
      sinPrimerContacto: true,
    });
    lead = r?.lead || null;
  }
  res.lead = lead;

  const pagado = p.estado === 'pagado' || p.estado === 'enviado';
  const ahoraIso = new Date(io.ahora()).toISOString();
  if (pagado && lead && !disparos.pagado) {
    // ¿Primera compra? La primera vez que esta persona paga algo en la tienda.
    const filtroPersona = [p.email ? `email.eq.${enc(p.email)}` : null, lead.id ? `lead_id.eq.${lead.id}` : null].filter(Boolean).join(',');
    const anteriores = ((await io.sb(`/tienda_pedidos?tienda_id=eq.${tienda.id}&tipo=eq.pedido&externo_id=neq.${enc(p.externo_id)}&pagado_at=not.is.null&or=(${filtroPersona})&select=id&limit=1`)) || []).length;

    if (lead.stage !== 'ganado') {
      await io.sb(`/leads?id=eq.${lead.id}`, 'PATCH', {
        stage: 'ganado', value: p.total, closed_at: ahoraIso, updated_at: ahoraIso,
        ...(p.moneda ? { close_currency: p.moneda } : {}),
      }, 'return=minimal');
      await io.sb('/lead_activities', 'POST', {
        lead_id: lead.id, user_id: userId, type: 'stage_change',
        content: 'Ganado en la tienda: ' + notaDe(tienda, p, 'pagó el pedido'),
        metadata: { from: lead.stage, to: 'ganado', actor: tienda.nombre || 'Tienda', origen: 'tienda', tienda_id: tienda.id, pedido: p.numero },
      }, 'return=minimal').catch(() => {});
      // Las automatizaciones «cuando pasa a Ganado» que ya tuviera la cuenta.
      await encolar(io, userId, { ...lead, stage: 'ganado' }, 'stage_changed', null, a => !a.trigger.stage || a.trigger.stage === 'ganado');
    } else {
      await io.sb('/lead_activities', 'POST', {
        lead_id: lead.id, user_id: userId, type: 'nota',
        content: notaDe(tienda, p, 'Compró de nuevo: pedido'),
        metadata: { origen: 'tienda', tienda_id: tienda.id, pedido: p.numero },
      }, 'return=minimal').catch(() => {});
    }

    // Sus carritos a medias ya no están a medias.
    const carritos = (await io.sb(`/tienda_pedidos?tienda_id=eq.${tienda.id}&tipo=eq.carrito&estado=in.(pendiente,abandonado)&or=(${[
      p.checkout ? `externo_id.eq.${enc(p.checkout)}` : null,
      p.email ? `email.eq.${enc(p.email)}` : null,
      `externo_id.eq.${enc(p.externo_id)}`,
    ].filter(Boolean).join(',')})&select=id,lead_id`)) || [];
    if (carritos.length) {
      await io.sb(`/tienda_pedidos?id=in.(${carritos.map(c => c.id).join(',')})`, 'PATCH', { estado: 'recuperado', updated_at: ahoraIso }, 'return=minimal');
    }
    await cancelarCarritos(io, userId, [lead.id, ...carritos.map(c => c.lead_id)]);

    const ctx = contextoDe(tienda, { ...p, tipo: 'pedido' });
    if (await encolar(io, userId, lead, 'pedido_pagado', ctx)) res.disparados.push('pedido_pagado');
    if (!anteriores && await encolar(io, userId, lead, 'primera_compra', ctx)) res.disparados.push('primera_compra');
    disparos.pagado = ahoraIso;
  }
  if (p.estado === 'enviado' && lead && !disparos.enviado) {
    if (await encolar(io, userId, lead, 'pedido_enviado', contextoDe(tienda, { ...p, tipo: 'pedido' }))) res.disparados.push('pedido_enviado');
    disparos.enviado = ahoraIso;
  }

  await guardar(io, {
    user_id: userId, client_id: clientId, tienda_id: tienda.id, tipo: 'pedido',
    externo_id: p.externo_id, numero: p.numero, checkout: p.checkout, lead_id: lead?.id || null,
    nombre: p.nombre, email: p.email, telefono: p.telefono, total: p.total, moneda: p.moneda,
    estado: p.estado, productos: p.productos, enlace: p.enlace,
    creado_at: p.creado_at, pagado_at: antes?.pagado_at || p.pagado_at, enviado_at: antes?.enviado_at || p.enviado_at,
    disparos,
  });

  // WooCommerce no tiene checkouts: su carrito abandonado es el pedido que se
  // quedó sin pagar. Se anota como carrito para que el barrido lo vea.
  if (p.sin_pagar && conContacto) {
    const c = await previo(io, tienda.id, 'carrito', p.externo_id);
    if (!c) await guardar(io, {
      user_id: userId, client_id: clientId, tienda_id: tienda.id, tipo: 'carrito',
      externo_id: p.externo_id, numero: p.numero, nombre: p.nombre, email: p.email, telefono: p.telefono,
      total: p.total, moneda: p.moneda, estado: 'pendiente', productos: p.productos, enlace: p.enlace,
      creado_at: p.creado_at || ahoraIso, lead_id: lead?.id || null, disparos: {},
    });
  }
  return res;
}

// ── Carritos (checkouts de Shopify) ─────────────────────────────────────────
export async function procesarCarrito(io, tienda, c) {
  const antes = await previo(io, tienda.id, 'carrito', c.externo_id);
  // Lo que ya se avisó o se recuperó no vuelve atrás por un aviso tardío.
  const estado = c.completado ? 'recuperado'
    : (antes && ['abandonado', 'recuperado', 'sin_contacto'].includes(antes.estado)) ? antes.estado : 'pendiente';
  await guardar(io, {
    user_id: tienda.user_id, client_id: tienda.client_id || null, tienda_id: tienda.id, tipo: 'carrito',
    externo_id: c.externo_id, checkout: c.checkout, nombre: c.nombre, email: c.email, telefono: c.telefono,
    total: c.total, moneda: c.moneda, estado, productos: c.productos, enlace: c.enlace,
    creado_at: c.creado_at, lead_id: antes?.lead_id || null, disparos: antes?.disparos || {},
  });
  return { estado };
}

/**
 * Los carritos que llevan ESPERA_CARRITO_MIN sin compra se vuelven
 * «abandonados»: la persona entra al CRM (o se suma a su lead abierto) y se
 * dispara «carrito abandonado». Los de más de 3 días ya no se avisan: un
 * recordatorio de hace una semana no recupera nada y sí molesta.
 */
export async function barrerCarritos(io, tiendas, { limite = 40 } = {}) {
  const porId = new Map(tiendas.map(t => [t.id, t]));
  if (!porId.size) return { avisados: 0, recuperados: 0 };
  const ahora = io.ahora();
  const hasta = new Date(ahora - ESPERA_CARRITO_MIN * 60000).toISOString();
  const desde = new Date(ahora - 3 * 86400000).toISOString();
  const filas = (await io.sb(`/tienda_pedidos?tipo=eq.carrito&estado=eq.pendiente&tienda_id=in.(${[...porId.keys()].join(',')})&creado_at=lt.${enc(hasta)}&creado_at=gt.${enc(desde)}&select=*&order=creado_at.asc&limit=${limite}`)) || [];
  let avisados = 0, recuperados = 0;
  for (const c of filas) {
    const tienda = porId.get(c.tienda_id);
    const marcar = (estado, extra = {}) => io.sb(`/tienda_pedidos?id=eq.${c.id}`, 'PATCH', { estado, updated_at: new Date(io.ahora()).toISOString(), ...extra }, 'return=minimal');
    if (!c.email && !c.telefono) { await marcar('sin_contacto'); continue; }
    // ¿Compró después por otro camino? (otro checkout, otro dispositivo)
    const compro = ((await io.sb(`/tienda_pedidos?tienda_id=eq.${c.tienda_id}&tipo=eq.pedido&pagado_at=not.is.null&or=(${[
      c.checkout ? `checkout.eq.${enc(c.checkout)}` : null,
      c.email ? `email.eq.${enc(c.email)}` : null,
      `externo_id.eq.${enc(c.externo_id)}`,
    ].filter(Boolean).join(',')})&creado_at=gte.${enc(new Date(Date.parse(c.creado_at) - 6 * 3600000).toISOString())}&select=id&limit=1`)) || []).length;
    if (compro) { await marcar('recuperado'); recuperados++; continue; }

    const r = await io.intake(tienda.user_id, tienda.client_id || null, {
      name: c.nombre, email: c.email, phone: c.telefono,
      source: 'tienda', sourceLabel: tienda.nombre || 'Tienda',
      tags: ['tienda', 'carrito-abandonado'],
      note: notaDe(tienda, c, 'Dejó un carrito sin terminar'),
      sinPrimerContacto: true,
    });
    const lead = r?.lead;
    if (!lead) { await marcar('sin_contacto'); continue; }
    await encolar(io, tienda.user_id, lead, 'carrito_abandonado', contextoDe(tienda, { ...c, tipo: 'carrito' }));
    await marcar('abandonado', { lead_id: lead.id, disparos: { ...(c.disparos || {}), carrito: new Date(io.ahora()).toISOString() } });
    avisados++;
  }
  return { avisados, recuperados };
}

/**
 * «Sin comprar»: a los N días de la última compra. Se mira una ventana de 3
 * días a partir de N (por si el cron no corrió un rato) y una vez por compra:
 * si ya hay un trabajo de esa automatización para ese lead creado después de
 * su última compra, ya se le escribió.
 */
export async function barrerRecompra(io, { limite = 60 } = {}) {
  const autos = (await io.sb(`/automations?active=eq.true&trigger->>type=eq.sin_comprar&select=id,user_id,client_id,trigger`)) || [];
  const ahora = io.ahora();
  let encolados = 0;
  for (const a of autos) {
    const dias = Math.max(7, Math.min(365, parseInt(a.trigger.days, 10) || 30));
    const hasta = new Date(ahora - dias * 86400000).toISOString();
    const desde = new Date(ahora - (dias + 3) * 86400000).toISOString();
    const scope = a.client_id ? `&client_id=eq.${enc(a.client_id)}` : '&client_id=is.null';
    const viejos = (await io.sb(`/tienda_pedidos?user_id=eq.${enc(a.user_id)}${scope}&tipo=eq.pedido&pagado_at=gte.${enc(desde)}&pagado_at=lt.${enc(hasta)}&lead_id=not.is.null&select=lead_id,email,pagado_at,numero,total,moneda,productos,enlace,tienda_id&order=pagado_at.desc&limit=${limite}`)) || [];
    const vistos = new Set();
    for (const p of viejos) {
      if (vistos.has(p.lead_id)) continue;
      vistos.add(p.lead_id);
      // ¿Volvió a comprar después?
      const despues = ((await io.sb(`/tienda_pedidos?user_id=eq.${enc(a.user_id)}&tipo=eq.pedido&pagado_at=gt.${enc(p.pagado_at)}&or=(lead_id.eq.${p.lead_id}${p.email ? ',email.eq.' + enc(p.email) : ''})&select=id&limit=1`)) || []).length;
      if (despues) continue;
      const ya = ((await io.sb(`/automation_jobs?automation_id=eq.${a.id}&lead_id=eq.${p.lead_id}&created_at=gt.${enc(p.pagado_at)}&select=id&limit=1`)) || []).length;
      if (ya) continue;
      const lead = await leadVivo(io, p.lead_id);
      if (!lead) continue;
      const tienda = ((await io.sb(`/tiendas?id=eq.${p.tienda_id}&select=nombre,moneda&limit=1`)) || [])[0] || {};
      await io.sb('/automation_jobs', 'POST', [{
        automation_id: a.id, user_id: a.user_id, lead_id: lead.id, step_index: 0,
        status: 'pending', run_at: new Date(ahora).toISOString(), context: contextoDe(tienda, { ...p, tipo: 'pedido' }),
      }], 'return=minimal');
      encolados++;
    }
  }
  return encolados;
}

// ── Historial ───────────────────────────────────────────────────────────────
// Los pedidos de antes de conectar. Reglas (16-10-2026):
//   · NADA se dispara: ni bienvenida, ni «pedido pagado», ni reparto, ni tarea
//     de primer contacto. Son clientes de hace meses.
//   · Un cliente = UN lead ganado, aunque tenga diez pedidos: su valor es lo
//     que lleva gastado y su fecha, la de su primera compra. Así Análisis no
//     amanece con «800 leads nuevos hoy» ni 800 ventas de hoy.
//   · Si la persona ya tiene una oportunidad abierta (escribe por WhatsApp),
//     sus pedidos se le enlazan y no se le toca la etapa.
//   · Solo pedidos pagados o enviados. Un pedido que ya entró en vivo se salta,
//     así que importar dos veces no duplica nada.
export const HISTORIAL = { pagado: 'historial', enviado: 'historial', historial: true };

export async function importarPedido(io, tienda, p) {
  if (!['pagado', 'enviado'].includes(p.estado)) return 'omitido';
  if (await previo(io, tienda.id, 'pedido', p.externo_id)) return 'ya estaba';
  const userId = tienda.user_id, clientId = tienda.client_id || null;
  const fila = {
    user_id: userId, client_id: clientId, tienda_id: tienda.id, tipo: 'pedido',
    externo_id: p.externo_id, numero: p.numero, checkout: p.checkout,
    nombre: p.nombre, email: p.email, telefono: p.telefono, total: p.total, moneda: p.moneda,
    estado: p.estado, productos: p.productos, enlace: p.enlace,
    creado_at: p.creado_at, pagado_at: p.pagado_at || p.creado_at, enviado_at: p.enviado_at, disparos: HISTORIAL,
  };
  if (!p.email && !p.telefono) { await guardar(io, { ...fila, lead_id: null }); return 'sin contacto'; }

  // ¿Ya es cliente? Por un pedido suyo que ya esté guardado.
  const llave = [p.email ? `email.eq.${enc(p.email)}` : null, p.telefono ? `telefono.eq.${enc(p.telefono)}` : null].filter(Boolean).join(',');
  const suyo = ((await io.sb(`/tienda_pedidos?tienda_id=eq.${tienda.id}&lead_id=not.is.null&or=(${llave})&select=lead_id&limit=1`)) || [])[0];
  let lead = await leadVivo(io, suyo?.lead_id);
  let nuevo = false;
  if (!lead) {
    const r = await io.intake(userId, clientId, {
      name: p.nombre, email: p.email, phone: p.telefono,
      source: 'tienda', sourceLabel: tienda.nombre || 'Tienda', tags: ['tienda'],
      stage: 'ganado', silencioso: true, sinAsignar: true, sinPrimerContacto: true,
      note: 'Cliente de ' + (tienda.nombre || 'la tienda') + ' (importado del historial de pedidos)',
    });
    lead = r?.lead || null;
    nuevo = !!r?.created;
  }
  const fecha = p.pagado_at || p.creado_at;
  if (lead && nuevo) {
    await io.sb(`/leads?id=eq.${lead.id}`, 'PATCH', {
      value: p.total, created_at: fecha, closed_at: lead.stage === 'ganado' ? fecha : null,
      ...(p.moneda ? { close_currency: p.moneda } : {}),
    }, 'return=minimal');
  } else if (lead && lead.stage === 'ganado' && lead.source === 'tienda') {
    // Otro pedido del mismo cliente: suma a lo que lleva gastado.
    await io.sb(`/leads?id=eq.${lead.id}`, 'PATCH', { value: (Number(lead.value) || 0) + (Number(p.total) || 0) }, 'return=minimal');
  }
  await guardar(io, { ...fila, lead_id: lead?.id || null });
  return nuevo ? 'cliente nuevo' : 'sumado';
}

/**
 * Una página de pedidos. Los de la MISMA persona van en fila (si no, dos
 * pedidos suyos a la vez la crearían dos veces); personas distintas, en
 * paralelo. Devuelve cuántos pedidos y clientes nuevos entraron.
 */
export async function importarPagina(io, tienda, pedidos, { enParalelo = 4 } = {}) {
  const grupos = new Map();
  for (const p of pedidos) {
    const k = p.email || p.telefono || 'id:' + p.externo_id;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const lista = [...grupos.values()];
  let i = 0, importados = 0, clientes = 0;
  async function obrero() {
    while (i < lista.length) {
      for (const p of lista[i++]) {
        const r = await importarPedido(io, tienda, p);
        if (r === 'cliente nuevo' || r === 'sumado' || r === 'sin contacto') importados++;
        if (r === 'cliente nuevo') clientes++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(enParalelo, lista.length) }, obrero));
  return { importados, clientes };
}
