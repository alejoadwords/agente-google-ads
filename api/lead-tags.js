// api/lead-tags.js
// Catálogo de etiquetas del CRM: nombre normalizado, color de la paleta de
// marca (asignado por hash — cero fricción) y tipo (manual | auto).
// Las etiquetas de cada lead viven en leads.tags (text[]); este catálogo es
// la fuente de colores, autocompletado y gestión.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TAG_PALETTE = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EC4899','#14B8A6','#EF4444','#6366F1','#84CC16','#F97316'];

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

// Normalización canónica — la misma en toda la app: minúsculas, espacios
// colapsados, máx 30 chars. Evita duplicados tipo "VIP"/"vip"/" vip ".
function normalizeTag(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
}

function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: si soy miembro activo de un workspace, opero sobre los datos del dueño
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sbHeaders() });
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) userId = _tw.owner_user_id;
  } catch {}


  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;
  const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';

  if (req.method === 'GET') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_tags?user_id=eq.${encodeURIComponent(userId)}${scope}&select=*&order=name.asc`, { headers: sbHeaders() });
    return jsonResp({ tags: (await res.json()) || [] });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const name = normalizeTag(body.name);
    if (name.length < 2) return jsonResp({ error: 'La etiqueta necesita al menos 2 caracteres' }, 400);
    const kind = body.kind === 'auto' ? 'auto' : 'manual';
    // ¿Ya existe? — devolverla (idempotente)
    const exRes = await fetch(`${SUPABASE_URL}/rest/v1/lead_tags?user_id=eq.${encodeURIComponent(userId)}${scope}&name=eq.${encodeURIComponent(name)}&select=*&limit=1`, { headers: sbHeaders() });
    const existing = (await exRes.json()) || [];
    if (existing.length) return jsonResp({ tag: existing[0], existed: true });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_tags`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({ user_id: userId, client_id: clientId, name, color: colorFor(name), kind }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ tag: rows[0] }, 201);
  }

  // DELETE ?id= — quita la etiqueta del catálogo y de los leads que la llevan.
  //
  // Las etiquetas viven en DOS sitios: este catálogo y el array `tags` de cada
  // lead. Borrar solo aquí dejaba la etiqueta pegada a los leads y el filtro la
  // seguía mostrando —porque une catálogo y etiquetas en uso—, así que el
  // usuario veía que "no se borró".
  //
  // El barrido va por tandas y devuelve cuántos leads quedan: una cuenta con
  // miles de leads etiquetados no cabe en una sola invocación edge. Quien llama
  // repite mientras `restantes` sea mayor que cero.
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);

    const fila = await fetch(
      `${SUPABASE_URL}/rest/v1/lead_tags?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}&select=name,client_id&limit=1`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    const nombre = fila?.[0]?.name;
    if (!nombre) return jsonResp({ error: 'Etiqueta no encontrada' }, 404);

    // El catálogo guarda una fila POR CLIENTE, así que dos clientes de una misma
    // agencia pueden tener "vip" cada uno. El barrido va limitado al ámbito de
    // ESTA etiqueta: sin esto, borrarla en un cliente se la quitaba a los leads
    // del otro.
    const ambito = fila[0].client_id
      ? `&client_id=eq.${encodeURIComponent(fila[0].client_id)}`
      : '&client_id=is.null';

    const TANDA = 200;
    const conLaEtiqueta = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}${ambito}` +
      `&tags=cs.{${encodeURIComponent(nombre)}}&select=id,tags&limit=${TANDA}`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);

    let limpiados = 0;
    for (const lead of conLaEtiqueta || []) {
      const restantes = (lead.tags || []).filter(t => t !== nombre);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ tags: restantes }),
      });
      if (r.ok) limpiados++;
    }

    // ¿Quedan más? Si la tanda vino llena, es muy probable que sí.
    const quedan = (conLaEtiqueta || []).length === TANDA;
    if (quedan) return jsonResp({ ok: false, limpiados, restantes: true });

    // Solo cuando no queda ninguno se retira del catálogo: si se borrara antes y
    // el barrido fallara a medias, la etiqueta quedaría huérfana en los leads
    // sin forma de volver a intentarlo desde la interfaz.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lead_tags?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ ok: true, limpiados, restantes: false });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
