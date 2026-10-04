// api/reporte-publico.js — los números de un reporte enviado, para /r/<token>
//
// Sin sesión: lo abre el cliente de la agencia desde el correo. El token es
// largo y aleatorio (128 bits) y es lo único que da acceso; no hay listado ni
// búsqueda. Devuelve los datos CONGELADOS del día en que se armó el reporte.

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
const resp = (d, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
});

export default async function handler(req) {
  if (req.method !== 'GET') return resp({ error: 'Método no permitido' }, 405);
  const t = new URL(req.url).searchParams.get('t') || '';
  if (!/^[a-f0-9]{32}$/.test(t)) return resp({ error: 'Este enlace no es válido.' }, 404);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/reportes_enviados?token=eq.${t}&select=id,desde,hasta,datos,resumen,created_at,vistas&limit=1`, { headers: H });
    if (!r.ok) throw new Error('Supabase ' + r.status);
    const [f] = await r.json();
    if (!f) return resp({ error: 'Este reporte no existe o ya no está disponible.' }, 404);
    // Contar la vista no puede tumbar la página.
    fetch(`${SUPABASE_URL}/rest/v1/reportes_enviados?id=eq.${f.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ vistas: (f.vistas || 0) + 1 }) }).catch(() => {});
    return resp({ desde: f.desde, hasta: f.hasta, datos: f.datos, resumen: f.resumen, creado: f.created_at });
  } catch (e) {
    console.error('[reporte-publico]', e?.message);
    return resp({ error: 'No pudimos abrir el reporte ahora mismo. Vuelve a intentarlo en un momento.' }, 500);
  }
}
