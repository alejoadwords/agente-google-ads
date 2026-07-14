// eval/agent-eval.mjs
// Suite de evaluación: agentes de Acuarius vs Claude sin contexto ("pelado").
// Para cada pregunta genera ambas respuestas y un juez ciego las califica
// contra una rúbrica de puntos clave (0-10). El sistema del agente se compone
// EXACTAMENTE como en la app: prompt del agente + packs publicados (API de
// producción) + benchmarks + reglas — así se evalúa lo que el usuario recibe.
//
// Uso:  ANTHROPIC_API_KEY=sk-... node eval/agent-eval.mjs
// Salida: eval/results-<fecha>.json + tabla en consola.
// Re-correr después de cada actualización de packs para vigilar regresiones.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dir, '..');
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Falta ANTHROPIC_API_KEY'); process.exit(1); }
const MODEL = 'claude-sonnet-5';

// ── Componer el system de cada agente como lo hace la app ────────────────────
function loadPromptVar(file, varName) {
  const src = fs.readFileSync(path.join(ROOT, 'public/prompts', file), 'utf8');
  const sandbox = {};
  new Function('sandbox', src + `\nsandbox.v = ${varName};`)(sandbox);
  return sandbox.v;
}

async function composeSystems() {
  const statics = {
    google: loadPromptVar('google-ads.js', 'SYSTEM'),
    meta: loadPromptVar('meta-ads.js', 'SYSTEM_META'),
    tiktok: loadPromptVar('tiktok-ads.js', 'SYSTEM_TIKTOK'),
    consultor: loadPromptVar('consultor.js', 'SYSTEM_CONSULTOR'),
  };
  const packsFile = fs.readFileSync(path.join(ROOT, 'public/prompts/actualizaciones-2026.js'), 'utf8');
  const sandbox = {};
  new Function('sandbox', packsFile + '\nsandbox.k = KNOWLEDGE_2026; sandbox.b = BENCHMARKS_LATAM; sandbox.w = WEB_SEARCH_RULES;')(sandbox);
  let packs = sandbox.k, bench = sandbox.b;

  // Packs publicados reales (los que sirven a los usuarios) — override como en la app
  try {
    const d = await fetch('https://app.acuarius.app/api/knowledge-packs').then(r => r.json());
    for (const p of (d.packs || [])) {
      if (p.agent === 'benchmarks') bench = p.content;
      else if (packs[p.agent] !== undefined) packs[p.agent] = p.content;
    }
    console.log('Packs publicados cargados:', (d.packs || []).map(p => p.agent).join(', '));
  } catch { console.log('⚠️ No se pudieron cargar packs publicados — usando estáticos'); }

  const compose = (agentKey) =>
    statics[agentKey].replace('{MEMORY}', '').replace('{STAGE}', '').replace('{AGENT}', 'Google Ads') +
    '\n\n' + packs[agentKey] + '\n\n' + bench;
  return { google: compose('google'), meta: compose('meta'), tiktok: compose('tiktok'), consultor: compose('consultor') };
}

