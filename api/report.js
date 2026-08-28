// api/report.js — Reporte de campañas: guardar y leer públicamente
// POST /api/report        → guarda reporte, devuelve { id }
// GET  /api/report?id=xxx → devuelve datos del reporte (público, sin auth)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Verificación real del token ──────────────────────────────────────────────
// Antes solo se decodificaba el contenido del JWT y se le creía. Un JWT no
// verificado no prueba nada: cualquiera se escribe uno que diga plan 'agency'
// y gasta nuestras consultas. Aquí se comprueba la FIRMA contra las claves
// públicas de Clerk, que se cachean diez minutos.
let _jwks = null, _jwksExp = 0;
async function verificarFirma(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const b64 = x => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const header = JSON.parse(b64(hB64).toString('utf8'));
    if (!_jwks || _jwksExp < Date.now()) {
      _jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
      _jwksExp = Date.now() + 600000;
    }
    const key = _jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, b64(sB64), new TextEncoder().encode(`${hB64}.${pB64}`));
    if (!ok) return null;
    const payload = JSON.parse(b64(pB64).toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
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
      const payload = await verificarFirma(token);
      if (!payload?.sub) return res.status(401).json({ error: 'Invalid token' });
      userId = payload.sub;
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
