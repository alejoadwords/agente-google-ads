// api/hotmart-webhook.js
// Sin dependencias externas — usa fetch nativo igual que referral.js

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const HOTMART_SECRET = process.env.HOTMART_WEBHOOK_SECRET;
const CLERK_SECRET  = process.env.CLERK_SECRET_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const ALERTA_A      = process.env.ALERT_EMAIL || 'alejandro.gonzalez.ads@gmail.com';

// ── Aviso cuando una compra NO se pudo activar ───────────────────────────────
// El fallo silencioso es el peor caso del negocio: el cliente paga, no recibe
// nada, y el unico rastro era un console.error en los logs de Vercel. Pasa
// cuando el email de Hotmart no coincide con el de Clerk o cuando el comprador
// paga antes de registrarse. Nunca lanza: un fallo del aviso no puede tumbar
// el webhook ni provocar reintentos de Hotmart.
async function avisarFalloActivacion({ email, productName, motivo, extra }) {
  console.error('[hotmart-webhook] ACTIVACION FALLIDA:', motivo, '|', email, '|', productName);
  if (!RESEND_KEY) return false;
  try {
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' +
        '<h2 style="font-size:18px;margin:0 0 12px">Una compra no se pudo activar</h2>' +
        '<p style="margin:0 0 14px">Hotmart confirmo un pago pero no se pudo aplicar el plan en Clerk. ' +
        'El cliente pago y <strong>no tiene acceso</strong>.</p>' +
        '<table style="border-collapse:collapse;font-size:14px">' +
          '<tr><td style="padding:4px 12px 4px 0;color:#5a5a72">Email del comprador</td><td><strong>' + (email || '—') + '</strong></td></tr>' +
          '<tr><td style="padding:4px 12px 4px 0;color:#5a5a72">Producto</td><td>' + (productName || '—') + '</td></tr>' +
          '<tr><td style="padding:4px 12px 4px 0;color:#5a5a72">Motivo</td><td>' + motivo + '</td></tr>' +
          (extra ? '<tr><td style="padding:4px 12px 4px 0;color:#5a5a72">Detalle</td><td>' + extra + '</td></tr>' : '') +
        '</table>' +
        '<p style="margin:16px 0 0">Como arreglarlo: verifica que el cliente tenga cuenta en Acuarius con ese mismo email. ' +
        'Si la tiene con otro, asigna el plan a mano desde el panel de admin (escribe en Clerk y la app lo respeta al instante).</p>' +
      '</div>';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Acuarius <notificaciones@app.acuarius.app>',
        to: [ALERTA_A],
        subject: 'Compra sin activar: ' + (email || 'sin email') + ' (' + (productName || 'producto desconocido') + ')',
        html,
      }),
    });
    return r.ok;
  } catch (e) {
    console.error('[hotmart-webhook] no se pudo enviar el aviso:', e.message);
    return false;
  }
}

// ── Cantidad comprada: de donde sale y por que en ese orden ─────────────────
// Hotmart 2.0 manda data.purchase.offer.code, un alfanumerico ALEATORIO
// ('2muq4ex2'). Sacarle digitos con un regex es una bomba: '2muq4ex2' daria 2.
// Y data.purchase.price.value viene en la moneda del comprador (ISO 4217 en
// price.currency_value), asi que una compra colombiana de 13.512 COP inferida
// como USD daba miles de paquetes. Orden de confianza:
//   1. Mapa explicito por codigo de oferta  → exacto, no adivina
//   2. Nombre de la oferta, si trae un patron claro de cantidad
//   3. Precio, SOLO si la moneda es USD
//   4. Nada fiable → 1 unidad y aviso por email para ajustarlo a mano
//
// Para añadir una oferta: su codigo esta en el link de pago, en ?off=CODIGO.
const OFERTAS = {
  // Creditos de video (producto 7642463)
  '2muq4ex2': { tipo: 'video',     cantidad: 5  },
  'mfjz53b5': { tipo: 'video',     cantidad: 10 },
  // Usuarios adicionales (producto 8179091) — $9 por usuario
  // Contactos adicionales (producto 8216932) — paquetes de 1.000
  // Pendiente: añadir aqui los codigos ?off= de cada oferta
};

function monedaEsUSD(data) {
  const c = (data?.purchase?.price?.currency_value || data?.purchase?.full_price?.currency_value || '').toUpperCase();
  return c === 'USD' || c === '';  // vacio = payloads viejos sin el campo
}

