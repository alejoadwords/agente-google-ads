// api/team.js
// Equipo y asientos: el dueño invita miembros por email (link firmado); el
// miembro se registra con Clerk y al canjear el token queda vinculado al
// workspace del dueño. Los endpoints core (leads, agenda, etiquetas, inbox)
// resuelven member→owner para que el equipo trabaje sobre los mismos datos.
// Asientos por plan (incluyen al dueño): Free/Pro 1 (invitar = upsell a
// Agency), Agency 3. Admin sin límite. Add-on de asientos extra: futuro
// (patrón leads_extra en el JWT: seats_extra).
export const config = { runtime: 'edge' };

import { quienPregunta, gestionaEquipo, normalizarPerfil, puedeTocarA, paraElCliente, PERFILES } from './_perfiles.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

// Trae la fila del equipo comprobando que es de ESTA cuenta. Sin el filtro por
// owner_user_id, un id de otra cuenta se podría tocar desde aquí.
async function filaDelEquipo(cuenta, id) {
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?id=eq.${encodeURIComponent(id)}&owner_user_id=eq.${encodeURIComponent(cuenta)}&select=id,member_user_id,member_email,role,status&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return filas?.[0] || null;
}

// ── QUÉ SE LLEVA CONSIGO QUIEN SE VA ────────────────────────────────────────
// Un asesor no solo tiene leads. También puede ser el destino fijo de un
// formulario web o estar dentro del reparto de una rama de un conector. Si se
// le quita sin mirar eso, sus leads quedan apuntando a un fantasma —fuera del
// filtro «Míos» de todos, sin que nadie los llame— y los leads NUEVOS de esa
// fuente dejan de asignarse a nadie, en silencio.
//
// Las tareas y la agenda no se cuentan aparte: `activities` no tiene
// responsable propio, una tarea es de quien tenga su lead. Al mover los leads
// se mueven con ellos.
const CARGA_VACIA = { total: 0, leads: 0, abiertos: 0, formularios: 0, reglas: 0, fuentes: 0 };

async function cargaDe(cuenta, suyo) {
  const cuenta1 = (ruta) => fetch(`${SUPABASE_URL}/rest/v1${ruta}`, {
    headers: { ...sbHeaders(), Prefer: 'count=exact', Range: '0-0' },
  }).then(r => Number((r.headers.get('content-range') || '0-0/0').split('/')[1]) || 0).catch(() => 0);

  const base = `user_id=eq.${encodeURIComponent(cuenta)}&assigned_to=eq.${encodeURIComponent(suyo)}`;
  const [leads, abiertos, formularios, forms] = await Promise.all([
    cuenta1(`/leads?${base}&deleted_at=is.null&select=id`),
    cuenta1(`/leads?${base}&deleted_at=is.null&stage=not.in.(ganado,perdido,won,lost)&select=id`),
    cuenta1(`/lead_forms?user_id=eq.${encodeURIComponent(cuenta)}&assigned_to=eq.${encodeURIComponent(suyo)}&select=id`),
    fetch(`${SUPABASE_URL}/rest/v1/lead_forms?user_id=eq.${encodeURIComponent(cuenta)}&reglas=not.is.null&select=id,reglas`, { headers: sbHeaders() })
      .then(r => (r.ok ? r.json() : [])).catch(() => []),
  ]);

  const reglas = (forms || []).filter(f => reglaNombra(f.reglas, suyo)).length;

  // La regla general de la cuenta pesa más que todo lo anterior: en Certain,
  // una sola persona es el destino fijo de SEIS fuentes. Quitarla sin tocar
  // eso deja seis orígenes de leads sin asignar a nadie, en silencio.
  const fuentes = (Object.values((await reglasDeCuenta(cuenta)).reglas || {}))
    .filter(r => r && r.fijo === suyo).length;

  return { total: leads + formularios + reglas + fuentes, leads, abiertos, formularios, reglas, fuentes };
}

