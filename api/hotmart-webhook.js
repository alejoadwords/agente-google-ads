// api/hotmart-webhook.js
// Sin dependencias externas — usa fetch nativo igual que referral.js

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const HOTMART_SECRET = process.env.HOTMART_WEBHOOK_SECRET;
const CLERK_SECRET  = process.env.CLERK_SECRET_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const ALERTA_A      = process.env.ALERT_EMAIL || 'alejandro.gonzalez.ads@gmail.com';
const META_PIXEL_ID  = process.env.META_PIXEL_ID;
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN;

// ── Conversión a Meta por API de conversiones ───────────────────────────────
// Por qué desde aquí y no con un píxel en la página de gracias: el checkout
// ocurre en hotmart.com, no en nuestro dominio, y no todo el que paga vuelve a
// la página de gracias — cierra la pestaña, o el pago se aprueba horas después.
// Este webhook es el único sitio que se entera de TODAS las compras.
//
// El correo viaja cifrado (SHA-256 sobre el correo en minúsculas y sin
// espacios): Meta solo puede comprobar si coincide con alguien que ya conoce.
// Declarado en la sección 6 de la política de privacidad.
//
// `event_id` = la transacción de Hotmart. Si algún día se añade también el
// píxel en el navegador, Meta usará ese id para no contar la compra dos veces.
//
// Nunca revienta el webhook: si Meta falla, la compra ya se activó y eso es lo
// que importa. Se registra en consola y se sigue.
async function enviarConversionMeta({ email, valor, moneda, transactionId, plan }) {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) return { enviado: false, motivo: 'sin configurar' };
  if (!email) return { enviado: false, motivo: 'sin email' };
  try {
    const { createHash } = await import('node:crypto');
    const hash = (v) => createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
    const evento = {
      event_name:       'Purchase',
      event_time:       Math.floor(Date.now() / 1000),
      event_id:         String(transactionId || ''),
      action_source:    'website',
      event_source_url: 'https://app.acuarius.app/success.html',
      user_data:        { em: [hash(email)] },
      custom_data:      {
        value:        Number(valor) || 0,
        currency:     (moneda || 'USD').toUpperCase(),
        content_name: plan === 'agency' ? 'Acuarius Agency' : 'Acuarius Pro',
      },
    };
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_CAPI_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [evento] }) }
    );
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[hotmart-webhook] Meta CAPI rechazó el evento:', JSON.stringify(cuerpo));
      return { enviado: false, motivo: cuerpo?.error?.message || ('HTTP ' + r.status) };
    }
    return { enviado: true, recibidos: cuerpo.events_received };
  } catch (e) {
    console.error('[hotmart-webhook] Meta CAPI error:', e.message);
    return { enviado: false, motivo: e.message };
  }
}

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

// Hotmart no manda el nombre del plan siempre en el mismo sitio segun el
// evento (compra suelta, suscripcion, cambio de plan). En vez de apostar por
// una forma concreta, se recogen todos los sitios donde puede venir. Leer de
// mas es inofensivo: el patron exige un numero junto a la palabra clave, asi
// que un nombre generico como 'Contactos adicionales' no produce cantidad.
function nombresCandidatos(data) {
  return [
    data?.subscription?.plan?.name,
    data?.plan?.name,
    data?.purchase?.subscription?.plan?.name,
    data?.purchase?.offer?.name,
    data?.product?.name,
  ].filter(Boolean).map(x => String(x).toLowerCase().trim());
}

function codigosCandidatos(data) {
  return [
    data?.purchase?.offer?.code,
    data?.subscription?.plan?.offer?.code,
    data?.plan?.offer?.code,
  ].filter(Boolean).map(x => String(x).trim());
}

// ── Cambio de plan: cual es el plan NUEVO ───────────────────────────────────
// El payload de SWITCH_PLAN no lo hemos visto en real. Lo mas probable es que
// traiga una lista de planes marcando el vigente, asi que se prueban las formas
// razonables y, si ninguna encaja, se devuelve null y se avisa con el payload
// entero en vez de aplicar algo a ciegas.
function planNuevoDeSwitch(data) {
  const listas = [data?.plans, data?.subscription?.plans, data?.purchase?.plans].filter(Array.isArray);
  for (const lista of listas) {
    if (!lista.length) continue;
    // El vigente tras el cambio: 'current' o 'active' en true
    const vigente = lista.find(p => p && (p.current === true || p.active === true));
    const elegido = vigente || lista[lista.length - 1];
    const nombre = elegido?.name || elegido?.plan?.name;
    if (nombre) return String(nombre);
  }
  // Formas planas
  const sueltos = [data?.new_plan?.name, data?.subscription?.plan?.name, data?.plan?.name];
  for (const n of sueltos) if (n) return String(n);
  return null;
}

