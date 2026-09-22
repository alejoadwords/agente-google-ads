// api/automations.js
// CRUD de automatizaciones del CRM: flujos con trigger + pasos que el motor
// (api/cron-automations.js) ejecuta server-side.
// Triggers: lead_created | stage_changed (stage opcional) | lead_inactive (days)
// Steps: send_email {subject,body} | send_whatsapp {body} | wait {hours} |
//        condition {field,op,value} | change_stage {stage} | add_note {text}
export const config = { runtime: 'edge' };

import { quienPregunta, puedeVer, exigeModulo, alcanceDeCliente } from './_perfiles.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation',
  };
}

// Verificación completa del JWT de Clerk (mismo patrón que api/leads.js)
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
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(sB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(pB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    _lastPlan = payload.public_metadata?.plan || payload.publicMetadata?.plan || 'free';
    return payload.sub || null;
  } catch { return null; }
}

// ── Gate por plan: crear/editar automatizaciones es feature Pro ──────────────
let _lastPlan = 'free';

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

const PAID_PLANS = ['pro', 'agency', 'individual', 'agencia', 'trial'];
const ADMIN_EMAILS = ['alejandro.gonzalez.ads@gmail.com', 'alejandro@acuarius.app', 'admin@acuarius.app'];

async function isPaidOrAdmin(userId) {
  if (PAID_PLANS.includes(_lastPlan)) return true;
  const meta = await clerkMeta(userId);
  if (PAID_PLANS.includes(meta.plan)) { _lastPlan = meta.plan; return true; }
  if (ADMIN_EMAILS.includes(meta._email)) return true;
  return false;
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const VALID_TRIGGERS = ['lead_created', 'stage_changed', 'lead_inactive', 'webhook', 'tag_added'];
// Esta lista tiene que cubrir lo que ofrece el constructor y lo que sabe
// ejecutar el motor. `pedir_resena` faltaba: se podía armar en la pantalla,
// el motor sabía ejecutarlo, y al guardar respondía «Paso inválido».
// pruebas/automatizaciones-pasos.mjs compara las tres listas.
const VALID_STEPS = ['send_email', 'send_whatsapp', 'wait', 'condition', 'change_stage', 'add_note', 'create_activity', 'notify_owner', 'branch', 'add_tag', 'remove_tag', 'send_nps', 'pedir_resena'];

// Valida el árbol de pasos (las ramas yes/no anidan sub-pasos, un solo nivel).
// Devuelve {error, count} — count suma todos los pasos incluidos los anidados.
function validateSteps(steps, depth) {
  let count = 0;
  for (const s of (steps || [])) {
    count++;
    if (!VALID_STEPS.includes(s.type)) return { error: 'Paso inválido: ' + s.type, count };
    if (s.type === 'send_email' && (!s.subject || !s.body)) return { error: 'El paso de email requiere asunto y cuerpo', count };
    if (s.type === 'send_whatsapp' && !s.body) return { error: 'El paso de WhatsApp requiere el mensaje', count };
    if (s.type === 'wait' && !(parseFloat(s.hours) > 0)) return { error: 'El paso de espera requiere horas > 0', count };
    if (s.type === 'condition' && (!s.field || !s.op)) return { error: 'La condición requiere campo y operador', count };
    if (s.type === 'change_stage' && !s.stage) return { error: 'El cambio de etapa requiere la etapa destino', count };
    if (s.type === 'add_note' && !s.text) return { error: 'La nota requiere texto', count };
    if (s.type === 'create_activity' && !s.title) return { error: 'La tarea requiere un título', count };
    if (s.type === 'notify_owner' && !s.body) return { error: 'La notificación requiere el mensaje', count };
    if ((s.type === 'add_tag' || s.type === 'remove_tag') && !String(s.tag || '').trim()) return { error: 'El paso de etiqueta requiere el nombre de la etiqueta', count };
    if (s.type === 'branch') {
      if (depth > 0) return { error: 'Las ramas no pueden anidarse dentro de otra rama', count };
      if (!s.field || !s.op) return { error: 'La rama requiere campo y operador', count };
      if (!(s.yes || []).length && !(s.no || []).length) return { error: 'La rama necesita al menos un paso en Sí o en No', count };
      for (const key of ['yes', 'no']) {
        const sub = validateSteps(s[key], depth + 1);
        count += sub.count;
        if (sub.error) return { error: sub.error, count };
      }
    }
  }
  return { error: null, count };
}

function validateAutomation(body) {
  if (!body.name || !String(body.name).trim()) return 'El nombre es requerido';
  if (!body.trigger || !VALID_TRIGGERS.includes(body.trigger.type)) return 'Trigger inválido';
  if (body.trigger.type === 'lead_inactive' && !(parseInt(body.trigger.days) > 0)) return 'El trigger de inactividad requiere días > 0';
  if (body.trigger.window) {
    const w = body.trigger.window;
    const s = parseInt(w.start), e = parseInt(w.end);
    if (isNaN(s) || isNaN(e) || s < 0 || s > 23 || e < 0 || e > 23 || s === e) return 'La ventana horaria requiere horas válidas (0–23) y distintas';
  }
  if (!Array.isArray(body.steps) || !body.steps.length) return 'La automatización necesita al menos un paso';
  const r = validateSteps(body.steps, 0);
  if (r.error) return r.error;
  if (r.count > 20) return 'Máximo 20 pasos en total (incluyendo los de las ramas)';
  return null;
}

// ── Qué le va a pasar a un lead ─────────────────────────────────────────────

// COPIA EXACTA de compileSteps en api/cron-automations.js. No se puede
// importar: el cron es una función Node y un api/_*.js solo se importa desde
// funciones edge. Y no se puede omitir: `step_index` de un trabajo indexa esta
// lista aplanada, no `automations.steps`, así que describir el paso con el
// índice sin compilar señalaría el paso equivocado en cuanto haya una rama.
// pruebas/automatizaciones-pasos.mjs compara las dos copias carácter a carácter.
function compileSteps(steps) {
  const out = [];
  const walk = (arr) => {
    for (const s of (arr || [])) {
      if (s.type === 'branch') {
        const node = { type: '_branch', field: s.field, op: s.op, value: s.value, jumpFalse: -1 };
        out.push(node);
        walk(s.yes);
        const g = { type: '_goto', to: -1 };
        out.push(g);
        node.jumpFalse = out.length;
        walk(s.no);
        g.to = out.length;
      } else {
        out.push(s);
      }
    }
  };
  walk(steps);
  return out;
}

/** Una línea en español de lo que hará el paso. Sin jerga del motor. */
function describirPaso(paso) {
  if (!paso) return 'Continuar el flujo';
  const corto = (t, n) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  switch (paso.type) {
    case 'send_email': return 'Enviar correo: ' + (corto(paso.subject, 48) || 'sin asunto');
    case 'send_whatsapp': return 'Enviar WhatsApp: ' + (corto(paso.body, 48) || 'sin mensaje');
    case 'pedir_resena': return 'Pedir reseña ' + (paso.canal === 'whatsapp' ? 'por WhatsApp' : 'por correo');
    case 'send_nps': return 'Enviar la encuesta de satisfacción';
    case 'wait': return 'Esperar ' + (parseFloat(paso.hours) || 0) + ' h';
    case 'change_stage': return 'Mover a la etapa «' + corto(paso.stage, 30) + '»';
    case 'add_note': return 'Dejar una nota: ' + corto(paso.text, 48);
    case 'create_activity': return 'Crear la tarea «' + corto(paso.title, 40) + '»';
    case 'notify_owner': return 'Avisarte a ti: ' + corto(paso.body, 44);
    case 'add_tag': return 'Poner la etiqueta «' + corto(paso.tag, 26) + '»';
    case 'remove_tag': return 'Quitar la etiqueta «' + corto(paso.tag, 26) + '»';
    case 'condition': return 'Comprobar si ' + corto(paso.field, 24) + ' ' + corto(paso.op, 12) + ' ' + corto(paso.value, 20);
    case '_branch': return 'Decidir según ' + corto(paso.field, 24);
    case '_goto': return 'Seguir con el flujo';
    // Un paso que el motor entienda y esto no debe verse, no desaparecer: si
    // no, la caja diría que no va a pasar nada cuando sí va a pasar.
    default: return 'Paso «' + corto(paso.type, 24) + '»';
  }
}

/** Lo mismo para la bitácora: qué se hizo y cómo salió. */
const ACCION_TEXTO = {
  send_email: 'Correo', send_whatsapp: 'WhatsApp', pedir_resena: 'Petición de reseña',
  send_nps: 'Encuesta de satisfacción', wait: 'Espera', condition: 'Condición',
  change_stage: 'Cambio de etapa', add_note: 'Nota', create_activity: 'Tarea',
  notify_owner: 'Aviso al dueño', add_tag: 'Etiqueta puesta', remove_tag: 'Etiqueta quitada',
  branch: 'Rama', run: 'Ejecución',
};
const RESULTADO_TEXTO = {
  sent: 'enviado', done: 'hecho', failed: 'falló', skipped: 'se saltó',
  cancelled: 'cancelado', passed: 'se cumplió', stopped: 'se detuvo',
  scheduled: 'programado', yes: 'por el sí', no: 'por el no',
};

/**
 * Qué le va a pasar a un lead y qué ya le pasó.
 *
 * Exportada aparte del handler para poder ejecutarla de verdad en
 * pruebas/automatizaciones-ficha.mjs: lo que importa aquí no es que el código
 * compile, es que los índices de paso señalen el paso correcto.
 */
export async function estadoDeAutomatizaciones(userId, leadId) {
  const [jr, gr] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/automation_jobs?user_id=eq.${encodeURIComponent(userId)}&lead_id=eq.${leadId}` +
          `&status=eq.pending&select=id,automation_id,step_index,run_at&order=run_at.asc&limit=20`,
          { headers: sbHeaders() }),
    fetch(`${SUPABASE_URL}/rest/v1/automation_logs?user_id=eq.${encodeURIComponent(userId)}&lead_id=eq.${leadId}` +
          `&select=automation_id,step_index,action,result,detail,created_at&order=created_at.desc&limit=10`,
          { headers: sbHeaders() }),
  ]);
  if (!jr.ok || !gr.ok) throw new Error('No se pudo leer el estado de las automatizaciones');
  const jobs = (await jr.json()) || [];
  const logs = (await gr.json()) || [];

  // Los nombres y los pasos, de una sola consulta para todas las
  // automatizaciones implicadas.
  const ids = [...new Set([...jobs, ...logs].map(x => x.automation_id).filter(Boolean))];
  let autos = [];
  if (ids.length) {
    const ar = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?id=in.(${ids.join(',')})&user_id=eq.${encodeURIComponent(userId)}&select=id,name,active,steps`,
      { headers: sbHeaders() }
    );
    autos = ar.ok ? ((await ar.json()) || []) : [];
  }
  const porId = new Map(autos.map(a => [a.id, a]));

  return {
    pendientes: jobs.map(j => {
      const a = porId.get(j.automation_id);
      const pasos = a ? compileSteps(a.steps || []) : [];
      return {
        id: j.id,
        automation_id: j.automation_id,
        // Una automatización borrada deja trabajos huérfanos que el motor
        // cancela al tocarlos. Decir «(automatización eliminada)» es más
        // honesto que esconder la fila.
        nombre: a ? a.name : '(automatización eliminada)',
        apagada: !!a && a.active === false,
        paso: describirPaso(pasos[j.step_index || 0]),
        run_at: j.run_at,
      };
    }),
    hechas: logs.map(l => ({
      automation_id: l.automation_id,
      nombre: (porId.get(l.automation_id) || {}).name || '(automatización eliminada)',
      accion: ACCION_TEXTO[l.action] || l.action,
      resultado: RESULTADO_TEXTO[l.result] || l.result,
      // `failed` y `skipped` son los que hay que poder leer enteros: son el
      // «no le llegó» del que vive la mitad del soporte.
      fallo: l.result === 'failed' || l.result === 'skipped',
      detalle: l.detail || '',
      created_at: l.created_at,
    })),
  };
}

