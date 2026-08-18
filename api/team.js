// api/team.js
// Equipo y asientos: el dueño invita miembros por email (link firmado); el
// miembro se registra con Clerk y al canjear el token queda vinculado al
// workspace del dueño. Los endpoints core (leads, agenda, etiquetas, inbox)
// resuelven member→owner para que el equipo trabaje sobre los mismos datos.
// Asientos por plan (incluyen al dueño): Free/Pro 1 (invitar = upsell a
// Agency), Agency 3. Admin sin límite. Add-on de asientos extra: futuro
// (patrón leads_extra en el JWT: seats_extra).
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const PLAN_SEATS = { free: 1, pro: 3, individual: 3, agency: 10, agencia: 10, trial: 3 };

function sbHeaders(prefer) {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': prefer || 'return=representation',
  };
}

let _lastPlan = 'free';
let _seatsExtra = 0;
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
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    const meta = payload.public_metadata || payload.publicMetadata || {};
    _lastPlan = meta.plan || 'free';
    _seatsExtra = parseInt(meta.seats_extra || 0) || 0;
    return payload.sub || null;
  } catch { return null; }
}


// ── Plan del usuario ──────────────────────────────────────────────────────────
// Clerk dejó de incluir public_metadata en el token de sesión (formato v2), así
// que el plan ya no viaja en el JWT y todo usuario de pago se leía como "free".
// Cuando el token no lo trae, se consulta a Clerk y se cachea un minuto.
const _planCache = new Map();
async function clerkMeta(userId) {
  if (!userId || !process.env.CLERK_SECRET_KEY) return {};
  const hit = _planCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.meta;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const u = await r.json();
    const meta = Object.assign({}, u.public_metadata || {});
    meta._email = (u.email_addresses?.[0]?.email_address || '').toLowerCase();
    _planCache.set(userId, { meta, exp: Date.now() + 60000 });
    return meta;
  } catch { return {}; }
}

