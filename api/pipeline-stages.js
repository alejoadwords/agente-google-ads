export const config = { runtime: 'edge' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Estas tres etapas tienen significado para el resto de la plataforma: una propuesta
// pagada y el webhook de MercadoPago mueven el lead a 'ganado', el motor de
// automatizaciones usa 'ganado'/'perdido' para saber qué leads están cerrados y el
// módulo de Análisis calcula con ellas la tasa de cierre. Se pueden renombrar,
// recolorear y reordenar, pero no eliminar.
const PROTECTED_KEYS = ['nuevo', 'ganado', 'perdido'];
const MAX_STAGES = 12;

function uniqueKey(label, taken) {
  const base = label.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'etapa';
  let key = base;
  let n = 2;
  while (taken.has(key) || PROTECTED_KEYS.includes(key)) key = `${base}-${n++}`;
  return key;
}

const DEFAULT_STAGES = [
  { key: 'nuevo',       label: 'Nuevo',        color: '#6B7280', position: 1 },
  { key: 'contactado',  label: 'Contactado',   color: '#3B82F6', position: 2 },
  { key: 'calificado',  label: 'Calificado',   color: '#8B5CF6', position: 3 },
  { key: 'propuesta',   label: 'Propuesta',    color: '#F59E0B', position: 4 },
  { key: 'negociacion', label: 'Negociación',  color: '#EF4444', position: 5 },
  { key: 'ganado',      label: 'Ganado',       color: '#10B981', position: 6 },
  { key: 'perdido',     label: 'Perdido',      color: '#9CA3AF', position: 7 },
];


// La columna probability se añadió después; si la base aún no la tiene, se
// reintenta sin ella en vez de romper el guardado del pipeline.
async function patchStage(url, update) {
  let res = await fetch(url, { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) });
  if (!res.ok && update.probability !== undefined) {
    const txt = await res.clone().text().catch(() => '');
    if (txt.includes('probability')) {
      const { probability, ...rest } = update;
      if (!Object.keys(rest).length) return null;
      res = await fetch(url, { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(rest) });
    }
  }
  return res;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);


  // GET — list stages (global per user, not per client)
  if (req.method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_stages?user_id=eq.${userId}&select=*&order=position.asc`,
      { headers: sbHeaders() }
    );
    let rows = await res.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      // Seed defaults — upsert to avoid duplicates on concurrent requests
      const seeds = DEFAULT_STAGES.map(s => ({
        user_id: userId,
        key: s.key,
        label: s.label,
        color: s.color,
        position: s.position,
      }));
      const seedHeaders = {
        ...sbHeaders(),
        'Prefer': 'return=representation,resolution=ignore-duplicates',
      };
      const seedRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_stages`, {
        method: 'POST',
        headers: seedHeaders,
        body: JSON.stringify(seeds),
      });
      if (seedRes.ok) {
        rows = await seedRes.json();
        // If upsert returned nothing (all were duplicates), re-fetch
        if (!Array.isArray(rows) || rows.length === 0) {
          const refetch = await fetch(
            `${SUPABASE_URL}/rest/v1/pipeline_stages?user_id=eq.${userId}&select=*&order=position.asc`,
            { headers: sbHeaders() }
          );
          rows = await refetch.json();
        }
      }
    }

    // De-duplicate by key in case the table has dirty data
    const seen = new Set();
    const deduped = Array.isArray(rows) ? rows.filter(r => {
      if (seen.has(r.key)) return false;
      seen.add(r.key);
      return true;
    }) : [];

    return jsonResp({ stages: deduped });
  }

  const url = new URL(req.url);

  // PUT — update a single stage (label, color) o reordenar todo el pipeline
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }

    // Reordenar: {order: [id1, id2, ...]} — la posición es el índice en el array
    if (Array.isArray(body.order)) {
      const owned = await fetch(
        `${SUPABASE_URL}/rest/v1/pipeline_stages?user_id=eq.${userId}&select=id`,
        { headers: sbHeaders() }
      ).then(r => r.json()).catch(() => []);
      const ownedIds = new Set((owned || []).map(r => r.id));
      const ids = body.order.filter(id => ownedIds.has(id));
      for (let i = 0; i < ids.length; i++) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/pipeline_stages?id=eq.${ids[i]}&user_id=eq.${userId}`,
          { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify({ position: i + 1 }) }
        );
      }
      return jsonResp({ ok: true, reordered: ids.length });
    }

    const { id, label, color } = body;
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const update = {};
    if (label) update.label = label.trim().slice(0, 40);
    if (color) update.color = color;
    if (body.probability !== undefined) {
      update.probability = body.probability === null ? null
        : Math.max(0, Math.min(100, Math.round(Number(body.probability) || 0)));
    }
    if (!Object.keys(update).length) return jsonResp({ error: 'Nada que actualizar' }, 400);
    const res = await patchStage(`${SUPABASE_URL}/rest/v1/pipeline_stages?id=eq.${id}&user_id=eq.${userId}`, update);
    if (!res) return jsonResp({ error: 'Nada que actualizar' }, 400);
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    if (!rows.length) return jsonResp({ error: 'Etapa no encontrada' }, 404);
    return jsonResp({ stage: rows[0] });
  }

  // POST — crear una etapa nueva
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const label = String(body.label || '').trim().slice(0, 40);
    if (!label) return jsonResp({ error: 'La etapa necesita un nombre' }, 400);

    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_stages?user_id=eq.${userId}&select=key,position`,
      { headers: sbHeaders() }
    ).then(r => r.json()).catch(() => []);
    if (Array.isArray(existing) && existing.length >= MAX_STAGES) {
      return jsonResp({ error: `Máximo ${MAX_STAGES} etapas por pipeline` }, 400);
    }

    const key = uniqueKey(label, new Set((existing || []).map(s => s.key)));
    const maxPos = (existing || []).reduce((m, s) => Math.max(m, s.position || 0), 0);
    const payload = {
      user_id: userId,
      key,
      label,
      color: /^#[0-9A-Fa-f]{6}$/.test(body.color || '') ? body.color : '#6B7280',
      position: Number.isFinite(body.position) ? body.position : maxPos + 1,
    };
    if (Number.isFinite(body.probability)) payload.probability = Math.max(0, Math.min(100, Math.round(body.probability)));
    let res = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_stages`, {
      method: 'POST', headers: sbHeaders(), body: JSON.stringify(payload),
    });
    if (!res.ok && payload.probability !== undefined) {
      const txt = await res.clone().text().catch(() => '');
      if (txt.includes('probability')) {
        const { probability, ...rest } = payload;
        res = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_stages`, {
          method: 'POST', headers: sbHeaders(), body: JSON.stringify(rest),
        });
      }
    }
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ stage: rows[0] });
  }

  // DELETE — borrar una etapa y mover sus leads a otra
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const moveTo = url.searchParams.get('move_to');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);

    const all = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_stages?user_id=eq.${userId}&select=id,key&order=position.asc`,
      { headers: sbHeaders() }
    ).then(r => r.json()).catch(() => []);
    const target = (all || []).find(s => s.id === id);
    if (!target) return jsonResp({ error: 'Etapa no encontrada' }, 404);
    if (PROTECTED_KEYS.includes(target.key)) {
      return jsonResp({ error: 'Esta etapa es parte del sistema: puedes renombrarla o moverla, pero no eliminarla.' }, 400);
    }
    if ((all || []).length <= 2) return jsonResp({ error: 'El pipeline necesita al menos 2 etapas' }, 400);

    // Los leads que estén en la etapa borrada se mueven a otra; nunca se pierden
    const dest = (all || []).find(s => s.key === moveTo && s.id !== id)
              || (all || []).find(s => s.key === 'nuevo' && s.id !== id)
              || (all || []).find(s => s.id !== id);
    const moved = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}&stage=eq.${encodeURIComponent(target.key)}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify({ stage: dest.key, updated_at: new Date().toISOString() }),
      }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    const del = await fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_stages?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    if (!del.ok) return jsonResp({ error: await del.text() }, 500);
    return jsonResp({ ok: true, moved: Array.isArray(moved) ? moved.length : 0, moved_to: dest.key });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
