export const config = { runtime: 'edge' };

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
  const sanitizedSystem = typeof system === 'string'
    ? system.slice(0, MAX_SYSTEM_CHARS)
    : '';

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        stream: true,
        // Prompt caching: el system (grande y estable dentro de una conversación)
        // se cachea 5 min — los turnos siguientes pagan ~10% del costo de input
        system: sanitizedSystem
          ? [{ type: 'text', text: sanitizedSystem, cache_control: { type: 'ephemeral' } }]
          : undefined,
        messages,
      }),
    });

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

      try {
        while (true) {
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

              if (evt.type === 'message_stop') {
                // Emitir el texto completo al final para que el cliente pueda procesarlo
                await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true, full: fullText })}\n\n`));
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