// Devuelve { cantidad, fuente } — 'fuente' sirve para saber si hay que avisar
function resolverCantidad(data, { tipo, patronNombre, porPrecio, maximo }) {
  const codigo = (data?.purchase?.offer?.code || '').trim();
  const o = codigo ? OFERTAS[codigo] : null;
  // El tipo debe coincidir: si no, una oferta de video mapeada a 5 acabaria
  // dando 5 asientos al caer en otra rama.
  if (o && o.cantidad && o.tipo === tipo) {
    return { cantidad: Math.min(o.cantidad, maximo), fuente: 'codigo' };
  }
  // OJO: solo el NOMBRE, nunca el codigo — el codigo es aleatorio
  const nombre = (data?.purchase?.offer?.name || '').toLowerCase().trim();
  if (nombre && patronNombre) {
    const n = patronNombre(nombre);
    if (n > 0) return { cantidad: Math.min(n, maximo), fuente: 'nombre' };
  }
  const precio = data?.purchase?.price?.value || 0;
  if (precio > 0 && monedaEsUSD(data)) {
    const n = porPrecio(precio);
    if (n > 0) return { cantidad: Math.min(n, maximo), fuente: 'precio' };
  }
  return { cantidad: 1, fuente: 'indeterminada' };
}

// ── Clerk: la app lee el plan de publicMetadata.plan — actualizarlo es lo que
// realmente activa/desactiva el plan para el usuario ─────────────────────────
async function clerkFindUserByEmail(email) {
  const r = await fetch('https://api.clerk.com/v1/users?email_address=' + encodeURIComponent(email) + '&limit=1', {
    headers: { Authorization: `Bearer ${CLERK_SECRET}` },
  });
  const users = await r.json();
  return Array.isArray(users) && users.length ? users[0] : null;
}

async function clerkSetPlan(clerkUserId, plan) {
  return clerkMergeMetadata(clerkUserId, { plan });
}

