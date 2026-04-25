// api/conversations.js
// Historial de conversaciones por agente
// Acciones: save | list | get | delete

import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@clerk/backend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const config = { runtime: 'edge' };

async function getUserId(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return payload?.sub || null;
  } catch {
    return null;
  }
}

export default async function handler(req) {
  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // ── SAVE ────────────────────────────────────────────────────────────────────
  // POST /api/conversations?action=save
  // Body: { agent, messages: [{role, content}], conversationId? }
  if (req.method === 'POST' && action === 'save') {
    const body = await req.json();
    const { agent, messages, conversationId } = body;

    if (!agent || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
    }

    // Título: primer mensaje del usuario, truncado a 80 chars
    const firstUser = messages.find(m => m.role === 'user');
    const rawTitle = typeof firstUser?.content === 'string'
      ? firstUser.content
      : firstUser?.content?.find?.(c => c.type === 'text')?.text || 'Conversación';
    const title = rawTitle.slice(0, 80);

    if (conversationId) {
      // Actualizar conversación existente
      const { data, error } = await supabase
        .from('conversations')
        .update({
          messages,
          title,
          message_count: messages.filter(m => m.role === 'user').length,
        })
        .eq('id', conversationId)
        .eq('user_id', userId)
        .select('id')
        .single();

      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ id: data.id }), { status: 200 });
    } else {
      // Crear nueva conversación
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          user_id: userId,
          agent,
          title,
          messages,
          message_count: messages.filter(m => m.role === 'user').length,
        })
        .select('id')
        .single();

      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ id: data.id }), { status: 201 });
    }
  }

  // ── LIST ─────────────────────────────────────────────────────────────────────
  // GET /api/conversations?action=list&agent=google-ads&limit=20
  if (req.method === 'GET' && action === 'list') {
    const agent = url.searchParams.get('agent');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

    let query = supabase
      .from('conversations')
      .select('id, agent, title, message_count, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (agent) query = query.eq('agent', agent);

    const { data, error } = await query;
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ conversations: data }), { status: 200 });
  }

  // ── GET ──────────────────────────────────────────────────────────────────────
  // GET /api/conversations?action=get&id=UUID
  if (req.method === 'GET' && action === 'get') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 404 });
    return new Response(JSON.stringify({ conversation: data }), { status: 200 });
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
  // DELETE /api/conversations?action=delete&id=UUID
  if (req.method === 'DELETE' && action === 'delete') {
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
