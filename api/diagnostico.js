// api/diagnostico.js — radiografía de solo lectura de la cuenta de un cliente.
//
// Sustituye al modo soporte, que se revirtió: aquí no se suplanta a nadie, no
// hay sesión que caduque y no se escribe absolutamente nada. Solo se lee la
// configuración para poder responder "¿por qué no le llegan los leads?" sin
// pedirle al cliente que comparta pantalla.
//
// Deliberadamente NO devuelve el contenido de los mensajes ni los datos de
// contacto de sus leads: para diagnosticar hace falta saber que las cosas
// existen y cómo están configuradas, no leer las conversaciones de terceros.
//
//   GET ?cuentas=1        lista de cuentas
//   GET ?cuenta=<userId>  la radiografía
//
// Edge, y solo para los correos de ADMIN_EMAILS.

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb() {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
}
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
async function q(path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sb() });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

async function getUserId(req) {
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
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, sig, new TextEncoder().encode(`${hB64}.${pB64}`)))) return null;
    const p = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p.sub || null;
  } catch { return null; }
}

async function emailDe(userId) {
  try {
    const u = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    }).then(r => (r.ok ? r.json() : null));
    return u?.email_addresses?.[0]?.email_address || null;
  } catch { return null; }
}

const PLAN_LEADS = { free: 50, pro: 1000, individual: 1000, trial: 1000, agency: 5000, agencia: 5000 };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return jsonResp({ error: 'Método no permitido' }, 405);

  const userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  const admins = String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const email = await emailDe(userId);
  if (!email || !admins.includes(email.toLowerCase())) {
    return jsonResp({ error: 'Solo el equipo de Acuarius puede ver diagnósticos' }, 403);
  }

  const url = new URL(req.url);

  if (url.searchParams.get('cuentas')) {
    const rows = await q('users?select=id,email,name,plan,status,created_at&order=created_at.desc&limit=200');
    return jsonResp({ cuentas: (rows || []).filter(u => u.id !== userId) });
  }

  const cuenta = url.searchParams.get('cuenta');
  if (!cuenta) return jsonResp({ error: 'Falta la cuenta' }, 400);
  const c = encodeURIComponent(cuenta);

  const [usuario, canales, agentes, equipo, formularios, plataformas, config, etapas] = await Promise.all([
    q(`users?id=eq.${c}&select=id,email,name,plan,status,created_at,trial_ends_at&limit=1`),
    q(`channel_connections?user_id=eq.${c}&select=channel,channel_name,is_active,agent_id,created_at`),
    q(`chat_agents?user_id=eq.${c}&select=id,name,is_active,client_id,capture_fields`),
    q(`team_members?owner_user_id=eq.${c}&select=member_name,member_email,status,member_user_id`),
    q(`lead_forms?user_id=eq.${c}&select=name,active,submissions,last_submission_at`),
    q(`platform_connections?user_id=eq.${c}&select=platform,account_name,token_expires_at,connected_at`),
    q(`user_profiles?user_id=eq.${c}&select=agent_key,profile_data`),
    q(`pipeline_stages?user_id=eq.${c}&select=key,label,position&order=position.asc`),
  ]);

  // Conteos sin traerse los datos: Prefer count=exact devuelve el total en la cabecera
  async function contar(filtro) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?user_id=eq.${c}${filtro}&select=id&limit=0`,
        { headers: { ...sb(), Prefer: 'count=exact' } });
      return parseInt((r.headers.get('content-range') || '*/0').split('/')[1] || '0') || 0;
    } catch { return 0; }
  }
  const [activos, papelera, sinAsignar] = await Promise.all([
    contar('&deleted_at=is.null'),
    contar('&deleted_at=not.is.null'),
    contar('&deleted_at=is.null&assigned_to=is.null'),
  ]);

  const conf = {};
  (config || []).forEach(r => { conf[r.agent_key] = r.profile_data; });
  const u = usuario?.[0] || null;
  const plan = u?.plan || 'free';
  const limite = PLAN_LEADS[plan] || 10;

  // Actividad reciente: solo metadatos, nunca el contenido de los mensajes ni
  // el teléfono o el correo de sus leads.
  const [ultimosLeads, ultimasConv] = await Promise.all([
    q(`leads?user_id=eq.${c}&deleted_at=is.null&select=source,stage,created_at,assigned_name&order=created_at.desc&limit=5`),
    q(`chat_conversations?user_id=eq.${c}&select=channel,status,last_message_at&order=last_message_at.desc&limit=5`),
  ]);

  // ── Lo que hace útil esta pantalla: los desajustes típicos ────────────────
  const avisos = [];
  const add = (nivel, texto) => avisos.push({ nivel, texto });

  const canalesActivos = (canales || []).filter(x => x.is_active);
  const agentesActivos = (agentes || []).filter(a => a.is_active);
  const comerciales = (equipo || []).filter(m => m.status === 'active' && m.member_user_id);

  if (!canalesActivos.length && !(formularios || []).some(f => f.active)) {
    add('alto', 'No hay ninguna fuente de leads activa: ni canales de chat ni formularios web.');
  }
  canalesActivos.forEach(cn => {
    const ag = (agentes || []).find(a => a.id === cn.agent_id);
    if (!ag) add('alto', `El canal ${cn.channel} está conectado pero su agente ya no existe: los mensajes no se responden.`);
    else if (!ag.is_active) add('alto', `El canal ${cn.channel} está conectado pero el agente "${ag.name}" está desactivado.`);
  });

  const reparto = conf.__assign_rules__?.reglas || {};
  const reparteAlguna = Object.values(reparto).some(r => r && r.modo && r.modo !== 'off');
  if (reparteAlguna && !comerciales.length) {
    add('alto', 'El reparto automático está activo pero no hay comerciales en el equipo: los leads se quedan sin dueño.');
  }
  if (!reparteAlguna && comerciales.length) {
    add('medio', `Hay ${comerciales.length} comercial(es) en el equipo pero el reparto automático está apagado: los leads llegan sin asignar.`);
  }
  if (sinAsignar > 0 && comerciales.length) {
    add('medio', `${sinAsignar} lead(s) sin comercial asignado.`);
  }

  const califica = Object.values(conf.__qualify_rules__ || {}).some(r => r && r.activo);
  if (canalesActivos.length && !califica) {
    add('info', 'Hay canales conectados pero ningún agente califica antes de pasar al comercial.');
  }

  const seg = conf.__followup_rules__;
  if (seg && seg.primer_contacto === false) {
    add('medio', 'La tarea automática de primer contacto está desactivada: nada garantiza que alguien llame al lead.');
  }

  if (limite && activos / limite >= 0.8) {
    add(activos >= limite ? 'alto' : 'medio',
      `La base va al ${Math.round(activos / limite * 100)}% de su capacidad (${activos} de ${limite}).`);
  }

  (plataformas || []).forEach(p => {
    if (p.token_expires_at && new Date(p.token_expires_at) < new Date()) {
      add('alto', `La conexión de ${p.platform} está vencida: hay que reconectarla.`);
    }
  });

  if (u?.plan === 'trial' && u?.trial_ends_at && new Date(u.trial_ends_at) < new Date()) {
    add('alto', 'La prueba ya venció y la cuenta sigue en plan trial.');
  }

  return jsonResp({
    generado: new Date().toISOString(),
    cuenta: u,
    capacidad: { activos, papelera, limite, porcentaje: limite ? Math.round(activos / limite * 100) : 0, sin_asignar: sinAsignar },
    canales: canales || [],
    agentes: (agentes || []).map(a => ({
      ...a,
      califica: !!conf.__qualify_rules__?.[a.id]?.activo,
      criterios: (conf.__qualify_rules__?.[a.id]?.criterios || []).length,
    })),
    equipo: equipo || [],
    formularios: formularios || [],
    plataformas: plataformas || [],
    etapas: etapas || [],
    reglas: {
      reparto,
      seguimiento: conf.__followup_rules__ || null,
      canales: conf.__channel_policy__?.policies || null,
      retencion: conf.__retention_rules__ || null,
    },
    actividad: { ultimos_leads: ultimosLeads || [], ultimas_conversaciones: ultimasConv || [] },
    avisos,
  });
}
