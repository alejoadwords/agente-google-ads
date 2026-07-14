// api/knowledge-approve.js
// Aprueba o rechaza un borrador de knowledge pack desde los links firmados
// del email del cron (HMAC con CRON_SECRET — no requiere sesión).
// Al aprobar: el pack pasa a published y los publicados anteriores del mismo
// agente se archivan. El frontend los carga via api/knowledge-packs.js.

import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

async function sb(path, method = 'GET', body = null, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': prefer || 'return=representation',
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function page(title, body, ok) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">' +
    '<div style="background:#fff;border-radius:16px;padding:40px 44px;max-width:440px;text-align:center;box-shadow:0 8px 30px rgba(30,43,204,.08)">' +
    '<div style="font-size:44px;margin-bottom:12px">' + (ok ? '✅' : '❌') + '</div>' +
    '<h2 style="margin:0 0 10px;color:#1a1a2e">' + title + '</h2>' +
    '<p style="color:#666;margin:0;line-height:1.6">' + body + '</p></div></body></html>';
}

export default async function handler(req, res) {
  const { id, action, sig } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!id || !['approve', 'reject'].includes(action) || !sig) {
    return res.status(400).send(page('Solicitud inválida', 'Faltan parámetros del enlace.', false));
  }
  const expected = crypto.createHmac('sha256', CRON_SECRET).update(id + ':' + action).digest('hex').slice(0, 32);
  const a = Buffer.from(String(sig)), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).send(page('Enlace inválido', 'La firma del enlace no es válida.', false));
  }

  try {
    const rows = await sb(`/knowledge_packs?id=eq.${id}&select=*`);
    const pack = rows?.[0];
    if (!pack) return res.status(404).send(page('No encontrado', 'Este borrador ya no existe.', false));
    if (pack.status !== 'draft') {
      return res.status(200).send(page('Ya procesado', 'Este borrador ya fue ' + (pack.status === 'published' ? 'aprobado y publicado' : pack.status === 'rejected' ? 'rechazado' : pack.status) + ' anteriormente.', true));
    }

    if (action === 'reject') {
      await sb(`/knowledge_packs?id=eq.${id}`, 'PATCH', { status: 'rejected' }, 'return=minimal');
      return res.status(200).send(page('Borrador rechazado', 'Los agentes siguen usando el conocimiento vigente. El investigador volverá a proponer cambios el próximo mes.', true));
    }

    // Aprobar: archivar los publicados anteriores del mismo agente y publicar este
    await sb(`/knowledge_packs?agent=eq.${encodeURIComponent(pack.agent)}&status=eq.published`, 'PATCH', { status: 'archived' }, 'return=minimal');
    await sb(`/knowledge_packs?id=eq.${id}`, 'PATCH', { status: 'published', published_at: new Date().toISOString() }, 'return=minimal');
    return res.status(200).send(page('Pack publicado', 'El conocimiento actualizado de <b>' + pack.agent + '</b> ya está activo — todos los agentes lo usan desde este momento, sin necesidad de deploy.', true));
  } catch (e) {
    console.error('[knowledge-approve]', e.message);
    return res.status(500).send(page('Error', 'No se pudo procesar: ' + e.message, false));
  }
}
