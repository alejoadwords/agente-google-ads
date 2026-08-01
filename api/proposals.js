// api/proposals.js
// Propuestas comerciales del CRM: generación con IA (Sonnet 5 usando el lead +
// contexto del negocio), página pública trackeada (/p/{token} → proposal.html)
// y cierre: aceptar (notifica al dueño) y marcar pagada (lead → ganado).
// El link de pago es del usuario (su Wompi/MercadoPago/Stripe) — BYO, sin
// tocar dinero. Crear/editar es feature de plan pago (mismo gate que
// automatizaciones); las rutas públicas van por public_token, sin sesión.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

let _lastPlan = 'free';
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    _lastPlan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
    return payload.sub || null;
  } catch { return null; }
}


// ── Plan del usuario ──────────────────────────────────────────────────────────
// Clerk dejó de incluir public_metadata en el token de sesión (formato v2), así
// que el plan ya no viaja en el JWT y todo usuario de pago se leía como "free".
// Cuando el token no lo trae, se consulta a Clerk y se cachea un minuto.
const _planCache = new Map();
async function clerkMeta(userId) {
  if (!userId || !process.env.CLERK_SECRET_KEY) return {};
  const hit = _planCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.meta;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const u = await r.json();
    const meta = Object.assign({}, u.public_metadata || {});
    meta._email = (u.email_addresses?.[0]?.email_address || '').toLowerCase();
    _planCache.set(userId, { meta, exp: Date.now() + 60000 });
    return meta;
  } catch { return {}; }
}

const PAID_PLANS = ['pro', 'agency', 'individual', 'agencia', 'trial'];
const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];
async function isPaidOrAdmin(userId) {
  if (PAID_PLANS.includes(_lastPlan)) return true;
  const meta = await clerkMeta(userId);
  if (PAID_PLANS.includes(meta.plan)) { _lastPlan = meta.plan; return true; }
  if (ADMIN_EMAILS.includes(meta._email)) return true;
  return false;
}

