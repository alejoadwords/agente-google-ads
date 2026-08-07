// api/soporte.js — panel de soporte para administradores de Acuarius.
//   GET  ?action=cuentas         lista de cuentas para entrar
//   POST ?action=entrar          abre una sesión de soporte (devuelve el vale)
//   GET  ?action=registro&cuenta accesos registrados de una cuenta
//
// Edge porque importa api/_soporte.js.

export const config = { runtime: 'edge' };

import { emitirVale, esAdmin, emailDeClerk, registrar, LOG_KEY, DURACION_MIN } from './_soporte.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-acuarius-soporte',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}

async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data))) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const email = await emailDeClerk(userId);
  if (!esAdmin(email)) return jsonResp({ error: 'Solo el equipo de Acuarius puede usar el modo soporte' }, 403);

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // Cuentas a las que se puede entrar
  if (req.method === 'GET' && action === 'cuentas') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=id,email,name,plan,status,created_at&order=created_at.desc&limit=200`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    const cuentas = (rows || [])
      .filter(u => !q || (u.email || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))
      .filter(u => u.id !== userId);
    return jsonResp({ cuentas, duracion_min: DURACION_MIN });
  }

  // Abrir sesión de soporte
  if (req.method === 'POST' && action === 'entrar') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const cuenta = String(body?.cuenta || '').trim();
    const escritura = !!body?.escritura;
    const motivo = String(body?.motivo || '').trim().slice(0, 200);
    if (!cuenta) return jsonResp({ error: 'Falta la cuenta' }, 400);
    if (cuenta === userId) return jsonResp({ error: 'Esa es tu propia cuenta' }, 400);

    const dueño = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(cuenta)}&select=id,email,name,plan&limit=1`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (!dueño?.length) return jsonResp({ error: 'Cuenta no encontrada' }, 404);

    await registrar(cuenta, { admin: userId, admin_email: email, escritura, motivo, evento: 'entrada' });
    const vale = await emitirVale({ adminId: userId, adminEmail: email, cuenta, escritura });
    return jsonResp({
      vale, escritura, duracion_min: DURACION_MIN,
      cuenta: { id: dueño[0].id, email: dueño[0].email, name: dueño[0].name, plan: dueño[0].plan },
    });
  }

  // Registro de accesos de una cuenta
  if (req.method === 'GET' && action === 'registro') {
    const cuenta = url.searchParams.get('cuenta');
    if (!cuenta) return jsonResp({ error: 'Falta la cuenta' }, 400);
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(cuenta)}&agent_key=eq.${LOG_KEY}&select=profile_data&limit=1`,
      { headers: sbHeaders() }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    return jsonResp({ accesos: rows?.[0]?.profile_data?.accesos || [] });
  }

  return jsonResp({ error: 'Acción no reconocida' }, 400);
}
