export const config = { runtime: 'edge' };

import { registrarUso, cuentaDe, consumoDelMes } from './_uso-ia.js';

// ── Cupo mensual de mensajes ─────────────────────────────────────────────────
// El tope del plan Free vivía SOLO en el navegador (app.js). Cualquiera con la
// sesión abierta podía saltárselo, y el chat es el rubro que más cuesta de toda
// la plataforma. Aquí es donde tiene que estar.
//
// Los planes de pago llevan un techo alto: no es un límite comercial, es un
// freno de emergencia para que una automatización en bucle o una cuenta
// compartida no se lleven el margen del mes sin que nadie se entere.
const CUPO_MENSAJES = { free: 50, trial: 1500, individual: 1500, pro: 1500, agency: 4000, agencia: 4000 };

// Clerk dejó de mandar public_metadata en el token de sesión (v2), así que el
// plan se le pregunta a Clerk y se cachea un minuto.
const _planCache = new Map();
async function planDe(userId) {
  const hit = _planCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.plan;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const u = await r.json();
    const plan = u?.public_metadata?.plan || 'free';
    _planCache.set(userId, { plan, exp: Date.now() + 60000 });
    return plan;
  } catch {
    // Si no se puede saber el plan, se trata como de pago: dejar sin chat a un
    // cliente porque Clerk tardó es peor que regalar unos mensajes.
    return 'pro';
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Verify Clerk JWT using JWKS (Edge-compatible, no extra deps)
async function verifyClerkToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g,'+').replace(/_/g,'/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(sB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  // Verify Clerk session token — block unauthenticated requests
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '') || '';
  const userId = token ? await verifyClerkToken(token) : null;
  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'No autorizado.' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'API key no configurada en el servidor.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // El cupo se mira contra la CUENTA, no contra quien escribe: los mensajes de
  // un miembro del equipo gastan del bote del dueño, igual que se le imputan.
  const cuenta = await cuentaDe(userId);
  const plan = await planDe(cuenta);
  const tope = CUPO_MENSAJES[plan] ?? CUPO_MENSAJES.free;
  const gastados = await consumoDelMes(cuenta, 'agente');
  // gastados === null significa que la consulta falló, no que sean cero.
  if (gastados !== null && gastados >= tope) {
    return new Response(
      JSON.stringify({
        error: plan === 'free'
          ? `Usaste tus ${tope} mensajes gratuitos de este mes. El plan Pro los quita.`
          : `Llegaste a ${tope} mensajes este mes. Escríbenos y te ampliamos el cupo.`,
        upgrade: plan === 'free',
        cupo: { plan, limite: tope, usados: gastados },
      }),
      { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  let body;
  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch (readErr) {
    return new Response(
      JSON.stringify({ error: `Error leyendo body: ${readErr?.message}` }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // Límite explícito: 3MB (Edge Runtime de Vercel puede rechazar cuerpos muy grandes)
  if (rawBody.length > 3 * 1024 * 1024) {
    return new Response(
      JSON.stringify({ error: `Payload demasiado grande: ${rawBody.length} bytes. Máximo 3MB.` }),
      { status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  try {
    body = JSON.parse(rawBody);
  } catch (parseErr) {
    return new Response(
      JSON.stringify({ error: `JSON inválido en posición ${parseErr?.message}: primeros 200 chars: ${rawBody.slice(0, 200)}` }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const { messages, system } = body;

  if (!messages || !Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: 'Campo messages requerido.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // Límite de seguridad del system (los prompts completos de los agentes miden
  // hasta ~80k chars + packs). El costo se controla con prompt caching abajo.
  const MAX_SYSTEM_CHARS = 150000;
// Qué agente es, deducido del prompt. El cliente no manda esa etiqueta y
// pedírsela obligaría a tocar el frontend; la primera línea del prompt de cada
// agente ya lo dice. Si no se reconoce, se guarda null y el informe lo agrupa
// como "otros" en vez de mentir.
function agenteDe(system) {
  const t = String(system || '').slice(0, 400).toLowerCase();
  for (const [clave, patron] of [
    ['google-ads', /google ads/], ['meta-ads', /meta ads|facebook ads/],
    ['tiktok-ads', /tiktok/],     ['linkedin-ads', /linkedin/],
    ['seo', /\bseo\b/],           ['social', /redes sociales|contenido para redes/],
    ['consultor', /consultor/],
  ]) if (patron.test(t)) return clave;
  return null;
}

  const sanitizedSystem = typeof system === 'string'
    ? system.slice(0, MAX_SYSTEM_CHARS)
    : '';

  // La caché de 5 minutos se pierde en cuanto el usuario lee, piensa y vuelve a
  // escribir — que es como se usa un chat. Con el prompt del agente de Google Ads
  // en 20.572 tokens, cada fallo de caché cuesta 7,6 centavos en vez de 2.
  // Con una hora, una conversación de seis mensajes sale ~22% más barata.
  //
  // Va con reintento porque el TTL largo se pide con una cabecera beta: si
  // Anthropic la retira o la cambia, el chat de TODOS los agentes se caería.
  // Antes que eso, se reintenta con la caché corta de siempre.
  const pedir = (ttlLargo) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...(ttlLargo ? { 'anthropic-beta': 'extended-cache-ttl-2025-04-11' } : {}),
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // OJO: max_tokens es el techo de TODA la salida — razonamiento + texto.
        // Con 4000 el razonamiento se comía el presupuesto entero y la respuesta
        // llegaba vacía (stop_reason max_tokens, cero bloques de texto).
        max_tokens: 32000,
        // Declarado explícitamente: Sonnet 5 activa el razonamiento adaptativo
        // solo con no mandar este campo. effort medium cuesta ~3x menos que el
        // 'high' implícito y produce un texto del mismo largo.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        stream: true,
        // Prompt caching: el system se cachea una hora (ver arriba). Los turnos
        // siguientes pagan ~10% del costo de input en vez del 100%.
        system: sanitizedSystem
          ? [{
              type: 'text',
              text: sanitizedSystem,
              cache_control: ttlLargo ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
            }]
          : undefined,
        messages,
      }),
    });

  try {
    let claudeRes = await pedir(true);
    // 400 es lo que devuelve Anthropic cuando no reconoce la beta o el ttl. Se
    // reintenta sin ellos para no dejar el chat caído por una optimización.
    if (claudeRes.status === 400) {
      const detalle = await claudeRes.clone().text().catch(() => '');
      if (/ttl|cache_control|beta/i.test(detalle)) {
        console.error('caché de 1h rechazada, se usa la de 5 min:', detalle.slice(0, 200));
        claudeRes = await pedir(false);
      }
    }

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Anthropic API error:', claudeRes.status, errText.slice(0, 500));
      // Parsear el error de Anthropic para dar mensaje útil
      let errDetail = errText.slice(0, 300);
      try { errDetail = JSON.parse(errText)?.error?.message || errDetail; } catch {}
      return new Response(
        JSON.stringify({ error: `Anthropic ${claudeRes.status}: ${errDetail}` }),
        { status: claudeRes.status, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Retransmitir el stream de Anthropic directamente al cliente
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Procesar el stream SSE de Anthropic y re-emitirlo
    (async () => {
      const reader = claudeRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let stopReason = null;
      // El consumo llega en dos eventos distintos: los tokens de entrada y de
      // caché en message_start, los de salida en message_delta. Hay que juntar
      // los dos o el costo sale a la mitad.
      let uso = null;
      let modeloUsado = null;

      // Se pone en true al emitir un error terminal: corta el for interno y el
      // while externo, para no mandar dos motivos por el mismo fallo.
      let terminado = false;

      try {
        while (!terminado) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // guardar línea incompleta

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const evt = JSON.parse(data);

              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                fullText += evt.delta.text;
                // Emitir delta al cliente en formato SSE
                await writer.write(encoder.encode(`data: ${JSON.stringify({ delta: evt.delta.text })}\n\n`));
              }

              // Anthropic puede mandar un evento de error a mitad del stream
              // (overloaded, rate limit, request inválido). Antes se ignoraba:
              // el cliente se quedaba sin texto y sin motivo.
              if (evt.type === 'error') {
                const msg = evt.error?.message || evt.error?.type || 'error desconocido de la API';
                await writer.write(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
                terminado = true;
                break;
              }

              // message_delta trae stop_reason. Si se corta por max_tokens sin
              // haber emitido texto, el cliente necesita saberlo — si no, ve un
              // "error al procesar la respuesta" sin ninguna pista.
              if (evt.type === 'message_start' && evt.message?.usage) {
                uso = { ...evt.message.usage };
                modeloUsado = evt.message.model || null;
              }

              if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
                stopReason = evt.delta.stop_reason;
              }
              if (evt.type === 'message_delta' && evt.usage) {
                uso = { ...(uso || {}), ...evt.usage };
              }

              if (evt.type === 'message_stop') {
                if (!fullText && stopReason === 'max_tokens') {
                  await writer.write(encoder.encode(`data: ${JSON.stringify({
                    error: 'La respuesta se agotó en razonamiento antes de escribir texto (stop_reason: max_tokens). Subí max_tokens o bajá el effort.',
                  })}\n\n`));
                  terminado = true;
                  break;
                }
                // Emitir el texto completo al final para que el cliente pueda procesarlo
                await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true, full: fullText, stopReason })}\n\n`));
              }
            } catch (_) {
              // Ignorar líneas SSE no parseables
            }
          }
        }
      } catch (err) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
      } finally {
        await writer.close();
        // Se registra DESPUÉS de cerrar el stream: así no le añade ni un
        // milisegundo a la respuesta que el usuario está leyendo. Y va dentro
        // del finally para que también quede constancia de lo que se gastó
        // cuando la conversación acabó en error — que es cuando más interesa.
        if (uso) {
          await registrarUso({
            userId: await cuentaDe(userId),
            actorId: userId,
            origen: 'agente',
            agente: agenteDe(sanitizedSystem),
            modelo: modeloUsado,
            uso,
          });
        }
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (err) {
    console.error('chat.js error:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
}