// El endpoint /metadata de Clerk hace MERGE — no pisa leads_extra/emails_extra/seats_extra
async function clerkMergeMetadata(clerkUserId, obj) {
  const r = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}/metadata`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${CLERK_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_metadata: obj }),
  });
  return r.ok;
}

// ── Helper REST Supabase (igual que referral.js) ──────────────────────────────
async function sb(path, method = 'GET', body = null, prefer = 'return=representation') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        prefer,
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── GET ?email=x → consulta plan activo ──────────────────────────────────
  if (req.method === 'GET') {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const { data: users } = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
    if (!users || users.length === 0) return res.json({ plan: 'free', active: false });
    const userId = users[0].id;

    const { data: billing } = await sb(
      `/billing?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=plan,status,period_end&order=created_at.desc&limit=1`
    );
    if (!billing || billing.length === 0) return res.json({ plan: 'free', active: false });

    const active = new Date(billing[0].period_end) > new Date();
    return res.json({ plan: billing[0].plan, active });
  }

  // ── POST → evento de Hotmart ──────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['x-hotmart-hottok'];
  if (!HOTMART_SECRET || signature !== HOTMART_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event     = req.body;
  const eventType = event?.event;
  const data      = event?.data;

  console.log('[hotmart-webhook]', JSON.stringify({
    eventType,
    email:       data?.buyer?.email,
    product:     data?.product?.name,
    transaction: data?.purchase?.transaction,
  }));

  // SUBSCRIPTION_PURCHASE = renovación mensual automática de Hotmart
  const eventosValidos     = ['PURCHASE_APPROVED','PURCHASE_COMPLETE','SUBSCRIPTION_REACTIVATED','SUBSCRIPTION_PURCHASE'];
  const eventosCancelacion = ['PURCHASE_REFUNDED','PURCHASE_CHARGEBACK','SUBSCRIPTION_CANCELLATION'];

  if (!eventosValidos.includes(eventType) && !eventosCancelacion.includes(eventType)) {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  const email          = data?.buyer?.email;
  const transactionId  = data?.purchase?.transaction;
  const subscriptionId = data?.subscription?.subscriber?.code || null;
  const productName    = (data?.product?.name || '').toLowerCase();

  if (!email) return res.status(400).json({ error: 'Missing email' });

  // Buscar usuario en Supabase (best-effort: billing y referidos; la activación
  // real del plan pasa por Clerk más abajo y no depende de esta tabla)
  const { data: users } = await sb(`/users?email=eq.${encodeURIComponent(email)}&select=id,video_credits_extra&limit=1`);
  const usuario = (users && users.length) ? users[0] : null;

  // ── Compra de créditos de video ──────────────────────────────────────────
  if (productName.includes('video')) {
    if (!usuario) {
      await avisarFalloActivacion({ email, productName, motivo: 'El comprador no existe en la tabla users de Supabase' });
      return res.status(200).json({ received: true, action: 'user_not_found', email });
    }
    if (eventosCancelacion.includes(eventType)) {
      return res.status(200).json({ received: true, action: 'video_credits_no_refund' });
    }
    const rv = resolverCantidad(data, {
      tipo: 'video',
      patronNombre: (n) => { const m = n.match(/(\d+)\s*(cr[eé]dito|video)/); return m ? parseInt(m[1]) : 0; },
      porPrecio: (p) => (p <= 12 ? 5 : 10),
      maximo: 50,
    });
    const creditsToAdd = rv.fuente === 'indeterminada' ? 5 : rv.cantidad;

    await sb(
      `/users?id=eq.${encodeURIComponent(usuario.id)}`,
      'PATCH',
      { video_credits_extra: (usuario.video_credits_extra || 0) + creditsToAdd },
      'return=minimal'
    );
    return res.status(200).json({ received: true, action: 'video_credits_added', credits: creditsToAdd, email });
  }

  // ── Paquetes de emails de campaña (suscripción mensual) ──────────────────
  // Producto con 'email' en el nombre. Paquetes de 2.000 emails/mes: la
  // oferta lleva el volumen en el nombre ('2k' → 1 paquete, '4k' → 2,
  // '6k' → 3, '10k' → 5...). Fallback por precio (~$4 por paquete).
  // emails_extra se FIJA con el total de paquetes de la oferta comprada —
  // idempotente ante renovaciones. Cancelación → 0.
  if (productName.includes('email')) {
    let clerkOk = false;
    try {
      const clerkUser = await clerkFindUserByEmail(email);
      if (!clerkUser) {
        await avisarFalloActivacion({ email, productName, motivo: 'No hay cuenta en Clerk con ese email (complemento sin aplicar)' });
        return res.status(200).json({ received: true, action: 'user_not_found', email });
      }
      if (eventosCancelacion.includes(eventType)) {
        clerkOk = await clerkMergeMetadata(clerkUser.id, { emails_extra: 0 });
        return res.status(200).json({ received: true, action: 'email_pack_cancelled', clerkUpdated: clerkOk });
      }
      const re = resolverCantidad(data, {
        tipo: 'emails',
        patronNombre: (n) => { const k = n.match(/(\d+)\s*k\b/); return k ? Math.round(parseInt(k[1]) / 2) : 0; },
        porPrecio: (p) => (p <= 5 ? 1 : p <= 9 ? 2 : p <= 13 ? 3 : p <= 17 ? 4 : p <= 23 ? 5 : Math.round(p / 4)),
        maximo: 50,
      });
      const packs = re.cantidad;
      clerkOk = await clerkMergeMetadata(clerkUser.id, { emails_extra: packs });
      return res.status(200).json({ received: true, action: 'email_pack_set', packs, emails: packs * 2000, clerkUpdated: clerkOk });
    } catch (e) {
      console.error('[hotmart-webhook] email pack error:', e.message);
      return res.status(200).json({ received: true, action: 'email_pack_error' });
    }
  }

  // ── Usuarios adicionales de equipo (suscripción mensual) ─────────────────
  // Producto con 'usuario', 'asiento' o 'seat' en el nombre. La oferta lleva la cantidad
  // ('1 asiento' → 1, '2 asientos' → 2...). Fallback por precio ($9/asiento).
  // seats_extra se FIJA con la cantidad de la oferta comprada — idempotente
  // ante renovaciones. Cancelación → 0. api/team.js lo suma al cupo del plan.
  if (productName.includes('asiento') || productName.includes('seat') || productName.includes('usuario')) {
    let clerkOk = false;
    try {
      const clerkUser = await clerkFindUserByEmail(email);
      if (!clerkUser) {
        await avisarFalloActivacion({ email, productName, motivo: 'No hay cuenta en Clerk con ese email (complemento sin aplicar)' });
        return res.status(200).json({ received: true, action: 'user_not_found', email });
      }
      if (eventosCancelacion.includes(eventType)) {
        clerkOk = await clerkMergeMetadata(clerkUser.id, { seats_extra: 0 });
        return res.status(200).json({ received: true, action: 'seats_cancelled', clerkUpdated: clerkOk });
      }
      const r = resolverCantidad(data, {
        tipo: 'asientos',
        patronNombre: (n) => { const m = n.match(/(\d+)\s*(usuario|asiento|seat)/); return m ? parseInt(m[1]) : 0; },
        porPrecio: (p) => Math.round(p / 9),   // $9 por usuario
        maximo: 20,
      });
      const seats = r.cantidad;
      clerkOk = await clerkMergeMetadata(clerkUser.id, { seats_extra: seats });
      if (r.fuente === 'indeterminada') {
        await avisarFalloActivacion({ email, productName, motivo: 'No se pudo determinar cuantos usuarios compro — se aplico 1',
          extra: 'Oferta: ' + (data?.purchase?.offer?.code || 'sin codigo') + ' · Precio: ' + (data?.purchase?.price?.value || 0) + ' ' + (data?.purchase?.price?.currency_value || '?') });
      }
      return res.status(200).json({ received: true, action: 'seats_set', seats, fuente: r.fuente, clerkUpdated: clerkOk });
    } catch (e) {
      console.error('[hotmart-webhook] seats error:', e.message);
      return res.status(200).json({ received: true, action: 'seats_error' });
    }
  }

  // ── Paquetes de contactos del CRM (suscripción mensual) ──────────────────
  // Producto con 'contacto' o 'lead' en el nombre. Paquetes de 1.000 contactos:
  // la oferta lleva el volumen en el nombre ('1k'/'1.000' → 1 paquete, '5k' → 5).
  // Fallback por precio (~$4 por paquete en Pro, ~$3 en Agency).
  // leads_extra se FIJA con el total de la oferta comprada — idempotente ante
  // renovaciones. Cancelación → 0. api/leads.js lo suma al cupo del plan.
  if (productName.includes('contacto') || productName.includes('lead')) {
    let clerkOk = false;
    try {
      const clerkUser = await clerkFindUserByEmail(email);
      if (!clerkUser) {
        await avisarFalloActivacion({ email, productName, motivo: 'No hay cuenta en Clerk con ese email (complemento sin aplicar)' });
        return res.status(200).json({ received: true, action: 'user_not_found', email });
      }
      if (eventosCancelacion.includes(eventType)) {
        clerkOk = await clerkMergeMetadata(clerkUser.id, { leads_extra: 0 });
        return res.status(200).json({ received: true, action: 'lead_pack_cancelled', clerkUpdated: clerkOk });
      }
      const r = resolverCantidad(data, {
        tipo: 'contactos',
        patronNombre: (n) => {
          const k = n.match(/(\d+)\s*k\b/);              // '5k contactos' → 5
          if (k) return parseInt(k[1]);
          const mil = n.match(/(\d+)[.,](\d{3})/);        // '5.000 contactos' → 5
          if (mil) return parseInt(mil[1]);
          return 0;
        },
        porPrecio: (p) => Math.round(p / 4),   // $4 por cada 1.000
        maximo: 100,
      });
      const packs = r.cantidad;
      clerkOk = await clerkMergeMetadata(clerkUser.id, { leads_extra: packs });
      if (r.fuente === 'indeterminada') {
        await avisarFalloActivacion({ email, productName, motivo: 'No se pudo determinar cuantos contactos compro — se aplicaron 1.000',
          extra: 'Oferta: ' + (data?.purchase?.offer?.code || 'sin codigo') + ' · Precio: ' + (data?.purchase?.price?.value || 0) + ' ' + (data?.purchase?.price?.currency_value || '?') });
      }
      return res.status(200).json({ received: true, action: 'lead_pack_set', packs, contacts: packs * 1000, fuente: r.fuente, clerkUpdated: clerkOk });
    } catch (e) {
      console.error('[hotmart-webhook] lead pack error:', e.message);
      return res.status(200).json({ received: true, action: 'lead_pack_error' });
    }
  }

  // ── Red de seguridad antes de tocar el plan ──────────────────────────────
  // Todo lo que llega hasta aquí se trataba como compra de plan, con 'pro' por
  // defecto: un add-on nuevo con un nombre no contemplado DEGRADABA a un Agency.
  // Si el nombre huele a complemento y no menciona un plan, no tocar nada.
  const pareceAddon = /extra|adicional|paquete|pack|cr[eé]dito|ampliaci[oó]n/.test(productName);
  const mencionaPlan = /pro\b|agenc|plan|acuarius/.test(productName);
  if (pareceAddon && !mencionaPlan) {
    console.error('[hotmart-webhook] producto no reconocido, plan intacto:', productName);
    return res.status(200).json({ received: true, action: 'unhandled_product', product: productName });
  }

  // ── Suscripción / plan ──────────────────────────────────────────────────
  // Modelo actual: Pro $39 / Agency $99. 'agenc' cubre "Agency" y "Agencia".
  const plan = productName.includes('agenc') ? 'agency' : 'pro';

  // Precios y comisiones de referido por plan
  const PLAN_CONFIG = {
    agency: { amount: 99, commission: 10 },
    pro:    { amount: 39, commission: 5  },
  };
  const { amount: planAmount, commission: planCommission } = PLAN_CONFIG[plan];

  // ── Cancelación: desactivar en Clerk (fuente de verdad de la app) ────────
  if (eventosCancelacion.includes(eventType)) {
    let clerkOk = false;
    try {
      const clerkUser = await clerkFindUserByEmail(email);
      if (clerkUser) clerkOk = await clerkSetPlan(clerkUser.id, 'free');
    } catch (e) { console.error('[hotmart-webhook] Clerk cancel error:', e.message); }
    if (usuario) await sb(`/billing?user_id=eq.${encodeURIComponent(usuario.id)}`, 'PATCH', { status: 'cancelled' }, 'return=minimal');
    return res.status(200).json({ received: true, action: 'cancelled', clerkUpdated: clerkOk });
  }

  // ── Activación: Clerk publicMetadata.plan es lo que la app lee ───────────
  let clerkOk = false;
  try {
    const clerkUser = await clerkFindUserByEmail(email);
    if (clerkUser) clerkOk = await clerkSetPlan(clerkUser.id, plan);
    else await avisarFalloActivacion({ email, productName, motivo: 'No hay cuenta en Clerk con ese email', extra: 'Plan que deberia tener: ' + plan });
  } catch (e) { console.error('[hotmart-webhook] Clerk activate error:', e.message); }

  const ahora      = new Date();
  const vencimiento = new Date(ahora);
  vencimiento.setMonth(vencimiento.getMonth() + 1);

  if (usuario) {
    // Resetear créditos mensuales de video al renovar
    await sb(
      `/users?id=eq.${encodeURIComponent(usuario.id)}`,
      'PATCH',
      { video_credits_used: 0, video_credits_reset_at: ahora.toISOString() },
      'return=minimal'
    );

    // Upsert billing (histórico de facturación y sistema de referidos)
    await sb('/billing', 'POST', {
      user_id:                  usuario.id,
      plan,
      status:                   'active',
      amount:                   planAmount,
      currency:                 'USD',
      period_start:             ahora.toISOString(),
      period_end:               vencimiento.toISOString(),
      hotmart_transaction:      transactionId,
      hotmart_subscription_id:  subscriptionId,
      notes:                    `Activado via Hotmart - ${eventType}`,
    }, 'resolution=merge-duplicates,return=minimal');
  }

  // ── Rastreo de referidos ────────────────────────────────────────────────
  try {
    const { data: refRows } = await sb(
      `/referral_conversions?referred_email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`
    );
    const refConversion = refRows?.[0];

    if (refConversion) {
      if (refConversion.status === 'registered') {
        await sb(
          `/referral_conversions?id=eq.${refConversion.id}`,
          'PATCH',
          {
            status:           'active',
            referred_user_id: usuario ? usuario.id : null,
            activated_at:     ahora.toISOString(),
            months_paid:      1,
            total_earned:     planCommission,
            updated_at:       ahora.toISOString(),
          },
          'return=minimal'
        );
      } else if (refConversion.status === 'active') {
        await sb(
          `/referral_conversions?id=eq.${refConversion.id}`,
          'PATCH',
          {
            months_paid:  (refConversion.months_paid || 0) + 1,
            total_earned: parseFloat(refConversion.total_earned || 0) + planCommission,
            updated_at:   ahora.toISOString(),
          },
          'return=minimal'
        );
      }
    }
  } catch (refErr) {
    console.warn('[hotmart-webhook] Referral tracking error:', refErr.message);
  }

  return res.status(200).json({ received: true, action: 'activated', plan, amount: planAmount, commission: planCommission, clerkUpdated: clerkOk, email });
}