async function reglasDeCuenta(cuenta) {
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(cuenta)}&agent_key=eq.__assign_rules__&select=profile_data&limit=1`,
    { headers: sbHeaders() }).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return filas?.[0]?.profile_data || {};
}

// ¿Las reglas de destino de este conector nombran a esta persona? Mira tanto
// el reparto fijo («quien») como las listas de turnos («entre»).
function reglaNombra(reglas, suyo) {
  if (!reglas || typeof reglas !== 'object') return false;
  const ramas = [...(Array.isArray(reglas.casos) ? reglas.casos : []), reglas.sino].filter(Boolean);
  return ramas.some(c => {
    const r = c && c.reparto;
    if (!r) return false;
    if (r.quien === suyo) return true;
    return Array.isArray(r.entre) && r.entre.includes(suyo);
  });
}

// Cambia a la persona dentro de una regla. En una lista de turnos NO se
// duplica al destino si ya estaba: repartir entre [A, A, B] le daría a A el
// doble de leads sin que nadie lo hubiera pedido.
function reglaCambiada(reglas, suyo, destino) {
  const toca = (c) => {
    const r = c && c.reparto;
    if (!r) return c;
    if (r.quien === suyo) return { ...c, reparto: { ...r, quien: destino } };
    if (Array.isArray(r.entre) && r.entre.includes(suyo)) {
      const sin = r.entre.filter(x => x !== suyo);
      return { ...c, reparto: { ...r, entre: sin.includes(destino) ? sin : [...sin, destino] } };
    }
    return c;
  };
  return {
    ...reglas,
    casos: Array.isArray(reglas.casos) ? reglas.casos.map(toca) : reglas.casos,
    sino: reglas.sino ? toca(reglas.sino) : reglas.sino,
  };
}

async function miembroActivo(cuenta, memberUserId) {
  if (!memberUserId) return null;
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(cuenta)}` +
    `&member_user_id=eq.${encodeURIComponent(memberUserId)}&status=eq.active&select=member_user_id,member_name,member_email&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  return filas?.[0] || null;
}

// Nombre con el que se sella `assigned_name`. La ficha del lead lo enseña tal
// cual, así que dejarlo desfasado se ve en pantalla enseguida.
async function nombreDe(cuenta, quienId) {
  if (quienId === cuenta) {
    const u = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(quienId)}&select=name,email&limit=1`,
      { headers: sbHeaders() }).then(r => (r.ok ? r.json() : [])).catch(() => []);
    return u?.[0]?.name || u?.[0]?.email || 'Dueño de la cuenta';
  }
  const m = await miembroActivo(cuenta, quienId);
  return m?.member_name || m?.member_email || 'Sin nombre';
}

