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

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { sincronizarLote, UA } from './_catalogo.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
// ── Deteccion automatica del sitio ──────────────────────────────────────────
// El conector no puede estar atado a como llama Certain a sus campos: otra
// inmobiliaria usara otros nombres. Se inspecciona el sitio, se propone que es
// cada cosa y el usuario lo confirma. Eso es lo que hace que pegar la URL
// funcione para cualquier WordPress.
const NO_SON = new Set(['post','page','attachment','nav_menu_item','wp_block','wp_template','wp_template_part',
  'wp_global_styles','wp_navigation','wp_font_family','wp_font_face','e-floating-buttons']);
const PISTAS_TIPO = ['propiedad','inmueble','property','listing','proyecto','apartament','casa'];

// Qué rol juega cada taxonomía, por el nombre y por los valores que contiene
const ROLES = [
  { rol: 'operacion',    nombres: ['estado-del-inmueble','operacion','operation','tipo-de-operacion','status'],
    valores: ['arriendo','venta','alquiler','renta','sale','rent'] },
  { rol: 'tipo',         nombres: ['tipo-de-inmmueble','tipo-de-inmueble','tipo','property-type','tipo-propiedad'],
    valores: ['apartamento','casa','local','oficina','lote','bodega','finca'] },
  { rol: 'ciudad',       nombres: ['ciudad','city','municipio'], valores: [] },
  { rol: 'barrio',       nombres: ['barrios','barrio','zona','sector','neighborhood'], valores: [] },
  { rol: 'habitaciones', nombres: ['habitaciones','habitacion','alcobas','cuartos','bedrooms','rooms'], valores: [] },
  { rol: 'banos',        nombres: ['banos','baños','bathrooms'], valores: [] },
  { rol: 'estrato',      nombres: ['estrato','stratum'], valores: [] },
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function jsonDe(u) { const r = await fetch(u, { headers: UA }); return r.ok ? r.json() : null; }

async function detectar(base) {
  base = base.replace(/\/+$/, '');
  const tipos = await jsonDe(`${base}/wp-json/wp/v2/types`);
  if (!tipos) return { error: 'No responde la API de WordPress en esa dirección' };

  // 1. Elegir el tipo de contenido: primero por nombre, y si no, el que más registros tenga
  const candidatos = Object.keys(tipos).filter(k => !NO_SON.has(k) && !k.startsWith('wp_') && !k.startsWith('elementor') && !k.startsWith('jet') && !k.startsWith('elementskit'));
  const puntuados = [];
  for (const k of candidatos) {
    const rb = tipos[k].rest_base || k;
    const r = await fetch(`${base}/wp-json/wp/v2/${rb}?per_page=1`, { headers: UA }).catch(() => null);
    if (!r || !r.ok) continue;
    const total = parseInt(r.headers.get('x-wp-total') || '0', 10) || 0;
    const porNombre = PISTAS_TIPO.some(p => norm(k).includes(p) || norm(tipos[k].name).includes(p)) ? 1000 : 0;
    puntuados.push({ clave: k, rest_base: rb, nombre: tipos[k].name, total, punt: porNombre + total });
  }
  puntuados.sort((a, b) => b.punt - a.punt);
  const elegido = puntuados[0];
  if (!elegido || !elegido.total) return { error: 'No se encontró ningún listado de propiedades publicado' };

  // 2. Qué taxonomías usa, y qué papel juega cada una
  const muestra = (await jsonDe(`${base}/wp-json/wp/v2/${elegido.rest_base}?per_page=1`))?.[0] || {};
  const posibles = Object.keys(muestra).filter(k => Array.isArray(muestra[k]) && k !== 'class_list');
  const taxonomias = await jsonDe(`${base}/wp-json/wp/v2/taxonomies`) || {};

  const campos = [];
  const crudos = [];
  for (const k of posibles) {
    const rb = taxonomias[k]?.rest_base || k;
    const terms = await jsonDe(`${base}/wp-json/wp/v2/${rb}?per_page=20`) || [];
    crudos.push({ clave: k, etiqueta: taxonomias[k]?.name || k, terms: terms.map(t => norm(t.name)), ejemplos: terms.slice(0, 4).map(t => t.name) });
  }

  // Cada rol lo reclama UN solo campo. Primero por nombre, que es la señal
  // fuerte; el parecido por valores solo desempata, y exige coincidencia
  // exacta y repetida: con 'incluye' bastaba que un termino como
  // 'Acceso para camiones' contuviera 'casa' para marcarlo como tipo.
  const asignado = new Map();
  for (const r of ROLES) {
    let elegido = crudos.find(c => !asignado.has(c.clave) && r.nombres.some(n => norm(c.clave) === norm(n)));
    if (!elegido && r.valores.length) {
      const conPuntos = crudos
        .filter(c => !asignado.has(c.clave))
        .map(c => ({ c, n: r.valores.filter(v => c.terms.includes(v)).length }))
        .filter(x => x.n >= 2)
        .sort((a, b) => b.n - a.n);
      elegido = conPuntos[0]?.c;
    }
    if (elegido) asignado.set(elegido.clave, r.rol);
  }
  for (const c of crudos) campos.push({ clave: c.clave, etiqueta: c.etiqueta, rol: asignado.get(c.clave) || null, ejemplos: c.ejemplos });
  return { post_type: elegido.rest_base, nombre_tipo: elegido.nombre, total: elegido.total, campos };
}


function sb() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
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
  const sesion = await verificarSesion(req);
  let userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'knowledge-sync'), 401);
  // A que cliente esta acotado este miembro. Se lee en la MISMA consulta que
  // ya resolvia al dueno: sin esto habria que preguntarlo otra vez.
  let clienteDelMiembro = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,client_id&limit=1`, { headers: sb() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tw = (await r.json())?.[0];
    if (tw && tw.owner_user_id) { userId = tw.owner_user_id; clienteDelMiembro = tw.client_id || null; }
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }

  const url = new URL(req.url);
  const clientId = clienteDelMiembro || url.searchParams.get('client_id') || '';
  if (!clientId) return jsonResp({ error: 'Falta el cliente' }, 400);

  const filtroFuente = `user_id=eq.${encodeURIComponent(userId)}&client_id=eq.${encodeURIComponent(clientId)}`;

  // ── Detectar: se mira la web y se propone qué es cada cosa ────────────────
  if (req.method === 'GET' && url.searchParams.get('action') === 'detectar') {
    let base = String(url.searchParams.get('base_url') || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return jsonResp({ error: 'La dirección debe empezar por https://' }, 400);
    const r = await detectar(base);
    if (r.error) return jsonResp(r, 400);
    return jsonResp({ ...r, base_url: base });
  }

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

    const previa = await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?${filtroFuente}&select=id&limit=1`, { headers: sb() })
      .then(r => (r.ok ? r.json() : [])).catch(() => []);
    // El mapeo llega ya confirmado por el usuario. Si no viene, se detecta: asi
    // el conector no depende de que los campos se llamen como en Certain.
    let post_type = String(body.post_type || '').trim();
    let mapeo = body.mapeo && typeof body.mapeo === 'object' ? body.mapeo : null;
    if (!post_type || !mapeo) {
      const det = await detectar(base);
      if (det.error) return jsonResp(det, 400);
      post_type = post_type || det.post_type;
      mapeo = mapeo || Object.fromEntries(det.campos.filter(c => c.rol).map(c => [c.rol, c.clave]));
    }
    if (!mapeo.operacion) {
      return jsonResp({ error: 'No se pudo identificar cuál campo dice si es arriendo o venta. ' +
        'Indícalo a mano antes de guardar.', mapeo_incompleto: true }, 400);
    }
    const fila = { user_id: userId, client_id: clientId, tipo: 'wordpress', base_url: base, activo: true,
      cursor_pagina: 1, post_type, mapeo };
    const res = previa?.[0]?.id
      ? await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?id=eq.${previa[0].id}`, { method: 'PATCH', headers: sb(), body: JSON.stringify(fila) })
      : await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources`, { method: 'POST', headers: sb(), body: JSON.stringify(fila) });
    if (!res.ok) return jsonResp({ error: 'No se pudo guardar: ' + (await res.text()).slice(0, 200) }, 500);
    return jsonResp({ fuente: (await res.json())?.[0] || null });
  }

  // ── Sincronizar un lote ───────────────────────────────────────────────────
  // La lógica vive en _catalogo.js porque la comparte con el cron: con dos
  // copias, el lector de precios de una se arregla y el de la otra no.
  if (req.method === 'POST') {
    const fuente = await fetch(`${SUPABASE_URL}/rest/v1/client_knowledge_sources?${filtroFuente}&select=*&limit=1`, { headers: sb() })
      .then(r => (r.ok ? r.json() : [])).then(r => r?.[0] || null).catch(() => null);
    if (!fuente) return jsonResp({ error: 'Este cliente no tiene web configurada todavía' }, 404);

    const r = await sincronizarLote(fuente);
    if (r.error) return jsonResp({ error: r.error }, r.estado || 500);
    return jsonResp(r);
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
