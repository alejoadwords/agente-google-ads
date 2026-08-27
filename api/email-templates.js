// api/email-templates.js
// Plantillas de correo reutilizables. Viven fuera de la campaña a propósito: el
// contenido escrito en el asistente moría con ella y nadie podía partir de algo
// ya aprobado.
//
// Son de la CUENTA, no de quien las escribe: todo el equipo las ve y las usa.
// Editar o borrar sí es de quien la creó (y del dueño o un administrador, que
// mandan sobre todo lo de su cuenta). Un comercial escribiendo su plantilla es
// legítimo; que le borre la suya a otro, no.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

const MAX_HTML = 400_000;   // un correo por encima de esto lo cortan los clientes
const MAX_PLANTILLAS = 300;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const actorId = userId;
  let actorNombre = null, mando = true;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,member_name,member_email,role&limit=1`, { headers: sbHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) {
      userId = tw.owner_user_id;
      actorNombre = tw.member_name || tw.member_email || null;
      mando = tw.role === 'admin';
    }
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const id = url.searchParams.get('id');

    // Una sola, con su diseño: es lo que necesita el constructor al abrirla.
    if (id) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/email_templates?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null&select=*&limit=1`,
        { headers: sbHeaders() }
      );
      if (!r.ok) return jsonResp({ error: await r.text() }, 500);
      const t = (await r.json())?.[0];
      if (!t) return jsonResp({ error: 'No encontrada' }, 404);
      return jsonResp({ plantilla: t, puedo_editar: puedeTocar(t, actorId, mando) });
    }

    // El listado NO trae ni diseno ni html: son campos gordos y en una lista de
    // cien plantillas se descargarían megas para pintar unos nombres.
    let q = `${SUPABASE_URL}/rest/v1/email_templates`
      + `?user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null`
      + `&select=id,nombre,categoria,asunto,descripcion,formato,creado_por,creado_por_nombre,client_id,created_at,updated_at`
      + `&order=updated_at.desc&limit=${MAX_PLANTILLAS}`;
    // Con un cliente activo se ven las suyas Y las generales de la cuenta: una
    // plantilla de marca sirve para todos, y esconderla obligaría a duplicarla.
    if (clientId) q += `&or=(client_id.eq.${encodeURIComponent(clientId)},client_id.is.null)`;

    const r = await fetch(q, { headers: sbHeaders() });
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    const filas = (await r.json()) || [];
    return jsonResp({
      plantillas: filas.map(t => ({ ...t, puedo_editar: puedeTocar(t, actorId, mando) })),
      actor_id: actorId,
    });
  }

  // ── POST ───────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }

    const nombre = String(body.nombre || '').trim();
    if (!nombre) return jsonResp({ error: 'La plantilla necesita un nombre' }, 400);

    const cuantas = await contar(userId);
    if (cuantas >= MAX_PLANTILLAS) {
      return jsonResp({ error: `Has llegado al tope de ${MAX_PLANTILLAS} plantillas. Borra alguna para crear otra.` }, 409);
    }

    const err = revisaTamano(body);
    if (err) return jsonResp({ error: err }, 413);

    const r = await fetch(`${SUPABASE_URL}/rest/v1/email_templates`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        user_id: userId,
        client_id: body.client_id || clientId || null,
        nombre: nombre.slice(0, 120),
        categoria: body.categoria ? String(body.categoria).slice(0, 60) : null,
        asunto: body.asunto ? String(body.asunto).slice(0, 200) : null,
        descripcion: body.descripcion ? String(body.descripcion).slice(0, 500) : null,
        formato: body.formato === 'html' ? 'html' : 'simple',
        diseno: body.diseno || null,
        html: body.html || null,
        contenido: body.contenido || null,
        creado_por: actorId,
        creado_por_nombre: actorNombre,
      }),
    });
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    return jsonResp({ plantilla: (await r.json())[0] }, 201);
  }

  // ── PATCH ──────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);

    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }

    const actual = await unaDe(userId, id);
    if (!actual) return jsonResp({ error: 'No encontrada' }, 404);
    if (!puedeTocar(actual, actorId, mando)) {
      return jsonResp({ error: 'Esta plantilla la creó otra persona. Puedes duplicarla y editar tu copia.' }, 403);
    }

    const err = revisaTamano(body);
    if (err) return jsonResp({ error: err }, 413);

    const patch = { updated_at: new Date().toISOString() };
    if ('nombre' in body) {
      const n = String(body.nombre || '').trim();
      if (!n) return jsonResp({ error: 'La plantilla necesita un nombre' }, 400);
      patch.nombre = n.slice(0, 120);
    }
    if ('categoria' in body)  patch.categoria  = body.categoria ? String(body.categoria).slice(0, 60) : null;
    if ('asunto' in body)     patch.asunto     = body.asunto ? String(body.asunto).slice(0, 200) : null;
    if ('descripcion' in body) patch.descripcion = body.descripcion ? String(body.descripcion).slice(0, 500) : null;
    if ('formato' in body)    patch.formato    = body.formato === 'html' ? 'html' : 'simple';
    if ('diseno' in body)     patch.diseno     = body.diseno || null;
    if ('html' in body)       patch.html       = body.html || null;
    if ('contenido' in body)  patch.contenido  = body.contenido || null;
    if ('client_id' in body)  patch.client_id  = body.client_id || null;

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/email_templates?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(patch) }
    );
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    return jsonResp({ plantilla: (await r.json())[0] });
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  // Borrado suave: una campaña ya enviada puede apuntar a esta plantilla, y
  // dejar ese enlace roto convertiría su historial en un misterio.
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);

    const actual = await unaDe(userId, id);
    if (!actual) return jsonResp({ error: 'No encontrada' }, 404);
    if (!puedeTocar(actual, actorId, mando)) {
      return jsonResp({ error: 'Esta plantilla la creó otra persona.' }, 403);
    }

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/email_templates?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify({ deleted_at: new Date().toISOString() }) }
    );
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}

// ── ayudas ───────────────────────────────────────────────────────────────────

// El dueño y los administradores mandan sobre todo lo de su cuenta. El resto,
// sobre lo suyo. Las plantillas antiguas sin autor quedan a cargo de la
// dirección, que es la salida segura.
function puedeTocar(t, actorId, mando) {
  return mando || (!!t.creado_por && t.creado_por === actorId);
}

async function unaDe(userId, id) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/email_templates?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null&select=id,creado_por&limit=1`,
    { headers: sbHeaders() }
  );
  if (!r.ok) return null;
  return (await r.json())?.[0] || null;
}

async function contar(userId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/email_templates?user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null&select=id`,
    { headers: { ...sbHeaders(), Prefer: 'count=exact', Range: '0-0' } }
  );
  const rango = r.headers.get('content-range') || '';
  return Number(rango.split('/')[1]) || 0;
}

// Un diseño con imágenes pegadas en base64 crece sin avisar hasta que Supabase
// devuelve un error que no dice nada. Mejor cortarlo aquí y explicarlo.
function revisaTamano(body) {
  if (body.html && String(body.html).length > MAX_HTML) {
    return 'El correo pesa demasiado. Sube las imágenes en vez de pegarlas dentro del diseño.';
  }
  if (body.diseno && JSON.stringify(body.diseno).length > MAX_HTML * 2) {
    return 'El diseño pesa demasiado. Sube las imágenes en vez de pegarlas dentro del diseño.';
  }
  return null;
}