const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];
async function clerkEmail(userId) {
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    return ((await r.json()).email_addresses?.[0]?.email_address || '').toLowerCase();
  } catch { return ''; }
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const userId = await getUserId(req);
  if (userId && _lastPlan === 'free') {
    const meta = await clerkMeta(userId);
    if (meta.plan) _lastPlan = meta.plan;
    if (meta.seats_extra) _seatsExtra = parseInt(meta.seats_extra) || 0;
  }
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);
  const url = new URL(req.url);

  // GET ?me=1 — ¿soy miembro del workspace de alguien? (para el init de la app)
  if (req.method === 'GET' && url.searchParams.get('me')) {
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,role,owner_name&limit=1`, { headers: sbHeaders() }).then(r => r.json());
    return jsonResp({ membership: rows?.[0] || null });
  }

  // POST ?action=redeem — canjear invitación (cualquier usuario autenticado)
  if (req.method === 'POST' && url.searchParams.get('action') === 'redeem') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const token = String(body.token || '');
    if (!/^[a-f0-9]{32}$/.test(token)) return jsonResp({ error: 'Invitación inválida' }, 400);
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/team_members?invite_token=eq.${token}&select=*`, { headers: sbHeaders() }).then(r => r.json());
    const inv = rows?.[0];
    if (!inv) return jsonResp({ error: 'Invitación no encontrada o revocada' }, 404);
    if (inv.status === 'active') return jsonResp({ ok: true, already: true, owner_name: inv.owner_name });
    if (inv.owner_user_id === userId) return jsonResp({ error: 'No puedes unirte a tu propio equipo' }, 400);
    const email = await clerkEmail(userId);
    await fetch(`${SUPABASE_URL}/rest/v1/team_members?id=eq.${inv.id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ member_user_id: userId, member_email: email || inv.member_email, status: 'active', joined_at: new Date().toISOString() }),
    });
    return jsonResp({ ok: true, owner_name: inv.owner_name });
  }

  // ── A partir de aquí se opera sobre la cuenta ──────────────────────────────
  // Un miembro puede LEER el equipo —lo necesita todo selector de "quién
  // atiende"—, pero no invitar ni quitar a nadie. Sin esto la lista le llegaba
  // vacía y no podía asignarle un lead a ningún compañero.
  let cuenta = userId;
  let esMiembro = false;
  try {
    const _tw = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id&limit=1`,
      { headers: sbHeaders() }
    );
    if (!_tw.ok) throw new Error('HTTP ' + _tw.status);
    const _fila = (await _tw.json())?.[0];
    if (_fila?.owner_user_id) { cuenta = _fila.owner_user_id; esMiembro = true; }
  } catch {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }
  if (esMiembro && req.method !== 'GET') {
    return jsonResp({ error: 'Solo el dueño de la cuenta puede gestionar el equipo' }, 403);
  }

  // GET — listar el equipo + asientos
  if (req.method === 'GET') {
    // member_user_id es imprescindible: sin él, cualquier selector de "quién
    // atiende" se queda sin equipo que ofrecer y solo muestra al que mira.
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(cuenta)}&select=id,member_user_id,member_email,member_name,role,status,created_at,joined_at&order=created_at.asc`, { headers: sbHeaders() }).then(r => r.json());
    const myEmail = await clerkEmail(userId);
    const isAdmin = ADMIN_EMAILS.includes(myEmail);
    const seats = isAdmin ? 99 : (PLAN_SEATS[_lastPlan] ?? 1) + _seatsExtra;
    return jsonResp({ members: rows || [], seats: { total: seats, used: 1 + (rows || []).length, plan: _lastPlan } });
  }

  // POST — invitar
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonResp({ error: 'Email inválido' }, 400);
    const myEmail = await clerkEmail(userId);
    if (email === myEmail) return jsonResp({ error: 'Ese es tu propio email' }, 400);
    const isAdmin = ADMIN_EMAILS.includes(myEmail);
    const seats = isAdmin ? 99 : (PLAN_SEATS[_lastPlan] ?? 1) + _seatsExtra;

    const existing = await fetch(`${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(userId)}&select=id,member_email`, { headers: sbHeaders() }).then(r => r.json());
    if ((existing || []).some(m => m.member_email === email)) return jsonResp({ error: 'Ese email ya está en tu equipo' }, 400);
    if (1 + (existing || []).length >= seats) {
      return jsonResp({
        error: _lastPlan === 'agency' || _lastPlan === 'agencia'
          ? 'Alcanzaste los ' + seats + ' usuarios de tu plan. Amplía tu equipo con usuarios adicionales.'
          : 'Tu plan incluye 1 usuario. Los equipos son parte del plan Agency.',
        upgrade: _lastPlan !== 'agency' && _lastPlan !== 'agencia',
        seats_full: true,
      }, 403);
    }

    const token = crypto.randomUUID().replace(/-/g, '');
    const ownerName = String(body.owner_name || 'Tu equipo').slice(0, 80);
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/team_members`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({
        owner_user_id: userId, owner_name: ownerName,
        member_email: email, member_name: String(body.name || '').slice(0, 80) || null,
        role: body.role === 'admin' ? 'admin' : 'vendedor',
        status: 'invited', invite_token: token,
      }),
    }).then(r => r.ok ? r.json() : null);
    if (!rows) return jsonResp({ error: 'No se pudo crear la invitación' }, 500);

    // Email de invitación
    if (RESEND_API_KEY) {
      const joinUrl = 'https://app.acuarius.app/join?t=' + token;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Acuarius <notificaciones@app.acuarius.app>', to: [email],
          subject: ownerName + ' te invitó a su equipo en Acuarius',
          html: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;max-width:560px">' +
            '<p><b>' + ownerName + '</b> te invitó a colaborar en su CRM de Acuarius: leads, agenda e inbox del equipo, en un solo lugar.</p>' +
            '<p style="margin:24px 0"><a href="' + joinUrl + '" style="background:#1E2BCC;color:#fff;padding:13px 26px;border-radius:11px;text-decoration:none;font-weight:700">Unirme al equipo</a></p>' +
            '<p style="font-size:12.5px;color:#888">Si no tienes cuenta, créala gratis con este mismo email y la invitación se aplica sola. Si no esperabas esta invitación, ignora este correo.</p></div>',
        }),
      }).catch(() => {});
    }
    return jsonResp({ member: rows[0] }, 201);
  }

  // DELETE — quitar miembro o revocar invitación
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/team_members?id=eq.${id}&owner_user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: sbHeaders() });
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
