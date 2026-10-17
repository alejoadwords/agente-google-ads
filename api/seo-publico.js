// api/seo-publico.js — el dashboard SEO que ve el cliente, sin cuenta.
//
//   GET ?t=<32 hex>   el proyecto entero, con la MISMA carga que la app
//                     (_seo-datos.js, en modo público: sin acciones ocultas
//                     ni datos internos). 404 si no existe, 410 si se revocó.
//   POST { t, contenido_id, accion: aprobar | cambios | comentario, nombre, texto }
//                     el cliente revisa una pieza del calendario (fase 2).
//
// Página: public/seo.html, ruta /seo/:token. Mismo patrón que /i/:token.
export const config = { runtime: 'edge' };

import { cargarProyecto } from './_seo-datos.js';
import { registrarError } from './_registro-errores.js';
import { transicionContenido, comentableContenido } from './_seo.js';
import { avisarAgencia } from './_seo-avisos.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

const sb = async (ruta, init = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, { ...init, headers: sbH(init.prefer ? { Prefer: init.prefer } : {}) });
  const tx = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + tx.slice(0, 200));
  return tx ? JSON.parse(tx) : null;
};

// El cliente no tiene cuenta: el enlace es su llave. Se le pide el nombre
// para que la agencia sepa quién aprobó, y hay tope de mensajes por pieza.
const TOPE_POR_HORA = 20;
async function revisar(req) {
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Cuerpo inválido' }, 400); }
  const t = String(b.t || '');
  if (!/^[a-f0-9]{32}$/.test(t)) return json({ error: 'Este enlace no existe.' }, 404);
  const [e] = await sb(`/seo_enlaces?token=eq.${t}&select=id,proyecto_id,revocado_at&limit=1`) || [];
  if (!e) return json({ error: 'Este enlace no existe.' }, 404);
  if (e.revocado_at) return json({ error: 'Este enlace se desactivó. Pídele uno nuevo a tu agencia.', revocado: true }, 410);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.contenido_id || ''))) return json({ error: 'Esa pieza no existe.' }, 404);
  const [c] = await sb(`/seo_contenidos?id=eq.${b.contenido_id}&proyecto_id=eq.${e.proyecto_id}&borrado_at=is.null&select=*&limit=1`) || [];
  if (!c) return json({ error: 'Esa pieza no existe.' }, 404);
  const nombre = String(b.nombre || '').trim().slice(0, 80);
  const texto = String(b.texto || '').trim().slice(0, 4000);
  const accion = b.accion;
  if (!['aprobar', 'cambios', 'comentario'].includes(accion)) return json({ error: 'Acción no válida.' }, 400);
  if (!nombre) return json({ error: 'Escribe tu nombre: así tu agencia sabe quién revisó.' }, 400);
  if (accion !== 'aprobar' && !texto) return json({ error: accion === 'cambios' ? 'Cuéntale a tu agencia qué hay que cambiar.' : 'Escribe tu comentario.' }, 400);
  if (accion === 'comentario' && !comentableContenido(c.estado)) return json({ error: 'Esta pieza todavía no está lista para revisar.' }, 409);
  const hace1h = new Date(Date.now() - 3600 * 1000).toISOString();
  const recientes = await sb(`/seo_contenido_comentarios?contenido_id=eq.${c.id}&autor_tipo=eq.cliente&creado_at=gte.${hace1h}&select=id`) || [];
  if (recientes.length >= TOPE_POR_HORA) return json({ error: 'Ya enviaste muchos mensajes sobre esta pieza en la última hora. Intenta más tarde.' }, 429);

  let estado = c.estado;
  if (accion !== 'comentario') {
    const tr = transicionContenido(c.estado, accion, 'cliente');
    if (tr.error) return json({ error: tr.error }, 409);
    estado = tr.estado;
    const cambios = { estado, actualizado_at: new Date().toISOString() };
    if (accion === 'aprobar') { cambios.aprobado_at = cambios.actualizado_at; cambios.aprobado_por = nombre; }
    // Solo cambia si sigue en revisión: dos personas del cliente a la vez no pisan una decisión.
    const filas = await sb(`/seo_contenidos?id=eq.${c.id}&estado=eq.en_revision`, { method: 'PATCH', prefer: 'return=representation', body: JSON.stringify(cambios) }) || [];
    if (!filas.length) return json({ error: 'Alguien ya respondió esta pieza. Recarga para ver cómo quedó.' }, 409);
  }
  await sb('/seo_contenido_comentarios', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
    contenido_id: c.id, version: c.version || null, autor_tipo: 'cliente', autor_nombre: nombre, enlace_id: e.id,
    accion: accion === 'aprobar' ? 'aprobado' : accion, texto: texto || null }) });
  const [pr] = await sb(`/seo_proyectos?id=eq.${e.proyecto_id}&select=*&limit=1`) || [];
  const avisos = pr ? await avisarAgencia({ proyecto: pr, contenido: c, accion: accion === 'aprobar' ? 'aprobado' : accion, nombre, texto }).catch(() => []) : [];
  return json({ ok: true, estado, avisos });
}

export default async function handler(req) {
  if (req.method === 'POST') {
    try { return await revisar(req); } catch (err) {
      await registrarError({ origen: 'servidor', donde: 'seo-publico.revisar', error: err }).catch(() => {});
      return json({ error: 'No pudimos guardar tu respuesta. Intenta de nuevo en unos minutos.' }, 500);
    }
  }
  if (req.method !== 'GET') return json({ error: 'Método no permitido' }, 405);
  const t = new URL(req.url).searchParams.get('t') || '';
  if (!/^[a-f0-9]{32}$/.test(t)) return json({ error: 'Este enlace no existe.' }, 404);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/seo_enlaces?token=eq.${t}&select=id,proyecto_id,user_id,vistas,revocado_at&limit=1`, { headers: sbH() });
    const [e] = r.ok ? await r.json() : [];
    if (!e) return json({ error: 'Este enlace no existe.' }, 404);
    if (e.revocado_at) return json({ error: 'Este enlace se desactivó. Pídele uno nuevo a tu agencia.', revocado: true }, 410);
    const datos = await cargarProyecto(e.proyecto_id, { publico: true });
    if (!datos) return json({ error: 'Este proyecto ya no está disponible.', revocado: true }, 410);
    // Quién lo prepara: el negocio del dueño de la cuenta (la agencia).
    const alta = await fetch(`${SUPABASE_URL}/rest/v1/onboarding_cuenta?user_id=eq.${encodeURIComponent(e.user_id)}&select=empresa&limit=1`, { headers: sbH() })
      .then(x => (x.ok ? x.json() : [])).catch(() => []);
    // La visita se cuenta con await: en edge, lo que no se espera se corta al responder.
    await fetch(`${SUPABASE_URL}/rest/v1/seo_enlaces?id=eq.${e.id}`, { method: 'PATCH', headers: sbH({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ vistas: (e.vistas || 0) + 1, ultima_vista: new Date().toISOString() }) }).catch(() => {});
    return json({ ...datos, agencia: (alta?.[0]?.empresa?.nombre || '').slice(0, 120) || null });
  } catch (err) {
    await registrarError({ origen: 'servidor', donde: 'seo-publico', error: err }).catch(() => {});
    return json({ error: 'No pudimos cargar el reporte. Intenta de nuevo en unos minutos.' }, 500);
  }
}
