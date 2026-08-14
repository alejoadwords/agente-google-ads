// api/close-reasons.js
// Catálogo de motivos de cierre (ganada / perdida), editable por cada usuario.
// Se siembran unos por defecto la primera vez que se consultan.
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
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
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
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const DEFAULTS = {
  won: ['Mejor propuesta de valor', 'Precio competitivo', 'Confianza y relación', 'Recomendación de un cliente', 'Urgencia del cliente'],
  lost: ['Precio alto', 'Eligió a la competencia', 'Sin presupuesto', 'No responde', 'No era el perfil', 'Lo dejó para más adelante'],
};
const MAX_REASONS = 30;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: el catálogo de motivos es de la cuenta. Sin esto, un miembro veía
  // uno vacío, se le sembraban los motivos por defecto a su nombre y cerraba
  // negocios con etiquetas distintas a las del resto — sin que nadie lo notara.
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sbHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) userId = tw.owner_user_id;
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const url = new URL(req.url);

  // GET — lista los motivos; siembra los de por defecto la primera vez
  if (req.method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/close_reasons?user_id=eq.${userId}&select=*&order=kind.asc,position.asc`,
      { headers: sbHeaders() }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    let rows = await res.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      const seeds = [];
      for (const kind of ['won', 'lost']) {
        DEFAULTS[kind].forEach((label, i) => seeds.push({ user_id: userId, kind, label, position: i + 1 }));
      }
      const seedRes = await fetch(`${SUPABASE_URL}/rest/v1/close_reasons`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation,resolution=ignore-duplicates' },
        body: JSON.stringify(seeds),
      });
      if (seedRes.ok) {
        rows = await seedRes.json();
        if (!Array.isArray(rows) || rows.length === 0) {
          rows = await fetch(
            `${SUPABASE_URL}/rest/v1/close_reasons?user_id=eq.${userId}&select=*&order=kind.asc,position.asc`,
            { headers: sbHeaders() }
          ).then(r => r.json()).catch(() => []);
        }
      }
    }
    const list = Array.isArray(rows) ? rows : [];
    return jsonResp({
      won: list.filter(r => r.kind === 'won'),
      lost: list.filter(r => r.kind === 'lost'),
    });
  }

  // POST — agrega un motivo nuevo
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const kind = body.kind === 'won' ? 'won' : 'lost';
    const label = String(body.label || '').trim().slice(0, 60);
    if (!label) return jsonResp({ error: 'El motivo necesita un nombre' }, 400);

    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/close_reasons?user_id=eq.${userId}&kind=eq.${kind}&select=id,label,position`,
      { headers: sbHeaders() }
    ).then(r => r.json()).catch(() => []);
    if (Array.isArray(existing) && existing.length >= MAX_REASONS) {
      return jsonResp({ error: `Máximo ${MAX_REASONS} motivos` }, 400);
    }
    const dup = (existing || []).find(r => (r.label || '').toLowerCase() === label.toLowerCase());
    if (dup) return jsonResp({ reason: dup, duplicate: true });

    const maxPos = (existing || []).reduce((m, r) => Math.max(m, r.position || 0), 0);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/close_reasons`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({ user_id: userId, kind, label, position: maxPos + 1 }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ reason: rows[0] });
  }

  // PUT — renombra un motivo
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id } = body;
    const label = String(body.label || '').trim().slice(0, 60);
    if (!id || !label) return jsonResp({ error: 'Faltan datos' }, 400);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/close_reasons?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify({ label }) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    if (!rows.length) return jsonResp({ error: 'Motivo no encontrado' }, 404);
    return jsonResp({ reason: rows[0] });
  }

  // DELETE — quita un motivo del catálogo (los leads ya cerrados conservan el texto)
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/close_reasons?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
