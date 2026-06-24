export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
function sbHeaders() {
  return { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };
}
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g,'+').replace(/_/g,'/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }

  const { lead_id, action } = body; // action: 'analyze' | 'draft_message' | 'score'
  if (!lead_id || !action) return jsonResp({ error: 'Faltan campos' }, 400);

  // Load lead
  const leadRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}&user_id=eq.${userId}&deleted_at=is.null&select=*`,
    { headers: sbHeaders() }
  );
  const leadRows = await leadRes.json();
  const lead = leadRows?.[0];
  if (!lead) return jsonResp({ error: 'Lead no encontrado' }, 404);

  // Load recent activities
  const actRes = await fetch(
    `${SUPABASE_URL}/rest/v1/lead_activities?lead_id=eq.${lead_id}&select=type,content,created_at&order=created_at.desc&limit=10`,
    { headers: sbHeaders() }
  );
  const activities = await actRes.json() || [];

  const leadContext = `
Nombre: ${lead.name}
Empresa: ${lead.company || 'No especificada'}
Email: ${lead.email || 'No disponible'}
Teléfono: ${lead.phone || 'No disponible'}
Etapa actual: ${lead.stage}
Fuente: ${lead.source}
Fecha de creación: ${new Date(lead.created_at).toLocaleDateString('es-CO')}
Notas: ${lead.notes || 'Ninguna'}

Historial de actividad (más reciente primero):
${activities.map(a => `- [${a.type}] ${a.content} (${new Date(a.created_at).toLocaleDateString('es-CO')})`).join('\n') || 'Sin actividad registrada'}
`.trim();

  const prompts = {
    analyze: `Eres un experto en ventas para el mercado latinoamericano. Analiza este lead y responde en español de forma concisa (máximo 150 palabras):

${leadContext}

Responde con:
1. **Estado actual**: Una frase que describe dónde está este lead en el proceso
2. **Acción recomendada**: Qué hacer HOY con este lead y por qué
3. **Señales de alerta**: Si hay algo preocupante (tiempo sin contacto, etapa estancada, etc.)

Sé directo y práctico. No repitas datos del lead.`,

    draft_message: `Eres un experto en comunicación de ventas para el mercado latinoamericano. Redacta un mensaje de seguimiento en WhatsApp para este lead.

${leadContext}

El mensaje debe:
- Ser natural, cálido y breve (máximo 3-4 líneas)
- No sonar comercial ni desesperado
- Referirse a la conversación anterior si hay actividad
- Incluir un call-to-action claro pero suave
- Usar lenguaje informal (tú) y emojis con moderación

Solo escribe el mensaje, sin explicaciones adicionales.`,

    score: `Eres un experto en ventas. Evalúa este lead del 1 al 10 según su probabilidad de cierre.

${leadContext}

Responde SOLO con un JSON válido, sin markdown ni texto adicional:
{"score": 7, "label": "Alta", "reason": "Frase corta explicando el score", "days_estimate": 14}`
  };

  const prompt = prompts[action];
  if (!prompt) return jsonResp({ error: 'Acción no válida' }, 400);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResp({ error: 'API key no configurada' }, 500);

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!claudeRes.ok) return jsonResp({ error: 'Error de IA' }, 500);
  const claudeData = await claudeRes.json();
  const result = claudeData.content?.[0]?.text || '';

  if (action === 'score') {
    try {
      const parsed = JSON.parse(result);
      return jsonResp({ score: parsed });
    } catch { return jsonResp({ result }); }
  }

  return jsonResp({ result });
}
