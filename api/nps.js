// api/nps.js
// Encuestas NPS — cara pública y stats:
// GET  ?t=token&s=score → registra la respuesta, etiqueta al lead (nps
//      promotor/neutro/detractor — dispara automatizaciones tag_added) y
//      muestra la página de gracias con campo de comentario opcional.
// POST ?t=token {comment} → guarda el comentario.
// GET  con Authorization (sin t) → stats para el widget de Análisis.
export const config = { runtime: 'edge' };

import { ensureCatalog, enqueueAutomations } from './_lead-intake.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const NPS_TAGS = ['nps promotor', 'nps neutro', 'nps detractor'];
function categoryFor(score) {
  return score >= 9 ? 'nps promotor' : score >= 7 ? 'nps neutro' : 'nps detractor';
}

const LOGO_SVG = '<span style="display:inline-flex;align-items:center;gap:2px"><svg width="30" height="30" viewBox="0 0 75 75" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="#1E2BCC" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#1E2BCC" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#1E2BCC" cx="60.13" cy="10.7" r="5.3"/></svg><span style="font-size:21px;font-weight:800;color:#0b0b14;letter-spacing:-.5px">cuarius</span></span>';

function page(inner) {
  return new Response('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Gracias por tu opinión</title></head>' +
    '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#F6F7FB;color:#14162E;display:flex;align-items:flex-start;justify-content:center;min-height:100vh;padding:40px 16px">' +
    '<div style="background:#fff;border-radius:18px;max-width:440px;width:100%;padding:36px 32px;box-shadow:0 8px 40px rgba(20,22,46,.08);text-align:center">' +
    inner +
    '<div style="margin-top:26px;font-size:11.5px;color:#9ca3af">Encuesta gestionada con <a href="https://acuarius.app" style="color:#9ca3af;font-weight:700;text-decoration:none">Acuarius</a></div>' +
    '</div></body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const token = url.searchParams.get('t') || '';

  // ── Stats autenticadas (widget de Análisis) ──
  if (!token && req.method === 'GET') {
    let userId = await getUserId(req);
    if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
    try {
      const tw = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sbHeaders() }).then(r => r.json());
      if (tw?.[0]?.owner_user_id) userId = tw[0].owner_user_id;
    } catch {}
    // Modo soporte (solo lectura aquí, es un GET). Ver api/_soporte.js.
    try {
      const { resolverSoporte } = await import('./_soporte.js');
      const r = await resolverSoporte(req, userId);
      if (r.soporte) userId = r.userId;
    } catch {}
    const clientId = url.searchParams.get('client_id') || null;
    const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/nps_responses?user_id=eq.${encodeURIComponent(userId)}${scope}&select=score,comment,responded_at,sent_at,lead_id&order=sent_at.desc&limit=1000`, { headers: sbHeaders() }).then(r => r.json()).then(r => r || []);
    const answered = rows.filter(r => r.score !== null && r.score !== undefined);
    const promoters = answered.filter(r => r.score >= 9).length;
    const passives = answered.filter(r => r.score >= 7 && r.score <= 8).length;
    const detractors = answered.filter(r => r.score <= 6).length;
    const nps = answered.length ? Math.round(((promoters - detractors) / answered.length) * 100) : null;
    // Nombres de los últimos comentarios
    const withComment = answered.filter(r => r.comment).slice(0, 8);
    const leadIds = [...new Set(withComment.map(r => r.lead_id).filter(Boolean))];
    let names = {};
    if (leadIds.length) {
      const leads = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${leadIds.join(',')})&select=id,name`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
      names = Object.fromEntries((leads || []).map(l => [l.id, l.name]));
    }
    return jsonResp({
      sent: rows.length, answered: answered.length, promoters, passives, detractors, nps,
      comments: withComment.map(r => ({ score: r.score, comment: r.comment, name: names[r.lead_id] || 'Anónimo', at: r.responded_at })),
    });
  }

  if (!/^[a-f0-9]{24,64}$/i.test(token)) return page('<div style="font-size:15px;color:#6b7280">Enlace no válido o vencido.</div>');

  const rows = await fetch(`${SUPABASE_URL}/rest/v1/nps_responses?token=eq.${encodeURIComponent(token)}&select=*&limit=1`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
  const resp = rows?.[0];
  if (!resp) return page('<div style="font-size:15px;color:#6b7280">Enlace no válido o vencido.</div>');

  // ── POST: comentario opcional ──
  if (req.method === 'POST') {
    let body = {};
    try {
      const ct = req.headers.get('content-type') || '';
      body = ct.includes('json') ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()));
    } catch {}
    const comment = String(body.comment || '').trim().slice(0, 600);
    if (comment) {
      await fetch(`${SUPABASE_URL}/rest/v1/nps_responses?id=eq.${resp.id}`, {
        method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ comment }),
      });
    }
    return page('<div style="font-size:42px;margin-bottom:10px">🙌</div><div style="font-size:17px;font-weight:800;margin-bottom:6px">¡Gracias por tu comentario!</div><div style="font-size:14px;color:#6b7280">Lo leeremos con atención.</div>');
  }

  // ── GET con score: registrar y etiquetar ──
  const score = parseInt(url.searchParams.get('s'));
  if (!(score >= 0 && score <= 10)) return page('<div style="font-size:15px;color:#6b7280">Enlace no válido.</div>');

  const first = resp.score === null || resp.score === undefined;
  if (first) {
    await fetch(`${SUPABASE_URL}/rest/v1/nps_responses?id=eq.${resp.id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ score, responded_at: new Date().toISOString() }),
    });
  }

  // Etiquetar al lead con su categoría (quita las otras nps) — solo primera respuesta
  const tag = categoryFor(score);
  if (first && resp.lead_id) {
    try {
      const leads = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${resp.lead_id}&select=*`, { headers: sbHeaders() }).then(r => r.json());
      const lead = leads?.[0];
      if (lead && !lead.deleted_at) {
        const newTags = [...(lead.tags || []).filter(t => !NPS_TAGS.includes(t)), tag].slice(0, 15);
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${resp.lead_id}`, {
          method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify({ tags: newTags, updated_at: new Date().toISOString() }),
        });
        await ensureCatalog(resp.user_id, resp.client_id || null, [tag], tag).catch(() => {});
        await enqueueAutomations(resp.user_id, { ...lead, tags: newTags }, 'tag_added', [tag]).catch(() => {});
      }
    } catch (e) { console.error('[nps] tag error:', e.message); }
  }

  const face = score >= 9 ? '🤩' : score >= 7 ? '🙂' : '😕';
  return page(
    LOGO_SVG +
    '<div style="font-size:42px;margin:14px 0 8px">' + face + '</div>' +
    '<div style="font-size:18px;font-weight:800;margin-bottom:4px">¡Gracias! Registramos tu ' + score + '/10</div>' +
    '<div style="font-size:13.5px;color:#6b7280;margin-bottom:18px">' + (score <= 6 ? '¿Qué deberíamos mejorar? Tu respuesta llega directo al equipo.' : '¿Algo que quieras contarnos?') + '</div>' +
    '<form method="POST" action="/api/nps?t=' + token + '">' +
    '<textarea name="comment" rows="3" placeholder="Escribe aquí (opcional)…" style="width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical"></textarea>' +
    '<button type="submit" style="margin-top:12px;width:100%;padding:12px;border:none;border-radius:10px;background:#1E2BCC;color:#fff;font-size:14.5px;font-weight:800;font-family:inherit;cursor:pointer">Enviar comentario</button>' +
    '</form>'
  );
}
