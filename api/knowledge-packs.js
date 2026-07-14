// api/knowledge-packs.js
// Devuelve el último knowledge pack publicado por agente. El frontend los
// carga al iniciar y sobreescribe los estáticos de prompts/actualizaciones-2026.js
// (que quedan como fallback si no hay nada publicado o la petición falla).
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  // CDN puede cachear 5 min — los packs cambian una vez al mes
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_packs?status=eq.published&select=agent,content,published_at&order=published_at.desc`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = (await r.json()) || [];
    // Solo el más reciente por agente
    const seen = new Set();
    const packs = [];
    for (const row of rows) {
      if (seen.has(row.agent)) continue;
      seen.add(row.agent);
      packs.push({ agent: row.agent, content: row.content, published_at: row.published_at });
    }
    return new Response(JSON.stringify({ packs }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ packs: [], error: e.message }), { status: 200, headers: CORS });
  }
}
