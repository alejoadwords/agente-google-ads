export const config = { runtime: 'edge' };

import { conErrores } from './_errores.js';

import { enviarPushA } from './_push.js';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// El token de sesión de Clerk (v2) ya no trae public_metadata: si el plan no
// viene en el JWT hay que preguntárselo a Clerk, o todo usuario de pago se
// quedaría con el límite del plan gratuito. Cache de un minuto por usuario.
const _planCache = new Map();
async function clerkMeta(userId) {
  if (!userId || !process.env.CLERK_SECRET_KEY) return {};
  const hit = _planCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.meta;
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    const meta = (await r.json()).public_metadata || {};
    _planCache.set(userId, { meta, exp: Date.now() + 60000 });
    return meta;
  } catch { return {}; }
}

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}
async function getUserId(req) {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [hB64, pB64, sB64] = parts;
    const header = JSON.parse(atob(hB64.replace(/-/g,'+').replace(/_/g,'/')));
    const jwks = await fetch('https://clerk.acuarius.app/.well-known/jwks.json').then(r => r.json());
    const key = jwks.keys?.find(k => k.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(sB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub || null;
  } catch { return null; }
}

// Quien puede EDITAR, MOVER o BORRAR un lead. Ver, buscar y filtrar es libre
// para toda la cuenta; esto solo gobierna los cambios.
//   · El dueño de la cuenta puede con todo.
//   · Un lead sin responsable esta libre: cualquiera del equipo lo gestiona.
//     Sin esto, el dia que se active la regla todos los leads existentes
//     quedarian bloqueados para el equipo hasta asignarlos uno a uno.
//   · Con responsable, SOLO ese responsable. Quien lo creo no cuenta: si
//     contara, reasignar no le quitaria el control al creador y reasignar
//     dejaria de significar traspasar la responsabilidad. Para que "los que yo
//     creo son mios" siga siendo cierto, un lead que crea un miembro nace
//     asignado a el — ver el POST.
function puedeGestionar(lead, actorId, esMiembro) {
  if (!esMiembro) return true;
  if (!lead) return false;
  if (!lead.assigned_to) return true;
  return lead.assigned_to === actorId;
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Etiquetas ────────────────────────────────────────────────────────────────
// Normalización canónica (misma regla que api/lead-tags.js): minúsculas,
// espacios colapsados, máx 30 chars, máx 15 etiquetas por lead.
function normalizeTag(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
}

const TAG_PALETTE = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EC4899','#14B8A6','#EF4444','#6366F1','#84CC16','#F97316'];
function tagColorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// Normaliza las etiquetas del lead, agrega la auto-etiqueta de fuente (si
// aplica) y garantiza que todas existan en el catálogo lead_tags con color.
//
// `puedeCrear` en false —un miembro que no es administrador— significa que
// puede PONER etiquetas del catálogo pero no inventarlas: el catálogo lo
// gobierna quien manda en la cuenta. Las que no existan se devuelven en
// `ignoradas` para que la interfaz lo diga; descartarlas en silencio dejaría
// al comercial creyendo que etiquetó.
//
// La auto-etiqueta de fuente se salva siempre de esa regla: no la escribe
// nadie, la pone el sistema, y bloquearla rompería la trazabilidad del origen.
async function prepareTags(userId, clientId, tags, source, puedeCrear = true) {
  const set = new Set((Array.isArray(tags) ? tags : []).map(normalizeTag).filter(t => t.length >= 2));
  let autoTag = null;
  if (source) {
    autoTag = normalizeTag(String(source).replace(/_/g, ' '));
    if (autoTag.length >= 2) set.add(autoTag);
  }
  let list = [...set].slice(0, 15);
  const ignoradas = [];
  if (!list.length) return { list: [], ignoradas };
  // Asegurar catálogo (fire-and-forget por etiqueta faltante)
  try {
    const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
    const exRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lead_tags?user_id=eq.${encodeURIComponent(userId)}${scope}&select=name`,
      { headers: sbHeaders() }
    );
    const existing = new Set(((await exRes.json()) || []).map(t => t.name));
    let missing = list.filter(t => !existing.has(t));
    if (!puedeCrear) {
      const vetadas = missing.filter(t => t !== autoTag);
      if (vetadas.length) {
        ignoradas.push(...vetadas);
        const fuera = new Set(vetadas);
        list = list.filter(t => !fuera.has(t));
        missing = missing.filter(t => !fuera.has(t));
      }
    }
    if (missing.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/lead_tags`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(missing.map(t => ({
          user_id: userId, client_id: clientId, name: t, color: tagColorFor(t),
          kind: t === autoTag ? 'auto' : 'manual',
        }))),
      });
    }
  } catch {} // el catálogo es best-effort — las etiquetas del lead no se bloquean
  return { list, ignoradas };
}