async function traspasar(cuenta, suyo, destino) {
  const nombre = await nombreDe(cuenta, destino);
  const movido = { leads: 0, formularios: 0, reglas: 0, fuentes: 0, hacia: nombre };

  const rLeads = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${encodeURIComponent(cuenta)}&assigned_to=eq.${encodeURIComponent(suyo)}&deleted_at=is.null`,
    { method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=representation' },
      // updated_at a propósito: la inactividad de un lead cuelga de ese campo y
      // un traspaso es actividad — si no, el nuevo responsable hereda leads que
      // ya nacen marcados como olvidados.
      body: JSON.stringify({ assigned_to: destino, assigned_name: nombre, updated_at: new Date().toISOString() }) }
  );
  if (rLeads.ok) movido.leads = ((await rLeads.json()) || []).length;

  const rForms = await fetch(
    `${SUPABASE_URL}/rest/v1/lead_forms?user_id=eq.${encodeURIComponent(cuenta)}&assigned_to=eq.${encodeURIComponent(suyo)}`,
    { method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({ assigned_to: destino }) }
  );
  if (rForms.ok) movido.formularios = ((await rForms.json()) || []).length;

  // Las reglas de destino van una por una: cada conector tiene su jsonb y no
  // hay forma de reescribirlas en bloque sin pisar las ramas que no le tocan.
  const forms = await fetch(
    `${SUPABASE_URL}/rest/v1/lead_forms?user_id=eq.${encodeURIComponent(cuenta)}&reglas=not.is.null&select=id,reglas`,
    { headers: sbHeaders() }).then(r => (r.ok ? r.json() : [])).catch(() => []);
  for (const f of forms || []) {
    if (!reglaNombra(f.reglas, suyo)) continue;
    const ok = await fetch(`${SUPABASE_URL}/rest/v1/lead_forms?id=eq.${f.id}`, {
      method: 'PATCH', headers: sbHeaders(),
      body: JSON.stringify({ reglas: reglaCambiada(f.reglas, suyo, destino) }),
    });
    if (ok.ok) movido.reglas++;
  }

  // Y la regla general de la cuenta: si el que se va era el destino «fijo» de
  // una fuente, los leads nuevos de esa fuente se quedarían sin dueño.
  try {
    const blobs = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(cuenta)}&agent_key=eq.__assign_rules__&select=profile_data&limit=1`,
      { headers: sbHeaders() }).then(r => (r.ok ? r.json() : [])).catch(() => []);
    const blob = blobs?.[0]?.profile_data;
    const reglas = blob && blob.reglas;
    const cuantas = reglas ? Object.values(reglas).filter(r => r && r.fijo === suyo).length : 0;
    if (cuantas) {
      const nuevas = {};
      for (const [k, r] of Object.entries(reglas)) nuevas[k] = (r && r.fijo === suyo) ? { ...r, fijo: destino } : r;
      await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=user_id,agent_key`, {
        method: 'POST',
        headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: cuenta, agent_key: '__assign_rules__', profile_data: { ...blob, reglas: nuevas } }),
      });
      movido.fuentes = cuantas;
    }
  } catch { /* la regla general es una mejora, no puede tumbar el traspaso */ }

  return movido;
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

/**
 * El correo PRINCIPAL y VERIFICADO, o cadena vacía.
 *
 * Distinto de clerkEmail() a propósito, y la diferencia es de seguridad: atar
 * una invitación por correo sin exigir verificación deja que cualquiera se
 * registre con el correo de otro y entre a su CRM. clerkEmail() sigue como
 * estaba para lo demás —comparar con el propio, mirar si es admin—, donde una
 * suplantación no abre ninguna puerta.
 */
async function clerkEmailVerificado(userId) {
  try {
    const r = await fetch('https://api.clerk.com/v1/users/' + userId, {
      headers: { Authorization: 'Bearer ' + process.env.CLERK_SECRET_KEY },
    });
    if (!r.ok) return '';
    const u = await r.json();
    const lista = u.email_addresses || [];
    // El principal; si no está marcado, el primero verificado que haya.
    const principal = lista.find(e => e.id === u.primary_email_address_id) || lista[0];
    const elegido = (principal && principal.verification?.status === 'verified')
      ? principal
      : lista.find(e => e.verification?.status === 'verified');
    return (elegido?.email_address || '').toLowerCase();
  } catch { return ''; }
}

/**
 * Ata una invitación pendiente al usuario que acaba de entrar, buscándola por
 * su correo verificado.
 *
 * Hacía falta porque el correo de invitación promete literalmente «créala
 * gratis con este mismo email y la invitación se aplica sola», y eso no pasaba:
 * el canje solo funcionaba si hacían clic en el enlace. Quien se registraba por
 * su cuenta con el correo invitado se quedaba con una cuenta suelta y vacía, y
 * su invitación en «Invitado» para siempre.
 */
/**
 * La fila espejo del miembro en `users`. Aceptar una invitación no la creaba,
 * y varias tablas la exigen por clave foránea: user_profiles, chat_history,
 * activity_logs y billing.
 *
 * El síntoma era un 500 al guardar preferencias —«Key (user_id)=(…) is not
 * present in table users»— que solo le pasaba a los miembros del equipo, nunca
 * al dueño, porque el dueño sí la tiene desde que se registró.
 *
 * `ignore-duplicates` a propósito: si la fila ya existe se deja como está. Con
 * merge se le pisaría el plan a alguien que además tiene cuenta propia.
 */
async function asegurarFilaDeUsuario(userId, correo, nombre) {
  if (!userId || !correo) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?on_conflict=id`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ id: userId, email: correo, name: nombre || null }),
    });
  } catch (e) {
    // No puede tumbar la aceptación de la invitación: sin fila el miembro entra
    // igual y solo pierde el guardado de preferencias.
    console.error('[team] fila espejo:', e.message);
  }
}