// ── Batería de preguntas con rúbrica ─────────────────────────────────────────
const QUESTIONS = [
  { agent: 'google', q: 'Manejo las campañas de búsqueda de mi empresa con keywords de toda la vida. Escuché algo de AI Max, ¿qué es y debería pasarme?', rubric: 'AI Max = campañas de search SIN keywords (usa landing y presupuesto con objetivo ROAS/CPA), ya disponible para todas las cuentas en 2026; recomendarlo como COMPLEMENTO de search con keywords maduras, no reemplazo; mencionar exclusiones de marca para no canibalizar.' },
  { agent: 'google', q: 'Tengo varias campañas con tCPA que están limitadas por presupuesto. ¿Hay algo este año que deba tener en el radar?', rubric: 'Cambio de backend de Google el 17 de agosto de 2026 para campañas limitadas por presupuesto con estrategias por objetivo (tCPA/tROAS): optimizarán más consistentemente hacia el target; revisar targets agresivos ANTES de esa fecha porque el volumen puede caer.' },
  { agent: 'google', q: '¿Cómo preparo mis campañas de Google para el Buen Fin y Black Friday de este año?', rubric: 'Promotion Mode (beta 2026): impulso de temporada auto-limitado para Search y PMax, ventana definida de 3-14 días, ajusta tolerancia ROAS y presupuesto extra, y REVIERTE SOLO; preferirlo sobre cambiar targets a mano.' },
  { agent: 'google', q: 'Performance Max me parece una caja negra, no sé dónde aparecen mis anuncios. ¿Sigue siendo así?', rubric: 'Ya NO: en 2026 PMax tiene reportes COMPLETOS de ubicaciones y exclusiones de términos a nivel de CUENTA; dato de contexto: PMax genera ~62% de los clics de Google Ads; recomendar revisar esos reportes antes de decidir migrar.' },
  { agent: 'meta', q: 'Mis CPMs en Meta suben hace semanas. Mi agencia dice que afinemos los intereses y recortemos lookalikes. ¿Tiene sentido?', rubric: 'NO como palanca principal: con Andromeda el creativo es la segmentación; desde API v25 el targeting detallado es SUGERENCIA no restricción; diagnóstico correcto = fatiga/similitud creativa (Creative Fatigue y Creative Similarity — la baja diversidad se castiga con CPM alto); revisar 15-20 creativos diversos y señal (EMQ).' },
  { agent: 'meta', q: '¿Cuántos anuncios activos debería tener en mi campaña de Meta y cómo deben ser?', rubric: '15-20 anuncios activos con hooks, formatos y mensajes GENUINAMENTE distintos (conceptos diferentes, no 20 variaciones del mismo anuncio); la diversidad creativa real es la palanca #1 con Andromeda.' },
  { agent: 'meta', q: 'Me hablaron del Event Match Quality en Meta. ¿Qué es y qué número debería tener?', rubric: 'EMQ mide la calidad de la señal de conversión; objetivo: mayor a 7; requiere Pixel + CAPI corriendo SIMULTÁNEOS; señal limpia es una de las 3 palancas clave con Andromeda.' },
  { agent: 'meta', q: 'Tengo una clínica dental en México y quiero captar pacientes con Meta Ads. ¿Qué costo por lead es razonable esperar?', rubric: 'Usa benchmarks LatAm 2026: salud en México ~18-25 USD por lead (rango de referencia, no promesa); mencionar que depende de campaña/creativo y validar con datos propios; idealmente contrasta con CPM MX ~3.9 USD.' },
  { agent: 'tiktok', q: 'Me da miedo que Smart+ de TikTok me quite el control de mis campañas. ¿Cómo funciona ahora?', rubric: 'Smart+ ahora es MODULAR: automatización activable POR MÓDULO (targeting, presupuesto, ubicaciones) con etiqueta visible — puedes automatizar unas partes y mantener otras manuales; también en campañas de Tráfico; global desde Q2 2026; mencionar Symphony (creativos con IA integrados) suma.' },
  { agent: 'tiktok', q: '¿Qué cambió en el algoritmo de TikTok que afecte a mis anuncios este año?', rubric: 'Pivote a intent-driven discovery: el FYP prioriza conectar usuarios con productos que probablemente compren; creativos con señal de intención clara (demo de producto, oferta, CTA) ganan distribución; bonus: venta a Oracle/reentrenamiento del algoritmo y reglas de etiquetado de contenido IA si lo menciona.' },
  { agent: 'consultor', q: 'Voy a lanzar el plan de marketing digital de mi e-commerce en Colombia. ¿Cómo debería repartir el presupuesto?', rubric: 'Recomendar reservar 15-25% del presupuesto TOTAL a producción/renovación de creativos (en 2026 pesa más que la optimización manual); usar benchmarks CO (CPM Meta ~2 USD); mix por objetivo con lógica clara; mencionar las palancas 2026 (creativo como targeting).' },
  { agent: 'consultor', q: '¿Qué CPM debería esperar en Meta si pauto en Colombia? ¿Y en México? ¿Cómo se compara con Estados Unidos?', rubric: 'Colombia ~2.0 USD, México ~3.9 USD (CPM Meta 2026); LatAm es 4-8x más barato por impresión que USA; presentarlos como rangos de referencia y sugerir validar con datos propios.' },
];

// ── Llamadas ─────────────────────────────────────────────────────────────────
async function claude(system, user, maxTokens = 900) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content: user }] }),
    });
    const d = await r.json();
    if (r.ok) return d.content?.find(b => b.type === 'text')?.text || '';
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 8000 * (intento + 1))); continue; }
    throw new Error('Anthropic ' + r.status + ': ' + JSON.stringify(d).slice(0, 150));
  }
  throw new Error('Anthropic: reintentos agotados');
}

