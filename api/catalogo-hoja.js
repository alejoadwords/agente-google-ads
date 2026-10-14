// api/catalogo-hoja.js
// Conecta una hoja de Google como catálogo de productos (joyas, en el caso de
// AMETT) y la sincroniza. La lectura vive en _hoja-productos.js porque la
// comparte con cron-catalogo.
//
//   GET     → qué hoja hay conectada y cuántas piezas
//   PUT     → { hoja_url } se prueba, se guarda y se sincroniza
//   POST    → sincronizar ahora ({ forzar } salta el freno de borrado masivo)
//   DELETE  → desconectar: quita la hoja y su catálogo
//
// El alcance es el cliente activo de una agencia o, sin cliente, la cuenta
// entera: un negocio sin perfil (AMETT hoy) también tiene que poder conectarlo.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { csvDeHoja, leerHoja, sincronizarHoja, filtroAlcance } from './_hoja-productos.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
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
    return jsonResp({ error: 'Error con el catálogo: ' + (e?.message || 'desconocido') }, 500);
  }
}

async function manejar(req) {
  const sesion = await verificarSesion(req);
  let userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'catalogo-hoja'), 401);
  // Un miembro del equipo trabaja sobre la cuenta del dueño, y si está acotado
  // a un cliente, sobre ese cliente y no otro.
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
  const clientId = clienteDelMiembro || url.searchParams.get('client_id') || null;
  const alcance = filtroAlcance(userId, clientId);

  const fuenteActual = () => fetch(`${SUPABASE_URL}/rest/v1/client_product_sources?${alcance}&select=*&limit=1`, { headers: sb() })
    .then(r => { if (!r.ok) throw new Error('No se pudo leer la hoja conectada (HTTP ' + r.status + ')'); return r.json(); })
    .then(r => r?.[0] || null);

  if (req.method === 'GET') {
    const fuente = await fuenteActual();
    const contar = (extra) => fetch(`${SUPABASE_URL}/rest/v1/client_products?${alcance}${extra}&select=id`,
      { headers: { ...sb(), Prefer: 'count=exact', Range: '0-0' } })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return parseInt((r.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0; });
    const [productos, agotados] = await Promise.all([contar(''), contar('&disponible=is.false')]);
    return jsonResp({ fuente, productos, agotados });
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    const enlace = String(body.hoja_url || '').trim();
    const c = csvDeHoja(enlace);
    if (c.error) return jsonResp({ error: c.error }, 400);
    // Se lee ANTES de guardar: una hoja privada o sin «Referencia» guardada
    // como buena es un cron que falla cada media hora sin que nadie mire.
    const prueba = await leerHoja(c.csv);
    if (prueba.error) return jsonResp({ error: prueba.error }, 400);

    const fila = { user_id: userId, client_id: clientId, hoja_url: enlace.slice(0, 500), csv_url: c.csv, activo: true,
      ultimo_estado: null, ultimo_error: null };
    const previa = await fuenteActual();
    const res = previa
      ? await fetch(`${SUPABASE_URL}/rest/v1/client_product_sources?id=eq.${previa.id}`, { method: 'PATCH', headers: sb(), body: JSON.stringify(fila) })
      : await fetch(`${SUPABASE_URL}/rest/v1/client_product_sources`, { method: 'POST', headers: sb(), body: JSON.stringify(fila) });
    if (!res.ok) return jsonResp({ error: 'No se pudo guardar la hoja: ' + (await res.text()).slice(0, 200) }, 500);
    const fuente = (await res.json())?.[0];
    // Conectar una hoja nueva es decir «este es el catálogo»: se sincroniza ya
    // y sin freno, porque reemplazar una hoja por otra más corta es a propósito.
    const sync = await sincronizarHoja(fuente, { forzar: true });
    if (sync.error) return jsonResp({ error: 'La hoja se guardó, pero la primera lectura falló: ' + sync.error, fuente }, sync.estado || 500);
    return jsonResp({ fuente, ...sync });
  }

  if (req.method === 'POST') {
    const fuente = await fuenteActual();
    if (!fuente) return jsonResp({ error: 'No hay ninguna hoja conectada todavía' }, 404);
    const body = await req.json().catch(() => ({}));
    const r = await sincronizarHoja(fuente, { forzar: body.forzar === true });
    if (r.error) return jsonResp(r, r.estado || 500);
    return jsonResp(r);
  }

  if (req.method === 'DELETE') {
    const fuente = await fuenteActual();
    if (!fuente) return jsonResp({ ok: true });
    // Primero el catálogo y después la hoja: al revés, si lo segundo falla
    // quedarían piezas huérfanas que el agente seguiría ofreciendo sin que
    // ninguna sincronización las vuelva a tocar.
    const d1 = await fetch(`${SUPABASE_URL}/rest/v1/client_products?${alcance}`, { method: 'DELETE', headers: { ...sb(), Prefer: 'return=minimal' } });
    if (!d1.ok) return jsonResp({ error: 'No se pudo quitar el catálogo (HTTP ' + d1.status + ')' }, 500);
    const d2 = await fetch(`${SUPABASE_URL}/rest/v1/client_product_sources?id=eq.${fuente.id}`, { method: 'DELETE', headers: { ...sb(), Prefer: 'return=minimal' } });
    if (!d2.ok) return jsonResp({ error: 'Se quitó el catálogo pero no la hoja (HTTP ' + d2.status + ')' }, 500);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