/** Parar un paso que todavía no ha ocurrido. Devuelve {estado, cuerpo}. */
export async function pararTrabajo(userId, jobId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/automation_jobs?id=eq.${jobId}&user_id=eq.${encodeURIComponent(userId)}&status=eq.pending`,
    { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify({ status: 'cancelled' }) }
  );
  if (!res.ok) return { estado: 500, cuerpo: { error: await res.text() } };
  const filas = await res.json().catch(() => []);
  // Sin filas, o ya lo ejecutó el motor —va cada 10 minutos— o no era suyo.
  // Decirlo evita que alguien crea que paró un correo que ya salió.
  if (!filas.length) return { estado: 409, cuerpo: { error: 'Ese paso ya se ejecutó o no existe' } };
  const j = filas[0];
  // Queda en la bitácora de la automatización: si no, mañana nadie sabe por
  // qué ese lead se quedó a medias.
  await fetch(`${SUPABASE_URL}/rest/v1/automation_logs`, {
    method: 'POST', headers: sbHeaders(),
    body: JSON.stringify({
      automation_id: j.automation_id, user_id: userId, lead_id: j.lead_id,
      step_index: j.step_index, action: 'run', result: 'cancelled',
      detail: 'Cancelado a mano desde la ficha del contacto',
    }),
  }).catch(() => {});
  return { estado: 200, cuerpo: { ok: true } };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let userId = await getUserId(req);
  if (!userId) return jsonResp({ error: 'No autorizado' }, 401);

  // Miembros del equipo: se opera sobre la cuenta del DUEÑO. Sin esto, un
  // miembro veía esta sección VACÍA —su propia cuenta, que no tiene nada— y el
  // perfil Mercadeo no habría servido de nada.
  //
  // Y Marketing se escribe solo desde los perfiles que lo tienen. Leer sí: el
  // reporte de Marketing vive dentro de Análisis, al que Ventas sí entra.
  let quien;
  try { quien = await quienPregunta(userId); }
  catch (e) {
    // Una cuenta suspendida no es un fallo de la base: se le dice, y con su
    // propio código, para que la pantalla pueda enseñar algo que se entienda.
    if (e?.suspendida) return jsonResp({ error: e.message, suspendida: true }, 403);
    return jsonResp({ error: 'No se pudo verificar tu cuenta. Reintenta en unos segundos.' }, 503);
  }
  userId = quien.userId;
  if (req.method !== 'GET' && !puedeVer(quien.perfil, 'marketing')) {
    const no = exigeModulo(quien, 'marketing');
    if (no) return no;
  }


  const url = new URL(req.url);
  // Un miembro acotado a un cliente no se sale de el: el servidor manda, no
  // el navegador. Ver alcanceDeCliente en _perfiles.js.
  const clientId = alcanceDeCliente(quien, url.searchParams.get('client_id'));

  // GET ?lead_id= — qué le va a pasar a ESTE lead y qué ya le pasó.
  //
  // Se lee sin exigir Marketing a propósito: un comercial tiene que poder ver
  // que a su lead le sale un correo mañana. Pararlo sí es de Marketing, abajo.
  if (req.method === 'GET' && url.searchParams.get('lead_id')) {
    const leadId = url.searchParams.get('lead_id');
    if (!/^[0-9a-f-]{32,36}$/i.test(leadId)) return jsonResp({ error: 'lead_id inválido' }, 400);

    // Un miembro acotado a un cliente no mira los leads de otro, aunque
    // escriba el id a mano: el lead manda, no el parámetro.
    if (quien.cliente) {
      const lr = await fetch(
        `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&user_id=eq.${userId}&select=client_id`,
        { headers: sbHeaders() }
      );
      const lead = (await lr.json().catch(() => []))[0];
      if (!lead || String(lead.client_id || '') !== String(quien.cliente)) {
        return jsonResp({ error: 'Ese contacto no es de tu cliente' }, 403);
      }
    }

    try {
      return jsonResp(await estadoDeAutomatizaciones(userId, leadId));
    } catch (e) {
      return jsonResp({ error: String(e.message || e) }, 502);
    }
  }

  // DELETE ?job_id= — parar algo que todavía no ha pasado.
  if (req.method === 'DELETE' && url.searchParams.get('job_id')) {
    const jobId = url.searchParams.get('job_id');
    if (!/^[0-9a-f-]{32,36}$/i.test(jobId)) return jsonResp({ error: 'job_id inválido' }, 400);
    const r = await pararTrabajo(userId, jobId);
    return jsonResp(r.cuerpo, r.estado);
  }

  // GET ?logs=1&automation_id= — historial de ejecuciones
  if (req.method === 'GET' && url.searchParams.get('logs')) {
    const autoId = url.searchParams.get('automation_id');
    let q = `${SUPABASE_URL}/rest/v1/automation_logs?user_id=eq.${userId}&select=*&order=created_at.desc&limit=100`;
    if (autoId) q += `&automation_id=eq.${autoId}`;
    const res = await fetch(q, { headers: sbHeaders() });
    return jsonResp({ logs: (await res.json()) || [] });
  }

  // GET — listar automatizaciones (del scope del cliente activo)
  if (req.method === 'GET') {
    const scope = clientId ? `&client_id=eq.${clientId}` : '&client_id=is.null';
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?user_id=eq.${userId}${scope}&select=*&order=created_at.desc`,
      { headers: sbHeaders() }
    );
    return jsonResp({ automations: (await res.json()) || [] });
  }

  // POST — crear (solo planes pagos)
  if (req.method === 'POST') {
    if (!(await isPaidOrAdmin(userId))) {
      return jsonResp({ error: 'Las automatizaciones son parte del plan Pro.', upgrade: true }, 403);
    }
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    const err = validateAutomation(body);
    if (err) return jsonResp({ error: err }, 400);
    // El trigger webhook recibe su token secreto aquí (nunca lo elige el cliente)
    if (body.trigger.type === 'webhook') {
      body.trigger = { type: 'webhook', token: crypto.randomUUID().replace(/-/g, ''), ...(body.trigger.window ? { window: body.trigger.window } : {}) };
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/automations`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        user_id: userId,
        client_id: clientId,
        name: String(body.name).trim(),
        active: body.active !== false,
        trigger: body.trigger,
        steps: body.steps,
      }),
    });
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ automation: rows[0] }, 201);
  }

  // PUT — actualizar (incluye toggle active; solo planes pagos)
  if (req.method === 'PUT') {
    if (!(await isPaidOrAdmin(userId))) {
      return jsonResp({ error: 'Las automatizaciones son parte del plan Pro.', upgrade: true }, 403);
    }
    let body;
    try { body = await req.json(); } catch { return jsonResp({ error: 'Body inválido' }, 400); }
    if (!body.id) return jsonResp({ error: 'Falta id' }, 400);
    const update = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) update.name = String(body.name).trim();
    if (body.active !== undefined) update.active = !!body.active;
    if (body.trigger !== undefined || body.steps !== undefined) {
      const err = validateAutomation({ name: body.name || 'x', trigger: body.trigger, steps: body.steps });
      if (err) return jsonResp({ error: err }, 400);
      // El token del webhook lo controla el servidor: se conserva el existente
      // o se genera uno nuevo si el trigger cambió a webhook
      if (body.trigger.type === 'webhook') {
        const curRes = await fetch(`${SUPABASE_URL}/rest/v1/automations?id=eq.${body.id}&user_id=eq.${userId}&select=trigger`, { headers: sbHeaders() });
        const cur = (await curRes.json())?.[0];
        const existingToken = cur?.trigger?.type === 'webhook' ? cur.trigger.token : null;
        body.trigger = { type: 'webhook', token: existingToken || crypto.randomUUID().replace(/-/g, ''), ...(body.trigger.window ? { window: body.trigger.window } : {}) };
      }
      update.trigger = body.trigger;
      update.steps = body.steps;
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?id=eq.${body.id}&user_id=eq.${userId}`,
      { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(update) }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    const rows = await res.json();
    return jsonResp({ automation: rows[0] });
  }

  // DELETE — eliminar (jobs pendientes se cancelan en cascada por FK)
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Falta id' }, 400);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/automations?id=eq.${id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: sbHeaders() }
    );
    if (!res.ok) return jsonResp({ error: await res.text() }, 500);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Método no permitido' }, 405);
}
