// api/report.js — Reporte de campañas: guardar y leer públicamente
// POST /api/report        → guarda reporte, devuelve { id }
// GET  /api/report?id=xxx → devuelve datos del reporte (público, sin auth)

// La sesión se verifica con el módulo común, que lee las cabeceras de las
// dos formas: `Headers` en edge y objeto plano en Node.
import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

// Acceso a Supabase por su API REST, como el resto de api/. Este fichero usaba
// el SDK @supabase/supabase-js, que NUNCA estuvo instalado: package.json no
// tiene dependencias. La función reventaba al cargar (FUNCTION_INVOCATION_FAILED)
// y la ruta llevaba caída desde abril de 2026 sin que nada lo dijera.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbCab = (extra) => ({
  'Content-Type': 'application/json',
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  ...(extra || {}),
});
async function sbSelect(tabla, query) {
  const r = await fetch(`${SB_URL}/rest/v1/${tabla}?${query}`, { headers: sbCab() });
  if (!r.ok) return { data: null, error: await r.text() };
  const filas = await r.json();
  return { data: filas, error: null };
}
async function sbUpdate(tabla, query, cambios) {
  const r = await fetch(`${SB_URL}/rest/v1/${tabla}?${query}`, {
    method: 'PATCH', headers: sbCab({ Prefer: 'return=minimal' }), body: JSON.stringify(cambios),
  });
  return r.ok ? { error: null } : { error: await r.text() };
}
async function sbInsert(tabla, fila) {
  const r = await fetch(`${SB_URL}/rest/v1/${tabla}`, {
    method: 'POST', headers: sbCab({ Prefer: 'return=minimal' }), body: JSON.stringify(fila),
  });
  return r.ok ? { error: null } : { error: await r.text() };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: leer reporte público por ID ────────────────────────────────────────
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data: filas } = await sbSelect('agency_reports', `id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    const data = filas && filas[0];
    if (!data) return res.status(404).json({ error: 'Report not found' });

    // Incrementar contador de vistas
    await sbUpdate('agency_reports', `id=eq.${encodeURIComponent(id)}`, { views: (data.views || 0) + 1 });

    return res.status(200).json({ report: data });
  }

  // ── POST: guardar nuevo reporte ──────────────────────────────────────────────
  if (req.method === 'POST') {
    // Verificar autenticación (solo la agencia puede guardar)
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // Sesión de Clerk, con la firma comprobada. Antes se intentaba primero
    // con supabase.auth (que aquí no autentica a nadie: los usuarios viven en
    // Clerk) y, al fallar, se aceptaba el 'sub' de un token sin verificar.
    const sesion = await verificarSesion(req);
    if (!sesion.id) return res.status(401).json(await cuerpoSinSesion(sesion, 'report'));
    const userId = sesion.id;

    const body = req.body;
    const {
      clientId, clientName, agencyName,
      platforms, kpis, metrics,
      period, dateFrom, dateTo,
      summary, // texto generado por IA
    } = body;

    if (!clientId || !platforms || !metrics) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generar ID único
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: insertError } = await sbInsert('agency_reports', {
        id,
        user_id:     userId,
        client_id:   clientId,
        client_name: clientName || 'Cliente',
        agency_name: agencyName || null,
        platforms,          // array de strings: ['google','meta']
        kpis,               // objeto: { google: ['inversion','clics',...], meta: [...] }
        metrics,            // objeto: { google: { inversion: '1200', clics: '850' }, meta: {...} }
        period,             // 'semana' | 'mes' | 'trimestre' | 'custom'
        date_from:   dateFrom || null,
        date_to:     dateTo   || null,
        summary,            // texto WhatsApp generado por IA
        views:       0,
        created_at:  now,
      });

    if (insertError) {
      console.error('report insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save report' });
    }

    const reportUrl = `https://app.acuarius.app/report.html?id=${id}`;
    return res.status(200).json({ id, url: reportUrl });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
