// api/cron-knowledge.js
// Auto-actualización mensual de los knowledge packs de los agentes.
// 1) Investiga cambios recientes por plataforma (Serper)
// 2) Claude redacta el pack actualizado partiendo del vigente
// 3) Guarda el borrador en knowledge_packs (status draft)
// 4) Email al admin con el changelog y botones Aprobar/Rechazar (links
//    firmados con HMAC — api/knowledge-approve.js). Nada se publica solo.
// Cron: día 1 de cada mes (vercel.json). Fallback de packs: prompts/actualizaciones-2026.js

import crypto from 'crypto';

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const SERPER_KEY     = process.env.SERPER_API_KEY;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET    = process.env.CRON_SECRET;
const ADMIN_EMAIL    = 'alejandro.gonzalez.ads@gmail.com';

const AREAS = [
  { agent: 'google',  nombre: 'Google Ads',  queries: ['Google Ads novedades cambios anuncios este mes', 'Google Ads Performance Max AI Max updates'] },
  { agent: 'meta',    nombre: 'Meta Ads',    queries: ['Meta Ads cambios novedades algoritmo este mes', 'Meta Advantage+ Andromeda updates advertisers'] },
  { agent: 'tiktok',  nombre: 'TikTok Ads',  queries: ['TikTok Ads Smart+ novedades cambios este mes', 'TikTok advertising algorithm updates'] },
];

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

async function serper(q) {
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, hl: 'es', num: 8 }),
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.organic || []).slice(0, 6).map(o => ({ title: o.title, url: o.link, snippet: (o.snippet || '').slice(0, 300), date: o.date || null }));
}

async function claude(system, user) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 3000, system, messages: [{ role: 'user', content: user }] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + JSON.stringify(d).slice(0, 200));
  return d.content?.find(b => b.type === 'text')?.text || '';
}

// Pack vigente: el último publicado en la tabla, o null (el frontend usa el estático)
async function currentPack(agent) {
  const rows = await sb(`/knowledge_packs?agent=eq.${agent}&status=eq.published&select=content&order=published_at.desc&limit=1`);
  return rows?.[0]?.content || null;
}

function sign(id, action) {
  return crypto.createHmac('sha256', CRON_SECRET).update(id + ':' + action).digest('hex').slice(0, 32);
}

const UPDATER_SYSTEM = `Eres el investigador de plataformas publicitarias de Acuarius. Tu trabajo: mantener actualizado el bloque de conocimiento que se inyecta a los agentes de IA.

Recibirás el bloque VIGENTE y resultados de búsqueda web recientes. Devuelve el bloque ACTUALIZADO completo siguiendo estas reglas ESTRICTAS:
1. Mantén el formato exacto del bloque vigente: encabezado === ... === y viñetas con guion.
2. Conserva todo lo que siga vigente; actualiza fechas/datos que cambiaron; agrega SOLO novedades verificables que aparezcan en los resultados (con impacto real para anunciantes de LatAm). Elimina lo que quedó obsoleto.
3. PROHIBIDO usar backticks en el texto (romperían el código que lo carga). Usa comillas simples si necesitas citar.
4. Actualiza el mes/año de "conocimiento verificado a..." del encabezado.
5. Estilo: español, directo, accionable, cada viñeta le dice al agente qué recomendar o evitar.
6. Si los resultados NO traen ninguna novedad relevante que amerite cambiar el bloque, responde EXACTAMENTE la palabra SIN_CAMBIOS y nada más.

Formato de respuesta (si hay cambios):
CHANGELOG: una línea por cambio realizado (máximo 5 líneas, empieza cada una con - )
---PACK---
(el bloque completo actualizado)`;

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const mes = new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const drafts = [];
  const errors = [];

  for (const area of AREAS) {
    try {
      // Dedupe: si ya hay un draft pendiente de este agente, no duplicar
      const pending = await sb(`/knowledge_packs?agent=eq.${area.agent}&status=eq.draft&select=id&limit=1`);
      if (pending?.length) { continue; }

      const searches = [];
      for (const q of area.queries) searches.push(...await serper(q));
      if (!searches.length) { errors.push(area.agent + ': sin resultados de búsqueda'); continue; }

      const vigente = (await currentPack(area.agent)) || '(no hay pack en la base — usa el formato estándar: === ACTUALIZACIONES ' + area.nombre.toUpperCase() + ' ... === con viñetas)';
      const out = await claude(UPDATER_SYSTEM,
        'Fecha actual: ' + mes + '\nPlataforma: ' + area.nombre + '\n\nBLOQUE VIGENTE:\n' + vigente +
        '\n\nRESULTADOS DE BÚSQUEDA RECIENTES:\n' + JSON.stringify(searches, null, 2));

      if (out.trim() === 'SIN_CAMBIOS' || out.includes('SIN_CAMBIOS')) continue;
      const sep = out.indexOf('---PACK---');
      if (sep === -1) { errors.push(area.agent + ': respuesta sin formato esperado'); continue; }
      const changelog = out.slice(0, sep).replace('CHANGELOG:', '').trim().slice(0, 1000);
      const content = out.slice(sep + 10).trim().replace(/`/g, "'"); // seguridad extra: sin backticks

      const rows = await sb('/knowledge_packs', 'POST', {
        agent: area.agent, content, changelog, status: 'draft',
      });
      drafts.push({ id: rows[0].id, agent: area.agent, nombre: area.nombre, changelog });
    } catch (e) {
      errors.push(area.agent + ': ' + e.message);
    }
  }

  // Email al admin con los borradores y botones firmados
  if (drafts.length && RESEND_API_KEY) {
    const base = 'https://app.acuarius.app/api/knowledge-approve';
    const bloques = drafts.map(d => {
      const ok = base + '?id=' + d.id + '&action=approve&sig=' + sign(d.id, 'approve');
      const no = base + '?id=' + d.id + '&action=reject&sig=' + sign(d.id, 'reject');
      return '<div style="border:1px solid #e2e2ef;border-radius:12px;padding:18px;margin:0 0 16px">' +
        '<div style="font-weight:800;font-size:16px;margin-bottom:8px">' + d.nombre + '</div>' +
        '<pre style="white-space:pre-wrap;font-family:inherit;font-size:13.5px;color:#444;margin:0 0 14px">' + d.changelog + '</pre>' +
        '<a href="' + ok + '" style="display:inline-block;background:#1E2BCC;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:700;margin-right:8px">✓ Aprobar y publicar</a>' +
        '<a href="' + no + '" style="display:inline-block;background:#f4f4f8;color:#666;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:700">✕ Rechazar</a>' +
        '</div>';
    }).join('');
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Acuarius <notificaciones@app.acuarius.app>',
        to: [ADMIN_EMAIL],
        subject: '🧠 Actualización mensual de conocimiento de los agentes — ' + drafts.length + ' propuesta(s)',
        html: '<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;color:#1a1a2e">' +
          '<h2 style="margin:0 0 6px">Actualización de knowledge packs</h2>' +
          '<p style="color:#666;margin:0 0 20px">El investigador encontró cambios en las plataformas (' + mes + '). Revisa el changelog y aprueba con un clic — al aprobar, todos los agentes usan el pack nuevo de inmediato.</p>' +
          bloques + '</div>',
      }),
    }).catch(e => errors.push('email: ' + e.message));
  }

  console.log('[cron-knowledge] drafts:', drafts.length, 'errors:', errors);
  return res.status(200).json({ ok: true, drafts: drafts.map(d => d.agent), errors });
}
