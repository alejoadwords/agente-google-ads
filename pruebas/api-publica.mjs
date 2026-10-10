// API pública (api/v1.js), sus llaves (api/llaves-api.js) y los avisos
// salientes (api/cron-webhooks.js), ejecutados de verdad contra Supabase.
//
// Clerk, Resend y el servidor que recibe los avisos se simulan; la base es la
// real. Identidad propia: cuentas `user_prueba_api_<hora>` que no existen en
// ningún otro sitio, y todo lo que escriben se borra al final.
//
// Lo que tiene que quedar demostrado es la promesa de la API: que un agente
// externo pase por las MISMAS reglas que una persona (motivo al cerrar, fecha
// de cierre, tareas anuladas, automatizaciones, historial firmado) y que no
// pueda salirse de su llave (permisos, cuenta, plan, límite de uso).
//
//   node pruebas/api-publica.mjs <carpeta con .env>
import fs from 'fs';
for (const l of fs.readFileSync(process.argv[2] + '/.env', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1); }
let mal = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) mal++; };
// Resend se simula abajo; sin una clave cualquiera el aviso de asignación ni lo intenta.
process.env.RESEND_API_KEY ||= 're_simulado';

const T = Date.now();
const DUENO = 'user_prueba_api_' + T, GRATIS = 'user_prueba_api_free_' + T, OTRA = 'user_prueba_api_otra_' + T;
const MIEMBRO = 'user_prueba_api_miembro_' + T;
const ADMIN = 'user_prueba_api_admin_' + T;
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const sbH = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

// ── Clerk, Resend y el receptor de avisos, simulados ────────────────────────
const usuarios = {
  [DUENO]:  { id: DUENO, public_metadata: { plan: 'pro' }, primary_email_address_id: 'e1', email_addresses: [{ id: 'e1', email_address: `dueno${T}@prueba.test` }] },
  [ADMIN]:  { id: ADMIN, public_metadata: { plan: 'trial' }, email_addresses: [{ email_address: `admin${T}@prueba.test` }] },
  [MIEMBRO]: { id: MIEMBRO, public_metadata: { plan: 'trial' }, email_addresses: [{ email_address: `miembro${T}@prueba.test` }] },
  [GRATIS]: { id: GRATIS, public_metadata: { plan: 'free' }, email_addresses: [{ email_address: `gratis${T}@prueba.test` }] },
  [OTRA]:   { id: OTRA, public_metadata: { plan: 'pro' }, email_addresses: [{ email_address: `otra${T}@prueba.test` }] },
};
const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'prueba-api', alg: 'RS256', use: 'sig' };
const b64u = b => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
async function jwt(sub) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'prueba-api', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ sub, sid: 'sess_' + T, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) }));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(new Uint8Array(s));
}
const correos = [];
const avisos = [];
const fetchReal = globalThis.fetch;
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith('/.well-known/jwks.json')) return J({ keys: [jwk] });
  if (u.startsWith('https://api.resend.com')) { correos.push(JSON.parse(init.body || '{}')); return J({ id: 'simulado' }); }
  if (u.startsWith('https://api.clerk.com/v1/users/')) {
    const id = decodeURIComponent(u.split('/users/')[1].split(/[/?]/)[0]);
    return usuarios[id] ? J(usuarios[id]) : J({ errors: [] }, 404);
  }
  if (u.startsWith('https://receptor-' + T + '.prueba.test/')) {
    avisos.push({ url: u, headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body });
    return new Response('ok', { status: u.includes('/roto') ? 500 : 200 });
  }
  return fetchReal(url, init);
};

const v1 = (await import('../api/v1.js?v=' + T)).default;
const llavesApi = (await import('../api/llaves-api.js?v=' + T)).default;
const cron = (await import('../api/cron-webhooks.js?v=' + T)).default;

