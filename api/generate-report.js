// api/generate-report.js
// Recibe datos del reporte para registro. El PDF se genera en el cliente con jsPDF.
// Este endpoint guarda el reporte en activity_logs para analytics.

export const config = { runtime: 'nodejs' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { data, userId } = req.body || {};
    if (!data) return res.status(400).json({ error: 'data requerido' });

    // Log en Supabase si hay userId
    if (userId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/activity_logs`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          action: 'report_generated',
          details: { agent: data.agente, negocio: data.negocio, periodo: data.periodo },
        }),
      }).catch(() => {});
    }

    return res.json({ ok: true, filename: `reporte-${(data.negocio||'acuarius').replace(/\s+/g,'-')}-${(data.periodo||'').replace(/\s+/g,'-')}.pdf` });
  } catch (err) {
    console.error('generate-report error:', err);
    return res.status(500).json({ error: err.message });
  }
}
