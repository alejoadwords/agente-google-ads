// api/_whatsapp.js — piezas compartidas de WhatsApp.
//
// Vive aquí y no dentro de un endpoint porque lo usan varios: la pantalla de
// plantillas y el gate de las campañas. El guion bajo evita que Vercel lo
// publique como ruta. Solo se importa desde funciones EDGE.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export const GRAPH = 'https://graph.facebook.com/v23.0';

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

/**
 * La conexión de WhatsApp de una cuenta, con lo que hace falta para hablar con
 * Meta: `external_id` es el phone_number_id (por donde se envía) y `waba_id` la
 * cuenta de negocio (de donde cuelgan las plantillas). Son cosas distintas y
 * confundirlas da un 404 de Meta que no explica nada.
 */
export async function conexionWhatsapp(userId, clientId) {
  const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '';
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&channel=eq.whatsapp&is_active=eq.true${scope}&select=id,external_id,waba_id,access_token,channel_name&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return filas?.[0] || null;
}

/**
 * Las plantillas de una WABA, tal y como las ve Meta. Devuelve
 * { ok, plantillas } o { ok:false, aviso }.
 */
export async function plantillasDeMeta(conn, campos) {
  const r = await fetch(
    `${GRAPH}/${encodeURIComponent(conn.waba_id)}/message_templates` +
    `?fields=${campos || 'name,status,category,language,components,quality_score,rejected_reason'}&limit=200`,
    { headers: { Authorization: `Bearer ${conn.access_token}` } }
  );
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    return { ok: false, aviso: String(d.error?.message || r.status).slice(0, 200) };
  }
  return { ok: true, plantillas: d.data || [] };
}

/**
 * Cuántas variables {{n}} usa cada parte de la plantilla. Es lo que la pantalla
 * necesita para pedir un campo del lead por cada hueco: si el mapeo no cuadra
 * con los huecos, Meta rechaza el envío entero.
 */
export function huecosDe(components) {
  const cuenta = (texto) => {
    const vistos = new Set();
    for (const m of String(texto || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) vistos.add(Number(m[1]));
    return vistos.size ? Math.max(...vistos) : 0;
  };
  const out = { header: 0, body: 0, cuerpo_texto: '' };
  for (const c of (components || [])) {
    if (c.type === 'HEADER' && c.format === 'TEXT') out.header = cuenta(c.text);
    if (c.type === 'BODY') { out.body = cuenta(c.text); out.cuerpo_texto = c.text || ''; }
  }
  return out;
}

/**
 * Quién es la CUENTA cuando quien pregunta es un miembro del equipo. Sin esto
 * un vendedor vería su propia cuenta —que no tiene ningún canal— y creería que
 * no hay plantillas.
 */
export async function cuentaDe(userId) {
  const tm = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return tm?.[0]?.owner_user_id || userId;
}