// ── Periodicidad: mensual o anual ───────────────────────────────────────────
// Hotmart no expone la periodicidad en un unico campo segun el evento, asi que
// se miran varios y, si no hay señal clara, se asume MENSUAL (lo conservador:
// un anual mal leido como mensual solo deja el registro corto; al reves daria
// 11 meses de acceso no pagado).
function esAnual(data) {
  const campos = [
    data?.subscription?.plan?.recurrency_period,
    data?.plan?.recurrency_period,
    data?.purchase?.subscription?.plan?.recurrency_period,
    data?.purchase?.recurrency_period,
  ].filter(v => v !== undefined && v !== null);
  for (const v of campos) {
    if (typeof v === 'number' && v >= 300) return true;          // periodo en dias
    if (typeof v === 'string' && /anual|annual|year/i.test(v)) return true;
  }
  // El nombre del plan tambien vale: '... anual', '... annual', '... por año'
  return nombresCandidatos(data).some(n => /\banual\b|\bannual\b|\baño\b|\banno\b|12\s*mes/.test(n));
}

// Devuelve { cantidad, fuente } — 'fuente' sirve para saber si hay que avisar
function resolverCantidad(data, { tipo, patronNombre, porPrecio, maximo }) {
  // 1. Mapa explicito por codigo de oferta. El tipo debe coincidir: si no, una
  //    oferta de video mapeada a 5 acabaria dando 5 asientos en otra rama.
  for (const codigo of codigosCandidatos(data)) {
    const o = OFERTAS[codigo];
    if (o && o.cantidad && o.tipo === tipo) {
      return { cantidad: Math.min(o.cantidad, maximo), fuente: 'codigo' };
    }
  }
  // 2. Cualquier nombre que traiga un patron claro de cantidad. NUNCA el
  //    codigo de oferta, que es un alfanumerico aleatorio.
  if (patronNombre) {
    for (const nombre of nombresCandidatos(data)) {
      const n = patronNombre(nombre);
      if (n > 0) return { cantidad: Math.min(n, maximo), fuente: 'nombre' };
    }
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

  // SWITCH_PLAN: el cliente se mueve entre planes del mismo producto (p.ej. de
  // '2 usuarios' a '4 usuarios'). Su payload tiene otra forma — trae los planes
  // actual y nuevo — y no la hemos visto en real todavia. NO se adivina: se
  // registra entero y se avisa para ajustarlo a mano. Con el primer evento real
  // sabremos la estructura exacta y se podra automatizar sin inventar nada.
  if (eventType === 'SWITCH_PLAN') {
    console.log('[hotmart-webhook] SWITCH_PLAN payload completo:', JSON.stringify(event));
    const correo   = data?.buyer?.email;
    const prod     = (data?.product?.name || '').toLowerCase();
    const planNuevo = planNuevoDeSwitch(data);

    // Sin plan nuevo identificable o sin cuenta en Clerk no se toca nada: se
    // avisa con el payload entero para poder automatizarlo con certeza.
    const avisarConPayload = (motivo) => avisarFalloActivacion({
      email: correo,
      productName: data?.product?.name || 'desconocido',
      motivo,
      extra: 'Payload: <code style="font-size:11px;word-break:break-all">' + JSON.stringify(event).slice(0, 3000) + '</code>',
    });

    if (!correo || !planNuevo) {
      await avisarConPayload('Cambio de plan sin plan nuevo identificable — ajustalo a mano');
      return res.status(200).json({ received: true, action: 'switch_plan_sin_plan' });
    }

    let clerkUser = null;
    try { clerkUser = await clerkFindUserByEmail(correo); } catch {}
    if (!clerkUser) {
      await avisarConPayload('Cambio de plan de alguien sin cuenta en Clerk con ese email');
      return res.status(200).json({ received: true, action: 'switch_plan_sin_usuario' });
    }

    // El nombre del plan nuevo manda. Se apaga el respaldo por precio: en un
    // cambio de plan el importe suele venir prorrateado y daria una cantidad
    // equivocada.
    const datosNuevos = { ...data, subscription: { ...(data.subscription || {}), plan: { name: planNuevo } } };
    const sinPrecio = () => 0;
    let resultado = null;

    if (prod.includes('asiento') || prod.includes('seat') || prod.includes('usuario')) {
      const r = resolverCantidad(datosNuevos, {
        tipo: 'asientos',
        patronNombre: (n) => { const m = n.match(/(\d+)\s*(usuario|asiento|seat)/); return m ? parseInt(m[1]) : 0; },
        porPrecio: sinPrecio, maximo: 20,
      });
      if (r.fuente !== 'indeterminada') {
        await clerkMergeMetadata(clerkUser.id, { seats_extra: r.cantidad });
        resultado = { campo: 'seats_extra', valor: r.cantidad };
      }
    } else if (prod.includes('contacto') || prod.includes('lead')) {
      const r = resolverCantidad(datosNuevos, {
        tipo: 'contactos',
        patronNombre: (n) => {
          const k = n.match(/(\d+)\s*k\b/); if (k) return parseInt(k[1]);
          const mil = n.match(/(\d+)[.,](\d{3})/); if (mil) return parseInt(mil[1]);
          return 0;
        },
        porPrecio: sinPrecio, maximo: 100,
      });
      if (r.fuente !== 'indeterminada') {
        await clerkMergeMetadata(clerkUser.id, { leads_extra: r.cantidad });
        resultado = { campo: 'leads_extra', valor: r.cantidad };
      }
    } else if (prod.includes('email')) {
      const r = resolverCantidad(datosNuevos, {
        tipo: 'emails',
        patronNombre: (n) => { const k = n.match(/(\d+)\s*k\b/); return k ? Math.round(parseInt(k[1]) / 2) : 0; },
        porPrecio: sinPrecio, maximo: 50,
      });
      if (r.fuente !== 'indeterminada') {
        await clerkMergeMetadata(clerkUser.id, { emails_extra: r.cantidad });
        resultado = { campo: 'emails_extra', valor: r.cantidad };
      }
    } else {
      // Producto de plan base: Pro <-> Agency, mensual <-> anual. El plan sale
      // del nombre del PRODUCTO, igual que en una compra normal.
      const planDestino = prod.includes('agenc') ? 'agency' : 'pro';
      await clerkSetPlan(clerkUser.id, planDestino);
      resultado = { campo: 'plan', valor: planDestino, anual: esAnual(datosNuevos) };
    }

    if (!resultado) {
      await avisarConPayload('Cambio de plan a "' + planNuevo + '" — no se pudo deducir la cantidad nueva');
      return res.status(200).json({ received: true, action: 'switch_plan_indeterminado', plan_nuevo: planNuevo });
    }
    console.log('[hotmart-webhook] SWITCH_PLAN aplicado:', correo, planNuevo, JSON.stringify(resultado));
    return res.status(200).json({ received: true, action: 'switch_plan_aplicado', plan_nuevo: planNuevo, ...resultado });
  }

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
  const anual      = esAnual(data);
  const vencimiento = new Date(ahora);
  vencimiento.setMonth(vencimiento.getMonth() + (anual ? 12 : 1));

  // Importe real cobrado — se calcula aquí (y no dentro del bloque de billing)
  // porque la conversión hay que mandarla exista o no la fila en Supabase: lo
  // que Meta necesita saber es que hubo una compra, no cómo la registramos.
  const precioPagado = data?.purchase?.price?.value || 0;
  const monedaPagada = (data?.purchase?.price?.currency_value || '').toUpperCase();
  const importe = precioPagado > 0 ? precioPagado : (anual ? planAmount * 12 : planAmount);
  const moneda  = (precioPagado > 0 && monedaPagada) ? monedaPagada : 'USD';

  const capi = await enviarConversionMeta({ email, valor: importe, moneda, transactionId, plan });

  if (usuario) {
    // Resetear créditos mensuales de video al renovar
    await sb(
      `/users?id=eq.${encodeURIComponent(usuario.id)}`,
      'PATCH',
      { video_credits_used: 0, video_credits_reset_at: ahora.toISOString() },
      'return=minimal'
    );

    // Importe real cobrado, con su moneda (calculados arriba, junto a la
    // conversión de Meta, para que ambos usen exactamente el mismo número).

    // Upsert billing (histórico de facturación y sistema de referidos)
    await sb('/billing', 'POST', {
      user_id:                  usuario.id,
      plan,
      status:                   'active',
      amount:                   importe,
      currency:                 moneda,
      period_start:             ahora.toISOString(),
      period_end:               vencimiento.toISOString(),
      hotmart_transaction:      transactionId,
      hotmart_subscription_id:  subscriptionId,
      notes:                    `Activado via Hotmart - ${eventType} - ${anual ? 'anual' : 'mensual'}`,
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

  return res.status(200).json({ received: true, action: 'activated', plan, amount: planAmount, commission: planCommission, clerkUpdated: clerkOk, metaCapi: capi, email });
}