// Encola las automatizaciones que coincidan con el trigger (lead_created /
// stage_changed / tag_added). El motor las ejecuta en api/cron-automations.js.
// extra: la etapa nueva (stage_changed) o el array de etiquetas añadidas (tag_added).
async function enqueueAutomations(userId, lead, triggerType, extra) {
  try {
    const scope = lead.client_id ? `&client_id=eq.${lead.client_id}` : '&client_id=is.null';
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?user_id=eq.${userId}${scope}&active=eq.true&select=id,trigger`,
      { headers: sbHeaders() }
    );
    if (!r.ok) return;
    const autos = await r.json();
    let matching = (autos || []).filter(a => {
      if (a.trigger?.type !== triggerType) return false;
      if (triggerType === 'stage_changed') return !a.trigger.stage || a.trigger.stage === extra;
      if (triggerType === 'tag_added') return !a.trigger.tag || (extra || []).includes(a.trigger.tag);
      return true;
    });
    // tag_added: se dispara UNA sola vez por lead (dedupe con historial completo)
    // — evita bucles cuando una automatización etiqueta y otra reacciona a esa etiqueta
    if (triggerType === 'tag_added' && matching.length) {
      const checks = await Promise.all(matching.map(a =>
        fetch(`${SUPABASE_URL}/rest/v1/automation_jobs?automation_id=eq.${a.id}&lead_id=eq.${lead.id}&select=id&limit=1`, { headers: sbHeaders() })
          .then(res => res.json()).then(rows => ({ a, exists: !!rows?.length })).catch(() => ({ a, exists: true }))
      ));
      matching = checks.filter(c => !c.exists).map(c => c.a);
    }
    if (!matching.length) return;
    await fetch(`${SUPABASE_URL}/rest/v1/automation_jobs`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(matching.map(a => ({
        automation_id: a.id, user_id: userId, lead_id: lead.id,
        step_index: 0, status: 'pending', run_at: new Date().toISOString(),
      }))),
    });
  } catch (e) { console.error('enqueueAutomations:', e.message); }
}


// ── Capacidad del plan ───────────────────────────────────────────────────────
// Un solo sitio que sepa el límite: lo usan el aviso de la UI, la creación
// individual y el importador.
const PLAN_LEADS = { free: 50, pro: 1000, individual: 1000, trial: 1000, agency: 5000, agencia: 5000 };
function limiteDelPlan(plan, extra) {
  return (PLAN_LEADS[plan] || 10) + (parseInt(extra || 0) || 0) * 1000;
}
// Los teléfonos de una base real vienen de mil formas: "+57 310 555 1234",
// "(1) 3105551234", "310-555-1234". Se comparan por los últimos 10 dígitos,
// que es lo que identifica a la persona sin depender del formato ni del país.
export function telClave(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-10) : '';
}

async function contarLeads(userId, filtroExtra = '&deleted_at=is.null') {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}${filtroExtra}&select=id&limit=0`,
    { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } }
  );
  return parseInt((r.headers.get('content-range') || '*/0').split('/')[1] || '0') || 0;
}

