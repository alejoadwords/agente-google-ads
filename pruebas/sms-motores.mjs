// SMS en los motores: node pruebas/sms-motores.mjs
//
// Se EJECUTA el código real (cron-campaigns, cron-automations, campaigns,
// hotmart-webhook, sms-ack, sms-entrante) contra un Supabase de mentira. No se
// usa la base real a propósito: disparar el cron de campañas de verdad enviaría
// las campañas encoladas de los clientes. El saldo de verdad (reserva atómica,
// devolución) lo prueba pruebas/sms-saldo.mjs contra Supabase.
//
// El reloj también es de mentira: el horario de la Ley 2300 depende de él.

process.env.SUPABASE_URL = 'https://base.falsa';
process.env.SUPABASE_SERVICE_KEY = 'clave';
process.env.CRON_SECRET = 'cron';
process.env.HOTMART_WEBHOOK_SECRET = 'hottok';
process.env.CLERK_SECRET_KEY = 'clerk';
process.env.SMS_ENTRANTE_SECRETO = 'entrante';
process.env.SMS_BETA = 'dueno';
delete process.env.LABSMOBILE_USUARIO; delete process.env.LABSMOBILE_TOKEN;

let mal = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? ' → ' + extra : '')); if (!c) mal++; };
const resp = (d, s = 200) => new Response(d === null ? null : JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

// ── Reloj ───────────────────────────────────────────────────────────────────
const RealDate = Date;
let AHORA = RealDate.parse('2026-10-01T10:00:00-05:00'); // jueves hábil
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [AHORA])); }
  static now() { return AHORA; }
};
const bog = (s) => RealDate.parse(s + '-05:00');

