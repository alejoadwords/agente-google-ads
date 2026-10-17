// api/_seo-medir.js — medir posiciones (Serper) y presencia en IAs (GEO).
//
// Lo usan el cron (cron-seo: posiciones cada semana, GEO cada mes) y el botón
// «Medir ahora» (api/seo-proyectos.js). Las dos mediciones trabajan como una
// cola: calculan lo que falta del periodo y hacen hasta donde alcancen el
// tiempo y el cupo del plan (_cupo-seo.js, que cuenta en ai_usage). Lo que no
// alcanzó se hace en la siguiente vuelta. Solo se importa desde edge.

import { costoDe } from './_uso-ia.js';
import { estadoSeo, apuntarSeo } from './_cupo-seo.js';
import { planDeCuenta } from './_cupo-agente.js';
import { dominio, leerRespuesta, hoyCO, periodoCO, MOTORES, CORRIDAS_GEO } from './_seo.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
async function sb(ruta, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { ...init, headers: sbH(init.prefer ? { Prefer: init.prefer } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}

const COSTO_KEYWORD = 0.002;   // Serper, num=100 = 2 créditos
const PAISES = { co: 'Colombia', mx: 'México', ar: 'Argentina', cl: 'Chile', pe: 'Perú', ec: 'Ecuador', es: 'España', us: 'Estados Unidos' };

export async function planDe(cuenta) {
  const r = await planDeCuenta(cuenta).catch(() => ({ ok: false }));
  return r.ok ? (r.plan || 'free') : null;   // null = no se pudo saber
}

// ── Posiciones ──────────────────────────────────────────────────────────────
async function serper(kw, gl, hl) {
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: kw, gl, hl, num: 100 }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d.organic)) throw new Error(d.message || d.error || 'Serper HTTP ' + r.status);
  return d.organic;
}

export function posicionEn(organic, dom) {
  const objetivo = dominio(dom);
  for (let i = 0; i < organic.length; i++) {
    const d = dominio(organic[i].link);
    if (d === objetivo || d.endsWith('.' + objetivo)) return { pos: organic[i].position || i + 1, url: organic[i].link };
  }
  return { pos: null, url: null };
}

/**
 * Mide las keywords que se le pasan (o todas las vivas del proyecto). Devuelve
 * { medidas, sinCupo, fallidas }. `cuenta` = dueño; `actorId` = quien pulsó.
 */
export async function medirPosiciones(proyecto, { keywords = null, actorId = null, presupuestoMs = 15000 } = {}) {
  if (!process.env.SERPER_API_KEY) throw new Error('Falta SERPER_API_KEY');
  const empezo = Date.now();
  const cuenta = proyecto.user_id;
  const plan = await planDe(cuenta);
  if (plan === null) return { medidas: 0, sinCupo: 0, fallidas: 0, error: 'No se pudo comprobar el plan' };
  const est = await estadoSeo(cuenta, 'posiciones', plan);
  if (est.error) return { medidas: 0, sinCupo: 0, fallidas: 0, error: 'No se pudo contar el cupo' };
  const lista = keywords || await sb(`/seo_keywords?proyecto_id=eq.${proyecto.id}&borrado_at=is.null&select=id,kw&order=creado_at.asc`) || [];
  const caben = Math.min(lista.length, est.restante);
  const fecha = hoyCO();
  let medidas = 0, fallidas = 0;
  const filasUso = [];
  for (let i = 0; i < caben; i += 5) {
    if (Date.now() - empezo > presupuestoMs) break;
    const tanda = lista.slice(i, Math.min(i + 5, caben));
    const res = await Promise.all(tanda.map(async (k) => {
      try {
        const org = await serper(k.kw, proyecto.pais || 'co', proyecto.idioma || 'es');
        const { pos, url } = posicionEn(org, proyecto.dominio);
        const top = org.slice(0, 5).map(o => ({ pos: o.position, titulo: o.title, url: o.link, dominio: dominio(o.link) }));
        return { ok: true, fila: { proyecto_id: proyecto.id, keyword_id: k.id, fecha, pos, url, top } };
      } catch (e) { return { ok: false, error: e.message }; }
    }));
    const filas = res.filter(r => r.ok).map(r => r.fila);
    if (filas.length) {
      await sb('/seo_posiciones?on_conflict=keyword_id,fecha', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: JSON.stringify(filas) });
    }
    medidas += filas.length; fallidas += res.length - filas.length;
    for (const r of res) filasUso.push({ ok: r.ok, detalle: 'serper', costo: COSTO_KEYWORD });
  }
  await apuntarSeo({ cuenta, actorId, tipo: 'posiciones', filas: filasUso });
  return { medidas, fallidas, sinCupo: Math.max(0, lista.length - caben), fecha };
}

