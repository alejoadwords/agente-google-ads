// api/knowledge-sync.js
// Trae el inventario del cliente desde su WordPress y lo guarda, para que el
// agente de WhatsApp pueda responder con lo que EXISTE y no con lo que suena
// bien. Sin esto, la regla de "no inventes" lo deja mudo ante casi todo.
//
// Por qué WordPress y no raspar HTML: certainpezzano.com expone /wp-json con un
// tipo 'propiedades' y taxonomías resueltas (operación, tipo, ciudad, barrio,
// habitaciones, baños, estrato). Es estable. Lo único que NO expone es el
// precio, que hay que leer de la ficha — y eso es lo que hace la sincronización
// lenta, así que va por lotes.
//
// El area se descarta a proposito: al leerla de la ficha salian valores
// absurdos (10.086 m2 para un apartamento). Un metraje falso es peor que
// ninguno.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const UA = { 'User-Agent': 'Acuarius/1.0 (+https://acuarius.app)' };

// Cuántas fichas se leen por ejecución. Cada una tarda ~2s, así que 40 deja la
// llamada en torno al minuto y medio: cabe de sobra y no castiga la web ajena.
const LOTE = 40;

const TAXONOMIAS = ['ciudad', 'barrios', 'habitaciones', 'banos', 'estrato', 'tipo-de-inmmueble', 'estado-del-inmueble'];

function sb() {
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
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, data)) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const num = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

async function terminos(base, tax) {
  const mapa = new Map();
  for (let p = 1; p <= 10; p++) {
    const r = await fetch(`${base}/wp-json/wp/v2/${tax}?per_page=100&page=${p}`, { headers: UA });
    if (!r.ok) break;
    const filas = await r.json().catch(() => []);
    if (!Array.isArray(filas) || !filas.length) break;
    filas.forEach(t => mapa.set(t.id, t.name));
    if (filas.length < 100) break;
  }
  return mapa;
}

// El precio no está en el API: se lee de la ficha. Se coge el MAYOR importe
// creíble de la página — los menores suelen ser administración o cuotas.
async function precioDeFicha(url) {
  try {
    const html = await fetch(url, { headers: UA }).then(r => r.text());
    const importes = [...html.matchAll(/\$\s?([\d.,]{6,})/g)]
      .map(m => num(m[1]))
      .filter(n => n && n >= 200000 && n < 100000000000);
    return importes.length ? Math.max(...importes) : null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    return await manejar(req);
  } catch (e) {
    return jsonResp({ error: 'Error sincronizando: ' + (e?.message || 'desconocido') }, 500);
  }
}

