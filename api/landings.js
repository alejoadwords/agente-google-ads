// api/landings.js
// Páginas de aterrizaje. Módulo deliberadamente autocontenido: tabla propia,
// endpoint propio y vista propia. Si un día se decide que sobra, se quita
// entero sin desenredarlo del resto.
//
//   GET  ?id=…              → una página CON su contenido (la abre el editor)
//   GET                     → mis páginas (sin html/css: pesan)
//   POST                    → crear
//   PUT                     → guardar / publicar
//   DELETE ?id=             → borrar
//
// La página PÚBLICA no se sirve desde aquí: la arma api/l.js, que la devuelve
// ya montada para que WhatsApp y Facebook vean título, descripción e imagen al
// compartir el enlace. Sus robots no ejecutan JavaScript.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=representation' };
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
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
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then((r) => r.json());
    const key = jwks.keys?.find((k) => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, new TextEncoder().encode(`${hB64}.${pB64}`)))) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

// El slug va en la URL pública, así que se limpia a conciencia: minúsculas,
// sin acentos ni símbolos. Un slug con espacios rompe el enlace que el cliente
// pega en su anuncio, y eso se descubre tarde y mal.
function limpiarSlug(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'pagina';
}

export default async function handler(req, contexto) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Una sola página, CON su contenido. La lista no lo devuelve porque el html
  // de cada página pesa y multiplicado por veinte hace la vista lenta; el
  // editor tiene que pedirlo aparte.
  if (req.method === 'GET' && url.searchParams.get('id')) {
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/landings?id=eq.${url.searchParams.get('id')}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
      { headers: sbHeaders() }
    ).then((r) => (r.ok ? r.json() : []));
    if (!filas.length) return jsonResp({ error: 'Página no encontrada' }, 404);
    return jsonResp({ pagina: filas[0] });
  }

  if (req.method === 'GET') {
    const clientId = url.searchParams.get('client_id');
    const alcance = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '';
    const filas = await fetch(
      `${SUPABASE_URL}/rest/v1/landings?user_id=eq.${encodeURIComponent(userId)}${alcance}&select=id,slug,title,published,visits,form_token,plantilla,updated_at&order=updated_at.desc`,
      { headers: sbHeaders() }
    ).then((r) => (r.ok ? r.json() : []));
    return jsonResp({ paginas: filas || [] });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const titulo = String(body?.title || '').trim().slice(0, 120) || 'Página sin título';
    let base = limpiarSlug(body?.slug || titulo);
    // Un slug repetido daría 409 y el usuario vería «error» sin entender nada;
    // se le añade un sufijo corto y sigue adelante.
    const existe = await fetch(
      `${SUPABASE_URL}/rest/v1/landings?slug=eq.${encodeURIComponent(base)}&select=id&limit=1`,
      { headers: sbHeaders() }
    ).then((r) => (r.ok ? r.json() : []));
    if (existe?.length) base += '-' + Math.random().toString(36).slice(2, 6);

    const r = await fetch(`${SUPABASE_URL}/rest/v1/landings`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({
        user_id: userId,
        client_id: body?.client_id || null,
        slug: base, title: titulo,
        html: body?.html || '', css: body?.css || '',
        form_token: body?.form_token || null,
        plantilla: body?.plantilla || null,
        published: false,
      }),
    });
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    return jsonResp({ pagina: (await r.json())[0] }, 201);
  }

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body?.id) return jsonResp({ error: 'Falta id' }, 400);

    // Al publicar, si la página no tiene formulario todavía, se le crea uno
    // solo. Publicar una landing cuyo formulario no guarda nada es el peor
    // fallo posible aquí: el cliente paga anuncios y los leads se pierden sin
    // que nadie se entere. Se puede cambiar después por otro existente.
    if (body.published === true && !body.form_token) {
      const actual = await fetch(
        `${SUPABASE_URL}/rest/v1/landings?id=eq.${body.id}&user_id=eq.${encodeURIComponent(userId)}&select=form_token,title,client_id`,
        { headers: sbHeaders() }
      ).then((r) => (r.ok ? r.json() : [])).then((f) => f?.[0]);
      if (actual && !actual.form_token) {
        try {
          const token = crypto.randomUUID().replace(/-/g, '');
          const nuevo = await fetch(`${SUPABASE_URL}/rest/v1/lead_forms`, {
            method: 'POST', headers: sbHeaders(),
            body: JSON.stringify({
              user_id: userId, client_id: actual.client_id || null, token, active: true, submissions: 0,
              name: 'Página: ' + (body.title || actual.title || 'sin título'),
              fields: [
                { key: 'nombre', label: 'Nombre', type: 'text', required: true },
                { key: 'email', label: 'Email', type: 'email', required: false },
                { key: 'telefono', label: 'Teléfono / WhatsApp', type: 'tel', required: false },
                { key: 'mensaje', label: 'Mensaje', type: 'textarea', required: false },
              ],
            }),
          });
          if (nuevo.ok) body.form_token = token;
        } catch (e) { console.error('[landings] no se pudo crear el formulario:', e.message); }
      }
    }

    const campos = {};
    for (const k of ['title', 'html', 'css', 'form_token', 'published', 'plantilla', 'settings']) {
      if (body[k] !== undefined) campos[k] = body[k];
    }
    if (body.slug !== undefined) {
      const nuevo = limpiarSlug(body.slug);
      const ocupado = await fetch(
        `${SUPABASE_URL}/rest/v1/landings?slug=eq.${encodeURIComponent(nuevo)}&id=neq.${body.id}&select=id&limit=1`,
        { headers: sbHeaders() }
      ).then((r) => (r.ok ? r.json() : []));
      if (ocupado?.length) return jsonResp({ error: 'Esa dirección ya la usa otra página. Prueba con otra.' }, 409);
      campos.slug = nuevo;
    }
    campos.updated_at = new Date().toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/landings?id=eq.${body.id}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(campos) }
    );
    if (!r.ok) return jsonResp({ error: await r.text() }, 500);
    const filas = await r.json();
    if (!filas.length) return jsonResp({ error: 'Página no encontrada' }, 404);
    return jsonResp({ pagina: filas[0] });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/landings?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE', headers: sbHeaders(),
    });
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
