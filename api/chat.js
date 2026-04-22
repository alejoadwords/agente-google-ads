export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
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

  // Truncar system prompt si es muy largo (seguridad adicional)
  const MAX_SYSTEM_CHARS = 20000;
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
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        stream: true,
        system: sanitizedSystem,
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