async function vincularPorCorreo(userId) {
  const correo = await clerkEmailVerificado(userId);
  if (!correo) return null;
  const filas = await fetch(
    `${SUPABASE_URL}/rest/v1/team_members?member_email=eq.${encodeURIComponent(correo)}` +
    `&status=eq.invited&select=id,owner_user_id,owner_name,role,member_name&order=created_at.desc&limit=1`,
    { headers: sbHeaders() }
  ).then(r => (r.ok ? r.json() : [])).catch(() => []);
  const inv = filas?.[0];
  if (!inv || !inv.owner_user_id) return null;
  if (inv.owner_user_id === userId) return null;   // nadie se une a su propio equipo

  const res = await fetch(`${SUPABASE_URL}/rest/v1/team_members?id=eq.${inv.id}&status=eq.invited`, {
    method: 'PATCH', headers: sbHeaders(),
    body: JSON.stringify({
      member_user_id: userId, member_email: correo,
      status: 'active', joined_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return null;
  await asegurarFilaDeUsuario(userId, correo, inv.member_name);
  const hechas = await res.json().catch(() => []);
  return hechas?.length ? { owner_user_id: inv.owner_user_id, role: inv.role, owner_name: inv.owner_name } : null;
}

/**
 * El plan del DUEÑO. Un miembro tiene su propio plan —normalmente trial o free—
 * y con él la aplicación le dibujaba la variante «Pro» en vez del selector de
 * cliente del dueño, y le aplicaba topes que no son los de la cuenta en la que
 * trabaja. El plan efectivo de quien trabaja en una cuenta ajena es el de esa
 * cuenta. Es el cuarto sitio donde aparece el mismo fallo: asientos del equipo,
 * cupo de correos, tope de leads y ahora el selector.
 */
async function planDelDueno(ownerId) {
  const meta = await clerkMeta(ownerId);
  return { plan_dueno: meta.plan || 'free', trial_until_dueno: meta.trial_until || null };
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
    if (rows?.[0]) {
      // El perfil viaja aquí para que el navegador sepa qué menú pintar. No es
      // el permiso —ese lo comprueba cada endpoint—, es la cara.
      const quienEs = { esMiembro: true, perfil: rows[0].role, esDueno: false, actorId: userId, userId: rows[0].owner_user_id };
      return jsonResp({
        membership: rows[0],
        ...(await planDelDueno(rows[0].owner_user_id)),
        yo: paraElCliente(quienEs),
      });
    }
    // Todavía no es miembro de nadie: puede que tenga una invitación esperando
    // a su correo y se haya registrado por su cuenta, sin tocar el enlace. Es
    // el caso normal, no el raro: la gente va a la web y se registra.
    const atada = await vincularPorCorreo(userId);
    return jsonResp({
      membership: atada, vinculado_ahora: !!atada,
      ...(atada ? await planDelDueno(atada.owner_user_id) : {}),
    });
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
    const rCanje = await fetch(`${SUPABASE_URL}/rest/v1/team_members?id=eq.${inv.id}`, {
      method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ member_user_id: userId, member_email: email || inv.member_email, status: 'active', joined_at: new Date().toISOString() }),
    });
    // La fila espejo va DESPUÉS de aceptar: si falla, el miembro entra igual y
    // solo pierde el guardado de preferencias.
    if (rCanje.ok) await asegurarFilaDeUsuario(userId, email || inv.member_email, inv.member_name);
    return jsonResp({ ok: true, owner_name: inv.owner_name });
  }

  // ── A partir de aquí se opera sobre la cuenta ──────────────────────────────
  // Un miembro puede LEER el equipo —lo necesita todo selector de "quién
  // atiende"—, pero no invitar ni quitar a nadie. Sin esto la lista le llegaba
  // vacía y no podía asignarle un lead a ningún compañero.
  let quien;
  try { quien = await quienPregunta(userId); }
  catch { return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503); }
  const cuenta = quien.userId;
  const esMiembro = quien.esMiembro;

  // Gestionar el equipo es del dueño y de los administradores. Antes lo era
  // SOLO del dueño; ahora un administrador invitado también, que es justo lo
  // que significa su perfil.
  if (req.method !== 'GET' && !quien.esDueno && !gestionaEquipo(quien.perfil)) {
    return jsonResp({
      error: 'Tu perfil no puede gestionar el equipo. Pídeselo al administrador de la cuenta.',
      sin_permiso: true,
    }, 403);
  }

  // Los asientos y el plan son del DUEÑO, no de quien pregunta. En cuanto un
  // administrador invitado pudo invitar, esto dejó de ser un detalle: su propio
  // JWT trae SU plan (normalmente free) y el límite habría salido mal, dejándole
  // invitar a nadie en una cuenta Agency.
  if (esMiembro) {
    const metaDueno = await clerkMeta(cuenta);
    _lastPlan = metaDueno.plan || 'free';
    _seatsExtra = parseInt(metaDueno.seats_extra || 0) || 0;
  }

  // GET — listar el equipo + asientos
  // Qué tiene asignado alguien, para poder preguntar a quién pasa antes de
  // quitarlo. Va aparte del listado porque son cuatro consultas y no tienen
  // por qué correr cada vez que se abre la pestaña de Equipo.
  if (req.method === 'GET' && url.searchParams.get('carga')) {
    const fila = await filaDelEquipo(cuenta, url.searchParams.get('carga'));
    if (!fila) return jsonResp({ error: 'Esa persona no está en tu equipo' }, 404);
    const carga = fila.member_user_id ? await cargaDe(cuenta, fila.member_user_id) : CARGA_VACIA;
    return jsonResp({ carga });
  }

  if (req.method === 'GET') {
    // member_user_id es imprescindible: sin él, cualquier selector de "quién
    // atiende" se queda sin equipo que ofrecer y solo muestra al que mira.
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(cuenta)}&select=id,member_user_id,member_email,member_name,role,status,created_at,joined_at&order=created_at.asc`, { headers: sbHeaders() }).then(r => r.json());
    const myEmail = await clerkEmail(userId);
    const isAdmin = ADMIN_EMAILS.includes(myEmail);
    const seats = isAdmin ? 99 : (PLAN_SEATS[_lastPlan] ?? 1) + _seatsExtra;
    // `yo` es lo que el navegador usa para pintar el menú. NO es el permiso: el
    // permiso se comprueba en cada endpoint. Ver api/_perfiles.js.
    return jsonResp({
      members: rows || [],
      seats: { total: seats, used: 1 + (rows || []).length, plan: _lastPlan },
      yo: paraElCliente(quien),
      perfiles: Object.entries(PERFILES).map(([id, p]) => ({ id, etiqueta: p.etiqueta, descripcion: p.descripcion })),
    });
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

    const existing = await fetch(`${SUPABASE_URL}/rest/v1/team_members?owner_user_id=eq.${encodeURIComponent(cuenta)}&select=id,member_email`, { headers: sbHeaders() }).then(r => r.json());
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
        owner_user_id: cuenta, owner_name: ownerName,
        member_email: email, member_name: String(body.name || '').slice(0, 80) || null,
        // `perfil` es el nombre nuevo; se sigue aceptando `role` por si queda
        // alguna llamada vieja. Lo desconocido cae en el perfil más limitado.
        role: normalizarPerfil(body.perfil || body.role),
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
          from: 'Acuarius <notificaciones@app.acuarius.app>', reply_to: 'ceo@acuarius.app', to: [email],
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

  // PUT — cambiar el perfil de alguien del equipo
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.id) return jsonResp({ error: 'Falta id' }, 400);
    const perfil = normalizarPerfil(body.perfil || body.role);

    const fila = await filaDelEquipo(cuenta, body.id);
    if (!fila) return jsonResp({ error: 'Esa persona no está en tu equipo' }, 404);
    if (!puedeTocarA(quien, fila)) {
      return jsonResp({
        error: 'No puedes cambiarte el perfil a ti mismo. Pídeselo a otro administrador o al dueño.',
        sin_permiso: true,
      }, 403);
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/team_members?id=eq.${encodeURIComponent(body.id)}&owner_user_id=eq.${encodeURIComponent(cuenta)}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify({ role: perfil }) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const filas = await res.json();
    if (!filas.length) return jsonResp({ error: 'Esa persona no está en tu equipo' }, 404);
    return jsonResp({ member: filas[0] });
  }

  // DELETE — quitar miembro o revocar invitación
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const fila = await filaDelEquipo(cuenta, id);
    if (!fila) return jsonResp({ error: 'Esa persona no está en tu equipo' }, 404);
    if (!puedeTocarA(quien, fila)) {
      return jsonResp({ error: 'No puedes quitarte a ti mismo del equipo.', sin_permiso: true }, 403);
    }

    const suyo = fila.member_user_id;
    const carga = suyo ? await cargaDe(cuenta, suyo) : CARGA_VACIA;
    // El dueño no tiene fila en team_members: el navegador lo pide con
    // `al_dueno` y aquí se resuelve a su propio id, que es el de la cuenta.
    const destino = url.searchParams.get('al_dueno')
      ? cuenta
      : url.searchParams.get('reasignar_a');

    // Quien se va con cartera NO se puede quitar a ciegas. Sin esto, sus leads
    // se quedaban apuntando a alguien que ya no existe: no salen en el filtro
    // «Míos» de nadie, nadie los llama y nadie se entera. Se corta aquí, en el
    // servidor, para que un navegador viejo tampoco pueda hacerlo.
    if (carga.total > 0 && !destino) {
      return jsonResp({
        error: 'Esta persona tiene trabajo asignado. Hay que decir a quién pasa antes de quitarla.',
        hay_que_reasignar: true,
        carga,
      }, 409);
    }

    if (carga.total > 0) {
      // El destino tiene que ser del equipo, o el propio dueño. Sin esta
      // comprobación se podría mandar la cartera a un id inventado, que es
      // exactamente el agujero que estamos tapando.
      const valido = destino === cuenta || !!(await miembroActivo(cuenta, destino));
      if (!valido) return jsonResp({ error: 'Esa persona no está en tu equipo.' }, 400);
      if (destino === suyo) return jsonResp({ error: 'No se puede reasignar a la misma persona que se va.' }, 400);

      const movido = await traspasar(cuenta, suyo, destino);
      await fetch(`${SUPABASE_URL}/rest/v1/team_members?id=eq.${id}&owner_user_id=eq.${encodeURIComponent(cuenta)}`, { method: 'DELETE', headers: sbHeaders() });
      return jsonResp({ ok: true, movido });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/team_members?id=eq.${id}&owner_user_id=eq.${encodeURIComponent(cuenta)}`, { method: 'DELETE', headers: sbHeaders() });
    return jsonResp({ ok: true, movido: null });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
