// api/meta-list-accounts.js
// Lista las cuentas publicitarias de la conexión de Meta de la cuenta.
//
// Antes tomaba el token del cuerpo de la petición y no pedía sesión: servía de
// relé abierto a la Graph API para cualquiera que tuviera un token. Ahora hace
// falta sesión y el token es el GUARDADO de la cuenta —el navegador ya no lo
// tiene—.

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

async function tokenDeLaCuenta(userId) {
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.meta_ads&select=access_token&limit=1`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  ).catch(() => null);
  if (!r || !r.ok) return '';
  return (await abrirConexion((await r.json())?.[0]))?.access_token || '';
}

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const sesion = await verificarSesion(req);
  // Con el motivo: «tu sesión venció» se arregla volviendo a entrar; un
  // «no autorizado» a secas no le dice a nadie qué hacer.
  if (!sesion.id) return json(await cuerpoSinSesion(sesion, 'meta-list-accounts'), 401);
  const userId = await cuentaDe(sesion.id);
  if (!userId) return json({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  const accessToken = await tokenDeLaCuenta(userId);
  if (!accessToken) return json({ error: 'No hay Meta conectado en esta cuenta.', needsConnect: true }, 401);

  try {
    // Obtener cuentas publicitarias del usuario
    const accountsRes = await fetch(
      `https://graph.facebook.com/v19.0/me/adaccounts?` +
      new URLSearchParams({
        fields:       'id,name,currency,account_status,business,spend_cap,amount_spent',
        access_token: accessToken,
        limit:        '50',
      })
    );

    const data = await accountsRes.json();

    if (data.error) {
      return json({ error: data.error.message }, 400);
    }

    // Mapear cuentas con estado legible
    const statusMap = {
      1: 'activa', 2: 'desactivada', 3: 'sin confirmar',
      7: 'pendiente revisión', 9: 'en revisión', 100: 'cerrada',
      101: 'cualquier activa', 201: 'sin permiso de pago',
    };

    const accounts = (data.data || []).map(acc => ({
      id:       acc.id,           // formato: act_XXXXXXXXX
      name:     acc.name,
      currency: acc.currency,
      status:   statusMap[acc.account_status] || 'desconocido',
      isActive: acc.account_status === 1,
      business: acc.business?.name || null,
      spent:    acc.amount_spent ? (acc.amount_spent / 100).toFixed(2) : '0',
    }));

    return json({ accounts, total: accounts.length });

  } catch (err) {
    console.error('meta-list-accounts error:', err);
    return json({ error: 'Error consultando cuentas de Meta' }, 500);
  }
}
