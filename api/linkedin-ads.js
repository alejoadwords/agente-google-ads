// api/linkedin-ads.js
// Proxy para LinkedIn Campaign Manager API
// Maneja: status, list-accounts, get-campaigns, get-insights
//
// Antes tomaba el token del cuerpo y no pedía sesión: un relé abierto a la API
// de LinkedIn. Ahora hace falta sesión y el token es el GUARDADO de la cuenta
// —el navegador ya no lo tiene—.

export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';
import { abrirConexion } from './_cifrado.js';

async function cuentaDe(actorId) {
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(actorId)}` +
    `&status=eq.active&select=owner_user_id&limit=1`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  ).catch(() => null);
  if (!r || !r.ok) return null;                 // no se adivina: se corta
  return (await r.json())?.[0]?.owner_user_id || actorId;
}

async function conexionDe(userId) {
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}` +
    `&platform=eq.linkedin_ads&select=access_token,account_name,token_expires_at&limit=1`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  ).catch(() => null);
  if (!r || !r.ok) return { fallo: true };
  return (await abrirConexion((await r.json())?.[0] || null)) || null;
}

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const sesion = await verificarSesion(req);
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'linkedin-ads'), 401);
  const userId = await cuentaDe(sesion.id);
  if (!userId) return json({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);

  const body = await req.json().catch(() => ({}));
  const { accountId, action } = body;

  const conn = await conexionDe(userId);
  if (conn?.fallo) return json({ error: 'No se pudo leer la conexión de LinkedIn. Reintenta en unos segundos.' }, 503);

  // La pantalla pregunta esto al arrancar en vez de guardarse el token: así
  // «conectado» lo decide el servidor y no un sessionStorage de hace un mes.
  if (action === 'status') {
    return json({ connected: !!conn?.access_token, name: conn?.account_name || '', expires_at: conn?.token_expires_at || null });
  }

  // Un token de mentira que manda el navegador ya no sirve de nada.
  const accessToken = conn?.access_token || '';
  if (!accessToken) return json({ error: 'No hay LinkedIn conectado en esta cuenta.', needsConnect: true }, 401);

  const headers = {
    Authorization:            `Bearer ${accessToken}`,
    'LinkedIn-Version':       '202406',
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type':           'application/json',
  };

  try {
    // ── Listar cuentas publicitarias ──────────────────────────
    if (action === 'list-accounts') {
      const url = 'https://api.linkedin.com/v2/adAccountsV2?q=search&search.status.values[0]=ACTIVE&count=50';
      const r   = await fetch(url, { headers });
      const data = await r.json();

      if (data.status === 401) {
        return json({ error: 'Token inválido o expirado. Vuelve a conectar tu cuenta de LinkedIn.' }, 401);
      }
      if (data.status === 403 || data.serviceErrorCode || (data.message && data.message.includes('Not enough permissions'))) {
        return json({ error: 'PENDING_APPROVAL' }, 403);
      }

      const elements = data.elements || [];
      const accounts = elements.map(acc => ({
        id:       String(acc.id),
        name:     acc.name || `Cuenta ${acc.id}`,
        currency: acc.currency || 'USD',
        status:   acc.status   || 'ACTIVE',
        type:     acc.type     || 'BUSINESS',
      }));

      return json({ accounts, total: accounts.length });
    }

    // ── Listar campañas de una cuenta ─────────────────────────
    if (action === 'get-campaigns') {
      if (!accountId) return json({ error: 'accountId requerido' }, 400);
      const urn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
      const url = `https://api.linkedin.com/v2/adCampaignsV2?q=search&search.account.values[0]=${urn}&search.status.values[0]=ACTIVE&count=20`;
      const r   = await fetch(url, { headers });
      const data = await r.json();

      const campaigns = (data.elements || []).map(c => ({
        id:            String(c.id),
        name:          c.name || `Campaña ${c.id}`,
        status:        c.status,
        objectiveType: c.objectiveType,
        costType:      c.costType,
        dailyBudget:   c.dailyBudget?.amount ? `${c.dailyBudget.amount} ${c.dailyBudget.currencyCode}` : null,
        totalBudget:   c.totalBudget?.amount  ? `${c.totalBudget.amount} ${c.totalBudget.currencyCode}` : null,
        startDate:     c.runSchedule?.start ? new Date(c.runSchedule.start).toISOString().slice(0, 10) : null,
        endDate:       c.runSchedule?.end   ? new Date(c.runSchedule.end).toISOString().slice(0, 10)   : null,
      }));

      return json({ campaigns });
    }

    // ── Métricas de rendimiento ───────────────────────────────
    if (action === 'get-insights') {
      if (!accountId) return json({ error: 'accountId requerido' }, 400);
      const { dateRange = 'LAST_30_DAYS' } = body;

      // Calcular fechas según rango
      const now   = new Date();
      const start = new Date(now);
      const days  = dateRange === 'LAST_7_DAYS' ? 7 : dateRange === 'LAST_14_DAYS' ? 14 : 30;
      start.setDate(now.getDate() - days);

      const fmt = d => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
      const urn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);

      const params = new URLSearchParams({
        q:                               'analytics',
        pivot:                           'ACCOUNT',
        'timeGranularity':               'ALL',
        'accounts[0]':                   `urn:li:sponsoredAccount:${accountId}`,
        'dateRange.start.year':          fmt(start).year,
        'dateRange.start.month':         fmt(start).month,
        'dateRange.start.day':           fmt(start).day,
        'dateRange.end.year':            fmt(now).year,
        'dateRange.end.month':           fmt(now).month,
        'dateRange.end.day':             fmt(now).day,
        'fields':                        'impressions,clicks,costInUsd,leads,externalWebsiteConversions,dateRange',
      });

      const r    = await fetch(`https://api.linkedin.com/v2/adAnalyticsV2?${params}`, { headers });
      const data = await r.json();

      const el = (data.elements || [])[0] || {};
      const insights = {
        impressions:   el.impressions   || 0,
        clicks:        el.clicks        || 0,
        spend:         el.costInUsd     ? parseFloat(el.costInUsd).toFixed(2) : '0.00',
        leads:         el.leads         || 0,
        conversions:   el.externalWebsiteConversions || 0,
        ctr:           el.impressions   ? ((el.clicks / el.impressions) * 100).toFixed(2) : '0.00',
        cpc:           el.clicks        ? (el.costInUsd / el.clicks).toFixed(2)           : '0.00',
        cpl:           el.leads         ? (el.costInUsd / el.leads).toFixed(2)            : '0.00',
      };

      return json({ insights, period: dateRange });
    }

    return json({ error: 'action no reconocido' }, 400);

  } catch (err) {
    console.error('linkedin-ads error:', err);
    return json({ error: 'Error consultando LinkedIn Ads API' }, 500);
  }
}
