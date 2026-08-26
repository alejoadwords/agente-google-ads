// api/lead-sources.js
// Fuentes de lead. Las seis de siempre viven en el código y no se pueden
// borrar: otros módulos las usan por su clave (el conector web manda 'web', el
// importador manda 'importacion', las automatizaciones filtran por fuente). Las
// que añada cada cuenta se guardan en lead_sources, con el mismo diseño que
// lead_tags: por usuario y, opcionalmente, por cliente.
//
// Si la migración aún no se ha corrido, se devuelven solo las de por defecto y
// la app sigue funcionando igual que antes: el orden de despliegue no importa.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const MAX_FUENTES = 30;

// Las de siempre. 'key' es lo que se guarda en leads.source.
export const FUENTES_BASE = [
  { key: 'manual',      label: 'Manual' },
  { key: 'meta_ads',    label: 'Meta Ads' },
  { key: 'google_ads',  label: 'Google Ads' },
  { key: 'organico',    label: 'Orgánico' },
  { key: 'referido',    label: 'Referido' },
  { key: 'web',         label: 'Web' },
];

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
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data)) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Clave a partir del nombre: minúsculas, sin acentos, con guion bajo. Es lo que
// queda escrito en leads.source para siempre, así que se genera una vez y no
// se toca aunque luego se renombre la etiqueta visible.
function claveDe(label) {
  return String(label || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

// Devuelve { falta: true } si la tabla todavía no existe (migración pendiente)
async function sb(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method, headers: sbHeaders(), body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (res.status === 404 || txt.includes('42P01') || txt.includes('does not exist')) return { falta: true };
    let detalle = txt;
    try {
      const j = JSON.parse(txt);
      detalle = [j.code && '[' + j.code + ']', j.message, j.details, j.hint].filter(Boolean).join(' ') || txt;
    } catch {}
    throw new Error(detalle || ('HTTP ' + res.status));
  }
  const txt = await res.text();
  return { data: txt ? JSON.parse(txt) : null };
}

function ambito(clientId) {
  return clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    return await manejar(req);
  } catch (e) {
    return jsonResp({ error: 'Error en la base de datos: ' + (e?.message || 'desconocido') }, 500);
  }
}

async function manejar(req) {
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: un miembro trabaja sobre las fuentes del dueño. Si la consulta
  // falla no se sigue: operar con la identidad equivocada devolvería las
  // fuentes de otra cuenta.
  let esMiembro = false, rolMiembro = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,role&limit=1`, { headers: sbHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) { userId = tw.owner_user_id; esMiembro = true; rolMiembro = tw.role || 'vendedor'; }
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  // Ver el catálogo es de todo el equipo; cambiarlo, no. Un comercial que
  // renombra o borra una entrada se la cambia a TODA la cuenta y descuadra los
  // informes de los demás. La regla vive aquí, no solo en la interfaz: ocultar
  // un botón no impide una llamada directa.
  if (esMiembro && rolMiembro !== 'admin' && req.method !== 'GET') {
    return jsonResp({ error: 'Solo el administrador de la cuenta puede cambiar esta lista.' }, 403);
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;

  // ── Listar: las de por defecto + las de la cuenta ─────────────────────────
  if (req.method === 'GET') {
    const r = await sb(`/lead_sources?user_id=eq.${userId}${ambito(clientId)}&select=*&order=position.asc`);
    if (r.falta) return jsonResp({ sources: FUENTES_BASE, propias: [], migracion_pendiente: true });
    const propias = (r.data || []).map(f => ({ key: f.key, label: f.label, id: f.id, propia: true }));
    return jsonResp({ sources: [...FUENTES_BASE, ...propias], propias, max: MAX_FUENTES });
  }

  // ── Crear ────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const label = String(body.label || '').trim().slice(0, 40);
    if (!label) return jsonResp({ error: 'Ponle un nombre a la fuente' }, 400);
    const key = claveDe(label);
    if (!key) return jsonResp({ error: 'Ese nombre no sirve como fuente: usa letras o números' }, 400);
    if (FUENTES_BASE.some(f => f.key === key)) {
      return jsonResp({ error: '«' + label + '» ya existe como fuente por defecto' }, 409);
    }

    const r = await sb(`/lead_sources?user_id=eq.${userId}${ambito(clientId)}&select=id,key,position`);
    if (r.falta) return jsonResp({ error: 'Falta correr la migración de fuentes en la base de datos', migracion_pendiente: true }, 409);
    const actuales = r.data || [];
    if (actuales.some(f => f.key === key)) return jsonResp({ error: 'Ya tienes una fuente con ese nombre' }, 409);
    if (actuales.length >= MAX_FUENTES) {
      return jsonResp({ error: `Llegaste al máximo de ${MAX_FUENTES} fuentes propias.`, limite: true }, 403);
    }
    const pos = actuales.reduce((m, f) => Math.max(m, f.position || 0), 0) + 1;
    const creada = await sb('/lead_sources', 'POST', {
      user_id: userId, client_id: clientId, key, label, position: pos,
    });
    if (creada.falta) return jsonResp({ error: 'Falta correr la migración', migracion_pendiente: true }, 409);
    return jsonResp({ source: creada.data?.[0] || null });
  }

  // ── Borrar ───────────────────────────────────────────────────────────────
  // Los leads que ya la usan NO se tocan: se quedan con su clave y la pantalla
  // la muestra tal cual. Borrar la fuente solo la quita de las opciones.
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta el id de la fuente' }, 400);
    const mia = await sb(`/lead_sources?id=eq.${id}&user_id=eq.${userId}&select=key`);
    if (mia.falta || !mia.data?.length) return jsonResp({ error: 'Fuente no encontrada' }, 404);
    const usados = await sb(`/leads?user_id=eq.${userId}&source=eq.${encodeURIComponent(mia.data[0].key)}&deleted_at=is.null&select=id&limit=1`);
    await sb(`/lead_sources?id=eq.${id}&user_id=eq.${userId}`, 'DELETE');
    return jsonResp({ ok: true, en_uso: !!(usados.data || []).length });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