// ── GEO ─────────────────────────────────────────────────────────────────────
const MOTOR = {
  claude: { etiqueta: 'Claude', env: 'ANTHROPIC_API_KEY' },
  gemini: { etiqueta: 'Gemini', env: 'GEMINI_API_KEY' },
  chatgpt: { etiqueta: 'ChatGPT', env: 'OPENAI_API_KEY' },
  perplexity: { etiqueta: 'Perplexity', env: 'PERPLEXITY_API_KEY' },
};
export const motoresActivos = () => MOTORES.filter(m => !!process.env[MOTOR[m].env]);

const TARIFAS = { gemini: { in: 0.30, out: 2.50, fija: 0 }, chatgpt: { in: 0.15, out: 0.60, fija: 0 }, perplexity: { in: 1, out: 1, fija: 0.005 } };
const tarifa = (m, tin, tout) => ((tin || 0) * TARIFAS[m].in + (tout || 0) * TARIFAS[m].out) / 1e6 + TARIFAS[m].fija;
const SISTEMA = (pais) => 'Eres un asistente útil. Responde en español para un usuario de ' + (PAISES[pais] || 'Latinoamérica') +
  '. Cuando la pregunta sea sobre productos, servicios, herramientas, plataformas o proveedores, recomienda opciones concretas con sus nombres reales, como lo harías normalmente.';

async function preguntarA(motor, pregunta, pais) {
  if (motor === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 700, system: SISTEMA(pais), messages: [{ role: 'user', content: pregunta }] }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Claude');
    return { texto: (d.content || []).map(c => c.text || '').join(' '), citas: [], costo: costoDe('claude-sonnet-5', d.usage || {}), tin: d.usage?.input_tokens, tout: d.usage?.output_tokens };
  }
  if (motor === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instruction: { parts: [{ text: SISTEMA(pais) }] }, contents: [{ parts: [{ text: pregunta }] }], generationConfig: { maxOutputTokens: 700 } }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Gemini');
    const u = d.usageMetadata || {};
    const salida = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    return { texto: (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(' '), citas: [], costo: tarifa('gemini', u.promptTokenCount, salida), tin: u.promptTokenCount, tout: salida };
  }
  if (motor === 'chatgpt') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 700, messages: [{ role: 'system', content: SISTEMA(pais) }, { role: 'user', content: pregunta }] }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'OpenAI');
    return { texto: d.choices?.[0]?.message?.content || '', citas: [], costo: tarifa('chatgpt', d.usage?.prompt_tokens, d.usage?.completion_tokens), tin: d.usage?.prompt_tokens, tout: d.usage?.completion_tokens };
  }
  // Perplexity busca en la web y devuelve sus fuentes: con ellas se sabe si
  // además de nombrar la marca CITÓ la web del cliente.
  const r = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.PERPLEXITY_API_KEY },
    body: JSON.stringify({ model: 'sonar', max_tokens: 700, messages: [{ role: 'system', content: SISTEMA(pais) }, { role: 'user', content: pregunta }] }) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Perplexity');
  const citas = (d.citations || (d.search_results || []).map(s => s.url) || []).filter(Boolean);
  return { texto: d.choices?.[0]?.message?.content || '', citas, costo: tarifa('perplexity', d.usage?.prompt_tokens, d.usage?.completion_tokens), tin: d.usage?.prompt_tokens, tout: d.usage?.completion_tokens };
}