async function api(llave, metodo, ruta, cuerpo, extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (llave) headers.Authorization = 'Bearer ' + llave;
  const q = ruta.includes('?') ? '&' + ruta.split('?')[1] : '';
  const r = await v1(new Request(`https://app.acuarius.app/api/v1?ruta=${encodeURIComponent(ruta.split('?')[0])}${q}`, {
    method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }));
  return { s: r.status, d: await r.json().catch(() => ({})), h: r.headers };
}
// Lo que abre una puerta pide el código del correo. `panel()` lo hace como la
// pantalla: si el servidor lo pide, solicita uno, lo lee del correo simulado y
// reintenta. Un código que la acción liberó (falló por otra cosa) se reutiliza,
// porque pedir otro antes de un minuto da 429. `sinCodigo` lo salta para
// probar justo eso.
const ultimoCodigo = {};
const ABREN = ['crear_llave', 'crear_webhook', 'rotar_secreto'];
function codigoDelCorreo(sub) {
  const para = usuarios[sub].email_addresses[0].email_address;
  const c = [...correos].reverse().find(x => x.to === para && /Tu código/.test(x.subject));
  return c?.html.match(/letter-spacing:\.3em;text-align:center">(\d{6})</)?.[1];
}
async function panel(sub, metodo = 'GET', cuerpo, q = '', { sinCodigo = false } = {}) {
  const abre = cuerpo && (ABREN.includes(cuerpo.accion) || (cuerpo.accion === 'editar_webhook' && cuerpo.url !== undefined));
  if (abre && !sinCodigo && !cuerpo.codigo) {
    let p = await panelCrudo(sub, metodo, { ...cuerpo, codigo: ultimoCodigo[sub] }, q);
    if (!(p.s === 403 && p.d.requiere_codigo)) return p;
    const pedido = await panelCrudo(sub, 'POST', { accion: 'pedir_codigo', para: cuerpo.accion });
    if (pedido.s !== 200) return pedido;
    ultimoCodigo[sub] = codigoDelCorreo(sub);
    return panelCrudo(sub, metodo, { ...cuerpo, codigo: ultimoCodigo[sub] }, q);
  }
  return panelCrudo(sub, metodo, cuerpo, q);
}
async function panelCrudo(sub, metodo = 'GET', cuerpo, q = '') {
  const r = await llavesApi(new Request('https://app.acuarius.app/api/llaves-api' + q, {
    method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await jwt(sub) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }));
  return { s: r.status, d: await r.json().catch(() => ({})) };
}
const sbGet = p => fetchReal(`${SB}/rest/v1/${p}`, { headers: sbH }).then(r => r.json());
const sbPost = (p, b) => fetchReal(`${SB}/rest/v1/${p}`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(b) }).then(async r => { if (!r.ok) throw new Error(p + ': ' + await r.text()); return r.json(); });
const sbPatch = (p, b) => fetchReal(`${SB}/rest/v1/${p}`, { method: 'PATCH', headers: { ...sbH, Prefer: 'return=minimal' }, body: JSON.stringify(b) });
const sbDel = p => fetchReal(`${SB}/rest/v1/${p}`, { method: 'DELETE', headers: sbH });

