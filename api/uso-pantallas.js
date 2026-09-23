// api/uso-pantallas.js — qué pantallas se usan de verdad
//
// El inventario de septiembre de 2026 tuvo que deducir el uso de las FILAS que
// cada módulo escribe, y eso deja ciegas a las pantallas que no escriben nada:
// Análisis, Pulso o la cartera salían en cero aunque se miren a diario. Para
// decidir qué se rehace primero en la versión móvil hace falta el dato real.
//
// Qué se guarda: la pantalla, si fue en móvil, cuántas veces y cuánto tiempo.
// Nada más. Ni el lead que se abrió, ni lo que se escribió, ni por dónde se
// navegó — el id de un lead se recorta antes de salir del navegador.
//
// El TIEMPO es la mitad del valor: separa la pantalla por la que se pasa de
// camino a otra, de aquella en la que de verdad se trabaja. Contar solo
// visitas haría parecer importante a cualquier pantalla de paso.
//
//   POST /api/uso-pantallas  { vistas: [{p, ms, m}] }

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Lo que puede llegar. Una pantalla que no esté aquí se guarda como '(otra)':
// sin esta lista, cualquiera podría llenar la tabla de valores inventados y
// además el día que alguien añada una ruta nueva nadie se enteraría de que
// falta declararla.
const PANTALLAS = new Set([
  '/', '/crm', '/crm/lista', '/crm/lead', '/crm/tareas', '/crm/agenda', '/crm/equipo',
  '/marketing', '/marketing/campanas', '/marketing/plantillas', '/marketing/listas',
  '/marketing/pauta', '/marketing/propuestas', '/marketing/landings', '/marketing/social',
  '/conversaciones', '/analisis', '/analisis/reportes', '/agente', '/academia',
  '/configuracion', '/clientes', '/novedades', '(otra)',
]);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const userId = await quienEs(req);
  // Sin sesión no se mide. Un endpoint de analítica abierto es una invitación
  // a que le escriban cualquier cosa.
  if (!userId) return json({ error: 'No autorizado' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Body inválido' }, 400); }
  const vistas = Array.isArray(body?.vistas) ? body.vistas.slice(0, 60) : [];
  if (!vistas.length) return json({ ok: true, guardadas: 0 });

  // Se juntan aquí las repeticiones de la misma pantalla: quien entra y sale
  // de Leads doce veces manda doce apuntes y hace una sola llamada a la base.
  const porClave = new Map();
  for (const v of vistas) {
    const pantalla = PANTALLAS.has(v?.p) ? v.p : '(otra)';
    const movil = !!v?.m;
    // Un `ms` absurdo —una pestaña abierta toda la noche— falsearía la media.
    // Se recorta a dos horas en vez de tirar el apunte: la visita existió.
    const ms = Math.max(0, Math.min(Number(v?.ms) || 0, 7200000));
    const clave = pantalla + '|' + movil;
    const previo = porClave.get(clave) || { pantalla, movil, vistas: 0, ms: 0 };
    previo.vistas += 1;
    previo.ms += ms;
    porClave.set(clave, previo);
  }

  const dia = new Date().toISOString().slice(0, 10);
  let guardadas = 0;
  for (const v of porClave.values()) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sumar_uso_pantalla`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        p_user: userId, p_dia: dia, p_pantalla: v.pantalla,
        p_movil: v.movil, p_vistas: v.vistas, p_ms: v.ms,
      }),
    });
    if (r.ok) guardadas++;
  }
  // Se dice cuántas entraron de las que se pidieron. Un 200 con todo perdido
  // por dentro es la forma de que nadie se entere de que el instrumento
  // dejó de medir — y un instrumento que calla no se distingue de «no pasa
  // nada».
  return json({ ok: guardadas === porClave.size, guardadas, pedidas: porClave.size });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Mismo patrón de verificación que el resto de la API.
async function quienEs(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  try {
    const [hB64, pB64, sB64] = auth.replace('Bearer ', '').split('.');
    if (!sB64) return null;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const p = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p.sub || null;
  } catch { return null; }
}