async function manejar(req) {
  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`, { headers: sb() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) userId = tw.owner_user_id;
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || '';
  if (!clientId) return jsonResp({ error: 'Falta el cliente' }, 400);

  const filtroFuente = `user_id=eq.${encodeURIComponent(userId)}&client_id=eq.${encodeURIComponent(clientId)}`;

  // ── Estado: qué fuente hay y cuántas propiedades ──────────────────────────
  if (req.method === 'GET') {
    const fuente = await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?${filtroFuente}&select=*&limit=1`, { headers: sb() })
      .then(r => (r.ok ? r.json() : [])).then(r => r?.[0] || null).catch(() => null);
    const total = await fetch(`${SUPABASE_URL}/rest/v1/client_properties?${filtroFuente}&select=id`,
      { headers: { ...sb(), 'Prefer': 'count=exact', 'Range': '0-0' } })
      .then(r => (r.headers.get('content-range') || '').split('/')[1]).catch(() => null);
    return jsonResp({ fuente, propiedades: parseInt(total || '0', 10) || 0 });
  }

  // ── Guardar la web de la que se lee ───────────────────────────────────────
  if (req.method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    let base = String(body.base_url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return jsonResp({ error: 'La dirección debe empezar por https://' }, 400);

    // Se comprueba ANTES de guardar: una fuente que no responde guardada como
    // buena es una sincronización que fallara cada noche sin que nadie mire.
    const prueba = await fetch(`${base}/wp-json/wp/v2/propiedades?per_page=1`, { headers: UA }).catch(() => null);
    if (!prueba || !prueba.ok) {
      return jsonResp({ error: 'Esa dirección no expone el listado de propiedades de WordPress. ' +
        'Comprueba que sea el dominio del sitio, sin ruta.' }, 400);
    }
    const total = parseInt(prueba.headers.get('x-wp-total') || '0', 10) || 0;
    if (!total) return jsonResp({ error: 'La web respondió pero no tiene ninguna propiedad publicada.' }, 400);

    const previa = await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?${filtroFuente}&select=id&limit=1`, { headers: sb() })
      .then(r => (r.ok ? r.json() : [])).catch(() => []);
    const fila = { user_id: userId, client_id: clientId, tipo: 'wordpress', base_url: base, activo: true, cursor_pagina: 1 };
    const res = previa?.[0]?.id
      ? await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?id=eq.${previa[0].id}`, { method: 'PATCH', headers: sb(), body: JSON.stringify(fila) })
      : await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources`, { method: 'POST', headers: sb(), body: JSON.stringify(fila) });
    if (!res.ok) return jsonResp({ error: 'No se pudo guardar: ' + (await res.text()).slice(0, 200) }, 500);
    return jsonResp({ fuente: (await res.json())?.[0] || null, propiedades_en_web: total });
  }

  // ── Sincronizar un lote ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const fuente = await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?${filtroFuente}&select=*&limit=1`, { headers: sb() })
      .then(r => (r.ok ? r.json() : [])).then(r => r?.[0] || null).catch(() => null);
    if (!fuente) return jsonResp({ error: 'Este cliente no tiene web configurada todavía' }, 404);

    const base = fuente.base_url;
    const pagina = Math.max(1, fuente.cursor_pagina || 1);

    const listado = await fetch(`${base}/wp-json/wp/v2/propiedades?per_page=${LOTE}&page=${pagina}&orderby=modified&order=desc`, { headers: UA });
    if (!listado.ok) {
      await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?id=eq.${fuente.id}`, {
        method: 'PATCH', headers: sb(),
        body: JSON.stringify({ ultimo_estado: 'error', ultimo_error: 'La web respondió ' + listado.status, ultimo_sync: new Date().toISOString() }),
      });
      return jsonResp({ error: 'La web respondió ' + listado.status }, 502);
    }
    const totalPaginas = parseInt(listado.headers.get('x-wp-totalpages') || '1', 10) || 1;
    const props = await listado.json().catch(() => []);

    const mapas = {};
    for (const t of TAXONOMIAS) mapas[t] = await terminos(base, t);
    const uno = (tax, arr) => (arr || []).map(id => mapas[tax].get(id)).filter(Boolean)[0] || null;

    const filas = [];
    for (const p of props) {
      const codigo = String((p.title?.rendered || '')).replace(/<[^>]*>/g, '').trim();
      if (!codigo) continue;
      filas.push({
        user_id: userId, client_id: clientId, codigo,
        operacion: uno('estado-del-inmueble', p['estado-del-inmueble']),
        tipo: uno('tipo-de-inmmueble', p['tipo-de-inmmueble']),
        ciudad: uno('ciudad', p.ciudad),
        barrio: uno('barrios', p.barrios),
        habitaciones: num(uno('habitaciones', p.habitaciones)),
        banos: num(uno('banos', p.banos)),
        estrato: num(uno('estrato', p.estrato)),
        precio: await precioDeFicha(p.link),
        url: p.link,
        modificado: p.modified ? new Date(p.modified).toISOString() : null,
        visto_en: new Date().toISOString(),
      });
    }

    if (filas.length) {
      const up = await fetch(`${SUPABASE_URL}/rest/v1/client_properties?on_conflict=user_id,client_id,codigo`, {
        method: 'POST',
        headers: { ...sb(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(filas),
      });
      if (!up.ok) {
        const det = await up.text().catch(() => '');
        await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?id=eq.${fuente.id}`, {
          method: 'PATCH', headers: sb(),
          body: JSON.stringify({ ultimo_estado: 'error', ultimo_error: det.slice(0, 300), ultimo_sync: new Date().toISOString() }),
        });
        return jsonResp({ error: 'No se pudieron guardar las propiedades: ' + det.slice(0, 300) }, 500);
      }
    }

    const siguiente = pagina >= totalPaginas ? 1 : pagina + 1;
    const terminado = pagina >= totalPaginas;
    await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?id=eq.${fuente.id}`, {
      method: 'PATCH', headers: sb(),
      body: JSON.stringify({
        cursor_pagina: siguiente,
        ultimo_sync: new Date().toISOString(),
        ultimo_estado: terminado ? 'ok' : 'en_curso',
        ultimo_error: null,
      }),
    });

    return jsonResp({
      guardadas: filas.length, pagina, de: totalPaginas, terminado,
      sin_precio: filas.filter(f => !f.precio).length,
    });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