// ── Una cuenta con su proceso, sus motivos, su equipo y una automatización ──
let proceso, auto, ajeno;
try {
[proceso] = await sbPost('pipelines', { user_id: DUENO, client_id: null, name: 'Venta prueba', is_default: true, position: 1 });
await sbPost('pipeline_stages', [
  { user_id: DUENO, pipeline_id: proceso.id, key: 'nuevo', label: 'Nuevo', color: '#6B7280', position: 1, al_entrar: null },
  { user_id: DUENO, pipeline_id: proceso.id, key: 'calificado', label: 'Calificado', color: '#8B5CF6', position: 2, al_entrar: null },
  { user_id: DUENO, pipeline_id: proceso.id, key: 'visita', label: 'Visita al concesionario', color: '#3B82F6', position: 3,
    al_entrar: { tipo: 'cita', titulo: 'Visita', duracion: 60, avisarChoque: true } },
  { user_id: DUENO, pipeline_id: proceso.id, key: 'ganado', label: 'Ganado', color: '#10B981', position: 4, al_entrar: null },
  { user_id: DUENO, pipeline_id: proceso.id, key: 'perdido', label: 'Perdido', color: '#EF4444', position: 5, al_entrar: null },
]);
await sbPost('close_reasons', [
  { user_id: DUENO, kind: 'won', label: 'Compró el vehículo', position: 1 },
  { user_id: DUENO, kind: 'lost', label: 'Sin presupuesto', position: 1 },
]);
await sbPost('team_members', { owner_user_id: DUENO, member_user_id: MIEMBRO, member_email: `miembro${T}@prueba.test`, member_name: 'Asesora Prueba', role: 'vendedor', status: 'active', invite_token: 'tok' + T });
await sbPost('team_members', { owner_user_id: DUENO, member_user_id: ADMIN, member_email: `admin${T}@prueba.test`, member_name: 'Admin Prueba', role: 'admin', status: 'active', invite_token: 'tka' + T });
[auto] = await sbPost('automations', { user_id: DUENO, client_id: null, name: 'Prueba API', active: true, trigger: { type: 'stage_changed', stage: 'calificado' }, steps: [] });
[ajeno] = await sbPost('leads', { user_id: OTRA, name: 'Lead ajeno', stage: 'nuevo', stage_position: 0, source: 'manual' });

  console.log('Llaves desde Configuración');
  let p = await panel(GRATIS, 'POST', { accion: 'crear_llave', nombre: 'Agente gratis', permisos: ['leads:leer'] });
  ok(p.s === 403 && p.d.plan_sin_api, 'plan gratis: no puede crear llaves (403)');
  p = await panel(DUENO, 'POST', { accion: 'crear_llave', nombre: 'x', permisos: ['leads:leer'] });
  ok(p.s === 400, 'sin nombre de verdad: 400');
  p = await panel(DUENO, 'POST', { accion: 'crear_llave', nombre: 'Agente de prueba', permisos: ['inventado'] });
  ok(p.s === 400, 'sin permisos válidos: 400');
  p = await panel(DUENO, 'POST', { accion: 'crear_llave', nombre: 'Agente de prueba',
    permisos: ['leads:leer', 'leads:escribir', 'leads:etapa', 'tareas:leer', 'tareas:escribir'] });
  ok(p.s === 201 && /^acu_live_[A-Za-z0-9_-]{43}$/.test(p.d.llave), 'crea la llave y la devuelve una vez');
  const LLAVE = p.d.llave;
  const filaLlave = (await sbGet(`api_llaves?id=eq.${p.d.fila.id}&select=*`))[0];
  ok(filaLlave && !JSON.stringify(filaLlave).includes(LLAVE), 'en la base NO está la llave, solo su hash');
  p = await panel(DUENO);
  ok(p.s === 200 && p.d.llaves.some(l => l.id === filaLlave.id) && !('hash' in p.d.llaves[0]), 'la lista la muestra sin el hash');
  p = await panel(MIEMBRO);
  ok(p.s === 403, 'una asesora (perfil Ventas) no gestiona la API');
  ok(correos.some(c => c.to === `dueno${T}@prueba.test` && /Se creó una llave/.test(c.subject) && /Agente de prueba/.test(c.html)), 'al dueño le llega el aviso de la llave nueva');

  console.log('Código de confirmación por correo');
  p = await panel(DUENO, 'POST', { accion: 'crear_llave', nombre: 'Sin código', permisos: ['leads:leer'] }, '', { sinCodigo: true });
  ok(p.s === 403 && p.d.requiere_codigo === true, 'sin código no se crea una llave');
  p = await panel(DUENO, 'POST', { accion: 'crear_webhook', url: `https://receptor-${T}.prueba.test/x`, eventos: ['lead.creado'] }, '', { sinCodigo: true });
  ok(p.s === 403 && p.d.requiere_codigo === true, 'ni un webhook');
  // Un código nuevo, propio de esta sección.
  await sbDel(`api_codigos?actor_id=eq.${DUENO}`);
  p = await panelCrudo(DUENO, 'POST', { accion: 'pedir_codigo', para: 'crear_llave' });
  const COD = codigoDelCorreo(DUENO);
  ok(p.s === 200 && /^\d{6}$/.test(COD || '') && p.d.correo?.endsWith('@prueba.test') && !p.d.correo.startsWith('dueno' + T), 'el código llega al correo de quien lo pide, enmascarado en pantalla');
  ok(correos.at(-1)?.html.includes('Equipo de Soporte — Acuarius'), 'el correo va firmado por Soporte');
  const filaCod = (await sbGet(`api_codigos?actor_id=eq.${DUENO}&select=*`))[0];
  ok(filaCod && !JSON.stringify(filaCod).includes(COD), 'en la base NO está el código, solo su hash');
  p = await panelCrudo(DUENO, 'POST', { accion: 'pedir_codigo', para: 'crear_llave' });
  ok(p.s === 429, 'pedir otro antes de un minuto: 429');
  const MALO = COD === '000000' ? '111111' : '000000';
  p = await panelCrudo(DUENO, 'POST', { accion: 'crear_llave', nombre: 'Con código malo', permisos: ['leads:leer'], codigo: MALO });
  ok(p.s === 403 && p.d.requiere_codigo && /quedan 4/.test(p.d.error), 'código incorrecto: 403 y cuántos intentos quedan');
  p = await panelCrudo(DUENO, 'POST', { accion: 'crear_llave', nombre: 'x', permisos: ['leads:leer'], codigo: COD });
  ok(p.s === 400, 'código bueno pero nombre corto: 400…');
  p = await panelCrudo(DUENO, 'POST', { accion: 'crear_llave', nombre: 'Con código', permisos: ['leads:leer'], codigo: COD });
  ok(p.s === 201 && p.d.llave, '…y el mismo código sigue valiendo para corregir');
  p = await panelCrudo(DUENO, 'POST', { accion: 'crear_llave', nombre: 'Código reusado', permisos: ['leads:leer'], codigo: COD });
  ok(p.s === 403 && p.d.codigo_vencido === true, 'usado una vez, ya no vale');
  ultimoCodigo[DUENO] = null;

  console.log('Puerta');
  let r = await api(null, 'GET', '');
  ok(r.s === 401 && r.d.codigo === 'sin_llave', 'sin llave: 401');
  r = await api('acu_live_corta', 'GET', '');
  ok(r.s === 401 && r.d.codigo === 'llave_invalida', 'llave deforme: 401');
  r = await api('acu_live_' + 'A'.repeat(43), 'GET', '');
  ok(r.s === 401 && r.d.codigo === 'llave_invalida', 'llave que no existe: 401');
  r = await api(LLAVE, 'GET', '');
  ok(r.s === 200 && r.d.llave?.nombre === 'Agente de prueba' && r.d.uso?.minuto >= 1, 'índice: dice quién soy y cuánto llevo');
  ok(r.h.get('access-control-allow-origin') === null, 'sin CORS: la llave no es para un navegador');
  r = await api(LLAVE, 'GET', 'nada/de/nada');
  ok(r.s === 404 && r.d.codigo === 'ruta_desconocida', 'ruta desconocida: 404');
  r = await api(LLAVE, 'DELETE', 'leads');
  ok(r.s === 405, 'DELETE no existe: 405');

  console.log('Lectura de la cuenta');
  r = await api(LLAVE, 'GET', 'procesos');
  const pr = r.d.procesos?.find(x => x.id === proceso.id);
  ok(r.s === 200 && pr?.etapas.length === 5, 'procesos con sus etapas');
  ok(pr?.etapas.find(e => e.key === 'visita')?.pide_cita === true && pr?.etapas.find(e => e.key === 'ganado')?.cierre === 'ganado', 'cada etapa dice si pide cita o si cierra');
  r = await api(LLAVE, 'GET', 'equipo');
  ok(r.d.equipo?.some(m => m.id === MIEMBRO && m.rol === 'ventas') && r.d.equipo?.[0]?.rol === 'dueno', 'equipo: el dueño y la asesora');
  r = await api(LLAVE, 'GET', 'motivos-cierre');
  ok(r.d.ganado?.[0] === 'Compró el vehículo' && r.d.perdido?.[0] === 'Sin presupuesto', 'motivos de cierre');

  console.log('Crear prospectos');
  r = await api(LLAVE, 'POST', 'leads', { name: 'Ana Prueba', email: `ana${T}@prueba.test`, phone: '+57 310 555 ' + String(T).slice(-4), etiquetas: ['Test Drive'], campos: { Vehículo: 'Corolla' } });
  ok(r.s === 201 && r.d.creado === true && r.d.lead?.stage === 'nuevo' && r.d.lead?.pipeline_id === proceso.id, 'crea en el proceso principal, en «nuevo»');
  const LEAD = r.d.lead?.id;
  ok(r.d.lead?.source === 'api' && r.d.lead?.tags.includes('test drive') && r.d.lead?.custom_fields?.['Vehículo'] === 'Corolla', 'fuente api, etiquetas normalizadas y campos propios');
  let hist = await sbGet(`lead_activities?lead_id=eq.${LEAD}&select=type,content,metadata&order=created_at.asc`);
  ok(hist.some(h => h.type === 'creacion' && h.metadata?.actor === 'Agente de prueba' && h.metadata?.via === 'api'), 'el alta queda firmada en el historial');
  r = await api(LLAVE, 'POST', 'leads', { name: 'Ana otra vez', email: `ANA${T}@prueba.test` });
  ok(r.s === 409 && r.d.codigo === 'duplicado' && r.d.lead?.id === LEAD, 'mismo correo: 409 con el que ya existe');
  r = await api(LLAVE, 'POST', 'leads', { name: 'Ana', phone: '310 555 ' + String(T).slice(-4), si_existe: 'actualizar', company: 'Prueba SAS' });
  ok(r.s === 200 && r.d.creado === false && r.d.lead?.id === LEAD, 'mismo teléfono con si_existe=actualizar: completa el que existe');
  r = await api(LLAVE, 'POST', 'leads', { name: 'Con dueño', asignado_a: MIEMBRO });
  ok(r.s === 403 && r.d.codigo === 'sin_permiso', 'elegir responsable sin permiso leads:asignar: 403');
  r = await api(LLAVE, 'POST', 'leads', { name: 'Cerrado', etapa: 'ganado' });
  ok(r.s === 422 && r.d.codigo === 'etapa_de_cierre', 'no se crea un prospecto ya cerrado');
  r = await api(LLAVE, 'POST', 'leads', { email: 'sin-nombre@prueba.test' });
  ok(r.s === 422 && r.d.codigo === 'falta_campo', 'sin nombre: 422');

  console.log('Mover de etapa');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'Inventada' });
  ok(r.s === 422 && r.d.codigo === 'etapa_desconocida' && r.d.etapas?.length === 5, 'etapa que no existe: 422 con la lista');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'calificado' });
  ok(r.s === 200 && r.d.lead?.stage === 'calificado' && r.d.lead?.stage_label === 'Calificado', 'por clave');
  const trabajos = await sbGet(`automation_jobs?automation_id=eq.${auto.id}&lead_id=eq.${LEAD}&select=id`);
  ok(trabajos.length === 1, 'dispara la automatización «cuando pasa a Calificado»');
  hist = await sbGet(`lead_activities?lead_id=eq.${LEAD}&type=eq.stage_change&select=content,metadata`);
  ok(hist.some(h => h.content === 'Movido de «Nuevo» a «Calificado»' && h.metadata?.actor === 'Agente de prueba'), 'historial: «Movido de «Nuevo» a «Calificado»», firmado');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'Visita al concesionario' });
  ok(r.s === 422 && r.d.codigo === 'etapa_pide_cita', 'etapa que pide cita, sin cita: 422 y el lead no se mueve');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'visita al concesionario', cita: { inicio: '2026-10-09T10:00' } });
  ok(r.s === 422 && r.d.codigo === 'fecha_invalida', 'cita sin zona horaria: 422');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'Visita al concesionario', cita: { inicio: new Date(Date.now() + 86400000).toISOString() } });
  ok(r.s === 200 && r.d.lead?.stage === 'visita' && r.d.cita?.tipo === 'cita' && r.d.cita?.aviso_calendario, 'por rótulo (sin tildes ni mayúsculas) y con la cita creada; avisa que Google no está conectado');
  const citaFin = new Date(r.d.cita?.termina) - new Date(r.d.cita?.vence);
  ok(citaFin === 3600000, 'la cita dura lo que dice la etapa (60 min)');

  console.log('Tareas');
  r = await api(LLAVE, 'POST', 'tareas', { lead_id: LEAD, titulo: 'Llamar para confirmar', vence: new Date(Date.now() + 2 * 86400000).toISOString() }, { 'Idempotency-Key': 'tarea-' + T });
  ok(r.s === 201 && r.d.tarea?.tipo === 'tarea', 'crea la tarea');
  const TAREA = r.d.tarea?.id;
  r = await api(LLAVE, 'POST', 'tareas', { lead_id: LEAD, titulo: 'Llamar para confirmar', vence: new Date(Date.now() + 2 * 86400000).toISOString() }, { 'Idempotency-Key': 'tarea-' + T });
  ok(r.s === 201 && r.d.tarea?.id === TAREA && r.h.get('idempotent-replayed') === 'true', 'misma Idempotency-Key: misma respuesta, sin repetir');
  const tareas = await sbGet(`activities?lead_id=eq.${LEAD}&type=eq.task&title=eq.Llamar para confirmar&select=id`);
  ok(tareas.length === 1, 'y una sola tarea en la base');
  const primer = await sbGet(`activities?lead_id=eq.${LEAD}&type=eq.task&title=like.Primer contacto*&select=id`);
  ok(primer.length === 1, 'el alta creó la tarea de primer contacto, como cualquier lead que entra');
  r = await api(LLAVE, 'POST', 'tareas', { titulo: 'Fecha basura', vence: 'texto basura' });
  ok(r.s === 422 && r.d.codigo === 'fecha_invalida', 'fecha basura: 422 (no una tarea del año 2000)');
  r = await api(LLAVE, 'GET', `tareas?lead_id=${LEAD}`);
  ok(r.s === 200 && r.d.tareas?.length === 3, 'lista las pendientes del lead (primer contacto, la cita y la tarea)');

  console.log('Cerrar');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'perdido' });
  ok(r.s === 422 && r.d.codigo === 'falta_motivo' && r.d.motivos?.[0] === 'Sin presupuesto', 'perder sin motivo: 422 con los motivos de la cuenta');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'perdido', motivo: 'Me cayó mal' });
  ok(r.s === 422 && r.d.codigo === 'motivo_desconocido', 'motivo fuera del catálogo: 422');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'perdido', motivo: 'sin presupuesto', nota: 'Dijo que vuelve en enero' });
  ok(r.s === 200 && r.d.lead?.stage === 'perdido' && r.d.lead?.close_reason === 'Sin presupuesto' && r.d.lead?.closed_at, 'pierde: motivo del catálogo y fecha de cierre sellada');
  const pendientes = await sbGet(`activities?lead_id=eq.${LEAD}&done=is.false&cancelled_at=is.null&select=id`);
  ok(pendientes.length === 0, 'sus tareas y citas pendientes quedan anuladas');
  hist = await sbGet(`lead_activities?lead_id=eq.${LEAD}&select=type,content,metadata&order=created_at.desc&limit=3`);
  ok(hist.some(h => h.type === 'stage_change' && h.content === 'Perdida · Sin presupuesto') && hist.some(h => h.type === 'nota' && h.content === 'Dijo que vuelve en enero'), 'historial: «Perdida · Sin presupuesto» y la nota del cierre');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'nuevo' });
  ok(r.s === 200 && r.d.lead?.closed_at === null, 'reabierto: se limpia la fecha de cierre');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etapa`, { etapa: 'ganado', motivo: 'Compró el vehículo', valor: 95000000, moneda: 'cop', fecha_cierre: '2026-10-08' });
  ok(r.s === 200 && r.d.lead?.value === 95000000 && r.d.lead?.close_currency === 'COP' && r.d.lead?.closed_at === '2026-10-08T17:00:00+00:00', 'gana con valor, moneda y el día elegido a las 12:00 de Colombia');

  console.log('Editar, etiquetar, anotar');
  r = await api(LLAVE, 'PATCH', `leads/${LEAD}`, { company: 'Karvio Prueba', campos: { Color: 'Rojo' } });
  ok(r.s === 200 && r.d.lead?.company === 'Karvio Prueba' && r.d.lead?.custom_fields?.['Vehículo'] === 'Corolla' && r.d.lead?.custom_fields?.Color === 'Rojo', 'editar fusiona los campos propios (no borra los que había)');
  r = await api(LLAVE, 'PATCH', `leads/${LEAD}`, { stage: 'nuevo' });
  ok(r.s === 422 && r.d.codigo === 'usa_otra_ruta', 'la etapa no se cambia por PATCH: 422');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/etiquetas`, { agregar: ['VIP'], quitar: ['test drive'] });
  ok(r.s === 200 && r.d.lead?.tags.includes('vip') && !r.d.lead?.tags.includes('test drive'), 'etiquetas: agrega y quita');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/notas`, { texto: 'Le escribí por WhatsApp', tipo: 'llamada' });
  ok(r.s === 201 && r.d.nota?.tipo === 'llamada', 'nota de llamada');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/notas`, { texto: 'x', tipo: 'borrar' });
  ok(r.s === 422, 'tipo de nota inventado: 422');

  console.log('Leer');
  r = await api(LLAVE, 'GET', `leads?buscar=Karvio Prueba&estado=cerrados`);
  ok(r.s === 200 && r.d.leads?.length === 1 && r.d.leads[0].id === LEAD, 'buscar + estado=cerrados');
  r = await api(LLAVE, 'GET', `leads?estado=abiertos`);
  ok(r.s === 200 && !r.d.leads?.some(l => l.id === LEAD), 'estado=abiertos no trae el ganado');
  r = await api(LLAVE, 'GET', `leads?buscar=a),or(user_id.neq.x`);
  ok(r.s === 200 && Array.isArray(r.d.leads), 'una búsqueda con sintaxis de filtro no se cuela en la consulta');
  r = await api(LLAVE, 'GET', `leads/${LEAD}`);
  ok(r.s === 200 && r.d.historial?.some(h => h.autor === 'Agente de prueba') && Array.isArray(r.d.tareas) && !('conversaciones' in r.d), 'ficha: historial firmado, tareas y SIN conversaciones (no tiene ese permiso)');
  r = await api(LLAVE, 'GET', `leads/${ajeno.id}`);
  ok(r.s === 404, 'un lead de OTRA cuenta: 404');
  r = await api(LLAVE, 'POST', `leads/${ajeno.id}/etapa`, { etapa: 'ganado', motivo: 'x' });
  ok(r.s === 404, 'ni moverlo: 404');
  r = await api(LLAVE, 'GET', 'conversaciones');
  ok(r.s === 403 && r.d.codigo === 'sin_permiso', 'conversaciones sin permiso: 403');
  r = await api(LLAVE, 'POST', `leads/${LEAD}/asignar`, { asignado_a: MIEMBRO });
  ok(r.s === 403, 'asignar sin permiso: 403');

  console.log('Asignar (otra llave, con permiso)');
  p = await panel(DUENO, 'POST', { accion: 'crear_llave', nombre: 'Agente asignador', permisos: ['leads:asignar'] });
  const LLAVE2 = p.d.llave;
  r = await api(LLAVE2, 'POST', `leads/${LEAD}/asignar`, { asignado_a: 'user_que_no_existe' });
  ok(r.s === 422, 'alguien que no es del equipo: 422');
  r = await api(LLAVE2, 'POST', `leads/${LEAD}/asignar`, { asignado_a: MIEMBRO });
  ok(r.s === 200 && r.d.lead?.assigned_to === MIEMBRO && r.d.lead?.assigned_name === 'Asesora Prueba', 'asigna a la asesora');
  ok(correos.some(c => c.to === `miembro${T}@prueba.test`), 'y a ella le llega el correo');
  r = await api(LLAVE2, 'GET', 'leads');
  ok(r.s === 403, 'esa llave no puede leer: 403');

  console.log('Límite de uso');
  await sbPatch(`api_llaves?id=eq.${(await sbGet(`api_llaves?user_id=eq.${DUENO}&nombre=eq.Agente asignador&select=id`))[0].id}`, { limite_minuto: 1 });
  r = await api(LLAVE2, 'GET', '');
  ok(r.s === 429 && r.d.codigo === 'limite_minuto' && r.h.get('retry-after'), 'pasado el límite por minuto: 429 con Retry-After');

  console.log('Límite de cambios');
  p = await panel(DUENO, 'POST', { accion: 'crear_llave', nombre: 'Agente apurado', permisos: ['leads:leer', 'leads:escribir'] });
  const LLAVE3 = p.d.llave;
  await sbPatch(`api_llaves?id=eq.${p.d.fila.id}`, { limite_escrituras_minuto: 1 });
  r = await api(LLAVE3, 'POST', `leads/${LEAD}/notas`, { texto: 'primera' });
  ok(r.s === 201, 'el primer cambio pasa');
  r = await api(LLAVE3, 'POST', `leads/${LEAD}/notas`, { texto: 'segunda' });
  ok(r.s === 429 && r.d.codigo === 'limite_escrituras', 'el segundo choca con el límite de cambios');
  r = await api(LLAVE3, 'GET', `leads/${LEAD}`);
  ok(r.s === 200, 'pero las consultas siguen pasando');

  console.log('Tope de la cuenta');
  process.env.API_LIMITE_CUENTA_MINUTO = '1';
  r = await api(LLAVE3, 'GET', '');
  ok(r.s === 429 && r.d.codigo === 'limite_cuenta', 'entre todas sus llaves, la cuenta tiene tope por minuto');
  delete process.env.API_LIMITE_CUENTA_MINUTO;

  console.log('Quien creó la llave se va del equipo');
  p = await panel(ADMIN, 'POST', { accion: 'crear_llave', nombre: 'Llave del admin', permisos: ['leads:leer'] });
  ok(p.s === 201, 'un administrador del equipo crea una llave');
  const LLAVE_ADMIN = p.d.llave, ID_LLAVE_ADMIN = p.d.fila.id;
  ok(correos.some(c => /Se creó una llave/.test(c.subject) && /Admin Prueba/.test(c.html)), 'y el dueño se entera de quién la creó');
  p = await panel(ADMIN, 'POST', { accion: 'crear_webhook', url: `https://receptor-${T}.prueba.test/admin`, eventos: ['lead.creado'] });
  ok(p.s === 201, 'y un webhook');
  const WH_ADMIN = p.d.fila.id;
  await sbPatch(`team_members?owner_user_id=eq.${DUENO}&member_user_id=eq.${ADMIN}`, { role: 'vendedor' });
  r = await api(LLAVE_ADMIN, 'GET', '');
  ok(r.s === 401 && r.d.codigo === 'llave_revocada', 'le bajan el perfil: su llave deja de entrar');
  const revocada = (await sbGet(`api_llaves?id=eq.${ID_LLAVE_ADMIN}&select=revocada_at,revocada_por`))[0];
  ok(revocada.revocada_at && revocada.revocada_por === 'sistema', 'y queda revocada en la base, no solo rechazada');
  ok(correos.some(c => /revocó una llave/.test(c.subject) && /ya no es administrador/.test(c.html)), 'el dueño recibe el porqué');
  const [otroLead] = await sbPost('leads', { user_id: DUENO, name: 'Dispara el webhook del admin', stage: 'nuevo', stage_position: 0, source: 'manual', pipeline_id: proceso.id });
  await cron(new Request('https://app.acuarius.app/api/cron-webhooks', { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }));
  const whAdmin = (await sbGet(`api_webhooks?id=eq.${WH_ADMIN}&select=activo,desactivado_motivo`))[0];
  ok(whAdmin.activo === false && /ya no es administrador/.test(whAdmin.desactivado_motivo), 'su webhook se desactiva solo antes de mandar nada');
  ok(!avisos.some(a => a.url.endsWith('/admin')), 'y no le llegó ningún dato');
  ok(correos.some(c => /desactivó un webhook/.test(c.subject)), 'y el dueño se entera');
  await sbDel(`api_webhooks?id=eq.${WH_ADMIN}`);
  await sbDel(`leads?id=eq.${otroLead.id}`);

  console.log('Plan y revocación');
  const { generarLlave } = await import('../api/_api-llaves.js');
  const g = await generarLlave();
  await sbPost('api_llaves', { user_id: GRATIS, nombre: 'Llave vieja', prefijo: g.prefijo, hash: g.hash, permisos: ['leads:leer'], creada_por: GRATIS });
  r = await api(g.llave, 'GET', 'leads');
  ok(r.s === 403 && r.d.codigo === 'plan_sin_api', 'una cuenta que bajó a gratis: su llave deja de servir (403)');
  p = await panel(DUENO, 'POST', { accion: 'revocar_llave', id: filaLlave.id });
  ok(p.s === 200, 'revoca desde Configuración (revocar no pide código)');
  ok(correos.some(c => /Se revocó una llave/.test(c.subject)), 'y el dueño recibe el aviso');
  r = await api(LLAVE, 'GET', '');
  ok(r.s === 401 && r.d.codigo === 'llave_revocada', 'la llave revocada ya no entra');

  console.log('Registro');
  p = await panel(DUENO, 'GET', null, '?registro=1');
  ok(p.s === 200 && p.d.registro?.some(x => x.metodo === 'POST' && x.ruta === `/leads/${LEAD}/etapa` && x.estado === 200), 'el registro guarda lo que escribió cada llave');
  ok(!p.d.registro?.some(x => x.metodo === 'GET' && x.estado === 200), 'y no cada lectura correcta');

  console.log('Avisos salientes (webhooks)');
  p = await panel(DUENO, 'POST', { accion: 'crear_webhook', url: 'http://receptor.prueba.test/x', eventos: ['lead.creado'] });
  ok(p.s === 400, 'http sin s: 400');
  for (const malo of ['https://10.0.0.5/x', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://servidor.internal/x', 'https://a.b.com:8443/x', 'https://app.acuarius.app/api/x']) {
    p = await panel(DUENO, 'POST', { accion: 'crear_webhook', url: malo, eventos: ['lead.creado'] });
    ok(p.s === 400, 'rechaza ' + malo);
  }
  p = await panel(DUENO, 'POST', { accion: 'crear_webhook', url: `https://receptor-${T}.prueba.test/hook`, eventos: ['lead.creado', 'lead.etapa_cambiada', 'lead.asignado'] });
  ok(p.s === 201 && /^whsec_/.test(p.d.secreto), 'crea el webhook y da el secreto una vez');
  const WH = p.d.fila.id, SECRETO = p.d.secreto;
  const filaWh = (await sbGet(`api_webhooks?id=eq.${WH}&select=secreto`))[0];
  ok(filaWh.secreto.startsWith('enc:v1:') && !filaWh.secreto.includes(SECRETO), 'el secreto se guarda cifrado');
  p = await panel(DUENO, 'POST', { accion: 'probar_webhook', id: WH });
  ok(p.s === 200 && p.d.resultado?.ok === true && avisos.length === 1, 'probar: lo manda en el momento');
  // La firma se comprueba como lo haría el receptor.
  const a = avisos[0];
  const [, t, v1sig] = a.headers['x-acuarius-firma'].match(/^t=(\d+),v1=([0-9a-f]{64})$/) || [];
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRETO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const esperada = Buffer.from(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(t + '.' + a.body))).toString('hex');
  ok(v1sig === esperada, 'la firma HMAC se puede verificar con el secreto');

  // Un lead nuevo y un cambio de etapa por la base: lo encolan los disparadores.
  const [nuevo] = await sbPost('leads', { user_id: DUENO, name: 'Entra por la base', stage: 'nuevo', stage_position: 0, source: 'manual', pipeline_id: proceso.id });
  await sbPatch(`leads?id=eq.${nuevo.id}`, { stage: 'calificado' });
  const cola = await sbGet(`api_entregas?webhook_id=eq.${WH}&select=evento,datos,estado&order=id.asc`);
  ok(cola.some(e => e.evento === 'lead.creado' && e.datos?.lead?.id === nuevo.id), 'lead creado: encolado');
  ok(cola.some(e => e.evento === 'lead.etapa_cambiada' && e.datos?.etapa_anterior === 'nuevo' && e.datos?.lead?.stage === 'calificado'), 'cambio de etapa: encolado con la etapa anterior');
  const antes = avisos.length;
  const rc = await cron(new Request('https://app.acuarius.app/api/cron-webhooks', { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }));
  const dc = await rc.json();
  ok(rc.status === 200 && dc.enviadas >= 2, 'el cron los entrega');
  ok(avisos.slice(antes).some(x => JSON.parse(x.body).evento === 'lead.etapa_cambiada'), 'y llegan al receptor');
  const enviadas = await sbGet(`api_entregas?webhook_id=eq.${WH}&estado=eq.enviada&select=id`);
  ok(enviadas.length >= 2, 'quedan marcadas como enviadas');

  // Un receptor que falla: se reintenta más tarde, no se pierde.
  await panel(DUENO, 'POST', { accion: 'editar_webhook', id: WH, url: `https://receptor-${T}.prueba.test/roto` });
  await sbPatch(`leads?id=eq.${nuevo.id}`, { stage: 'nuevo' });
  await cron(new Request('https://app.acuarius.app/api/cron-webhooks', { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }));
  const reintento = (await sbGet(`api_entregas?webhook_id=eq.${WH}&estado=eq.pendiente&select=intentos,proximo_at,ultimo_estado`))[0];
  ok(reintento?.intentos === 1 && reintento?.ultimo_estado === 500 && Date.parse(reintento.proximo_at) > Date.now() + 30000, 'receptor con 500: queda pendiente para reintentar en un minuto');
  const w = (await sbGet(`api_webhooks?id=eq.${WH}&select=fallos_seguidos,ultimo_error`))[0];
  ok(w.fallos_seguidos === 1 && /500/.test(w.ultimo_error), 'y el webhook muestra el fallo');
  p = await panel(DUENO, 'GET', null, '?entregas=' + WH);
  ok(p.s === 200 && p.d.entregas?.length >= 3, 'Configuración ve sus últimas entregas');
  await sbDel(`leads?id=eq.${nuevo.id}`);
} catch (e) {
  console.error(e);
  mal++;
} finally {
  // ── Limpieza ───────────────────────────────────────────────────────────
  const cuentas = `(${[DUENO, GRATIS, OTRA].join(',')})`;
  const leads = await sbGet(`leads?user_id=in.${cuentas}&select=id`);
  const ids = leads.map(l => l.id).join(',');
  const llaves = (await sbGet(`api_llaves?user_id=in.${cuentas}&select=id`)).map(l => l.id).join(',');
  if (ids) {
    await sbDel(`lead_activities?lead_id=in.(${ids})`);
    await sbDel(`activities?lead_id=in.(${ids})`);
    await sbDel(`automation_jobs?lead_id=in.(${ids})`);
  }
  await sbDel(`automations?user_id=eq.${DUENO}`);
  await sbDel(`leads?user_id=in.${cuentas}`);
  await sbDel(`pipeline_stages?user_id=eq.${DUENO}`);
  await sbDel(`pipelines?user_id=eq.${DUENO}`);
  await sbDel(`close_reasons?user_id=eq.${DUENO}`);
  await sbDel(`lead_tags?user_id=eq.${DUENO}`);
  await sbDel(`team_members?owner_user_id=eq.${DUENO}`);
  await sbDel(`api_uso_cuenta?user_id=in.${cuentas}`);
  await sbDel(`api_webhooks?user_id=in.${cuentas}`);
  if (llaves) {
    await sbDel(`api_uso?llave_id=in.(${llaves})`);
    await sbDel(`api_idempotencia?llave_id=in.(${llaves})`);
  }
  await sbDel(`api_registro?user_id=in.${cuentas}`);
  await sbDel(`api_llaves?user_id=in.${cuentas}`);
  await sbDel(`api_codigos?actor_id=in.(${[DUENO, ADMIN, GRATIS, OTRA].join(',')})`);
  const resto = await sbGet(`leads?user_id=in.${cuentas}&select=id`);
  ok(resto.length === 0, 'limpieza: no queda nada de la prueba');
}
console.log(mal ? `\n${mal} fallos` : '\nTodo bien');
process.exit(mal ? 1 : 0);
