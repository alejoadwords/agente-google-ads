// api/trial.js
// Prueba Pro de 14 días para cuentas free: una sola vez por usuario.
// POST autenticado → si el plan es free y nunca usó trial, fija en Clerk
// {plan:'trial', trial_until:+14d, trial_used:true}. Los gates del server
// aceptan 'trial' como plan pago y api/cron-trials.js lo expira a 'free'.
export const config = { runtime: 'edge' };

import { verificarSesion, cuerpoSinSesion } from './_sesion.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResp({ error: 'Método no permitido' }, 405);
  const sesion = await verificarSesion(req);
  const userId = sesion.id;
  if (!userId) return jsonResp(await cuerpoSinSesion(sesion, 'trial'), 401);
  // Una sesión de soporte (un admin dentro de la cuenta, ver api/cuentas.js)
  // no arranca la prueba: se gastaría la única que tiene el cliente sin que él
  // haya entrado nunca.
  if (sesion.datos?.act?.sub) return jsonResp({ ok: false, reason: 'sesion_de_soporte' });

  const CK = process.env.CLERK_SECRET_KEY;
  const u = await fetch('https://api.clerk.com/v1/users/' + userId, { headers: { Authorization: 'Bearer ' + CK } }).then(r => r.json()).catch(() => null);
  if (!u) return jsonResp({ error: 'Usuario no encontrado' }, 404);
  const meta = u.public_metadata || {};
  const plan = meta.plan || 'free';

  // Trial vigente → devolver estado
  if (plan === 'trial' && meta.trial_until) {
    return jsonResp({ ok: true, active: new Date(meta.trial_until) > new Date(), trial_until: meta.trial_until });
  }
  if (plan !== 'free') return jsonResp({ ok: false, reason: 'plan_activo', plan });
  if (meta.trial_used) return jsonResp({ ok: false, reason: 'trial_usado' });

  const trialUntil = new Date(Date.now() + 14 * 86400000).toISOString();
  const r = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + CK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_metadata: { plan: 'trial', trial_until: trialUntil, trial_used: true } }),
  });
  if (!r.ok) return jsonResp({ error: 'No se pudo activar la prueba' }, 500);
  return jsonResp({ ok: true, active: true, trial_until: trialUntil, started: true });
}