async function ownerEmail(userId) {
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    return (await r.json()).email_addresses?.[0]?.email_address || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Reglas compartidas por todas las plantillas
const PROPOSAL_BASE_RULES = `Reglas: español, tono profesional-cercano (LatAm), SIN emojis, específico al prospecto en cada sección (nombre, empresa, industria, notas). PROHIBIDO usar backticks y prohibido inventar datos del negocio que no estén en el contexto (nunca inventes premios, clientes ni cifras propias). Si hay monto, preséntalo con claridad; si no, deja el marcador [DEFINIR INVERSIÓN]. Responde SOLO con el markdown de la propuesta, empezando con un título nivel #.`;

const PROPOSAL_TEMPLATES = {

  consultiva: `Eres el consultor comercial senior de una empresa. Redactas propuestas de nivel agencia premium: consultivas, que demuestran expertise y cierran ventas. Estructura EXACTA en markdown:

# [Título — el resultado que obtiene el prospecto, no el servicio]
Párrafo de apertura personalizado: su situación, lo que está en juego, por qué ahora.
## Tu situación hoy
Diagnóstico concreto con sus datos. Si los benchmarks aplican a su industria/país, cita 1-2 cifras como rangos de referencia, con naturalidad.
## Qué vamos a lograr
3-4 objetivos MEDIBLES en viñetas (negrita al inicio), con horizonte de tiempo.
## Nuestra solución
### [Frente 1] con 2-4 entregables en viñetas. ### [Frente 2] igual (2-3 frentes, solo servicios que el negocio ofrece).
## Plan de trabajo
Tabla | Fase | Semanas | Qué hacemos | con 4-5 filas.
## Inversión
El monto en una frase, luego tabla | Incluye | Detalle | (3-5 filas) y condiciones simples.
## Por qué nosotros
3 diferenciales creíbles en viñetas.
## Siguiente paso
Cierre directo: aceptar con el botón, qué pasa después. Vigencia: 15 días.
Extensión: 600-850 palabras.`,

  ejecutiva: `Eres un consultor comercial que redacta propuestas EJECUTIVAS: una página, cero relleno, para prospectos calientes que ya conocen el servicio y solo necesitan concretar. Estructura EXACTA en markdown:

# [Título directo — servicio + resultado]
2-3 líneas de apertura: qué le vas a resolver y por qué contigo.
## Qué incluye
5-7 entregables concretos en viñetas (negrita al inicio de cada una).
## Inversión
El monto en una frase clara + qué cubre + forma de pago en la misma sección (sin tabla).
## Arrancamos así
3 pasos numerados: aceptar → kickoff → primer resultado, con tiempos concretos.
Cierra con la vigencia de 15 días en una línea.
Extensión: 200-350 palabras. Cada frase debe ganarse su lugar.`,

  comercial: `Eres un closer comercial que redacta propuestas PERSUASIVAS orientadas a la decisión: beneficio claro, urgencia legítima y oferta irresistible — sin humo ni presión artificial. Estructura EXACTA en markdown:

# [Título con el beneficio principal cuantificado si es posible]
Apertura que pinta el contraste: dónde está hoy el prospecto vs dónde puede estar en 90 días.
## Lo que te está costando no actuar
2-3 viñetas del costo de oportunidad (usa benchmarks de su industria/país si aplican, como rangos).
## La oferta
Qué recibe, en viñetas con negrita. Presenta el paquete como algo diseñado específicamente para su caso.
## Inversión y condiciones
El monto con anclaje de valor (qué costaría hacerlo mal o no hacerlo). Un incentivo de decisión legítimo (ej: cupo de inicio este mes, bonus de auditoría inicial) — solo si el contexto del negocio lo permite, nunca inventes descuentos.
## Garantía de proceso
Qué puede esperar mes a mes y cómo se mide (transparencia como cierre de objeciones).
## Decide hoy
Cierre directo con el botón de aceptar. Vigencia: 7 días.
Extensión: 400-600 palabras.`,

  paquetes: `Eres un consultor comercial que redacta propuestas con TRES OPCIONES de inversión (pricing con anclaje: básico, recomendado, premium). Estructura EXACTA en markdown:

# [Título — el resultado que obtiene el prospecto]
Apertura personalizada breve: su situación y por qué estas opciones.
## Qué vamos a lograr
3 objetivos medibles en viñetas.
## Elige tu plan
Tabla markdown | | Esencial | Recomendado | Premium | donde la primera columna son los componentes del servicio (5-7 filas) y las celdas marcan qué incluye cada plan (usa "Sí", "—", o el detalle corto). Fila final: | **Inversión mensual** | $X | $Y | $Z |. El monto proporcionado es el plan RECOMENDADO; calcula Esencial ~40% menos y Premium ~60% más, redondeados.
## Nuestra recomendación
Párrafo corto: por qué el plan Recomendado es el indicado para SU caso específico.
## Siguiente paso
Aceptar con el botón (el plan elegido se confirma en el kickoff). Vigencia: 15 días.
Extensión: 400-600 palabras.`,
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);

  // ── Rutas públicas (por token, sin sesión) ─────────────────────────────────
  const publicToken = url.searchParams.get('public_token');
  if (publicToken && /^[a-f0-9]{32}$/.test(publicToken)) {
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/proposals?public_token=eq.${publicToken}&select=*`, { headers: sbHeaders() }).then(r => r.json());
    const p = rows?.[0];
    if (!p) return jsonResp({ error: 'Propuesta no encontrada' }, 404);

    if (req.method === 'GET') {
      // Primera vista: marcar y subir de estado (enviada → vista)
      if (!p.viewed_at) {
        const patch = { viewed_at: new Date().toISOString() };
        if (p.status === 'sent' || p.status === 'draft') patch.status = 'viewed';
        await fetch(`${SUPABASE_URL}/rest/v1/proposals?id=eq.${p.id}`, { method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' }, body: JSON.stringify(patch) });
      }
      // ¿El dueño tiene MercadoPago conectado? (habilita el botón de pago automático)
      let mpAvailable = false;
      if (p.amount > 0) {
        try {
          const c = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(p.user_id)}&platform=eq.mercadopago&select=id&limit=1`, { headers: sbHeaders() }).then(r => r.json());
          mpAvailable = !!c?.length;
        } catch {}
      }
      // Solo lo que la página pública necesita
      return jsonResp({ proposal: { title: p.title, content: p.content, amount: p.amount, currency: p.currency, payment_link: p.payment_link, status: p.status, business_name: p.business_name, mp_available: mpAvailable } });
    }

    // POST ?action=mp_checkout — preferencia de Checkout Pro creada al vuelo con
    // el token del DUEÑO de la propuesta (el dinero va directo a su cuenta MP).
    if (req.method === 'POST' && url.searchParams.get('action') === 'mp_checkout') {
      if (!(p.amount > 0)) return jsonResp({ error: 'La propuesta no tiene monto definido' }, 400);
      const conns = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(p.user_id)}&platform=eq.mercadopago&select=*&limit=1`, { headers: sbHeaders() }).then(r => r.json());
      const conn = conns?.[0];
      if (!conn) return jsonResp({ error: 'El emisor no tiene MercadoPago conectado' }, 400);

      const preference = {
        items: [{
          title: (p.title || 'Propuesta') + (p.business_name ? ' — ' + p.business_name : ''),
          quantity: 1,
          unit_price: Number(p.amount),
          currency_id: p.currency || 'USD',
        }],
        external_reference: String(p.id),
        notification_url: 'https://app.acuarius.app/api/mp-webhook',
        back_urls: {
          success: 'https://app.acuarius.app/p/' + publicToken + '?paid=1',
          pending: 'https://app.acuarius.app/p/' + publicToken + '?paid=pending',
          failure: 'https://app.acuarius.app/p/' + publicToken,
        },
        auto_return: 'approved',
        statement_descriptor: (p.business_name || 'Acuarius').slice(0, 22),
      };
      const createPref = (tok) => fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(preference),
      });
      let r = await createPref(conn.access_token);
      // Token vencido → refresh y reintento único
      if (r.status === 401 && conn.refresh_token) {
        try {
          const tr = await fetch('https://api.mercadopago.com/oauth/token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
          });
          const t = await tr.json();
          if (t.access_token) {
            await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(p.user_id)}&platform=eq.mercadopago`, {
              method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
              body: JSON.stringify({ access_token: t.access_token, ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}), updated_at: new Date().toISOString() }),
            });
            r = await createPref(t.access_token);
          }
        } catch {}
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.init_point) {
        const msg = JSON.stringify(d.message || d.error || d).toLowerCase();
        if (msg.includes('currency')) return jsonResp({ error: 'MercadoPago solo acepta la moneda local de la cuenta del emisor (ej: COP para Colombia). Pídele al emisor ajustar la moneda de la propuesta.' }, 400);
        console.error('[mp_checkout] error:', JSON.stringify(d).slice(0, 300));
        return jsonResp({ error: 'No se pudo generar el pago — intenta de nuevo' }, 502);
      }
      return jsonResp({ init_point: d.init_point });
    }

    if (req.method === 'POST' && url.searchParams.get('action') === 'accept') {
      if (p.status === 'paid' || p.status === 'accepted') return jsonResp({ ok: true, already: true });
      await fetch(`${SUPABASE_URL}/rest/v1/proposals?id=eq.${p.id}`, {
        method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'accepted', accepted_at: new Date().toISOString() }),
      });
      // Notificar al dueño
      const email = await ownerEmail(p.user_id);
      if (email && RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Acuarius <notificaciones@app.acuarius.app>', to: [email],
            subject: '🎉 Propuesta aceptada: ' + (p.title || 'Sin título'),
            html: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' +
              '<p><b>' + (p.lead_name || 'Tu prospecto') + '</b> aceptó la propuesta "' + (p.title || '') + '"' +
              (p.amount ? ' por <b>$' + Number(p.amount).toLocaleString('es-CO') + ' ' + (p.currency || '') + '</b>' : '') + '.</p>' +
              (p.payment_link ? '<p>El botón de pago quedó a su disposición en la propuesta.</p>' : '<p>Contáctalo para coordinar el pago y el arranque.</p>') +
              '<p style="font-size:13px;color:#888">Cuando recibas el pago, márcala como pagada en Acuarius y el lead pasará a Ganado automáticamente.</p></div>',
          }),
        }).catch(() => {});
      }
      return jsonResp({ ok: true });
    }
    return jsonResp({ error: 'Método no permitido' }, 405);
  }

  // ── Rutas autenticadas ─────────────────────────────────────────────────────
  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  const clientId = url.searchParams.get('client_id') || null;

  // GET ?mp_status=1 — ¿tengo MercadoPago conectado? (para la UI de Propuestas)
  if (req.method === 'GET' && url.searchParams.get('mp_status')) {
    const c = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.mercadopago&select=account_name,updated_at&limit=1`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
    return jsonResp({ connected: !!c?.length, account: c?.[0]?.account_name || null });
  }

  // GET — propuestas de un lead (o todas)
  if (req.method === 'GET') {
    const leadId = url.searchParams.get('lead_id');
    let q = `${SUPABASE_URL}/rest/v1/proposals?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc&limit=100`;
    if (leadId) q += `&lead_id=eq.${encodeURIComponent(leadId)}`;
    const rows = await fetch(q, { headers: sbHeaders() }).then(r => r.json());
    return jsonResp({ proposals: rows || [] });
  }

  // POST ?action=generate — redactar la propuesta con IA (no persiste)
  if (req.method === 'POST' && url.searchParams.get('action') === 'generate') {
    if (!(await isPaidOrAdmin(userId))) return jsonResp({ error: 'Las propuestas son parte del plan Pro.', upgrade: true }, 403);
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    // Benchmarks LatAm publicados — dan respaldo de mercado al diagnóstico
    let benchmarks = '';
    try {
      const bRows = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_packs?agent=eq.benchmarks&status=eq.published&select=content&order=published_at.desc&limit=1`, { headers: sbHeaders() }).then(r => r.json());
      benchmarks = bRows?.[0]?.content || '';
    } catch {}
    const template = PROPOSAL_TEMPLATES[body.template] ? body.template : 'consultiva';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5', max_tokens: 2500,
        system: PROPOSAL_TEMPLATES[template] + '\n\n' + PROPOSAL_BASE_RULES,
        messages: [{ role: 'user', content:
          'PROSPECTO:\n' + JSON.stringify(body.lead || {}).slice(0, 1500) +
          '\n\nNEGOCIO QUE ENVÍA LA PROPUESTA:\n' + String(body.business_context || 'No especificado').slice(0, 2500) +
          (benchmarks ? '\n\nBENCHMARKS DE MERCADO (usa solo lo relevante a la industria/país del prospecto):\n' + benchmarks.slice(0, 2000) : '') +
          '\n\nMONTO: ' + (body.amount ? '$' + body.amount + ' ' + (body.currency || 'USD') : 'no definido') +
          (body.instructions ? '\n\nINSTRUCCIONES ADICIONALES DEL USUARIO:\n' + String(body.instructions).slice(0, 500) : '') }],
      }),
    });
    const d = await r.json();
    if (!r.ok) return jsonResp({ error: 'Error generando: ' + (d.error?.message || r.status) }, 502);
    const content = d.content?.find(b => b.type === 'text')?.text || '';
    return jsonResp({ content: content.replace(/`/g, "'") });
  }

  // POST — crear propuesta
  if (req.method === 'POST') {
    if (!(await isPaidOrAdmin(userId))) return jsonResp({ error: 'Las propuestas son parte del plan Pro.', upgrade: true }, 403);
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.title || !body.content) return jsonResp({ error: 'La propuesta requiere título y contenido' }, 400);
    const token = crypto.randomUUID().replace(/-/g, '');
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/proposals`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({
        user_id: userId, client_id: clientId,
        lead_id: body.lead_id || null, lead_name: String(body.lead_name || '').slice(0, 120),
        business_name: String(body.business_name || '').slice(0, 120),
        title: String(body.title).slice(0, 160), content: String(body.content).slice(0, 20000),
        amount: body.amount ? parseFloat(body.amount) || null : null,
        currency: String(body.currency || 'USD').slice(0, 6),
        payment_link: body.payment_link ? String(body.payment_link).slice(0, 500) : null,
        status: 'sent', public_token: token,
      }),
    }).then(r => r.ok ? r.json() : null);
    if (!rows) return jsonResp({ error: 'No se pudo crear' }, 500);
    return jsonResp({ proposal: rows[0] }, 201);
  }

  // PUT — actualizar (contenido, link de pago, o marcar pagada)
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.id) return jsonResp({ error: 'Falta id' }, 400);
    const update = { updated_at: new Date().toISOString() };
    for (const k of ['title', 'content', 'amount', 'currency', 'payment_link']) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    if (body.mark_paid) { update.status = 'paid'; update.paid_at = new Date().toISOString(); }
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/proposals?id=eq.${body.id}&user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update),
    }).then(r => r.ok ? r.json() : null);
    if (!rows) return jsonResp({ error: 'No se pudo actualizar' }, 500);
    const p = rows[0];
    // Pagada → el lead pasa a Ganado (con el valor de la propuesta si el lead no tenía)
    if (body.mark_paid && p?.lead_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${p.lead_id}&user_id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ stage: 'ganado', ...(p.amount ? { value: p.amount } : {}), updated_at: new Date().toISOString() }),
      }).catch(() => {});
    }
    return jsonResp({ proposal: p });
  }

  // DELETE
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/proposals?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: sbHeaders() });
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
