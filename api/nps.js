// api/nps.js
// Encuestas NPS — cara pública y stats:
// GET  ?t=token&s=score → registra la respuesta, etiqueta al lead (nps
//      promotor/neutro/detractor — dispara automatizaciones tag_added) y
//      muestra la página de gracias con campo de comentario opcional.
// POST ?t=token {comment} → guarda el comentario.
// GET  con Authorization (sin t) → stats para el widget de Análisis.
export const config = { runtime: 'edge' };

import { ensureCatalog, enqueueAutomations } from './_lead-intake.js';
import { leerNps, normalizarNps, pieSegunNota, NPS_KEY, TIPOS_PREGUNTA } from './_nps.js';

// Los textos los escribe el cliente y se meten dentro del HTML de una página
// pública: sin escapar, un `<script>` en el título de la encuesta se ejecuta
// en el navegador de quien la responde.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

function page(inner, cfg) {
  const marca = cfg?.logoUrl
    ? '<img src="' + esc(cfg.logoUrl) + '" alt="" style="max-height:44px;max-width:190px;margin-bottom:6px">'
    : LOGO_SVG;
  const pie = cfg?.logoUrl
    ? ''
    : '<div style="margin-top:26px;font-size:11.5px;color:#9ca3af">Encuesta gestionada con <a href="https://acuarius.app" style="color:#9ca3af;font-weight:700;text-decoration:none">Acuarius</a></div>';
  return new Response('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Gracias por tu opinión</title></head>' +
    '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#F6F7FB;color:#14162E;display:flex;align-items:flex-start;justify-content:center;min-height:100vh;padding:40px 16px">' +
    '<div style="background:#fff;border-radius:18px;max-width:440px;width:100%;padding:36px 32px;box-shadow:0 8px 40px rgba(20,22,46,.08);text-align:center">' +
    (cfg ? marca : '') + inner + pie +
    '</div></body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const token = url.searchParams.get('t') || '';

  // ── Todo lo autenticado: configuración de la encuesta y estadísticas ──
  if (!token && (req.method === 'GET' || req.method === 'PUT')) {
    let userId = await getUserId(req);
    if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  // A que cliente esta acotado este miembro. Se lee en la MISMA consulta que
  // ya resolvia al dueno: sin esto habria que preguntarlo otra vez.
  let clienteDelMiembro = null;
    try {
      const tw = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,client_id&limit=1`, { headers: sbHeaders() }).then(r => r.json());
      if (tw?.[0]?.owner_user_id) { userId = tw[0].owner_user_id; clienteDelMiembro = tw[0].client_id || null; }
    } catch {}
    const clientId = clienteDelMiembro || url.searchParams.get('client_id') || null;

    // ── La encuesta: leerla y guardarla ──
    if (url.searchParams.get('config')) {
      return jsonResp({ config: await leerNps(SUPABASE_URL, SUPABASE_KEY, userId, clientId) });
    }
    if (req.method === 'PUT') {
      let body = {};
      try { body = await req.json(); } catch {}
      const limpia = normalizarNps(body.config);
      // Una fila por cuenta con un mapa por cliente dentro, igual que las
      // reseñas: se lee lo que hay y se cambia solo la clave de este cliente.
      const previo = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${NPS_KEY}&select=profile_data&limit=1`,
        { headers: sbHeaders() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      const todo = previo?.[0]?.profile_data || {};
      todo[clientId || '_cuenta'] = limpia;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: userId, agent_key: NPS_KEY, profile_data: todo, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) {
        console.error('[nps] no se pudo guardar:', (await r.text()).slice(0, 200));
        return jsonResp({ error: 'No se pudo guardar la encuesta.' }, 500);
      }
      return jsonResp({ ok: true, config: limpia });
    }

    const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/nps_responses?user_id=eq.${encodeURIComponent(userId)}${scope}&select=score,comment,responded_at,sent_at,lead_id,answers,preguntas&order=sent_at.desc&limit=1000`, { headers: sbHeaders() }).then(r => r.json()).then(r => r || []);
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
    // ── Las preguntas extra, agregadas ──
    // El enunciado sale de la copia que viajó con CADA respuesta, no de la
    // configuración de hoy: así una pregunta reescrita no reetiqueta lo que ya
    // contestó la gente. Si dos textos distintos comparten id, se separan.
    const porPregunta = new Map();
    for (const r of rows) {
      const defs = Array.isArray(r.preguntas) ? r.preguntas : [];
      const resp = r.answers && typeof r.answers === 'object' ? r.answers : {};
      for (const d of defs) {
        const clave = d.id + '|' + d.texto;
        if (!porPregunta.has(clave)) {
          porPregunta.set(clave, { id: d.id, texto: d.texto, tipo: d.tipo, enviadas: 0, respuestas: [] });
        }
        const acc = porPregunta.get(clave);
        acc.enviadas++;
        const v = resp[d.id];
        if (v !== undefined && v !== null && v !== '') acc.respuestas.push({ v, at: r.responded_at, lead_id: r.lead_id });
      }
    }
    const preguntas = [...porPregunta.values()].map(q => {
      const numerica = !!TIPOS_PREGUNTA[q.tipo]?.numerica;
      const base = { id: q.id, texto: q.texto, tipo: q.tipo, enviadas: q.enviadas, respondidas: q.respuestas.length };
      if (!numerica) {
        return { ...base, textos: q.respuestas.slice(0, 20).map(r => ({ texto: String(r.v), at: r.at, lead_id: r.lead_id })) };
      }
      const max = TIPOS_PREGUNTA[q.tipo].max;
      const nums = q.respuestas.map(r => Number(r.v)).filter(n => n >= 1 && n <= max);
      const reparto = Array.from({ length: max }, (_, i) => nums.filter(n => n === i + 1).length);
      return {
        ...base, max, reparto,
        promedio: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null,
      };
    });

    // Nombres para las respuestas de texto, con la misma consulta de antes
    const idsTexto = [...new Set(preguntas.flatMap(q => (q.textos || []).map(t => t.lead_id)).filter(Boolean))];
    if (idsTexto.length) {
      const faltan = idsTexto.filter(id => !names[id]);
      if (faltan.length) {
        const extra = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${faltan.join(',')})&select=id,name`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
        for (const l of (extra || [])) names[l.id] = l.name;
      }
      for (const q of preguntas) for (const t of (q.textos || [])) t.name = names[t.lead_id] || 'Anónimo';
    }

    return jsonResp({
      sent: rows.length, answered: answered.length, promoters, passives, detractors, nps,
      comments: withComment.map(r => ({ score: r.score, comment: r.comment, name: names[r.lead_id] || 'Anónimo', at: r.responded_at })),
      preguntas,
    });
  }

  if (!/^[a-f0-9]{24,64}$/i.test(token)) return page('<div style="font-size:15px;color:#6b7280">Enlace no válido o vencido.</div>');

  const rows = await fetch(`${SUPABASE_URL}/rest/v1/nps_responses?token=eq.${encodeURIComponent(token)}&select=*&limit=1`, { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
  const resp = rows?.[0];
  if (!resp) return page('<div style="font-size:15px;color:#6b7280">Enlace no válido o vencido.</div>');

  // ── POST: comentario opcional ──
  if (req.method === 'POST') {
    const cfg = await leerNps(SUPABASE_URL, SUPABASE_KEY, resp.user_id, resp.client_id || null);
    let body = {};
    try {
      const ct = req.headers.get('content-type') || '';
      body = ct.includes('json') ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()));
    } catch {}
    const comment = String(body.comment || '').trim().slice(0, 600);

    // Las preguntas se guardan contra la copia que viajó con la respuesta, no
    // contra la configuración de hoy: si el cliente reescribe una pregunta
    // mañana, lo contestado ayer seguiría diciendo a qué contestaba.
    const preguntas = Array.isArray(resp.preguntas) && resp.preguntas.length ? resp.preguntas : cfg.preguntas;
    const answers = {};
    for (const p of preguntas) {
      const crudo = body['q_' + p.id];
      if (crudo === undefined || crudo === null || String(crudo).trim() === '') continue;
      if (TIPOS_PREGUNTA[p.tipo]?.numerica) {
        const n = parseInt(crudo, 10);
        const max = TIPOS_PREGUNTA[p.tipo].max;
        if (n >= 1 && n <= max) answers[p.id] = n;
      } else {
        answers[p.id] = String(crudo).trim().slice(0, 600);
      }
    }

    const cambios = {};
    if (comment) cambios.comment = comment;
    if (Object.keys(answers).length) cambios.answers = { ...(resp.answers || {}), ...answers };
    if (Object.keys(cambios).length) {
      await fetch(`${SUPABASE_URL}/rest/v1/nps_responses?id=eq.${resp.id}`, {
        method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(cambios),
      });
    }
    return page('<div style="font-size:42px;margin:10px 0">🙌</div>' +
      '<div style="font-size:17px;font-weight:800;margin-bottom:6px">' + esc(cfg.finalTitulo) + '</div>' +
      '<div style="font-size:14px;color:#6b7280">' + esc(cfg.finalTexto) + '</div>', cfg);
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

  const cfg = await leerNps(SUPABASE_URL, SUPABASE_KEY, resp.user_id, resp.client_id || null);

  // Manda la nota GUARDADA, no la del enlace. Solo cuenta la primera respuesta
  // —insistir cambia el histórico—, así que quien vuelva a pulsar otro número
  // veía «Anotamos tu 10» mientras en la base seguía su 9. La pantalla mentía.
  const nota = first ? score : resp.score;
  const face = nota >= 9 ? '🤩' : nota >= 7 ? '🙂' : '😕';
  // Se contesta sobre la copia que viajó con el envío: si la encuesta cambió
  // entre que se mandó y que la abren, el cliente ve la que le preguntaron.
  const preguntas = Array.isArray(resp.preguntas) && resp.preguntas.length ? resp.preguntas : cfg.preguntas;

  const campoDe = (p) => {
    const req = p.obligatoria ? ' required' : '';
    const etq = '<div style="font-size:13.5px;font-weight:700;text-align:left;margin:16px 0 7px">' + esc(p.texto) +
                (p.obligatoria ? '<span style="color:#EF4444"> *</span>' : '') + '</div>';
    if (TIPOS_PREGUNTA[p.tipo]?.numerica) {
      const max = TIPOS_PREGUNTA[p.tipo].max;
      // Botones de radio disfrazados: sin JavaScript, para que funcionen en
      // cualquier navegador y dentro de cualquier cliente de correo raro.
      const n = Array.from({ length: max }, (_, i) => i + 1).map(v =>
        '<label style="flex:1"><input type="radio" name="q_' + esc(p.id) + '" value="' + v + '"' + req +
        ' style="position:absolute;opacity:0;width:0;height:0">' +
        '<span style="display:block;padding:9px 0;text-align:center;border:1.5px solid #E5E7EB;border-radius:9px;' +
        'font-size:13.5px;font-weight:700;cursor:pointer" onclick="[...this.closest(\'.esc\').querySelectorAll(\'span\')].forEach(s=>{s.style.background=\'\';s.style.color=\'\';s.style.borderColor=\'#E5E7EB\'});' +
        'this.style.background=\'' + cfg.color + '\';this.style.color=\'#fff\';this.style.borderColor=\'' + cfg.color + '\'">' + v + '</span></label>').join('');
      return etq + '<div class="esc" style="display:flex;gap:5px">' + n + '</div>';
    }
    return etq + '<textarea name="q_' + esc(p.id) + '" rows="2"' + req +
      ' style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical"></textarea>';
  };

  return page(
    '<div style="font-size:42px;margin:14px 0 8px">' + face + '</div>' +
    '<div style="font-size:18px;font-weight:800;margin-bottom:4px">' + esc(cfg.gracias.replace('{nota}', nota)) + '</div>' +
    '<div style="font-size:13.5px;color:#6b7280;margin-bottom:4px">' + esc(pieSegunNota(cfg, nota)) + '</div>' +
    '<form method="POST" action="/api/nps?t=' + esc(token) + '">' +
    preguntas.map(campoDe).join('') +
    '<div style="margin-top:16px"><textarea name="comment" rows="3" placeholder="' + esc(cfg.comentarioPlaceholder) + '" style="width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical"></textarea></div>' +
    '<button type="submit" style="margin-top:12px;width:100%;padding:12px;border:none;border-radius:10px;background:' + cfg.color + ';color:#fff;font-size:14.5px;font-weight:800;font-family:inherit;cursor:pointer">' + esc(cfg.boton) + '</button>' +
    '</form>',
    cfg
  );
}
