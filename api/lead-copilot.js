export const config = { runtime: 'edge' };
import { registrarUso, cuentaDe, consumoDelMes } from './_uso-ia.js';
import { planDeCuenta } from './_cupo-agente.js';
import { soloSusLeads } from './_perfiles.js';
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
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
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Consultas al Copiloto incluidas al mes, contadas en ai_usage con origen
// 'copiloto' (cada consulta registra una fila). Es un freno de emergencia, no
// un límite comercial: una persona que usa el CRM todos los días no se acerca.
// Los alias viejos de Clerk ('individual', 'agencia') reciben su cupo, y un
// plan desconocido el de Pro: ante un dato nuestro mal puesto se cobra de menos.
const CUPO_COPILOTO = { free: 20, trial: 200, pro: 300, individual: 300, agency: 1500, agencia: 1500 };
function cupoCopiloto(plan) {
  const p = String(plan || '').toLowerCase().trim();
  if (!p) return CUPO_COPILOTO.free;
  return CUPO_COPILOTO[p] ?? CUPO_COPILOTO.pro;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);

  const sesion = await verificarSesion(req);
  let userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'lead-copilot'), 401);

  // Un miembro del equipo opera sobre la cuenta del dueño: los datos son de la
  // cuenta, no de la persona. Sin esto el miembro consulta su propia cuenta
  // —vacía— y el módulo le sale en blanco sin ningún error a la vista.
  const _actor = userId;
  let _rol = null;
  try {
    const _tw = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,role&limit=1`,
      { headers: sbHeaders() }
    );
    if (!_tw.ok) throw new Error('HTTP ' + _tw.status);
    const _fila = (await _tw.json())?.[0];
    if (_fila?.owner_user_id) { userId = _fila.owner_user_id; _rol = _fila.role || null; }
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  let body;
  try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }

  const { lead_id, action } = body; // action: 'analyze' | 'draft_message' | 'score' | 'next_action'
  if (!lead_id || !action) return jsonResp({ error: 'Faltan campos' }, 400);

  // El cupo se mira ANTES de gastar. Si no se puede leer (Supabase o Clerk
  // caídos) se deja pasar: frenar a un cliente por un mal minuto nuestro es
  // peor que una consulta de más. Queda en el log.
  const cuenta = await cuentaDe(userId);
  const [usadas, suPlan] = await Promise.all([consumoDelMes(cuenta, 'copiloto'), planDeCuenta(cuenta)]);
  if (usadas === null || !suPlan.ok) {
    console.error('[lead-copilot] no se pudo leer el cupo de', cuenta, '— se deja pasar');
  } else {
    const tope = cupoCopiloto(suPlan.plan);
    if (usadas >= tope) {
      return jsonResp({
        error: `Usaste las ${tope} consultas al Copiloto incluidas este mes. Se renuevan el día 1.`,
        upgrade: !suPlan.plan || suPlan.plan === 'free',
        cupo: { limite: tope, usadas },
      }, 429);
    }
  }

  // Load lead. Perfil Ventas: solo los suyos — el copiloto resume la ficha
  // entera, así que sin este corte era la forma más cómoda de leer el lead de
  // un compañero.
  const _filtroMios = (_actor !== userId && soloSusLeads(_rol))
    ? `&assigned_to=eq.${encodeURIComponent(_actor)}` : '';
  const leadRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}&user_id=eq.${userId}&deleted_at=is.null${_filtroMios}&select=*`,
    { headers: sbHeaders() }
  );
  const leadRows = await leadRes.json();
  const lead = leadRows?.[0];
  if (!lead) return jsonResp({ error: 'No se encontró el lead o no tienes acceso a él.' }, 404);

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

    next_action: `Eres un experto en ventas y CRM para el mercado latinoamericano. Sugiere la próxima acción concreta para este lead.

${leadContext}
Última actualización: ${new Date(lead.updated_at || lead.created_at).toLocaleDateString('es-CO')} (hoy es ${new Date().toLocaleDateString('es-CO')})

Responde en español, en 2 o 3 oraciones como máximo, con una acción específica y la urgencia que corresponda. Empieza directamente con la recomendación (no digas "te recomiendo" ni "sugiero"). Sin títulos ni listas.`,

    score: `Eres un experto en ventas. Evalúa este lead del 1 al 10 según su probabilidad de cierre.

${leadContext}

Responde SOLO con un JSON válido, sin markdown ni texto adicional:
{"score": 7, "label": "Alta", "reason": "Frase corta explicando el score", "days_estimate": 14}`
  };

  const prompt = prompts[action];
  if (!prompt) return jsonResp({ error: 'Acción no válida' }, 400);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResp({ error: 'La IA no está configurada en el servidor. Avísale a soporte.' }, 500);

  let claudeRes;
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch {
    return jsonResp({ error: 'No se pudo contactar a la IA. Reintenta en unos segundos.' }, 502);
  }

  if (!claudeRes.ok) {
    console.error('[lead-copilot] Anthropic respondió', claudeRes.status);
    return jsonResp({ error: claudeRes.status === 429 || claudeRes.status === 529
      ? 'La IA está saturada en este momento. Reintenta en un minuto.'
      : 'La IA no respondió. Reintenta en unos segundos.' }, 502);
  }
  const claudeData = await claudeRes.json();
  // Se busca el bloque de texto y no el primero: si el modelo abre con otro
  // tipo de bloque, content[0].text sale vacío y la caja se quedaba en blanco.
  const result = (claudeData.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (claudeData.usage) {
    await registrarUso({
      userId: cuenta, actorId: _actor,
      origen: 'copiloto', modelo: claudeData.model, uso: claudeData.usage,
    });
  }

  if (!result) return jsonResp({ error: 'La IA devolvió una respuesta vacía. Reintenta.' }, 502);

  if (action === 'score') {
    try {
      const parsed = JSON.parse(result);
      return jsonResp({ score: parsed });
    } catch { return jsonResp({ result }); }
  }

  return jsonResp({ result });
}
