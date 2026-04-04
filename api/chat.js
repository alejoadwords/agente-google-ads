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
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Body inválido.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const { messages, system, userPlan } = body;

  if (!messages || !Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: 'Campo messages requerido.' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // Límite de mensajes según plan
  const MAX_MSGS = { free: 20, pro: 200, agency: 500, admin: 9999 };
  const limit = MAX_MSGS[userPlan] || MAX_MSGS.free;

  // Llamar a Claude con streaming
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'messages-2023-12-15',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      stream: true,
      system: system || '',
      messages,
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return new Response(err, {
      status: claudeRes.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Transformar el stream SSE de Anthropic en un stream de texto acumulado,
  // y al final emitir el JSON completo que el frontend espera
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = claudeRes.body.getReader();
      let fullText = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              // Acumular texto del delta
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                fullText += event.delta.text;
                // Enviar delta al frontend para mostrar progreso
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`));
              }

              // Al terminar, enviar el JSON final completo
              if (event.type === 'message_stop') {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ done: true, content: [{ type: 'text', text: fullText }] })}\n\n`
                ));
              }
            } catch {
              // ignorar líneas malformadas
            }
          }
        }
      } catch (err) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ error: err.message })}\n\n`
        ));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
