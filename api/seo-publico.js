// api/seo-publico.js — el dashboard SEO que ve el cliente, sin cuenta.
//
//   GET ?t=<32 hex>   el proyecto entero, con la MISMA carga que la app
//                     (_seo-datos.js, en modo público: sin acciones ocultas
//                     ni datos internos). 404 si no existe, 410 si se revocó.
//
// Página: public/seo.html, ruta /seo/:token. Mismo patrón que /i/:token.
export const config = { runtime: 'edge' };

import { cargarProyecto } from './_seo-datos.js';
import { registrarError } from './_registro-errores.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export default async function handler(req) {
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
