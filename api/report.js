// api/report.js — Reporte de campañas: guardar y leer públicamente
// POST /api/report        → guarda reporte, devuelve { id }
// GET  /api/report?id=xxx → devuelve datos del reporte (público, sin auth)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: leer reporte público por ID ────────────────────────────────────────
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data, error } = await supabase
      .from('agency_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Report not found' });

    // Incrementar contador de vistas
    await supabase
      .from('agency_reports')
      .update({ views: (data.views || 0) + 1 })
      .eq('id', id);

    return res.status(200).json({ report: data });
  }

  // ── POST: guardar nuevo reporte ──────────────────────────────────────────────
  if (req.method === 'POST') {
    // Verificar autenticación (solo la agencia puede guardar)
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    let userId = null;
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) throw new Error('Invalid token');
      userId = user.id;
    } catch {
      // Clerk token — extraer sub claim
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          userId = payload.sub || payload.user_id || 'unknown';
        }
      } catch {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

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

    const { error: insertError } = await supabase
      .from('agency_reports')
      .insert({
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