const JUDGE_SYSTEM = `Eres un evaluador experto en marketing digital y plataformas de pauta (nivel consultor senior, conocimiento actualizado a 2026). Calificarás dos respuestas a la misma pregunta de un cliente, contra una rúbrica de puntos clave.

Criterios (0-10):
- Cobertura de los puntos clave de la rúbrica (peso principal)
- Precisión: penaliza FUERTE la información obsoleta (consejos de 2024 que ya no aplican) o inventada
- Accionabilidad: pasos concretos que el cliente puede ejecutar
- Honestidad: reconocer límites vale más que inventar

Responde SOLO con JSON válido: {"score_1": n, "score_2": n, "razon": "una frase comparativa"}`;

async function judgeOne(item, ansAgent, ansRaw) {
  const flip = Math.random() < 0.5; // orden aleatorio contra sesgo de posición
  const r1 = flip ? ansRaw : ansAgent;
  const r2 = flip ? ansAgent : ansRaw;
  let j = null;
  for (let intento = 0; intento < 2 && !j; intento++) {
    const out = await claude(JUDGE_SYSTEM,
      'PREGUNTA DEL CLIENTE:\n' + item.q + '\n\nRÚBRICA (lo que una respuesta experta 2026 debe cubrir):\n' + item.rubric +
      '\n\nRESPUESTA 1:\n' + r1 + '\n\nRESPUESTA 2:\n' + r2, 400);
    const m = out.match(/\{[\s\S]*\}/);
    try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
  }
  if (!j) throw new Error('el juez no devolvió JSON válido');
  return {
    scoreAgent: flip ? j.score_2 : j.score_1,
    scoreRaw: flip ? j.score_1 : j.score_2,
    razon: j.razon,
  };
}

// ── Ejecución ────────────────────────────────────────────────────────────────
const systems = await composeSystems();
console.log('Systems compuestos:', Object.entries(systems).map(([k, v]) => k + '=' + (v.length / 1000).toFixed(0) + 'k').join(' '));
console.log('Evaluando', QUESTIONS.length, 'preguntas (agente vs Claude sin contexto)...\n');

const results = [];
// Concurrencia 3 para no golpear rate limits
for (let i = 0; i < QUESTIONS.length; i += 3) {
  const batch = QUESTIONS.slice(i, i + 3);
  const settled = await Promise.allSettled(batch.map(async (item) => {
    const [ansAgent, ansRaw] = await Promise.all([
      claude(systems[item.agent], item.q),
      claude(null, item.q),
    ]);
    const scores = await judgeOne(item, ansAgent, ansRaw);
    return { agentKey: item.agent, q: item.q, ...scores, ansAgent, ansRaw };
  }));
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(s.value);
      console.log('✓', s.value.agentKey.padEnd(10), 'acuarius:', s.value.scoreAgent, '| claude:', s.value.scoreRaw, '—', s.value.razon.slice(0, 80));
    } else {
      console.log('✗ error:', s.reason.message);
    }
  }
}

// ── Reporte ──────────────────────────────────────────────────────────────────
console.log('\n════════════════ RESULTADOS ════════════════');
console.log('AGENTE'.padEnd(11) + 'ACUARIUS'.padEnd(10) + 'CLAUDE'.padEnd(9) + 'PREGUNTA');
let tA = 0, tR = 0, wins = 0, ties = 0;
for (const r of results) {
  tA += r.scoreAgent; tR += r.scoreRaw;
  if (r.scoreAgent > r.scoreRaw) wins++;
  else if (r.scoreAgent === r.scoreRaw) ties++;
  console.log(r.agentKey.padEnd(11) + String(r.scoreAgent).padEnd(10) + String(r.scoreRaw).padEnd(9) + r.q.slice(0, 60) + '…');
}
const n = results.length || 1;
console.log('─'.repeat(76));
console.log('PROMEDIO'.padEnd(11) + (tA / n).toFixed(1).padEnd(10) + (tR / n).toFixed(1));
console.log('\nAcuarius gana ' + wins + '/' + n + ' · empata ' + ties + ' · pierde ' + (n - wins - ties));

const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(__dir, 'results-' + stamp + '.json'), JSON.stringify({
  fecha: stamp, modelo: MODEL,
  resumen: { promedioAcuarius: +(tA / n).toFixed(2), promedioClaude: +(tR / n).toFixed(2), gana: wins, empata: ties, pierde: n - wins - ties, total: n },
  resultados: results,
}, null, 2));
console.log('Guardado: eval/results-' + stamp + '.json');
