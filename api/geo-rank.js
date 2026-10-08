// api/geo-rank.js
// GEO (Generative Engine Optimization): consulta a las principales IAs con las
// preguntas que haría un usuario real y detecta si la marca/dominio aparece en
// las respuestas, en qué posición y qué competidores se mencionan.
// Motores: Claude (ANTHROPIC_API_KEY — siempre activo), Gemini (GEMINI_API_KEY),
// ChatGPT (OPENAI_API_KEY) y Perplexity (PERPLEXITY_API_KEY) si sus keys existen.
// POST { queries: [...], domain, brand, competitors: [], country }

// La sesión se verifica con el módulo común, que lee las cabeceras de las
// dos formas: `Headers` en edge y objeto plano en Node.
import { verificarSesion, anotarSesion } from './_sesion.js';
import { costoDe } from './_uso-ia.js';
import { cuentaDe, estadoSeo, apuntarSeo } from './_cupo-seo.js';

const MAX_QUERIES = 10;

// A qué cuenta pertenece quien pregunta. Un miembro del equipo hereda el plan
// de su dueño: es la regla del producto y aquí se estaba ignorando.
async function duenoDe(userId) {
  if (!userId) return null;
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}` +
      `&status=eq.active&select=owner_user_id&limit=1`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    return r.ok ? ((await r.json())?.[0]?.owner_user_id || null) : null;
  } catch { return null; }
}

// ── Gate por plan (cada chequeo son llamadas reales a 4 IAs) ──
const PAID_PLANS = ['pro', 'agency', 'individual', 'agencia', 'trial'];
const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];

async function isPaidOrAdmin(req) {
  const sesion = await verificarSesion(req);
  // Cae a 'free' en vez de responder, así que el motivo se anota aquí o se
  // pierde — y «sin plan» y «token vencido» se ven igual desde fuera.
  if (!sesion.id) { await anotarSesion(sesion, 'geo-rank'); return { ok: false, plan: 'free' }; }
  const payload = sesion.datos;
  const plan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
  const userId = sesion.id;
  if (PAID_PLANS.includes(plan)) return { ok: true, plan, userId };
  // Bypass admin: verificar email real via Clerk (el JWT no siempre lo trae)
  if (payload.sub && process.env.CLERK_SECRET_KEY) {
    try {
      const r = await fetch('https://api.clerk.com/v1/users/' + payload.sub, {
        headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
      });
      const u = await r.json();
      // Clerk dejó de mandar public_metadata en el token de sesión (v2): el plan
      // real se lee aquí, si no todo usuario de pago quedaba como "free".
      const realPlan = u.public_metadata?.plan;
      if (PAID_PLANS.includes(realPlan)) return { ok: true, plan: realPlan, userId };

      // Y si no es de pago, puede ser MIEMBRO de una cuenta que sí lo es: el
      // plan es del DUEÑO, no de quien abre la pantalla. Sin esto, los siete
      // asesores de una inmobiliaria con plan Agency se quedaban sin SEO en
      // cuanto les caducaba su propia prueba — cada uno se registró por su
      // cuenta al aceptar la invitación y arrancó su prueba de 14 días.
      const duenoId = await duenoDe(payload.sub);
      if (duenoId && duenoId !== payload.sub) {
        const rd = await fetch('https://api.clerk.com/v1/users/' + duenoId, {
          headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
        });
        const dueno = await rd.json();
        const planDueno = dueno?.public_metadata?.plan;
        if (PAID_PLANS.includes(planDueno)) return { ok: true, plan: planDueno, userId };
      }
      const email = (u.email_addresses?.[0]?.email_address || '').toLowerCase();
      if (ADMIN_EMAILS.includes(email)) return { ok: true, plan: 'admin', userId };
    } catch {}
  }
  return { ok: false, plan };
}

const ENGINES = {
  claude:     { label: 'Claude',     env: 'ANTHROPIC_API_KEY' },
  gemini:     { label: 'Gemini',     env: 'GEMINI_API_KEY' },
  chatgpt:    { label: 'ChatGPT',    env: 'OPENAI_API_KEY' },
  perplexity: { label: 'Perplexity', env: 'PERPLEXITY_API_KEY' },
};

// USD por millón de tokens, precios de lista. Claude usa la tabla de _uso-ia.
// Perplexity cobra además una tarifa fija por petición (contexto de búsqueda bajo).
// No es para facturar: es para que «cuánto cuesta esta cuenta» incluya el GEO.
const TARIFAS = {
  gemini:     { in: 0.30, out: 2.50, fija: 0 },
  chatgpt:    { in: 0.15, out: 0.60, fija: 0 },
  perplexity: { in: 1,    out: 1,    fija: 0.005 },
};
function tarifa(motor, tin, tout) {
  const t = TARIFAS[motor];
  return ((tin || 0) * t.in + (tout || 0) * t.out) / 1e6 + t.fija;
}

const SYSTEM_PROMPT = (country) =>
  'Eres un asistente útil. Responde en español para un usuario de ' + (country || 'Latinoamérica') +
  '. Cuando la pregunta sea sobre productos, servicios, herramientas, plataformas o proveedores, ' +
  'recomienda opciones concretas con sus nombres reales, como lo harías normalmente.';

async function askClaude(query, country) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 700,
      system: SYSTEM_PROMPT(country),
      messages: [{ role: 'user', content: query }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Claude error');
  return {
    text: (d.content || []).map(c => c.text || '').join(' '),
    costo: costoDe('claude-sonnet-5', d.usage || {}),
    tokensIn: d.usage?.input_tokens, tokensOut: d.usage?.output_tokens,
  };
}

async function askGemini(query, country) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT(country) }] },
      contents: [{ parts: [{ text: query }] }],
      generationConfig: { maxOutputTokens: 700 },
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Gemini error');
  // El razonamiento de 2.5 Flash se cobra como salida.
  const u = d.usageMetadata || {};
  const salida = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  return {
    text: (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(' '),
    costo: tarifa('gemini', u.promptTokenCount, salida),
    tokensIn: u.promptTokenCount, tokensOut: salida,
  };
}

async function askOpenAI(query, country) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      messages: [{ role: 'system', content: SYSTEM_PROMPT(country) }, { role: 'user', content: query }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'OpenAI error');
  return {
    text: d.choices?.[0]?.message?.content || '',
    costo: tarifa('chatgpt', d.usage?.prompt_tokens, d.usage?.completion_tokens),
    tokensIn: d.usage?.prompt_tokens, tokensOut: d.usage?.completion_tokens,
  };
}

async function askPerplexity(query, country) {
  const r = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.PERPLEXITY_API_KEY },
    body: JSON.stringify({
      model: 'sonar',
      max_tokens: 700,
      messages: [{ role: 'system', content: SYSTEM_PROMPT(country) }, { role: 'user', content: query }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Perplexity error');
  return {
    text: d.choices?.[0]?.message?.content || '',
    costo: tarifa('perplexity', d.usage?.prompt_tokens, d.usage?.completion_tokens),
    tokensIn: d.usage?.prompt_tokens, tokensOut: d.usage?.completion_tokens,
  };
}

const ASK = { claude: askClaude, gemini: askGemini, chatgpt: askOpenAI, perplexity: askPerplexity };

function baseName(domainOrBrand) {
  return String(domainOrBrand || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('.')[0];
}

// Detecta menciones de la marca y competidores en la respuesta de la IA
function analyzeMention(text, domain, brand, competitors) {
  const t = (text || '').toLowerCase();
  const brandTerms = [...new Set([baseName(domain), (brand || '').toLowerCase().trim()].filter(s => s && s.length > 2))];
  const findFirst = (terms) => {
    let idx = -1;
    terms.forEach(term => {
      const i = t.indexOf(term);
      if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    });
    return idx;
  };
  const brandIdx = findFirst(brandTerms);
  const entities = [];
  if (brandIdx >= 0) entities.push({ who: 'brand', idx: brandIdx });
  const competitorsFound = [];
  (competitors || []).forEach(c => {
    const term = baseName(c);
    if (term.length > 2) {
      const i = t.indexOf(term);
      if (i >= 0) { entities.push({ who: c, idx: i }); competitorsFound.push(c); }
    }
  });
  entities.sort((a, b) => a.idx - b.idx);
  const rank = brandIdx >= 0 ? entities.findIndex(e => e.who === 'brand') + 1 : null;
  // Fragmento donde aparece la marca (contexto de la mención)
  let snippet = '';
  if (brandIdx >= 0) {
    const start = Math.max(0, brandIdx - 90);
    snippet = (start > 0 ? '…' : '') + (text || '').slice(start, brandIdx + 130).replace(/\n+/g, ' ').trim() + '…';
  }
  return { mentioned: brandIdx >= 0, rank, competitorsFound, snippet };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const gate = await isPaidOrAdmin(req);
  if (!gate.ok) {
    return res.status(403).json({
      error: 'El reporte GEO es parte del plan Pro.',
      upgrade: true,
    });
  }
  const cuenta = await cuentaDe(gate.userId);

  const { queries, domain, brand, competitors, country } = req.body || {};
  if (!Array.isArray(queries) || !queries.length) return res.status(400).json({ error: 'queries requeridas' });
  if (!domain) return res.status(400).json({ error: 'domain requerido' });

  const active = Object.keys(ENGINES).filter(k => !!process.env[ENGINES[k].env]);
  const enginesStatus = {};
  Object.keys(ENGINES).forEach(k => { enginesStatus[k] = { label: ENGINES[k].label, active: active.includes(k) }; });
  if (!active.length) return res.status(500).json({ error: 'Ningún motor de IA configurado', engines: enginesStatus });

  const batch = queries.slice(0, MAX_QUERIES).map(q => String(q).trim()).filter(Boolean);

  // ── Cupo del mes ──
  // Un reporte a medias no se hace: la visibilidad por motor saldría calculada
  // sobre la mitad de las preguntas y parecería un dato completo. O cabe
  // entero o se explica cuánto falta.
  const necesarias = batch.length * active.length;
  const cupo = await estadoSeo(cuenta, 'geo', gate.plan);
  if (cupo.error) {
    // No se pudo contar: se deja pasar (frenar a un cliente por un mal minuto
    // de Supabase es peor) pero queda en el log.
    console.error('[geo-rank] no se pudo leer el cupo de', cuenta, '— se deja pasar');
  } else if (necesarias > cupo.restante) {
    return res.status(429).json({
      error: cupo.restante === 0
        ? `Usaste las ${cupo.cupo} consultas a IAs de este mes. El contador se reinicia el día 1.`
        : `Este reporte necesita ${necesarias} consultas a IAs (${batch.length} ${batch.length === 1 ? 'pregunta' : 'preguntas'} × ${active.length} IAs) y te quedan ${cupo.restante} este mes. Quita preguntas o espera al día 1.`,
      sinCupo: true,
      cupo,
    });
  }

  try {
    const tasks = [];
    batch.forEach(q => active.forEach(engine => {
      tasks.push(
        ASK[engine](q, country)
          .then(r => ({ query: q, engine, _gasto: r, ...analyzeMention(r.text, domain, brand, competitors) }))
          .catch(e => ({ query: q, engine, error: String(e.message || e).slice(0, 200) }))
      );
    }));
    const crudos = await Promise.all(tasks);

    // Se apunta ANTES de responder: si el registro fuera después, un segundo
    // clic rápido vería el contador viejo.
    const registradas = crudos.filter(r => !r.error).length;
    await apuntarSeo({
      cuenta, actorId: gate.userId, tipo: 'geo',
      filas: crudos.map(r => ({
        ok: !r.error,
        detalle: 'geo:' + r.engine,
        costo: r._gasto?.costo,
        tokensIn: r._gasto?.tokensIn,
        tokensOut: r._gasto?.tokensOut,
      })),
    });
    const results = crudos.map(({ _gasto, ...r }) => r);
    return res.json({
      results,
      engines: enginesStatus,
      truncated: queries.length > MAX_QUERIES ? queries.length - MAX_QUERIES : 0,
      cupo: cupo.error ? { error: true, cupo: cupo.cupo }
        : { cupo: cupo.cupo, usados: cupo.usados + registradas, restante: Math.max(0, cupo.restante - registradas) },
    });
  } catch (err) {
    console.error('geo-rank error:', err);
    return res.status(500).json({ error: 'Error consultando las IAs' });
  }
}