// ── Sesión ──────────────────────────────────────────────────────────────────
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const JWKS = { keys: [{ ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
async function tokenDe(sub) {
  const cab = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const cuerpo = b64u(JSON.stringify({ sub, exp: Math.floor(AHORA / 1000) + 3600 }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(`${cab}.${cuerpo}`));
  return `${cab}.${cuerpo}.${b64u(new Uint8Array(firma))}`;
}

// ── Supabase de mentira ─────────────────────────────────────────────────────
let T, saldo, llamadas, labs, lecturaVieja = false;
function cumple(fila, k, v) {
  if (!(k in fila)) return true;
  const x = fila[k];
  if (v === 'is.null') return x == null;
  if (v === 'not.is.null') return x != null;
  if (v.startsWith('eq.')) return String(x) === v.slice(3);
  if (v.startsWith('neq.')) return String(x) !== v.slice(4);
  if (v.startsWith('like.')) return x != null && new RegExp('^' + v.slice(5).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(String(x));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x));
  if (v.startsWith('not.cs.{')) { const t = v.slice(8, -1).replace(/"/g, ''); return !(x || []).includes(t); }
  return true;
}
const filtrar = (tabla, sp) => (T[tabla] || []).filter(f => [...sp.entries()].every(([k, v]) => cumple(f, k, v)));
let idn = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const metodo = init.method || 'GET';
  if (u.pathname.includes('jwks.json')) return resp(JWKS);
  if (u.hostname === 'api.clerk.com') {
    if (u.searchParams.get('email_address')) return resp(u.searchParams.get('email_address') === 'dueno@x.co' ? [{ id: 'dueno' }] : []);
    return resp({ id: 'dueno', public_metadata: { plan: 'pro' } });
  }
  if (u.hostname === 'api.labsmobile.com') { labs.push(JSON.parse(init.body)); return resp({ code: 0, message: 'ok' }); }
  if (u.hostname === 'api.resend.com') return resp({ id: 'r' });
  if (u.hostname !== 'base.falsa') return resp({});
  const tabla = u.pathname.replace('/rest/v1/', '');
  llamadas.push({ metodo, tabla, url: decodeURIComponent(u.search), cuerpo: init.body });
  if (tabla === 'rpc/sms_saldo') { const b = JSON.parse(init.body); return resp(saldo[b.p_user] || 0); }
  if (tabla === 'rpc/sms_reservar') {
    const b = JSON.parse(init.body);
    if ((saldo[b.p_user] || 0) < b.p_creditos) return resp({ message: 'saldo_insuficiente' }, 400);
    saldo[b.p_user] -= b.p_creditos;
    const id = 'env' + (++idn);
    T.sms_envios.push({ id, user_id: b.p_user, creditos: b.p_creditos, estado: 'reservado', ...b.p_envio });
    return resp(id);
  }
  if (tabla === 'rpc/sms_devolver') return resp(true);
  if (tabla === 'rpc/campana_sumar_stats') {
    const b = JSON.parse(init.body); const c = T.campaigns.find(x => x.id === b.p_id);
    if (!c) return resp(null);
    const st = c.stats || {};
    c.stats = { ...st, sent: Math.max(0, (st.sent || 0) + (b.p_sent || 0)), skipped: Math.max(0, (st.skipped || 0) + (b.p_skipped || 0)),
      failed: Math.max(0, (st.failed || 0) + (b.p_failed || 0)), ...(b.p_extra || {}) };
    return resp(c.stats);
  }
  if (tabla === 'cron_latidos' || tabla === 'error_log') return resp([], 201);
  let filas = filtrar(tabla, u.searchParams);
  // Carrera: dos avisos casi a la vez. El primero ya cambió la fila, pero el
  // segundo la leyó antes y la cree «enviado».
  if (lecturaVieja && tabla === 'sms_envios' && metodo === 'GET') filas = filas.map(f => ({ ...f, estado: 'enviado' }));
  if (metodo === 'PATCH') {
    const c = JSON.parse(init.body); filas.forEach(f => Object.assign(f, c));
    return /return=representation/.test((init.headers || {}).Prefer || '') ? resp(filas) : resp(null, 204);
  }
  if (metodo === 'POST') {
    const nuevas = [].concat(JSON.parse(init.body));
    if (tabla === 'campaign_recipients' && u.searchParams.get('on_conflict') === 'id') {
      for (const n of nuevas) Object.assign(T.campaign_recipients.find(r => r.id === n.id) || {}, n);
      return resp(null, 201);
    }
    if (tabla === 'sms_movimientos') {
      const repetida = nuevas.every(n => T.sms_movimientos.some(m => m.motivo === n.motivo && m.referencia === n.referencia));
      if (repetida) return resp([], 201);
      nuevas.forEach(n => { T.sms_movimientos.push(n); saldo[n.user_id] = (saldo[n.user_id] || 0) + n.cantidad; });
      return resp(nuevas, 201);
    }
    (T[tabla] = T[tabla] || []).push(...nuevas.map(n => ({ id: 'n' + (++idn), ...n })));
    return resp(nuevas, 201);
  }
  const off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 1000);
  return resp(filas.slice(off, off + lim));
};

function mundo() {
  saldo = {}; llamadas = []; labs = []; idn = 0;
  T = {
    team_members: [], sms_envios: [], sms_movimientos: [], campaign_recipients: [], email_events: [],
    leads: [
      { id: 'L1', user_id: 'dueno', client_id: null, name: 'Ana', phone: '300 111 2233', tags: [], deleted_at: null },
      { id: 'L2', user_id: 'dueno', client_id: null, name: 'Beto', phone: '601 7654321', tags: [], deleted_at: null },
      { id: 'L3', user_id: 'dueno', client_id: null, name: 'Caro', phone: '3104445566', tags: ['no-sms'], deleted_at: null },
      { id: 'L4', user_id: 'dueno', client_id: null, name: 'Dani', phone: '+57 320 777 8899', tags: [], deleted_at: null },
      { id: 'L5', user_id: 'dueno', client_id: null, name: 'Eva', phone: '3155550000', tags: [], deleted_at: null },
    ],
    campaigns: [{ id: 'C1', user_id: 'dueno', client_id: null, name: 'Promo', channel: 'sms', status: 'queued', body: 'Hola {{nombre}}, tenemos una promoción para ti.', stats: { total: 5 }, queued_at: '2026-10-01', scheduled_at: null }],
  };
  T.campaign_recipients = T.leads.map((l, i) => ({ id: 'R' + (i + 1), campaign_id: 'C1', lead_id: l.id, status: 'pending' }));
}

const cron = (await import('../api/cron-campaigns.js')).default;
const correrCron = async () => {
  let estado, cuerpo;
  const res = { status(s) { estado = s; return res; }, json(d) { cuerpo = d; return res; } };
  await cron({ headers: { authorization: 'Bearer cron' } }, res);
  return { estado, cuerpo };
};
const rcpt = (id) => T.campaign_recipients.find(r => r.id === id);

console.log('\nCampaña de SMS');
{
  mundo(); saldo.dueno = 10;
  AHORA = bog('2026-10-04T10:00'); // domingo
  await correrCron();
  ok(T.campaigns[0].status === 'queued' && T.campaign_recipients.every(r => r.status === 'pending') && !T.sms_envios.length,
    'un domingo la campaña ni se toca: sigue en cola y no se cobra nada');

  AHORA = bog('2026-10-01T10:00');
  const r = await correrCron();
  ok(r.estado === 200, 'en horario el cron corre', JSON.stringify(r.cuerpo));
  ok(rcpt('R1').status === 'sent' && rcpt('R4').status === 'sent' && rcpt('R5').status === 'sent', 'los tres móviles válidos reciben el SMS');
  ok(rcpt('R2').status === 'skipped' && /móvil/.test(rcpt('R2').detail), 'un teléfono fijo se salta con el motivo', rcpt('R2').detail);
  ok(rcpt('R3').status === 'skipped' && /baja/.test(rcpt('R3').detail), 'quien pidió no recibir SMS se salta', rcpt('R3').detail);
  ok(T.sms_envios.length === 3 && T.sms_envios.some(e => e.mensaje === 'Hola Ana, tenemos una promocion para ti.'), 'el texto sale personalizado y sin la tilde que lo haría Unicode',
    T.sms_envios.map(e => e.mensaje).join(' | '));
  ok(T.campaigns[0].status === 'sent' && T.campaigns[0].stats.sent === 3 && T.campaigns[0].stats.skipped === 2, 'la campaña se cierra con sus cifras', JSON.stringify(T.campaigns[0].stats));
  ok(saldo.dueno === 7, 'se cobraron 3 créditos', saldo.dueno);

  // Sin saldo a mitad: se pausa con el motivo y los que faltan siguen pendientes.
  mundo(); saldo.dueno = 1;
  await correrCron();
  const enviados = T.campaign_recipients.filter(r => r.status === 'sent').length;
  ok(enviados === 1, 'con 1 crédito sale 1', enviados);
  ok(T.campaigns[0].status === 'paused' && /Sin créditos/.test(T.campaigns[0].stats.motivo_pausa || ''), 'la campaña queda pausada diciendo por qué', JSON.stringify(T.campaigns[0]));
  ok(T.campaign_recipients.filter(r => r.status === 'pending').length === 2, 'los móviles que faltaban siguen pendientes para cuando haya saldo');
}

console.log('\nAPI de campañas');
{
  const h = (await import('../api/campaigns.js')).default;
  const tok = await tokenDe('dueno');
  const pedir = (ruta, metodo = 'GET', cuerpo) => h(new Request('https://app.acuarius.app' + ruta, { method: metodo, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }));
  mundo();
  let r = await pedir('/api/campaigns?preview=1&channel=sms&audience=' + encodeURIComponent('{}'));
  let d = await r.json();
  ok(r.status === 200 && d.count === 3, 'la audiencia de SMS cuenta solo los móviles válidos sin baja', JSON.stringify(d));
  ok(d.breakdown?.missing === 1 && d.breakdown?.unsubscribed === 1, 'y explica cuántos quedan fuera: 1 sin móvil, 1 de baja', JSON.stringify(d.breakdown));

  T.campaigns[0].status = 'draft'; T.campaign_recipients = [];
  saldo.dueno = 2;
  r = await pedir('/api/campaigns?action=queue', 'POST', { id: 'C1' });
  d = await r.json();
  ok(r.status === 402 && d.necesarios === 3 && d.saldo === 2, 'sin saldo para toda la audiencia no se encola', `${r.status} ${JSON.stringify(d)}`);
  ok(!T.campaign_recipients.length, 'y no quedó nadie en la cola');

  T.campaigns[0].status = 'paused'; T.campaigns[0].stats = { total: 3, sent: 1, motivo_pausa: 'Sin créditos de SMS.' };
  saldo.dueno = 0;
  r = await pedir('/api/campaigns?action=resume', 'POST', { id: 'C1' });
  ok(r.status === 402, 'reanudar sin haber comprado no sirve', r.status);
  saldo.dueno = 1000;
  r = await pedir('/api/campaigns?action=resume', 'POST', { id: 'C1' });
  ok(r.status === 200 && T.campaigns[0].status === 'sending' && !('motivo_pausa' in T.campaigns[0].stats), 'con saldo se reanuda y se borra el motivo', JSON.stringify(T.campaigns[0]));

  process.env.SMS_BETA = 'otra';
  r = await pedir('/api/campaigns', 'POST', { name: 'x', body: 'hola', channel: 'sms' });
  ok(r.status === 403, 'una cuenta fuera de la beta no puede crear campañas de SMS', r.status);
  process.env.SMS_BETA = 'dueno';
}

console.log('\nAutomatización');
{
  const { actionSendSms } = await import('../api/cron-automations.js');
  mundo(); saldo.dueno = 5;
  const auto = { id: 'A1', user_id: 'dueno' };
  let r = await actionSendSms({ body: 'Hola {{nombre}}' }, T.leads[0], auto);
  ok(r.result === 'sent' && /simulado/.test(r.detail), 'el paso envía (simulado sin proveedor)', JSON.stringify(r));
  ok(T.sms_envios[0]?.automation_id === 'A1' && T.sms_envios[0]?.lead_id === 'L1', 'y queda atado a la automatización y al lead');
  r = await actionSendSms({ body: 'Hola' }, T.leads[2], auto);
  ok(r.result === 'skipped', 'a quien se dio de baja no', JSON.stringify(r));
  AHORA = bog('2026-10-04T10:00');
  r = await actionSendSms({ body: 'Hola' }, T.leads[0], auto);
  AHORA = bog('2026-10-01T10:00');
  ok(r.result !== 'sent' && T.sms_envios.length === 1 && saldo.dueno === 4, 'un domingo no sale ni se cobra', JSON.stringify(r));
  r = await actionSendSms({ body: 'Hola' }, { ...T.leads[0], user_id: 'otra' }, { id: 'A2', user_id: 'otra' });
  ok(r.result === 'skipped' && T.sms_envios.length === 1, 'una cuenta fuera de la beta no envía', JSON.stringify(r));
  saldo.dueno = 0;
  r = await actionSendSms({ body: 'Hola' }, T.leads[0], auto);
  ok(r.result === 'failed' && /créditos/.test(r.detail), 'sin saldo queda como fallido y lo dice', JSON.stringify(r));
}

console.log('\nProveedor');
{
  const { enviarSms } = await import('../api/_sms.js');
  mundo(); saldo.dueno = 5;
  process.env.LABSMOBILE_USUARIO = 'u'; process.env.LABSMOBILE_TOKEN = 't';
  let r = await enviarSms({ userId: 'dueno', lead: T.leads[0], texto: 'Hola' });
  ok(r.estado === 'enviado' && labs.length === 1 && labs[0].recipient[0].msisdn === '573001112233', 'con credenciales sale por LabsMobile', JSON.stringify(r));
  r = await enviarSms({ userId: 'dueno', lead: T.leads[0], texto: 'x'.repeat(153 * 6 + 1) });
  ok(r.estado === 'omitido' && labs.length === 1, 'un texto de más de 6 SMS no sale', JSON.stringify(r));
  const labsOk = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes('labsmobile') ? resp({ code: 35, message: 'no credit' }) : labsOk(url, init);
  r = await enviarSms({ userId: 'dueno', lead: T.leads[0], texto: 'Hola' });
  globalThis.fetch = labsOk;
  ok(r.estado === 'fallido' && /LabsMobile 35/.test(r.detalle), 'un rechazo de LabsMobile queda como fallido con su código', JSON.stringify(r));
  ok(llamadas.some(l => l.tabla === 'rpc/sms_devolver'), 'y se devuelven los créditos');
  delete process.env.LABSMOBILE_USUARIO; delete process.env.LABSMOBILE_TOKEN;
}

console.log('\nCompra en Hotmart');
{
  const h = (await import('../api/hotmart-webhook.js')).default;
  const { cantidadSmsDelNombre } = await import('../api/hotmart-webhook.js');
  const evento = (tipo, extra = {}) => ({ event: tipo, data: { buyer: { email: 'dueno@x.co' }, product: { name: 'Acuarius SMS' }, purchase: { transaction: 'HP123', price: { value: 22, currency_value: 'USD' }, offer: { code: 'zz' } }, ...extra } });
  const llamar = async (body) => { let s, d; const res = { setHeader() {}, status(x) { s = x; return res; }, json(x) { d = x; return res; }, end() { return res; } }; await h({ method: 'POST', headers: { 'x-hotmart-hottok': 'hottok' }, body }, res); return { s, d }; };
  mundo();
  let r = await llamar(evento('PURCHASE_APPROVED'));
  ok(r.d?.action === 'sms_acreditados' && saldo.dueno === 3000, 'una compra de 22 USD acredita 3.000 créditos', `${JSON.stringify(r.d)} ${saldo.dueno}`);
  r = await llamar(evento('PURCHASE_COMPLETE'));
  ok(r.d?.action === 'sms_ya_acreditados' && saldo.dueno === 3000, 'el segundo aviso de la misma compra no suma otra vez', `${JSON.stringify(r.d)} ${saldo.dueno}`);
  r = await llamar(evento('PURCHASE_REFUNDED'));
  ok(r.d?.action === 'sms_cancelados' && saldo.dueno === 0, 'un reembolso los descuenta', `${JSON.stringify(r.d)} ${saldo.dueno}`);
  r = await llamar({ event: 'PURCHASE_APPROVED', data: { buyer: { email: 'dueno@x.co' }, product: { name: 'Acuarius SMS' }, purchase: { transaction: 'HP9', price: { value: 74360, currency_value: 'COP' } } } });
  ok(r.d?.action === 'sms_cantidad_indeterminada' && saldo.dueno === 0, 'un pago en pesos sin cantidad en el nombre NO se acredita a ojo: se avisa', JSON.stringify(r.d));
  r = await llamar({ event: 'PURCHASE_APPROVED', data: { buyer: { email: 'dueno@x.co' }, product: { name: 'Acuarius SMS' }, purchase: { transaction: 'HP10', offer: { name: 'Paquete 10.000 SMS' }, price: { value: 219700, currency_value: 'COP' } } } });
  ok(r.d?.action === 'sms_acreditados' && saldo.dueno === 10000, 'con la cantidad en el nombre de la oferta sí', `${JSON.stringify(r.d)} ${saldo.dueno}`);
  ok(cantidadSmsDelNombre('sms 3.000') === 3000 && cantidadSmsDelNombre('20k sms') === 20000 && cantidadSmsDelNombre('sms 4.000') === 0 && cantidadSmsDelNombre('acuarius sms') === 0,
    'del nombre solo se aceptan paquetes que existen');
}

console.log('\nConfirmación de entrega');
{
  const h = (await import('../api/sms-ack.js')).default;
  const { firmaAck } = await import('../api/_sms.js');
  mundo();
  const sub = 'a'.repeat(20);
  T.sms_envios.push({ id: 'E1', subid: sub, estado: 'enviado' });
  let r = await h(new Request(`https://app.acuarius.app/api/sms-ack?subid=${sub}&k=malo&status=ok&acklevel=handset`));
  ok(r.status === 403 && T.sms_envios[0].estado === 'enviado', 'con firma falsa no cambia nada');
  const k = await firmaAck(sub);
  r = await h(new Request(`https://app.acuarius.app/api/sms-ack?subid=${sub}&k=${k}&status=ok&acklevel=operator&desc=DELIVRD`));
  ok(r.status === 200 && T.sms_envios[0].estado === 'enviado', 'aceptado por el operador: sigue como enviado');
  r = await h(new Request(`https://app.acuarius.app/api/sms-ack?subid=${sub}&k=${k}&status=ok&acklevel=handset&desc=DELIVRD`));
  ok(T.sms_envios[0].estado === 'entregado', 'llegó al teléfono: entregado');
  r = await h(new Request(`https://app.acuarius.app/api/sms-ack?subid=${sub}&k=${k}&status=ko&acklevel=error&desc=UNDELIV`));
  ok(T.sms_envios[0].estado === 'entregado', 'un aviso tardío de error no pisa un entregado');
}

console.log('\nUn rechazo del operador corrige la campaña');
{
  const h = (await import('../api/sms-ack.js')).default;
  const { firmaAck } = await import('../api/_sms.js');
  mundo();
  const sub = 'b'.repeat(20), k = await firmaAck(sub);
  T.campaigns[0].status = 'sent'; T.campaigns[0].stats = { total: 2, sent: 2, skipped: 0, failed: 0 };
  T.campaign_recipients = [{ id: 'R1', campaign_id: 'C1', lead_id: 'L1', status: 'sent' }, { id: 'R4', campaign_id: 'C1', lead_id: 'L4', status: 'sent' }];
  T.sms_envios.push({ id: 'E9', subid: sub, estado: 'enviado', campaign_id: 'C1', lead_id: 'L1', user_id: 'dueno' });
  const aviso = (q) => h(new Request(`https://app.acuarius.app/api/sms-ack?subid=${sub}&k=${k}&${q}`));
  let r = await aviso('status=ko&acklevel=error&desc=REJECTD');
  ok(r.status === 200 && T.sms_envios.find(e => e.id === 'E9').estado === 'fallido', 'el rechazo marca el envío como fallido');
  ok(T.campaigns[0].stats.sent === 1 && T.campaigns[0].stats.failed === 1 && T.campaigns[0].stats.total === 2, 'y la campaña pasa a 1 enviado y 1 fallido', JSON.stringify(T.campaigns[0].stats));
  const r1 = T.campaign_recipients.find(x => x.id === 'R1');
  ok(r1.status === 'failed' && /REJECTD/.test(r1.detail || ''), 'el destinatario queda como fallido con el motivo', JSON.stringify(r1));
  ok(T.campaign_recipients.find(x => x.id === 'R4').status === 'sent', 'sin tocar a los demás destinatarios');
  await aviso('status=ko&acklevel=error&desc=REJECTD');
  ok(T.campaigns[0].stats.sent === 1 && T.campaigns[0].stats.failed === 1, 'el mismo aviso repetido no vuelve a restar', JSON.stringify(T.campaigns[0].stats));
  await aviso('status=ok&acklevel=handset&desc=DELIVRD');
  ok(T.sms_envios.find(e => e.id === 'E9').estado === 'entregado' && T.campaigns[0].stats.sent === 2 && T.campaigns[0].stats.failed === 0 && r1.status === 'sent',
    'un «entregado» tardío que desmiente el fallo lo deshace', JSON.stringify(T.campaigns[0].stats));
  T.sms_envios.push({ id: 'E10', subid: 'c'.repeat(20), estado: 'enviado', campaign_id: null, lead_id: 'L4', user_id: 'dueno' });
  await h(new Request(`https://app.acuarius.app/api/sms-ack?subid=${'c'.repeat(20)}&k=${await firmaAck('c'.repeat(20))}&status=ko&acklevel=error&desc=UNDELIV`));
  ok(T.sms_envios.find(e => e.id === 'E10').estado === 'fallido' && T.campaigns[0].stats.failed === 0, 'un SMS de automatización (sin campaña) no toca ninguna campaña');
  // E9 está entregado y la campaña en 2/0. Un aviso de rechazo que leyó el
  // envío antes de que cambiara no puede restar: el cambio condicional lo frena.
  T.sms_envios.find(e => e.id === 'E9').estado = 'fallido';
  T.campaigns[0].stats = { total: 2, sent: 1, skipped: 0, failed: 1 };
  lecturaVieja = true;
  await aviso('status=ko&acklevel=error&desc=REJECTD');
  lecturaVieja = false;
  ok(T.campaigns[0].stats.sent === 1 && T.campaigns[0].stats.failed === 1, 'dos avisos a la vez no restan dos veces', JSON.stringify(T.campaigns[0].stats));
}

console.log('\nBaja por «SALIR»');
{
  const h = (await import('../api/sms-entrante.js')).default;
  mundo();
  T.leads.push({ id: 'X1', user_id: 'otra', phone: '3001112233', tags: [] });
  T.sms_envios.push({ id: 'E1', user_id: 'dueno', telefono: '573001112233', created_at: '2026-10-01' });
  const entrar = (msg, k = 'entrante') => h(new Request(`https://app.acuarius.app/api/sms-entrante?k=${k}`, { method: 'POST', body: JSON.stringify({ msisdn: '573001112233', message: msg }) }));
  let r = await entrar('SALIR', 'malo');
  ok(r.status === 401, 'sin el secreto no se acepta');
  r = await entrar('Gracias, me interesa');
  ok(!T.leads[0].tags.includes('no-sms'), 'una respuesta normal no da de baja');
  r = await entrar('  salir ');
  ok(T.leads[0].tags.includes('no-sms'), '«salir» da de baja al lead de la cuenta que le escribió');
  ok(!T.leads.find(l => l.id === 'X1').tags.includes('no-sms'), 'y no toca el mismo número en otra cuenta');
  ok((T.lead_activities || []).some(a => a.lead_id === 'L1' && /no recibir más SMS/.test(a.content)), 'queda una nota en la ficha');
}

globalThis.Date = RealDate;
console.log(mal ? `\n${mal} fallos` : '\nTodo en verde');
process.exit(mal ? 1 : 0);