// Pipeline principal del ambito (cuenta o cliente). Devuelve null si la tabla
// todavia no existe: en ese caso el lead se crea sin pipeline, como antes.
async function pipelinePrincipal(userId, clientId) {
  try {
    const scope = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/pipelines?user_id=eq.${encodeURIComponent(userId)}${scope}&select=id,is_default&order=position.asc`,
      { headers: sbHeaders() }
    );
    if (!r.ok) return null;
    const filas = await r.json();
    if (!Array.isArray(filas) || !filas.length) return null;
    return (filas.find(p => p.is_default) || filas[0]).id;
  } catch { return null; }}

async function manejar(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Equipo: si soy miembro activo de un workspace, opero sobre los datos del dueño
  // actorId es la PERSONA que hace la peticion; userId pasa a ser la CUENTA.
  // Hasta ahora se perdia el primero al resolver el dueño, y sin el no hay
  // forma de saber que leads puede gestionar quien pregunta.
  const actorId = userId;
  let actorNombre = null;
  let rolMiembro = null;
  // Si esta consulta falla NO se puede seguir: sin ella un miembro operaria
  // sobre su propia cuenta en vez de la del dueño, y devolveriamos datos de
  // otra cuenta como si fueran los suyos. Mejor un error que el tablero de
  // otro. (Un array vacio si es valido: significa que no es miembro.)
  try {
    const _twRes = await fetch(`${SUPABASE_URL}/rest/v1/team_members?member_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=owner_user_id,member_name,member_email,role&limit=1`, { headers: sbHeaders() });
    if (!_twRes.ok) throw new Error('HTTP ' + _twRes.status);
    const _tw = (await _twRes.json())?.[0];
    if (_tw && _tw.owner_user_id) { userId = _tw.owner_user_id; actorNombre = _tw.member_name || _tw.member_email || null; rolMiembro = _tw.role || null; }
  } catch (e) {
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }
  // Miembro del equipo: ve todo, pero solo gestiona lo suyo.
  const esMiembro = actorId !== userId;
  // El catálogo de etiquetas es de la cuenta: ponerlas es de todos, inventarlas
  // no. Ver prepareTags().
  const puedeCrearEtiquetas = !esMiembro || rolMiembro === 'admin';


  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') || null;

  // Build base filter: user_id + optional client_id + not deleted
  const scopeFilter = clientId
    ? `user_id=eq.${userId}&client_id=eq.${clientId}&deleted_at=is.null`
    : `user_id=eq.${userId}&deleted_at=is.null`;


  // Reglas de retención automática (las aplica cron-retention a diario)
  if (url.searchParams.get('action') === 'retention' && (req.method === 'GET' || req.method === 'PUT')) {
    const RET_KEY = '__retention_rules__';
    if (req.method === 'GET') {
      const rows = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&agent_key=eq.${RET_KEY}&select=profile_data&limit=1`,
        { headers: sbHeaders() }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      return jsonResp({ reglas: rows?.[0]?.profile_data || { perdidos_dias: 0, sin_actividad_dias: 0 } });
    }
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const reglas = {
      perdidos_dias: Math.max(0, parseInt(body?.perdidos_dias || 0) || 0),
      sin_actividad_dias: Math.max(0, parseInt(body?.sin_actividad_dias || 0) || 0),
    };
    // on_conflict obligatorio o el segundo guardado choca con el índice único
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, agent_key: RET_KEY, profile_data: reglas, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ reglas });
  }

  // POST ?action=cleanup — limpieza de la base para liberar cupo
  // Siempre se puede pedir la previsualización (dry_run) antes de borrar: la
  // idea es que nadie vacíe medio CRM sin ver primero a cuántos afecta.
  if (req.method === 'POST' && url.searchParams.get('action') === 'cleanup') {
    // Borrado masivo: decision de cuenta, no de un miembro.
    if (esMiembro) return jsonResp({ error: 'Solo el usuario principal puede hacer limpiezas masivas.', sin_permiso: true }, 403);
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const {
      stages = [],          // etapas a limpiar, ej: ['perdido']
      sources = [],         // fuentes, ej: ['importacion']
      dias_sin_actividad,   // sin updated_at reciente
      creados_antes_de,     // fecha ISO
      sin_contacto = false, // sin email y sin teléfono
      dry_run = true,
      limite = 2000,        // tope de seguridad por ejecución
    } = body || {};

    let q = `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null`;
    if (clientId) q += `&client_id=eq.${encodeURIComponent(clientId)}`;
    if (Array.isArray(stages) && stages.length) q += `&stage=in.(${stages.map(x => '"' + String(x).replace(/"/g, '') + '"').join(',')})`;
    if (Array.isArray(sources) && sources.length) q += `&source=in.(${sources.map(x => '"' + String(x).replace(/"/g, '') + '"').join(',')})`;
    if (creados_antes_de) q += `&created_at=lt.${encodeURIComponent(creados_antes_de)}`;
    if (dias_sin_actividad) {
      const corte = new Date(Date.now() - Number(dias_sin_actividad) * 86400000).toISOString();
      q += `&updated_at=lt.${encodeURIComponent(corte)}`;
    }
    if (sin_contacto) q += '&email=is.null&phone=is.null';

    // Nunca se tocan los ganados: son el histórico de facturación
    q += '&stage=neq.ganado';

    const rows = await fetch(`${q}&select=id,name,stage,source,created_at,updated_at&order=created_at.asc&limit=${Math.min(Number(limite) || 2000, 5000)}`,
      { headers: sbHeaders() }).then(r => r.json()).catch(() => []);
    const ids = (rows || []).map(r => r.id);

    if (dry_run !== false) {
      const porEtapa = {};
      (rows || []).forEach(r => { porEtapa[r.stage || '—'] = (porEtapa[r.stage || '—'] || 0) + 1; });
      return jsonResp({
        dry_run: true, afectados: ids.length, por_etapa: porEtapa,
        muestra: (rows || []).slice(0, 10).map(r => ({ name: r.name, stage: r.stage, source: r.source, created_at: r.created_at })),
      });
    }
    if (!ids.length) return jsonResp({ borrados: 0 });

    // Borrado lógico: sale del cupo al instante y queda 30 días recuperable
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.join(',')})`, {
      method: 'PATCH', headers: sbHeaders(),
      body: JSON.stringify({ deleted_at: new Date().toISOString() }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ borrados: ids.length });
  }

  // GET ?trash=1 — qué hay en la papelera (recuperable 30 días)
  if (req.method === 'GET' && url.searchParams.get('trash')) {
    const rows = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}&deleted_at=not.is.null&select=id,name,email,phone,stage,source,deleted_at&order=deleted_at.desc&limit=500`,
      { headers: sbHeaders() }
    ).then(r => r.json()).catch(() => []);
    return jsonResp({ leads: rows || [] });
  }

  // POST ?action=restore — sacar de la papelera
  if (req.method === 'POST' && url.searchParams.get('action') === 'restore') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
    if (!ids.length) return jsonResp({ error: 'Sin ids' }, 400);
    // Restaurar no puede saltarse el cupo del plan
    const meta = await clerkMeta(userId);
    const limite = limiteDelPlan(meta.plan || 'free', meta.leads_extra);
    const usados = await contarLeads(userId);
    if (usados + ids.length > limite) {
      return jsonResp({ error: `No caben: tienes ${usados} de ${limite}. Libera espacio antes de restaurar.` }, 409);
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${ids.join(',')})&user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: sbHeaders(), body: JSON.stringify({ deleted_at: null }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ restaurados: ids.length });
  }

  // GET ?usage=1 — cupo del plan: usados, límite y papelera
  if (req.method === 'GET' && url.searchParams.get('usage')) {
    let plan = 'free', extra = 0;
    try {
      const payload = JSON.parse(atob((req.headers.get('Authorization') || '').replace('Bearer ', '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      plan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
      extra = payload.public_metadata?.leads_extra || payload.publicMetadata?.leads_extra || 0;
    } catch {}
    if (plan === 'free') {
      // El token v2 de Clerk ya no trae el plan: hay que preguntárselo
      const meta = await clerkMeta(userId);
      if (meta.plan) plan = meta.plan;
      if (meta.leads_extra) extra = meta.leads_extra;
    }
    const [usados, papelera] = await Promise.all([
      contarLeads(userId),
      contarLeads(userId, '&deleted_at=not.is.null'),
    ]);
    const limite = limiteDelPlan(plan, extra);
    return jsonResp({
      plan, limite, usados, papelera,
      disponibles: Math.max(0, limite - usados),
      porcentaje: limite ? Math.round(usados / limite * 100) : 0,
    });
  }

  // GET — list leads
  if (req.method === 'GET' && !url.searchParams.get('id')) {
    const stage = url.searchParams.get('stage');
    // Sin pipeline_id devuelve todos, como antes: asi la app sigue viva si la
    // migracion de pipelines aun no se ha corrido.
    const pipelineId = url.searchParams.get('pipeline_id');
    let query = `${SUPABASE_URL}/rest/v1/leads?${scopeFilter}&select=*&order=stage_position.asc,created_at.desc`;
    if (pipelineId) query += `&pipeline_id=eq.${encodeURIComponent(pipelineId)}`;
    if (stage) query += `&stage=eq.${encodeURIComponent(stage)}`;
    const res = await fetch(query, { headers: sbHeaders() });
    const rows = await res.json();
    return jsonResp({ leads: rows || [], actor_id: actorId, es_miembro: esMiembro });
  }

  // GET single lead
  if (req.method === 'GET' && url.searchParams.get('id')) {
    const id = url.searchParams.get('id');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}&deleted_at=is.null&select=*`,
      { headers: sbHeaders() }
    );
    const rows = await res.json();
    if (!rows?.[0]) return jsonResp({ error: 'No encontrado' }, 404);
    return jsonResp({ lead: rows[0] });
  }

  // POST ?action=import — importación masiva (CSV/pegado desde el wizard).
  // Dedupe por email en el scope, respeta el límite de plan y NO dispara
  // automatizaciones (una importación de miles no debe detonar flujos de
  // lead nuevo — para eso está la etiqueta de importación + campañas).
  if (req.method === 'POST' && url.searchParams.get('action') === 'import') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const rows = Array.isArray(body.leads) ? body.leads.slice(0, 300) : [];
    if (!rows.length) return jsonResp({ error: 'Sin filas para importar' }, 400);
    const opts = body.options || {};
    const dedupe = opts.dedupe === 'update' ? 'update' : 'skip';
    const stage = String(opts.stage || 'nuevo').slice(0, 40);
    const importTags = Array.isArray(opts.tags) ? opts.tags : [];

    // Límite de plan (mismo cálculo que la creación individual)
    let userPlan = 'free', leadsExtra = 0;
    try {
      const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      userPlan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
      leadsExtra = parseInt(payload.public_metadata?.leads_extra || payload.publicMetadata?.leads_extra || 0);
    } catch {}
    if (userPlan === 'free') {
      const meta = await clerkMeta(userId);
      if (meta.plan) userPlan = meta.plan;
      if (meta.leads_extra) leadsExtra = parseInt(meta.leads_extra) || 0;
    }
    const PLAN_LIMITS_IMP = { free: 50, pro: 1000, individual: 1000, trial: 1000, agency: 5000, agencia: 5000 };
    const planLimit = (PLAN_LIMITS_IMP[userPlan] || 10) + (leadsExtra * 1000);
    const countRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}&deleted_at=is.null&select=id&limit=0`, { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } });
    let currentCount = parseInt((countRes.headers.get('content-range') || '*/0').split('/')[1] || '0') || 0;

    // Duplicados: por correo y TAMBIÉN por teléfono. En una base que viene de
    // WhatsApp la mitad de la gente no tiene correo, y sin esto cada archivo
    // que se solape con el anterior vuelve a crear a las mismas personas —
    // gastando cupo del plan y ensuciando los informes.
    const emails = rows.map(r => String(r.email || '').trim().toLowerCase()).filter(Boolean);
    const scope = clientId ? `&client_id=eq.${clientId}` : '&client_id=is.null';
    let existingByEmail = {}, existingByPhone = {};
    if (emails.length) {
      const exRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}${scope}&deleted_at=is.null&email=in.(${emails.map(e => '"' + e.replace(/"/g, '') + '"').join(',')})&select=id,email,tags`, { headers: sbHeaders() });
      ((await exRes.json()) || []).forEach(l => { existingByEmail[(l.email || '').toLowerCase()] = l; });
    }
    const telesLote = rows.map(r => telClave(r.phone)).filter(Boolean);
    if (telesLote.length) {
      // No se puede filtrar por "últimos 10 dígitos" en PostgREST, así que se
      // trae el índice de teléfonos del scope y se compara aquí. Va paginado:
      // Supabase corta cualquier consulta en 1.000 filas aunque se pida más, y
      // con el índice a medias el importador volvía a crear a gente que ya
      // estaba en la base.
      const PAGINA = 1000, MAX_PAGINAS = 12;
      for (let p = 0; p < MAX_PAGINAS; p++) {
        const tRes = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}${scope}&deleted_at=is.null&phone=not.is.null&select=id,phone,email,tags&order=created_at.asc&limit=${PAGINA}&offset=${p * PAGINA}`,
          { headers: sbHeaders() }
        );
        const pagina = (await tRes.json()) || [];
        pagina.forEach(l => {
          const k = telClave(l.phone);
          if (k && !existingByPhone[k]) existingByPhone[k] = l;
        });
        if (pagina.length < PAGINA) break;
      }
    }

    // Los contactos importados van al pipeline pedido o al principal; sin esto
    // quedarian sin pipeline y no se verian en ningun tablero.
    const pipelineImport = body.pipeline_id || await pipelinePrincipal(userId, clientId);

    const result = { created: 0, updated: 0, skipped: 0, invalid: 0, limit_reached: false };
    const toInsert = [];
    const seenInBatch = new Set();
    for (const r of rows) {
      const name = String(r.name || '').trim().slice(0, 120);
      let email = String(r.email || '').trim().toLowerCase().slice(0, 200) || null;
      const tel = telClave(r.phone);
      // Un correo mal escrito no es motivo para tirar el contacto: se descarta
      // el correo y se queda la persona con su nombre y su teléfono.
      let correoMalo = false;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { email = null; correoMalo = true; }
      if (!name && !email && !tel) { result.invalid++; continue; }
      if (correoMalo) result.email_invalido = (result.email_invalido || 0) + 1;
      if (email && seenInBatch.has(email)) { result.skipped++; continue; }
      // El mismo teléfono dos veces en el mismo archivo es la misma persona,
      // tenga correo o no: si solo se mira el correo, las dos copias entran.
      if (tel && seenInBatch.has('t:' + tel)) { result.skipped++; continue; }
      if (email) seenInBatch.add(email);
      if (tel) seenInBatch.add('t:' + tel);
      const rowTags = [...importTags, ...(Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(','))];
      const _prepImp = await prepareTags(userId, clientId, rowTags, null, puedeCrearEtiquetas);
      const cleanTags = _prepImp.list;
      // Importar con etiquetas nuevas sin poder crearlas: se acumulan para
      // decirlo al final, no se pierden en silencio fila por fila.
      if (_prepImp.ignoradas.length) {
        result.tags_ignoradas = [...new Set([...(result.tags_ignoradas || []), ..._prepImp.ignoradas])];
      }

      const existing = (email ? existingByEmail[email] : null) || (tel ? existingByPhone[tel] : null);
      if (existing) {
        if (dedupe === 'skip') { result.skipped++; continue; }
        const mergedTags = [...new Set([...(existing.tags || []), ...cleanTags])].slice(0, 15);
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existing.id}&user_id=eq.${userId}`, {
          method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            ...(name ? { name } : {}),
            ...(r.phone ? { phone: String(r.phone).trim().slice(0, 40) } : {}),
            ...(r.company ? { company: String(r.company).trim().slice(0, 120) } : {}),
            ...(r.value ? { value: parseFloat(String(r.value).replace(/[^\d.]/g, '')) || null } : {}),
            tags: mergedTags, updated_at: new Date().toISOString(),
          }),
        });
        result.updated++;
        continue;
      }
      if (currentCount + toInsert.length >= planLimit) { result.limit_reached = true; result.skipped++; continue; }
      toInsert.push({
        user_id: userId, client_id: clientId,
        name: name || email || (r.phone ? String(r.phone).trim() : 'Sin nombre'), email,
        phone: r.phone ? String(r.phone).trim().slice(0, 40) : null,
        company: r.company ? String(r.company).trim().slice(0, 120) : null,
        value: r.value ? parseFloat(String(r.value).replace(/[^\d.]/g, '')) || null : null,
        notes: r.notes ? String(r.notes).trim().slice(0, 1000) : null,
        stage, stage_position: 0,
        source: 'importacion',
        tags: cleanTags,
        custom_fields: {},
        ...(pipelineImport ? { pipeline_id: pipelineImport } : {}),
      });
    }
    if (toInsert.length) {
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: 'POST', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(toInsert),
      });
      if (!insRes.ok) return jsonResp({ error: 'Error insertando: ' + (await insRes.text()).slice(0, 200) }, 500);
      result.created = toInsert.length;
    }
    return jsonResp({ ok: true, result, plan_limit: planLimit, current: currentCount + result.created });
  }

  // POST — create lead
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { name, email, phone, company, stage, notes, source, tags, custom_fields } = body;
    if (!name) return jsonResp({ error: 'El nombre es requerido' }, 400);

    // Etiquetas: normalizar + auto-tag por fuente + asegurar catálogo
    const _tagsPrep = await prepareTags(userId, clientId, tags, source || 'manual', puedeCrearEtiquetas);
    const leadTags = _tagsPrep.list;
    const tagsIgnoradas = _tagsPrep.ignoradas;

    // Plan-based lead limit check
    let userPlan = 'free';
    let leadsExtra = 0;
    try {
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.replace('Bearer ', '');
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        userPlan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
        leadsExtra = parseInt(payload.public_metadata?.leads_extra || payload.publicMetadata?.leads_extra || 0);
      }
    } catch {}
    if (userPlan === 'free') {
      const meta = await clerkMeta(userId);
      if (meta.plan) userPlan = meta.plan;
      if (meta.leads_extra) leadsExtra = parseInt(meta.leads_extra) || 0;
    }
    const PLAN_LIMITS = { free: 50, pro: 1000, individual: 1000, trial: 1000, agency: 5000, agencia: 5000 };
    const planLimit = (PLAN_LIMITS[userPlan] || 10) + (leadsExtra * 1000);
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}&deleted_at=is.null&select=id&limit=0`,
      { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } }
    );
    const rawRange = countRes.headers.get('content-range') || '*/0';
    const currentCount = parseInt(rawRange.split('/')[1] || '0') || 0;
    if (currentCount >= planLimit) {
      return jsonResp({ error: 'Límite de leads alcanzado para tu plan.', limit_reached: true, current: currentCount, limit: planLimit }, 403);
    }

    // Get max position in target stage for ordering
    const posRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${userId}&${clientId ? `client_id=eq.${clientId}` : 'client_id=is.null'}&deleted_at=is.null&stage=eq.${encodeURIComponent(stage || 'nuevo')}&select=stage_position&order=stage_position.desc&limit=1`,
      { headers: sbHeaders() }
    );
    const posRows = await posRes.json();
    const maxPos = posRows?.[0]?.stage_position ?? 0;

    const payload = {
      user_id: userId,
      client_id: clientId,
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      company: company?.trim() || null,
      stage: stage || 'nuevo',
      stage_position: maxPos + 1000,
      notes: notes?.trim() || null,
      source: source || 'manual',
      tags: leadTags,
      custom_fields: custom_fields || {},
      created_by: actorId,
    };
    // El importe se perdía al crear: el formulario lo manda pero el POST nunca
    // lo copiaba, así que solo sobrevivía si luego editabas el lead. El total
    // del pipeline salía corto y nadie sabía por qué.
    const _valor = parseFloat(body.value);
    if (Number.isFinite(_valor) && _valor > 0) payload.value = _valor;

    // Fecha esperada de cierre: opcional, formato AAAA-MM-DD. Se valida el
    // formato para no mandarle basura a una columna `date` — un texto libre
    // haría fallar el insert entero y el lead se perdería por un campo
    // accesorio.
    if (typeof body.expected_close_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expected_close_date)) {
      payload.expected_close_date = body.expected_close_date;
    }
    // Un lead creado por un miembro nace asignado a el: asi "los que yo creo
    // son mios" sigue siendo cierto sin que el creador conserve el control tras
    // una reasignacion. Los del usuario principal nacen sin asignar, para que
    // pueda repartirlos.
    if (body.assigned_to) {
      payload.assigned_to = body.assigned_to;
      payload.assigned_name = body.assigned_name || null;
    } else if (esMiembro) {
      payload.assigned_to = actorId;
      payload.assigned_name = actorNombre;
    }
    // ── Aviso de duplicado ──────────────────────────────────────────────────
    // Las fuentes automáticas fusionan por correo o teléfono; el alta a mano no
    // miraba nada. La misma persona que llama dos veces acababa como dos fichas
    // en el tablero, cada una con su historia a medias. Aquí no se fusiona —eso
    // sería decidir por quien escribe— se avisa y se deja elegir.
    if (!body.forzar && (payload.email || payload.phone)) {
      const alcance = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '&client_id=is.null';
      let ya = null;
      if (payload.email) {
        ya = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}${alcance}` +
          `&email=eq.${encodeURIComponent(payload.email)}&deleted_at=is.null&select=id,name,stage,assigned_name&limit=1`,
          { headers: sbHeaders() }
        ).then(r => (r.ok ? r.json() : [])).then(r => r?.[0]).catch(() => null);
      }
      if (!ya && payload.phone) {
        // Por los últimos 10 dígitos: el mismo número se escribe con +57, con
        // espacios o sin nada, y una comparación literal no encontraría nada.
        const digitos = String(payload.phone).replace(/\D/g, '');
        if (digitos.length >= 7) {
          const cola = digitos.slice(-10);
          const candidatos = await fetch(
            `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(userId)}${alcance}` +
            `&phone=not.is.null&deleted_at=is.null&select=id,name,stage,assigned_name,phone&order=created_at.desc&limit=500`,
            { headers: sbHeaders() }
          ).then(r => (r.ok ? r.json() : [])).catch(() => []);
          ya = (candidatos || []).find(l => String(l.phone).replace(/\D/g, '').endsWith(cola)) || null;
        }
      }
      if (ya) {
        return jsonResp({
          duplicado: {
            id: ya.id, name: ya.name, stage: ya.stage,
            assigned_name: ya.assigned_name || null,
          },
        }, 409);
      }
    }

    // El lead cae en el pipeline que pida el cliente o, si no, en el principal
    const pipeline = body.pipeline_id || await pipelinePrincipal(userId, clientId);
    if (pipeline) payload.pipeline_id = pipeline;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    // Triggers de automatizaciones: lead creado + etiquetas iniciales
    if (rows[0]) {
      await enqueueAutomations(userId, rows[0], 'lead_created');
      // Aviso al móvil de quien lo va a atender. Si el lead nace asignado va a
      // esa persona; si no, al dueño de la cuenta, que es quien reparte.
      // Nunca bloquea ni rompe el alta: un lead guardado vale más que su aviso.
      try {
        const destinatario = rows[0].assigned_to || userId;
        await enviarPushA(destinatario, {
          titulo: 'Lead nuevo: ' + (rows[0].name || 'sin nombre'),
          texto: (rows[0].phone || rows[0].email || '') + ' · ' + (rows[0].source || 'manual'),
          url: '/crm?lead=' + rows[0].id,
          etiqueta: 'lead-nuevo',
        });
      } catch (e) { console.error('[push] lead nuevo:', e.message); }
      if (leadTags.length) await enqueueAutomations(userId, rows[0], 'tag_added', leadTags);
    }
    return jsonResp({ lead: rows[0], tags_ignoradas: tagsIgnoradas }, 201);
  }

  // PUT — update lead (including stage move)
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const { id, ...fields } = body;
    if (!id) return jsonResp({ error: 'Falta id' }, 400);

    // ¿Puede esta persona tocar este lead?
    if (esMiembro) {
      const act = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}&select=assigned_to,assigned_name,created_by`, { headers: sbHeaders() });
      const lead = (await act.json().catch(() => []))?.[0];
      if (!lead) return jsonResp({ error: 'Lead no encontrado' }, 404);
      if (!puedeGestionar(lead, actorId, esMiembro)) {
        return jsonResp({
          error: 'Este lead está asignado a ' + (lead.assigned_name || 'otra persona') + '. Solo esa persona o el usuario principal pueden modificarlo.',
          sin_permiso: true,
        }, 403);
      }
      // Reasignar es decision del usuario principal, no del equipo
      if (fields.assigned_to !== undefined || fields.assigned_name !== undefined) {
        return jsonResp({ error: 'Solo el usuario principal puede cambiar el responsable de un lead.', sin_permiso: true }, 403);
      }
    }

    // Only allow safe fields
    const allowed = ['name','email','phone','company','stage','stage_position','notes','source','tags','custom_fields','value','assigned_to','assigned_name','close_reason','close_currency','closed_at','expected_close_date'];
    const update = {};
    for (const k of allowed) {
      if (fields[k] !== undefined) update[k] = fields[k];
    }
    // Etiquetas editadas: normalizar y asegurar catálogo (sin auto-tag de fuente)
    let tagsIgnoradas = [];
    if (update.tags !== undefined) {
      const _prep = await prepareTags(userId, clientId, update.tags, null, puedeCrearEtiquetas);
      update.tags = _prep.list;
      tagsIgnoradas = _prep.ignoradas;
    }
    update.updated_at = new Date().toISOString();

    // Si cambia la etapa o las etiquetas, capturar el estado anterior para los triggers
    let prevStage = null;
    let prevTags = null;
    if (update.stage !== undefined || update.tags !== undefined) {
      try {
        const pre = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}&select=stage,tags`, { headers: sbHeaders() });
        const prev = (await pre.json())?.[0];
        prevStage = prev?.stage ?? null;
        prevTags = prev?.tags ?? [];
      } catch {}
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    // Trigger de automatizaciones: cambio de etapa real
    if (rows[0] && update.stage !== undefined && prevStage !== null && prevStage !== update.stage) {
      await enqueueAutomations(userId, rows[0], 'stage_changed', update.stage);
    }
    // Trigger: etiquetas añadidas en esta edición
    if (rows[0] && update.tags !== undefined && prevTags !== null) {
      const added = (update.tags || []).filter(t => !prevTags.includes(t));
      if (added.length) await enqueueAutomations(userId, rows[0], 'tag_added', added);
    }
    return jsonResp({ lead: rows[0], tags_ignoradas: tagsIgnoradas });
  }

  // DELETE — soft delete
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    if (esMiembro) {
      const act = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}&select=assigned_to,assigned_name,created_by`, { headers: sbHeaders() });
      const lead = (await act.json().catch(() => []))?.[0];
      if (!lead) return jsonResp({ error: 'Lead no encontrado' }, 404);
      if (!puedeGestionar(lead, actorId, esMiembro)) {
        return jsonResp({
          error: 'Este lead está asignado a ' + (lead.assigned_name || 'otra persona') + '. Solo esa persona o el usuario principal pueden eliminarlo.',
          sin_permiso: true,
        }, 403);
      }
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${id}&user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: sbHeaders(),
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}

// Envuelto para que una excepción no se convierta en un 500 mudo: queda
// registrada en error_log y el cron de la hora siguiente avisa.
export default conErrores('leads', manejar);