// Lo que falta del periodo: cada (pregunta × motor × corrida) sin resultado,
// o con un error de hace más de 6 horas (se reintenta una vez pasado el bache).
export function pendientesGeo(preguntas, motores, existentes, ahora = Date.now()) {
  const hecho = new Set();
  for (const e of existentes) {
    if (!e.error || ahora - Date.parse(e.creado_at) < 6 * 3600 * 1000) hecho.add(e.pregunta_id + '|' + e.motor + '|' + e.corrida);
  }
  const out = [];
  for (let c = 1; c <= CORRIDAS_GEO; c++) {
    for (const p of preguntas) for (const m of motores) if (!hecho.has(p.id + '|' + m + '|' + c)) out.push({ pregunta: p, motor: m, corrida: c });
  }
  return out;   // primero la corrida 1 de todo: con poco cupo, al menos una vuelta completa
}

export async function medirGeo(proyecto, { actorId = null, presupuestoMs = 15000, periodo = periodoCO() } = {}) {
  const empezo = Date.now();
  const cuenta = proyecto.user_id;
  const motores = motoresActivos();
  if (!motores.length) return { hechas: 0, pendientes: 0, error: 'No hay IAs configuradas' };
  const plan = await planDe(cuenta);
  if (plan === null) return { hechas: 0, pendientes: 0, error: 'No se pudo comprobar el plan' };
  const est = await estadoSeo(cuenta, 'geo', plan);
  if (est.error) return { hechas: 0, pendientes: 0, error: 'No se pudo contar el cupo' };
  const preguntas = await sb(`/seo_geo_preguntas?proyecto_id=eq.${proyecto.id}&borrado_at=is.null&select=id,pregunta&order=creado_at.asc`) || [];
  const existentes = await sb(`/seo_geo_resultados?proyecto_id=eq.${proyecto.id}&periodo=eq.${periodo}&select=pregunta_id,motor,corrida,error,creado_at`) || [];
  const cola = pendientesGeo(preguntas, motores, existentes);
  const caben = Math.min(cola.length, est.restante);
  let hechas = 0;
  for (let i = 0; i < caben; i += 8) {
    if (Date.now() - empezo > presupuestoMs) break;
    const tanda = cola.slice(i, Math.min(i + 8, caben));
    const res = await Promise.all(tanda.map(async (t) => {
      try {
        const a = await preguntarA(t.motor, t.pregunta.pregunta, proyecto.pais);
        const l = leerRespuesta(a.texto, { dominio: proyecto.dominio, marca: proyecto.marca, competidores: proyecto.competidores || [] }, a.citas);
        return { ok: true, uso: { ok: true, detalle: t.motor, costo: a.costo, tokensIn: a.tin, tokensOut: a.tout },
          fila: { proyecto_id: proyecto.id, pregunta_id: t.pregunta.id, periodo, motor: t.motor, corrida: t.corrida,
            mencionada: l.mencionada, citada: l.citada, posicion: l.posicion, competidores: l.competidores, citas: l.citas, fragmento: l.fragmento, error: null, creado_at: new Date().toISOString() } };
      } catch (e) {
        return { ok: false, uso: { ok: false, detalle: t.motor, costo: 0 },
          fila: { proyecto_id: proyecto.id, pregunta_id: t.pregunta.id, periodo, motor: t.motor, corrida: t.corrida,
            mencionada: null, citada: null, posicion: null, competidores: [], citas: [], fragmento: null, error: String(e.message || e).slice(0, 300), creado_at: new Date().toISOString() } };
      }
    }));
    await sb('/seo_geo_resultados?on_conflict=pregunta_id,periodo,motor,corrida', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: JSON.stringify(res.map(r => r.fila)) });
    await apuntarSeo({ cuenta, actorId, tipo: 'geo', filas: res.map(r => r.uso) });
    hechas += res.filter(r => r.ok).length;
  }
  return { hechas, pendientes: Math.max(0, cola.length - hechas), sinCupo: Math.max(0, cola.length - caben), periodo };
}
