// api/web-search.js
// Búsqueda web en vivo para los agentes. El agente emite [WEB_SEARCH: consulta]
// en su respuesta, el frontend la intercepta y llama aquí; los resultados se
// devuelven condensados y se reinyectan al modelo para que responda con
// información fresca citando fuentes. Motor: Serper.dev (misma key del SEO).
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  const sesion = await verificarSesion(req);
  const userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'web-search'), 401);

  const key = process.env.SERPER_API_KEY;
  if (!key) return jsonResp({ error: 'Búsqueda web no configurada' }, 500);

  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
  const query = String(body.query || '').trim().slice(0, 200);
  if (query.length < 3) return jsonResp({ error: 'Consulta demasiado corta' }, 400);
  // gl opcional: código de país del cliente activo (co, mx, ar, cl, pe...)
  const gl = /^[a-z]{2}$/.test(String(body.gl || '')) ? body.gl : 'co';

  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl, hl: 'es', num: 8 }),
    });
    if (!r.ok) return jsonResp({ error: 'El buscador respondió con error ' + r.status }, 502);
    const d = await r.json();

    // Condensar: solo lo que el modelo necesita, sin ruido
    const out = {
      query,
      answerBox: d.answerBox ? { title: d.answerBox.title || '', answer: (d.answerBox.answer || d.answerBox.snippet || '').slice(0, 500) } : null,
      knowledgeGraph: d.knowledgeGraph ? { title: d.knowledgeGraph.title || '', description: (d.knowledgeGraph.description || '').slice(0, 300) } : null,
      results: (d.organic || []).slice(0, 6).map(o => ({
        title: o.title,
        url: o.link,
        snippet: (o.snippet || '').slice(0, 300),
        date: o.date || null,
      })),
    };
    return jsonResp(out);
  } catch (e) {
    return jsonResp({ error: 'Error ejecutando la búsqueda: ' + String(e.message || e).slice(0, 100) }, 500);
  }
}
